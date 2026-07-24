const { app, BrowserWindow, ipcMain, Menu, screen, powerMonitor } = require('electron');
const os = require('os');
const path = require('path');
const petState = require('./src/petState');
const speech = require('./src/speech');
const configStore = require('./src/config');

const STATE_FILE = path.join(app.getPath('userData'), 'pet-state.json');

// --- レイアウト定数 ---
const PET_SIZE = 64;
const WINDOW_PADDING = 30; // セリフの吹き出し等がはみ出さないための余白
const WINDOW_MARGIN_FROM_EDGE = 24;
const ITEM_WINDOW_SIZE = 56; // 敵/コイン/骨を表示する別ウィンドウの一辺
const GAP = 14; // 主人と子分の間隔
const COMPANION_SIZE = 40; // 子分の見た目のサイズ

// --- 時間計測定数 ---
const TICK_INTERVAL_MS = 5000; // メインループの間隔
const TICK_SECONDS = TICK_INTERVAL_MS / 1000;
const IDLE_THRESHOLD_SECONDS = 90; // これ以上操作が無ければ「作業中」とみなさない
const SAVE_INTERVAL_MS = 30000;
const CHATTER_MIN_INTERVAL_MS = 45000; // アクティブウィンドウ検知によるセリフの最短間隔
const TASK_ACTION_DURATION_MS = 10000; // タスク固有アクション(対象ウィンドウの近くで待機)の継続時間
const TASK_ACTION_MIN_INTERVAL_MS = 30000; // 同じ分類のアクションを連発しないための最短間隔
const ENEMY_MIN_INTERVAL_MS = 90 * 1000; // 敵が出現してから次に出現できるまでの最短間隔
const ENEMY_AVG_INTERVAL_SECONDS = 150; // 平均的にこのくらいの間隔で出現するよう抽選確率を決める
const ENEMY_BATTLE_DURATION_MS = 6000; // 戦闘演出の長さ
const LOOT_MIN_INTERVAL_MS = 45 * 1000; // コイン/骨が出てから次に出現できるまでの最短間隔
const LOOT_AVG_INTERVAL_SECONDS = 90; // 平均的にこのくらいの間隔で出現するよう抽選確率を決める
const LOOT_DURATION_MS = 5000; // 拾って食べる演出の長さ
const SLEEP_THRESHOLD_SECONDS = 5 * 60; // これ以上操作が無ければ寝る

// --- 負荷(CPU/メモリ)による表情変化のしきい値(%) ---
const LOAD_BUSY_THRESHOLD = 50;
const LOAD_STRESSED_THRESHOLD = 80;

// --- 歩き回り(wander)関連定数 ---
const WANDER_TICK_MS = 50;
const DRAG_END_DEBOUNCE_MS = 220; // 最後の move イベントからこれだけ経ったら「手を離した」とみなす
const GRAVITY_PX_PER_S2 = 2200; // 落下の加速度
const RUN_SPEED_MULTIPLIER = 2.2; // 「走る」時の速度倍率
const ROLL_SPEED_MULTIPLIER = 1.6; // 「転がる」時の速度倍率
const JUMP_HEIGHT_PX = 46; // 「ジャンプ」の高さ
const JUMP_PERIOD_MS = 600; // ジャンプ1回分の周期
// 通常の歩行時に選ばれる移動スタイル。walkを多めにして、run/jump/rollはたまに混ざる程度にする。
const WALK_STYLES = ['walk', 'walk', 'walk', 'run', 'jump', 'roll'];
const MOVING_MODES = new Set(['walk', 'run', 'jump', 'roll']);
const MOVING_LIKE_MODES = new Set(['walk', 'run', 'jump', 'roll', 'seek']);

let mainWindow = null;
let tickIntervalId = null;
let wanderIntervalId = null;
let state = petState.loadState(STATE_FILE);
let config = configStore.loadConfig();
let lastActiveWindowKey = null;
let lastChatterAt = 0;
let lastActionAt = 0;
let lastActionCategoryKey = null;
let lastSaveTime = 0;
let lastCommandedBounds = null;
let prevCpuCores = os.cpus();
let battleActive = false;
let lastEnemyAt = 0;
let lootActive = false;
let lastLootAt = 0;
let isSleeping = false;
let itemWindow = null; // 敵/コイン/骨を表示する別ウィンドウ

function getGroundY(display, winH) {
  const work = display.workArea;
  return work.y + work.height - winH - WINDOW_MARGIN_FROM_EDGE;
}

function getXBounds(display, winW) {
  const work = display.workArea;
  return { minX: work.x, maxX: work.x + work.width - winW };
}

const wander = {
  x: 0,
  y: 0,
  vy: 0, // 落下時の垂直速度
  direction: 1, // 1: 右へ, -1: 左へ
  // 'idle' | 'walk' | 'run' | 'jump' | 'roll' | 'seek' | 'dragging' | 'falling' | 'action'
  mode: 'idle',
  modeUntil: 0,
  lastMoveEventAt: 0,
  jumpStartAt: 0,
  seekTargetX: 0,
  onArrive: null, // 'seek'で目的地に着いた時に呼ぶコールバック
  actionKind: null, // 'action'モード中の内訳: 'task' | 'loot' | 'battle'
  lastSentFacing: null,
  lastSentWalking: null,
  lastSentMoveStyle: null,
  lastSentFalling: null,
  lastSentDragging: null,
  lastSentHeight: 0,
};

// 子分は主人と同じウィンドウの中に横並びで表示するので、
// 子分の数に応じてウィンドウの幅を広げる(敵/コイン/骨は別ウィンドウのまま)。
function computeWindowSize(companionCount) {
  const width = WINDOW_PADDING * 2 + PET_SIZE + (COMPANION_SIZE + GAP) * companionCount;
  const height = WINDOW_PADDING * 2 + PET_SIZE + 40; // 40 = 吹き出し用の余白
  return { width: Math.round(width), height: Math.round(height) };
}

function createWindow() {
  const { width, height } = computeWindowSize(state.companions);
  const display = screen.getPrimaryDisplay();
  const { x: wx, y: wy, width: wW, height: wH } = display.workArea;

  mainWindow = new BrowserWindow({
    width,
    height,
    x: wx + wW - width - WINDOW_MARGIN_FROM_EDGE,
    y: wy + wH - height - WINDOW_MARGIN_FROM_EDGE,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  const [initialX, initialY] = mainWindow.getPosition();
  wander.x = initialX;
  wander.y = initialY;

  // ドラッグは -webkit-app-region:drag によるOSネイティブの移動に任せている
  // (JS側で座標を追いかける自前実装だと、カーソルが小さなウィンドウの外に
  // 出た瞬間に mousemove が届かなくなり、追従が止まってしまうため)。
  // 'move' は移動中連続で発火するので、自分で setBounds した直後の座標と
  // 一致しなければユーザーによるドラッグとみなす。
  mainWindow.on('move', () => {
    if (!mainWindow) return;
    const [x, y] = mainWindow.getPosition();
    const matchesCommand =
      lastCommandedBounds && Math.abs(x - lastCommandedBounds.x) <= 1 && Math.abs(y - lastCommandedBounds.y) <= 1;
    if (!matchesCommand) {
      // 敵/落し物イベントの途中(移動中や対応中)でユーザーに掴まれたら、
      // 中途半端な状態が残らないよう即座に片付ける。
      if (wander.mode === 'seek' || wander.mode === 'action') {
        cancelPendingEvent();
      }
      wander.x = x;
      wander.y = y;
      wander.vy = 0;
      wander.mode = 'dragging';
      wander.lastMoveEventAt = Date.now();
    }
  });

  // app-region:drag のエリアを右クリックすると、DOMの'contextmenu'より先に
  // OSの標準システムメニュー(最小化/閉じるなど)が出てしまう。これを横取りして
  // 自前のメニューを出す。
  mainWindow.on('system-context-menu', (event) => {
    event.preventDefault();
    buildContextMenu().popup({ window: mainWindow });
  });

  // ウィンドウ破棄後もタイマーが動き続けて破棄済みオブジェクトに
  // アクセスしてしまわないよう、破棄と同時にタイマーを止める。
  mainWindow.on('closed', () => {
    stopTimers();
    closeItemWindow(false);
    mainWindow = null;
  });
}

function startTimers() {
  stopTimers();
  tickIntervalId = setInterval(tick, TICK_INTERVAL_MS);
  wanderIntervalId = setInterval(wanderTick, WANDER_TICK_MS);
}

function stopTimers() {
  if (tickIntervalId) clearInterval(tickIntervalId);
  if (wanderIntervalId) clearInterval(wanderIntervalId);
  tickIntervalId = null;
  wanderIntervalId = null;
}

function moveWindowTo(x, y, width, height) {
  lastCommandedBounds = { x: Math.round(x), y: Math.round(y) };
  mainWindow.setBounds({ x: lastCommandedBounds.x, y: lastCommandedBounds.y, width, height });
}

// 子分は主人と同じウィンドウに同居しているので、子分の数が変わったらウィンドウ幅を
// 合わせ直す(見た目・動きは主人と共通のCSSがそのまま子分にも適用される)。
function resizeWindowForLayout() {
  if (!mainWindow) return;
  const { width, height } = computeWindowSize(state.companions);
  const [curX, curY] = mainWindow.getPosition();
  const [curW, curH] = mainWindow.getSize();
  // 右下を基準に、幅が増えた分だけ左に伸ばす
  const newX = curX - (width - curW);
  const newY = curY - (height - curH);
  wander.x = newX;
  wander.y = newY;
  moveWindowTo(newX, newY, width, height);
}

// 敵(ウイルス)/コイン/骨を、ペットのウィンドウとは別の透明ウィンドウとして
// 画面上のランダムな位置(地面の高さ)に表示する。
function spawnItemWindow(kind) {
  closeItemWindow(false);
  const display = screen.getDisplayNearestPoint({
    x: Math.round(wander.x + PET_SIZE / 2),
    y: Math.round(wander.y),
  });
  const work = display.workArea;
  const x = Math.round(work.x + Math.random() * Math.max(0, work.width - ITEM_WINDOW_SIZE));
  const y = work.y + work.height - ITEM_WINDOW_SIZE - WINDOW_MARGIN_FROM_EDGE;

  const win = new BrowserWindow({
    width: ITEM_WINDOW_SIZE,
    height: ITEM_WINDOW_SIZE,
    x,
    y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'renderer', 'item.html'), { query: { kind } });
  win.on('closed', () => {
    if (itemWindow === win) itemWindow = null;
  });
  itemWindow = win;
  return { x, y, width: ITEM_WINDOW_SIZE, height: ITEM_WINDOW_SIZE };
}

// withExitAnimation: trueならアイテム側にゆっくり消えるアニメーションをさせてから閉じる。
// falseなら(ドラッグ割り込み等の)即時クローズ。
function closeItemWindow(withExitAnimation) {
  if (!itemWindow || itemWindow.isDestroyed()) {
    itemWindow = null;
    return;
  }
  const win = itemWindow;
  itemWindow = null;
  if (withExitAnimation) {
    win.webContents
      .executeJavaScript(
        "document.querySelectorAll('.loot, .enemy').forEach((el) => { el.classList.remove('loot-enter', 'enemy-enter'); el.classList.add(el.classList.contains('enemy') ? 'enemy-defeated' : 'loot-cleared'); });"
      )
      .catch(() => {});
    setTimeout(() => {
      if (!win.isDestroyed()) win.close();
    }, 380);
  } else {
    win.close();
  }
}

// 別ウィンドウで表示したアイテムの中心を、ペットのウィンドウ座標系での目標X座標に変換する
// (ウィンドウ幅の半分だけ差し引いて、ペットの中心がアイテムに重なる位置を狙う)。
function computeSeekTargetX(item) {
  if (!mainWindow) return wander.x;
  const [winW] = mainWindow.getSize();
  const display = screen.getDisplayNearestPoint({ x: item.x, y: item.y });
  const { minX, maxX } = getXBounds(display, winW);
  const raw = Math.round(item.x + item.width / 2 - winW / 2);
  return Math.max(minX, Math.min(maxX, raw));
}

// 目標X座標まで「走って」向かい、着いたら onArrive を呼ぶ。
function startSeek(targetX, onArrive) {
  wander.mode = 'seek';
  wander.seekTargetX = targetX;
  wander.onArrive = onArrive;
}

// 'action'モードが時間切れで終わった時の後片付け。actionKindに応じて内容を分岐する。
function finishAction() {
  const kind = wander.actionKind;
  wander.actionKind = null;
  if (kind === 'task') {
    sendTaskAction(null);
  } else if (kind === 'loot') {
    lootActive = false;
    sendLooting(false);
    closeItemWindow(true);
  } else if (kind === 'battle') {
    battleActive = false;
    sendBattling(false);
    sendSpeech(speech.speechForEnemyDefeated());
    closeItemWindow(true);
  }
}

// ドラッグや就寝などで進行中のイベント(移動中/対応中の両方)に割り込まれた時、
// 中途半端な状態(消えないアクセサリーやウィンドウ)が残らないよう即座に片付ける。
function cancelPendingEvent() {
  const kind = wander.actionKind;
  wander.actionKind = null;
  wander.onArrive = null;
  if (kind === 'task') {
    sendTaskAction(null);
  } else if (kind === 'loot') {
    lootActive = false;
    sendLooting(false);
    closeItemWindow(false);
  } else if (kind === 'battle') {
    battleActive = false;
    sendBattling(false);
    closeItemWindow(false);
  } else if (lootActive || battleActive) {
    // 'seek'で目的地に向かっている途中(まだ到着前)に割り込まれたケース
    lootActive = false;
    battleActive = false;
    closeItemWindow(false);
  }
}

function sendState() {
  if (!mainWindow) return;
  mainWindow.webContents.send('state-update', petState.getProgress(state));
}

function sendSpeech(text) {
  if (!mainWindow) return;
  mainWindow.webContents.send('speech', { text });
}

function sendWalkState(force, heightAboveGround = 0) {
  if (!mainWindow) return;
  const facing = wander.direction >= 0 ? 'right' : 'left';
  const walking = MOVING_LIKE_MODES.has(wander.mode);
  // 'seek'(敵/落し物に向かって走る)は見た目上は「走る」として扱う
  const moveStyle = wander.mode === 'seek' ? 'run' : wander.mode;
  const falling = wander.mode === 'falling';
  const dragging = wander.mode === 'dragging';
  const height = Math.round(heightAboveGround);
  const changed =
    facing !== wander.lastSentFacing ||
    walking !== wander.lastSentWalking ||
    moveStyle !== wander.lastSentMoveStyle ||
    falling !== wander.lastSentFalling ||
    dragging !== wander.lastSentDragging ||
    Math.abs(height - wander.lastSentHeight) >= 2;
  if (!force && !changed) return;
  wander.lastSentFacing = facing;
  wander.lastSentWalking = walking;
  wander.lastSentMoveStyle = moveStyle;
  wander.lastSentFalling = falling;
  wander.lastSentDragging = dragging;
  wander.lastSentHeight = height;
  mainWindow.webContents.send('walk-state', { facing, walking, moveStyle, falling, dragging, heightAboveGround: height });
}

function sendLanded() {
  if (!mainWindow) return;
  mainWindow.webContents.send('landed');
}

function sendTaskAction(action) {
  if (!mainWindow) return;
  mainWindow.webContents.send('task-action', { action });
}

function sendSleepState(sleeping) {
  if (!mainWindow) return;
  mainWindow.webContents.send('sleep-state', { sleeping });
}

function sendLooting(active) {
  if (!mainWindow) return;
  mainWindow.webContents.send(active ? 'loot-spawn' : 'loot-clear');
}

function sendBattling(active) {
  if (!mainWindow) return;
  mainWindow.webContents.send(active ? 'enemy-spawn' : 'enemy-clear');
}

function cpuTimesTotal(cores) {
  let idle = 0;
  let total = 0;
  for (const core of cores) {
    idle += core.times.idle;
    total += core.times.user + core.times.nice + core.times.sys + core.times.idle + core.times.irq;
  }
  return { idle, total };
}

// 前回サンプルとの差分から CPU 使用率(%)を算出する
function sampleCpuPercent() {
  const cores = os.cpus();
  const prev = cpuTimesTotal(prevCpuCores);
  const cur = cpuTimesTotal(cores);
  prevCpuCores = cores;

  const idleDelta = cur.idle - prev.idle;
  const totalDelta = cur.total - prev.total;
  if (totalDelta <= 0) return 0;
  return Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100));
}

function sampleMemoryPercent() {
  const total = os.totalmem();
  const free = os.freemem();
  if (total <= 0) return 0;
  return ((total - free) / total) * 100;
}

function sendSystemLoad() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  const cpu = sampleCpuPercent();
  const mem = sampleMemoryPercent();
  const combined = Math.max(cpu, mem);

  let expression = 'calm';
  if (combined >= LOAD_STRESSED_THRESHOLD) expression = 'stressed';
  else if (combined >= LOAD_BUSY_THRESHOLD) expression = 'busy';

  mainWindow.webContents.send('system-load', { cpu: Math.round(cpu), mem: Math.round(mem), expression });
}

function randRange([min, max]) {
  return min + Math.random() * (max - min);
}

function pickNextWanderMode(now) {
  if (MOVING_MODES.has(wander.mode)) {
    wander.mode = 'idle';
    wander.modeUntil = now + randRange(config.idleDurationMs);
  } else {
    wander.mode = WALK_STYLES[Math.floor(Math.random() * WALK_STYLES.length)];
    if (Math.random() < 0.5) wander.direction *= -1;
    wander.modeUntil = now + randRange(config.walkDurationMs);
    wander.jumpStartAt = now;
  }
}

function wanderTick() {
  if (!mainWindow) return;
  const now = Date.now();

  const [winW, winH] = mainWindow.getSize();
  // ドラッグ中に別のモニターへ移動している場合があるため、現在位置に
  // 最も近いディスプレイを基準に境界を計算する(常にプライマリだと、
  // 手を離した瞬間に落下処理でプライマリ側へクランプされ戻ってしまう)。
  const display = screen.getDisplayNearestPoint({
    x: Math.round(wander.x + winW / 2),
    y: Math.round(wander.y + winH / 2),
  });
  const { minX, maxX } = getXBounds(display, winW);
  const groundY = getGroundY(display, winH);

  // ドラッグ中: OSに位置を委ね、動きが止まったら「手を離した」とみなして落下開始
  if (wander.mode === 'dragging') {
    if (now - wander.lastMoveEventAt > DRAG_END_DEBOUNCE_MS) {
      wander.mode = 'falling';
      wander.vy = 0;
    }
    sendWalkState(false, Math.max(0, groundY - wander.y));
    return;
  }

  // 落下中: 重力で加速しながら地面まで降りる
  if (wander.mode === 'falling') {
    wander.vy += GRAVITY_PX_PER_S2 * (WANDER_TICK_MS / 1000);
    wander.y += wander.vy * (WANDER_TICK_MS / 1000);
    wander.x = Math.max(minX, Math.min(maxX, wander.x));
    if (wander.y >= groundY) {
      wander.y = groundY;
      wander.vy = 0;
      wander.mode = 'idle';
      wander.modeUntil = now + randRange(config.idleDurationMs);
      moveWindowTo(wander.x, wander.y, winW, winH);
      sendWalkState(false, 0);
      sendLanded();
      return;
    }
    moveWindowTo(wander.x, wander.y, winW, winH);
    sendWalkState(false, groundY - wander.y);
    return;
  }

  // 'action'中(タスク固有アクション/落し物/戦闘): その場に留まり、時間が来たら片付けて通常状態に戻す
  if (wander.mode === 'action') {
    if (now >= wander.modeUntil) {
      wander.mode = 'idle';
      wander.modeUntil = now + randRange(config.idleDurationMs);
      finishAction();
    }
    sendWalkState(false, 0);
    return;
  }

  // 'seek'中: 敵/落し物に向かって走って移動し、着いたらコールバックを呼ぶ
  if (wander.mode === 'seek') {
    const step = (config.wanderSpeedPxPerSec * RUN_SPEED_MULTIPLIER * WANDER_TICK_MS) / 1000;
    const remaining = wander.seekTargetX - wander.x;
    if (Math.abs(remaining) <= step) {
      wander.x = wander.seekTargetX;
      wander.y = groundY;
      moveWindowTo(wander.x, wander.y, winW, winH);
      const onArrive = wander.onArrive;
      wander.onArrive = null;
      sendWalkState(true, 0);
      if (onArrive) onArrive();
      return;
    }
    wander.direction = remaining > 0 ? 1 : -1;
    wander.x += step * wander.direction;
    wander.x = Math.max(minX, Math.min(maxX, wander.x));
    wander.y = groundY;
    moveWindowTo(wander.x, wander.y, winW, winH);
    sendWalkState(false, 0);
    return;
  }

  // 通常の歩き回り(configで無効化されている、または就寝中は静止したまま)
  if (!config.wander || isSleeping) return;
  if (now >= wander.modeUntil) pickNextWanderMode(now);

  if (MOVING_MODES.has(wander.mode)) {
    const speedMultiplier = wander.mode === 'run' ? RUN_SPEED_MULTIPLIER : wander.mode === 'roll' ? ROLL_SPEED_MULTIPLIER : 1;
    const dx = ((config.wanderSpeedPxPerSec * speedMultiplier * WANDER_TICK_MS) / 1000) * wander.direction;
    wander.x += dx;
    if (wander.x <= minX) {
      wander.x = minX;
      wander.direction = 1;
    } else if (wander.x >= maxX) {
      wander.x = maxX;
      wander.direction = -1;
    }
  }
  wander.x = Math.max(minX, Math.min(maxX, wander.x));

  // ジャンプ中だけ地面から浮く(sin弧)。跳ねている高さは影の大きさにも使う。
  let heightAboveGround = 0;
  if (wander.mode === 'jump') {
    const t = ((now - wander.jumpStartAt) % JUMP_PERIOD_MS) / JUMP_PERIOD_MS;
    heightAboveGround = Math.max(0, Math.sin(t * Math.PI)) * JUMP_HEIGHT_PX;
  }
  wander.y = groundY - heightAboveGround;

  moveWindowTo(wander.x, wander.y, winW, winH);
  sendWalkState(false, heightAboveGround);
}

function toggleWander() {
  config.wander = !config.wander;
  configStore.saveConfig(config);
  if (!config.wander) {
    wander.mode = 'idle';
    sendWalkState(true);
  }
}

function saveIfDue(force) {
  const now = Date.now();
  if (force || now - lastSaveTime > SAVE_INTERVAL_MS) {
    petState.saveState(STATE_FILE, state);
    lastSaveTime = now;
  }
}

// category に固有アクションがあれば、同じ分類の開いているウィンドウの中から
// 自分に一番近いものを探し、その近くまで移動してアクション状態にする。
async function maybeStartTaskAction(activeWin, category) {
  if (!mainWindow || !category) return;
  const actionKey = speech.actionForCategory(category.key);
  if (!actionKey) return;
  if (wander.mode === 'dragging' || wander.mode === 'falling' || wander.mode === 'seek') return;
  if (battleActive || lootActive) return;

  const now = Date.now();
  if (actionKey === lastActionCategoryKey && now - lastActionAt < TASK_ACTION_MIN_INTERVAL_MS) return;

  let openWindows;
  try {
    openWindows = await activeWin.getOpenWindows();
  } catch (err) {
    console.error('getOpenWindows failed:', err.message);
    return;
  }
  if (!mainWindow) return;

  const [winW, winH] = mainWindow.getSize();
  const petCenterX = wander.x + winW / 2;
  const petCenterY = wander.y + winH / 2;

  let nearest = null;
  let nearestDist = Infinity;
  for (const win of openWindows) {
    if (!win.bounds) continue;
    const matched = speech.matchCategory(win.owner ? win.owner.name : '', win.title);
    if (!matched || matched.key !== category.key) continue;
    const cx = win.bounds.x + win.bounds.width / 2;
    const cy = win.bounds.y + win.bounds.height / 2;
    const dist = Math.hypot(cx - petCenterX, cy - petCenterY);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = win;
    }
  }
  if (!nearest) return;

  const display = screen.getDisplayNearestPoint({
    x: Math.round(nearest.bounds.x + nearest.bounds.width / 2),
    y: Math.round(nearest.bounds.y + nearest.bounds.height / 2),
  });
  const { minX, maxX } = getXBounds(display, winW);
  const groundY = getGroundY(display, winH);
  // 対象ウィンドウの右下付近を目指す(画面外に出ないようクランプ)
  const targetX = Math.max(minX, Math.min(maxX, nearest.bounds.x + nearest.bounds.width - winW - 12));

  wander.x = targetX;
  wander.y = groundY;
  wander.vy = 0;
  wander.mode = 'action';
  wander.actionKind = 'task';
  wander.modeUntil = now + TASK_ACTION_DURATION_MS;
  lastActionAt = now;
  lastActionCategoryKey = actionKey;

  moveWindowTo(wander.x, wander.y, winW, winH);
  sendWalkState(true, 0);
  sendTaskAction(actionKey);
}

// たまにウイルスっぽい敵を画面上のランダムな位置(別ウィンドウ)に出現させ、
// 主人がそこまで走って行って少しの間「戦う」演出をする。
// ゲーム的な報酬などは無く、見た目だけの一発イベント。
function maybeSpawnEnemy(now) {
  if (battleActive || lootActive) return;
  if (wander.mode === 'dragging' || wander.mode === 'falling' || wander.mode === 'seek') return;
  if (now - lastEnemyAt < ENEMY_MIN_INTERVAL_MS) return;
  if (Math.random() > TICK_SECONDS / ENEMY_AVG_INTERVAL_SECONDS) return;
  startEnemyBattle(now);
}

function startEnemyBattle(now) {
  if (!mainWindow) return;
  battleActive = true;
  lastEnemyAt = now;
  const item = spawnItemWindow('enemy');
  sendSpeech(speech.speechForEnemyAppear());
  startSeek(computeSeekTargetX(item), () => {
    wander.mode = 'action';
    wander.actionKind = 'battle';
    wander.modeUntil = Date.now() + ENEMY_BATTLE_DURATION_MS;
    sendBattling(true);
  });
}

// たまにコインか骨付き肉を画面上のランダムな位置(別ウィンドウ)に落としておき、
// 主人がそこまで走って行って拾って食べる演出をする。
// こちらもゲーム的な報酬(所持数など)は持たせず、見た目だけの一発イベント。
function maybeSpawnLoot(now) {
  if (lootActive || battleActive) return;
  if (wander.mode === 'dragging' || wander.mode === 'falling' || wander.mode === 'seek') return;
  if (now - lastLootAt < LOOT_MIN_INTERVAL_MS) return;
  if (Math.random() > TICK_SECONDS / LOOT_AVG_INTERVAL_SECONDS) return;
  startLoot(now);
}

function startLoot(now) {
  if (!mainWindow) return;
  const kind = Math.random() < 0.5 ? 'coin' : 'bone';
  lootActive = true;
  lastLootAt = now;
  const item = spawnItemWindow(kind);
  sendSpeech(speech.speechForLootFound(kind));
  startSeek(computeSeekTargetX(item), () => {
    wander.mode = 'action';
    wander.actionKind = 'loot';
    wander.modeUntil = Date.now() + LOOT_DURATION_MS;
    sendLooting(true);
  });
}

async function checkActiveWindow() {
  try {
    const activeWin = await import('active-win');
    const result = await activeWin.default();
    if (!result) return;
    const owner = result.owner ? result.owner.name : '';
    const title = result.title || '';
    const key = `${owner}::${title}`;
    if (key !== lastActiveWindowKey) {
      lastActiveWindowKey = key;
      const now = Date.now();
      const category = speech.matchCategory(owner, title);
      if (now - lastChatterAt >= CHATTER_MIN_INTERVAL_MS) {
        lastChatterAt = now;
        sendSpeech(speech.speechForWindow(owner, title));
      }
      await maybeStartTaskAction(activeWin, category);
    }
  } catch (err) {
    // active-win はプラットフォームによっては権限が必要な場合がある。失敗しても致命的ではない。
    console.error('active-win failed:', err.message);
  }
}

function tick() {
  sendSystemLoad();

  const idleSeconds = powerMonitor.getSystemIdleTime();
  const now = Date.now();

  const sleeping = idleSeconds >= SLEEP_THRESHOLD_SECONDS;
  if (sleeping !== isSleeping) {
    isSleeping = sleeping;
    if (isSleeping) {
      // 眠りに入る瞬間、移動中/イベント対応中でも即座に片付けて寝姿に切り替える
      if (wander.mode === 'seek' || wander.mode === 'action') {
        cancelPendingEvent();
      }
      wander.mode = 'idle';
      sendWalkState(true);
    }
    sendSleepState(isSleeping);
  }

  if (idleSeconds < IDLE_THRESHOLD_SECONDS) {
    const { leveledUp, gainedCompanion } = petState.addActiveSeconds(state, TICK_SECONDS);

    if (gainedCompanion) {
      resizeWindowForLayout();
      sendSpeech(speech.speechForCompanion(state.companions));
    } else if (leveledUp) {
      sendSpeech(speech.speechForLevelUp(state.level));
    }

    checkActiveWindow();
    maybeSpawnEnemy(now);
    maybeSpawnLoot(now);
  }

  sendState();
  saveIfDue(false);
}

function buildContextMenu() {
  return Menu.buildFromTemplate([
    { label: `Lv.${state.level} / 子分 ${state.companions}匹`, enabled: false },
    { type: 'separator' },
    {
      label: config.wander ? '歩き回るのをやめさせる' : '歩き回らせる',
      click: () => toggleWander(),
    },
    {
      label: '色を変える',
      submenu: petState.COLORS.map((c) => ({
        label: c.label,
        type: 'radio',
        checked: state.color === c.key,
        click: () => {
          petState.setColor(state, c.key);
          petState.saveState(STATE_FILE, state);
          sendState();
        },
      })),
    },
    {
      label: '見た目を変える',
      submenu: petState.SKINS.map((s) => ({
        label: s.label,
        type: 'radio',
        checked: state.skin === s.key,
        click: () => {
          petState.setSkin(state, s.key);
          petState.saveState(STATE_FILE, state);
          sendState();
        },
      })),
    },
    {
      label: 'データをリセット',
      click: () => {
        state = petState.defaultState();
        petState.saveState(STATE_FILE, state);
        resizeWindowForLayout();
        sendState();
      },
    },
    { type: 'separator' },
    { label: '終了', click: () => app.quit() },
  ]);
}

app.whenReady().then(() => {
  createWindow();
  startTimers();

  configStore.watchConfig((newConfig) => {
    config = newConfig;
    sendWalkState(true);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      startTimers();
    }
  });
});

app.on('window-all-closed', () => {
  petState.saveState(STATE_FILE, state);
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  petState.saveState(STATE_FILE, state);
});

ipcMain.on('pet:ready', () => {
  sendState();
});

ipcMain.on('pet:quit', () => {
  app.quit();
});

ipcMain.on('pet:reset', () => {
  state = petState.defaultState();
  petState.saveState(STATE_FILE, state);
  resizeWindowForLayout();
  sendState();
});

ipcMain.on('pet:context-menu', () => {
  buildContextMenu().popup({ window: mainWindow });
});
