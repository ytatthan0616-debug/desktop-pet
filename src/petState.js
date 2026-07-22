// レベル・子分(仲間)の進行状況を管理するモジュール。
// 永続化は呼び出し側 (main.js) が fs を使って行う。

const fs = require('fs');

// 30分の作業(アクティブ)時間で1レベルアップ
const SECONDS_PER_LEVEL = 30 * 60;
// 3レベルごとに子分が1匹増える
const COMPANION_EVERY_LEVELS = 3;
// 子分の最大数(ウィンドウが際限なく巨大化しないための上限)
const MAX_COMPANIONS = 8;

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
  };
}

function loadState(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      totalSeconds: Number(parsed.totalSeconds) || 0,
      level: computeLevel(Number(parsed.totalSeconds) || 0),
      companions: computeCompanions(computeLevel(Number(parsed.totalSeconds) || 0)),
    };
  } catch (err) {
    return defaultState();
  }
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
    secondsIntoLevel,
    secondsForLevel: SECONDS_PER_LEVEL,
    ratio: secondsIntoLevel / SECONDS_PER_LEVEL,
  };
}

module.exports = {
  SECONDS_PER_LEVEL,
  COMPANION_EVERY_LEVELS,
  MAX_COMPANIONS,
  computeLevel,
  computeCompanions,
  defaultState,
  loadState,
  saveState,
  addActiveSeconds,
  getProgress,
};
