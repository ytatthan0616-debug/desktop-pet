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
const SWARM_VERTICAL_ROOM = 20; // 子分が跳ねる分の縦方向の余白(子分がいる時のみ加算)
const ENEMY_SLOT_WIDTH = 60; // 敵(ウイルス)を表示するために追加するウィンドウ幅

// --- 時間計測定数 ---
const TICK_INTERVAL_MS = 5000; // メインループの間隔
const TICK_SECONDS = TICK_INTERVAL_MS / 1000;
const IDLE_THRESHOLD_SECONDS = 90; // これ以上操作が無ければ「作業中」とみなさない
const SAVE_INTERVAL_MS = 30000;
const CHATTER_MIN_INTERVAL_MS = 45000; // アクティブウィンドウ検知によるセリフの最短間隔
const TASK_ACTION_DURATION_MS = 10000; // タスク固有アクション(対象ウィンドウの近くで待機)の継続時間
const TASK_ACTION_MIN_INTERVAL_MS = 30000; // 同じ分類のアクションを連発しないための最短間隔
const ENEMY_MIN_INTERVAL_MS = 3 * 60 * 1000; // 敵が出現してから次に出現できるまでの最短間隔
const ENEMY_AVG_INTERVAL_SECONDS = 300; // 平均的にこのくらいの間隔で出現するよう抽選確率を決める
const ENEMY_BATTLE_DURATION_MS = 6000; // 戦闘演出の長さ
const LOOT_MIN_INTERVAL_MS = 2 * 60 * 1000; // コイン/骨が出てから次に出現できるまでの最短間隔
const LOOT_AVG_INTERVAL_SECONDS = 240; // 平均的にこのくらいの間隔で出現するよう抽選確率を決める
const LOOT_DURATION_MS = 5000; // 拾って食べる演出の長さ
const SLEEP_THRESHOLD_SECONDS = 5 * 60; // これ以上操作が無ければ寝る

// --- 負荷(CPU/メモリ)による表情変化のしきい値(%) ---
const LOAD_BUSY_THRESHOLD = 50;
const LOAD_STRESSED_THRESHOLD = 80;

// --- 歩き回り(wander)関連定数 ---
const WANDER_TICK_MS = 50;
const DRAG_END_DEBOUNCE_MS = 220; // 最後の move イベントからこれだけ経ったら「手を離した」とみなす
const GRAVITY_PX_PER_S2 = 2200; // 落下の加速度

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
let battleTimeoutId = null;
let lastEnemyAt = 0;
let lootActive = false;
let lootTimeoutId = null;
let lastLootAt = 0;
let isSleeping = false;

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
  mode: 'idle', // 'idle' | 'walk' | 'dragging' | 'falling' | 'action'
  modeUntil: 0,
  lastMoveEventAt: 0,
  lastSentFacing: null,
  lastSentWalking: null,
  lastSentFalling: null,
  lastSentDragging: null,
  lastSentHeight: 0,
};

// 子分は一列に並ばず主人のまわりで地面を跳ねながら動き回る(renderer側でランダムに位置を動かす)ので、
// 子分の数に応じて「動き回れる余白」をウィンドウに持たせる。戦闘中は敵の表示スペースも足す。
function computeWindowSize(companionCount, isBattleActive) {
  const swarmRadius = companionCount > 0 ? Math.min(130, 50 + companionCount * 11) : 0;
  const enemyWidth = isBattleActive ? ENEMY_SLOT_WIDTH : 0;
  const width = WINDOW_PADDING * 2 + PET_SIZE + swarmRadius * 2 + enemyWidth;
  const height = WINDOW_PADDING * 2 + PET_SIZE + 40 + (companionCount > 0 ? SWARM_VERTICAL_ROOM : 0); // 40 = 吹き出し用の余白
  return { width: Math.round(width), height: Math.round(height) };
}

function createWindow() {
  const { width, height } = computeWindowSize(state.companions, battleActive);
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
    if (battleTimeoutId) {
      clearTimeout(battleTimeoutId);
      battleTimeoutId = null;
    }
    if (lootTimeoutId) {
      clearTimeout(lootTimeoutId);
      lootTimeoutId = null;
    }
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

function resizeWindowForLayout() {
  if (!mainWindow) return;
  const { width, height } = computeWindowSize(state.companions, battleActive);
  const [curX, curY] = mainWindow.getPosition();
  const [curW, curH] = mainWindow.getSize();
  // 右下を基準に、幅が増えた分だけ左に伸ばす
  const newX = curX - (width - curW);
  const newY = curY - (height - curH);
  wander.x = newX;
  wander.y = newY;
  moveWindowTo(newX, newY, width, height);
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
  const walking = config.wander && wander.mode === 'walk';
  const falling = wander.mode === 'falling';
  const dragging = wander.mode === 'dragging';
  const height = Math.round(heightAboveGround);
  const changed =
    facing !== wander.lastSentFacing ||
    walking !== wander.lastSentWalking ||
    falling !== wander.lastSentFalling ||
    dragging !== wander.lastSentDragging ||
    Math.abs(height - wander.lastSentHeight) >= 2;
  if (!force && !changed) return;
  wander.lastSentFacing = facing;
  wander.lastSentWalking = walking;
  wander.lastSentFalling = falling;
  wander.lastSentDragging = dragging;
  wander.lastSentHeight = height;
  mainWindow.webContents.send('walk-state', { facing, walking, falling, dragging, heightAboveGround: height });
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

function sendLootSpawn(kind) {
  if (!mainWindow) return;
  mainWindow.webContents.send('loot-spawn', { kind });
}

function sendLootClear() {
  if (!mainWindow) return;
  mainWindow.webContents.send('loot-clear');
}

function sendEnemySpawn() {
  if (!mainWindow) return;
  mainWindow.webContents.send('enemy-spawn');
}

function sendEnemyClear() {
  if (!mainWindow) return;
  mainWindow.webContents.send('enemy-clear');
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
  if (wander.mode === 'walk') {
    wander.mode = 'idle';
    wander.modeUntil = now + randRange(config.idleDurationMs);
  } else {
    wander.mode = 'walk';
    if (Math.random() < 0.5) wander.direction *= -1;
    wander.modeUntil = now + randRange(config.walkDurationMs);
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

  // タスク固有アクション中: 対象ウィンドウのそばで静止し、時間が来たら通常状態に戻す
  if (wander.mode === 'action') {
    if (now >= wander.modeUntil) {
      wander.mode = 'idle';
      wander.modeUntil = now + randRange(config.idleDurationMs);
      sendTaskAction(null);
    }
    sendWalkState(false, 0);
    return;
  }

  // 通常の歩き回り(configで無効化されている、または就寝中は静止したまま)
  if (!config.wander || isSleeping) return;
  if (now >= wander.modeUntil) pickNextWanderMode(now);

  if (wander.mode === 'walk') {
    const dx = ((config.wanderSpeedPxPerSec * WANDER_TICK_MS) / 1000) * wander.direction;
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
  wander.y = groundY;

  moveWindowTo(wander.x, wander.y, winW, winH);
  sendWalkState(false, 0);
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
  if (wander.mode === 'dragging' || wander.mode === 'falling') return;

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
  wander.modeUntil = now + TASK_ACTION_DURATION_MS;
  lastActionAt = now;
  lastActionCategoryKey = actionKey;

  moveWindowTo(wander.x, wander.y, winW, winH);
  sendWalkState(true, 0);
  sendTaskAction(actionKey);
}

// たまにウイルスっぽい敵を出現させ、少しの間ペットたちに「戦わせる」演出をする。
// ゲーム的な報酬などは無く、見た目だけの一発イベント。
function maybeSpawnEnemy(now) {
  if (battleActive || lootActive) return;
  if (wander.mode === 'dragging' || wander.mode === 'falling') return;
  if (now - lastEnemyAt < ENEMY_MIN_INTERVAL_MS) return;
  if (Math.random() > TICK_SECONDS / ENEMY_AVG_INTERVAL_SECONDS) return;
  startEnemyBattle(now);
}

function startEnemyBattle(now) {
  if (!mainWindow) return;
  battleActive = true;
  lastEnemyAt = now;
  resizeWindowForLayout();
  sendSpeech(speech.speechForEnemyAppear());
  sendEnemySpawn();
  if (battleTimeoutId) clearTimeout(battleTimeoutId);
  battleTimeoutId = setTimeout(endEnemyBattle, ENEMY_BATTLE_DURATION_MS);
}

function endEnemyBattle() {
  battleTimeoutId = null;
  battleActive = false;
  sendEnemyClear();
  sendSpeech(speech.speechForEnemyDefeated());
  resizeWindowForLayout();
}

// たまに足元にコインか骨付き肉を落としておき、主人がそれを拾って食べる演出をする。
// こちらもゲーム的な報酬(所持数など)は持たせず、見た目だけの一発イベント。
function maybeSpawnLoot(now) {
  if (lootActive || battleActive) return;
  if (wander.mode === 'dragging' || wander.mode === 'falling') return;
  if (now - lastLootAt < LOOT_MIN_INTERVAL_MS) return;
  if (Math.random() > TICK_SECONDS / LOOT_AVG_INTERVAL_SECONDS) return;
  startLoot(now);
}

function startLoot(now) {
  if (!mainWindow) return;
  const kind = Math.random() < 0.5 ? 'coin' : 'bone';
  lootActive = true;
  lastLootAt = now;
  sendSpeech(speech.speechForLootFound(kind));
  sendLootSpawn(kind);
  if (lootTimeoutId) clearTimeout(lootTimeoutId);
  lootTimeoutId = setTimeout(endLoot, LOOT_DURATION_MS);
}

function endLoot() {
  lootTimeoutId = null;
  lootActive = false;
  sendLootClear();
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
      // 眠りに入る瞬間、歩行中でも即座に静止させて見た目を寝姿に切り替える
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
