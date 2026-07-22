// ユーザーが編集可能な設定ファイル (config.json) の読み書き。
// ファイルを直接編集すると自動的に反映される(watchConfig)。

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// パッケージ化されたアプリでは __dirname が読み取り専用の asar 内を指すため、
// その場合は resources ディレクトリ(書き込み可能)側の config.json を使う。
const CONFIG_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'config.json')
  : path.join(__dirname, '..', 'config.json');

const DEFAULT_CONFIG = {
  wander: true, // true: 画面内を歩き回る / false: その場に留まる
  wanderSpeedPxPerSec: 55,
  walkDurationMs: [2000, 6000],
  idleDurationMs: [1200, 4000],
};

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch (err) {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save config:', err);
  }
}

// config.json を直接編集した場合にも反映されるようにする
function watchConfig(onChange) {
  try {
    fs.watch(CONFIG_PATH, { persistent: false }, () => {
      // エディタによっては書き込みが複数イベントに分かれるため少し待つ
      setTimeout(() => onChange(loadConfig()), 150);
    });
  } catch (err) {
    // ファイルがまだ存在しない場合は無視
  }
}

module.exports = { CONFIG_PATH, DEFAULT_CONFIG, loadConfig, saveConfig, watchConfig };
