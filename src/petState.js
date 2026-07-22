// レベル・子分(仲間)の進行状況を管理するモジュール。
// 永続化は呼び出し側 (main.js) が fs を使って行う。

const fs = require('fs');

// 30分の作業(アクティブ)時間で1レベルアップ
const SECONDS_PER_LEVEL = 30 * 60;
// 3レベルごとに子分が1匹増える
const COMPANION_EVERY_LEVELS = 3;
// 子分の最大数(ウィンドウが際限なく巨大化しないための上限)
const MAX_COMPANIONS = 8;

// 見た目の色。すべて無料で選択可能。
const COLORS = [
  { key: 'white', label: '白(デフォルト)' },
  { key: 'black', label: '黒' },
  { key: 'red', label: '赤' },
  { key: 'blue', label: '青' },
  { key: 'green', label: '緑' },
  { key: 'yellow', label: '黄' },
  { key: 'pink', label: 'ピンク' },
  { key: 'purple', label: '紫' },
  { key: 'rainbow', label: 'レインボー' },
];
const DEFAULT_COLOR = 'white';
const COLOR_KEYS = COLORS.map((c) => c.key);

function computeLevel(totalSeconds) {
  return Math.floor(totalSeconds / SECONDS_PER_LEVEL) + 1;
}

function computeCompanions(level) {
  return Math.min(MAX_COMPANIONS, Math.floor((level - 1) / COMPANION_EVERY_LEVELS));
}

function defaultState() {
  return {
    totalSeconds: 0,
    level: 1,
    companions: 0,
    color: DEFAULT_COLOR,
  };
}

function loadState(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const totalSeconds = Number(parsed.totalSeconds) || 0;
    const level = computeLevel(totalSeconds);
    return {
      totalSeconds,
      level,
      companions: computeCompanions(level),
      color: COLOR_KEYS.includes(parsed.color) ? parsed.color : DEFAULT_COLOR,
    };
  } catch (err) {
    return defaultState();
  }
}

function setColor(state, colorKey) {
  if (!COLOR_KEYS.includes(colorKey)) return state;
  state.color = colorKey;
  return state;
}

function saveState(filePath, state) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save pet state:', err);
  }
}

// deltaSeconds 分だけ経過させ、レベルアップ/子分増加が起きたかを返す
function addActiveSeconds(state, deltaSeconds) {
  const prevLevel = state.level;
  const prevCompanions = state.companions;

  state.totalSeconds += deltaSeconds;
  state.level = computeLevel(state.totalSeconds);
  state.companions = computeCompanions(state.level);

  return {
    state,
    leveledUp: state.level > prevLevel,
    gainedCompanion: state.companions > prevCompanions,
  };
}

function getProgress(state) {
  const secondsIntoLevel = state.totalSeconds % SECONDS_PER_LEVEL;
  return {
    level: state.level,
    companions: state.companions,
    color: state.color,
    secondsIntoLevel,
    secondsForLevel: SECONDS_PER_LEVEL,
    ratio: secondsIntoLevel / SECONDS_PER_LEVEL,
  };
}

module.exports = {
  SECONDS_PER_LEVEL,
  COMPANION_EVERY_LEVELS,
  MAX_COMPANIONS,
  COLORS,
  DEFAULT_COLOR,
  computeLevel,
  computeCompanions,
  defaultState,
  loadState,
  saveState,
  addActiveSeconds,
  setColor,
  getProgress,
};
