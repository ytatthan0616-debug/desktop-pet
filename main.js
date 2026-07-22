const { app, BrowserWindow, ipcMain, Menu, screen, powerMonitor } = require('electron');
const path = require('path');
const petState = require('./src/petState');
const speech = require('./src/speech');
const configStore = require('./src/config');

const STATE_FILE = path.join(app.getPath('userData'), 'pet-state.json');

// --- レイアウト定数 ---
const PET_SIZE = 64;
const GAP = 14;
const WINDOW_PADDING = 30; // セリフの吹き出し等がはみ出さないための余白
const WINDOW_MARGIN_FROM_EDGE = 24;

// --- 時間計測定数 ---
const TICK_INTERVAL_MS = 5000; // メインループの間隔
const TICK_SECONDS = TICK_INTERVAL_MS / 1000;
const IDLE_THRESHOLD_SECONDS = 90; // これ以上操作が無ければ「作業中」とみなさない
const SAVE_INTERVAL_MS = 30000;

// --- 歩き回り(wander)関連定数 ---
const WANDER_TICK_MS = 50;
const DRAG_END_DEBOUNCE_MS = 220; // 最後の move イベントからこれだけ経ったら「手を離した」とみなす
const GRAVITY_PX_PER_S2 = 2200; // 落下の加速度

let mainWindow = null;
let state = petState.loadState(STATE_FILE);
let config = configStore.loadConfig();
let lastActiveWindowKey = null;
let lastSaveTime = 0;
let lastCommandedBounds = null;

const wander = {
  x: 0,
  y: 0,
  vy: 0, // 落下時の垂直速度
  direction: 1, // 1: 右へ, -1: 左へ
  mode: 'idle', // 'idle' | 'walk' | 'dragging' | 'falling'
  modeUntil: 0,
  lastMoveEventAt: 0,
  lastSentFacing: null,
  lastSentWalking: null,
  lastSentFalling: null,
  lastSentHeight: 0,
};

function windowSizeForCompanions(companionCount) {
  const petCount = 1 + companionCount;
  const width = WINDOW_PADDING * 2 + PET_SIZE * petCount + GAP * (petCount - 1);
  const height = WINDOW_PADDING * 2 + PET_SIZE + 40; // 40 = 吹き出し用の余白
  return { width: Math.round(width), height: Math.round(height) };
}

function createWindow() {
  const { width, height } = windowSizeForCompanions(state.companions);
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

  // Windows/Linux では 'move' が移動中連続で発火する。
  // 自分で setBounds した直後の座標と一致しなければユーザーによるドラッグとみなす。
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
}

function moveWindowTo(x, y, width, height) {
  lastCommandedBounds = { x: Math.round(x), y: Math.round(y) };
  mainWindow.setBounds({ x: lastCommandedBounds.x, y: lastCommandedBounds.y, width, height });
}

function resizeWindowForCompanions() {
  if (!mainWindow) return;
  const { width, height } = windowSizeForCompanions(state.companions);
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
  const height = Math.round(heightAboveGround);
  const changed =
    facing !== wander.lastSentFacing ||
    walking !== wander.lastSentWalking ||
    falling !== wander.lastSentFalling ||
    Math.abs(height - wander.lastSentHeight) >= 2;
  if (!force && !changed) return;
  wander.lastSentFacing = facing;
  wander.lastSentWalking = walking;
  wander.lastSentFalling = falling;
  wander.lastSentHeight = height;
  mainWindow.webContents.send('walk-state', { facing, walking, falling, heightAboveGround: height });
}

function sendLanded() {
  if (!mainWindow) return;
  mainWindow.webContents.send('landed');
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
  const { x: workX, y: workY, width: workW, height: workH } = screen.getPrimaryDisplay().workArea;
  const minX = workX;
  const maxX = workX + workW - winW;
  const groundY = workY + workH - winH - WINDOW_MARGIN_FROM_EDGE;

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

  // 通常の歩き回り(configで無効化されている場合は静止したまま)
  if (!config.wander) return;
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
      sendSpeech(speech.speechForWindow(owner, title));
    }
  } catch (err) {
    // active-win はプラットフォームによっては権限が必要な場合がある。失敗しても致命的ではない。
    console.error('active-win failed:', err.message);
  }
}

function tick() {
  const idleSeconds = powerMonitor.getSystemIdleTime();

  if (idleSeconds < IDLE_THRESHOLD_SECONDS) {
    const { leveledUp, gainedCompanion } = petState.addActiveSeconds(state, TICK_SECONDS);

    if (gainedCompanion) {
      resizeWindowForCompanions();
      sendSpeech(speech.speechForCompanion(state.companions));
    } else if (leveledUp) {
      sendSpeech(speech.speechForLevelUp(state.level));
    }

    checkActiveWindow();
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
      label: 'データをリセット',
      click: () => {
        state = petState.defaultState();
        petState.saveState(STATE_FILE, state);
        resizeWindowForCompanions();
        sendState();
      },
    },
    { type: 'separator' },
    { label: '終了', click: () => app.quit() },
  ]);
}

app.whenReady().then(() => {
  createWindow();
  setInterval(tick, TICK_INTERVAL_MS);
  setInterval(wanderTick, WANDER_TICK_MS);

  configStore.watchConfig((newConfig) => {
    config = newConfig;
    sendWalkState(true);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
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
  resizeWindowForCompanions();
  sendState();
});

ipcMain.on('pet:context-menu', () => {
  buildContextMenu().popup({ window: mainWindow });
});
