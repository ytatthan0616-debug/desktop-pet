// アクティブウィンドウの情報からセリフを選ぶモジュール。
// active-win から得られる owner.name / title をキーにマッチさせる。

const APP_LINES = [
  {
    match: /code|cursor|webstorm|intellij|vim|neovim/i,
    lines: ['コーディング中だね、集中してる！', 'そのバグ、倒せそう？', 'いいコード書けてる？'],
  },
  {
    match: /chrome|edge|firefox|safari|brave/i,
    lines: ['調べ物中？', 'ネットサーフィンも休憩のうち！', 'そのタブ、いくつ開いてるの…？'],
  },
  {
    match: /slack|discord|teams|zoom/i,
    lines: ['コミュニケーション中だね', 'ちゃんと休憩も取ってね'],
  },
  {
    match: /terminal|powershell|cmd|iterm|wt/i,
    lines: ['コマンド打ってる…かっこいい', 'ターミナル職人だ！'],
  },
  {
    match: /excel|word|powerpoint|spreadsheet/i,
    lines: ['資料作成おつかれさま', 'そのグラフ、見やすいね'],
  },
];

const DEFAULT_LINES = ['がんばえー', '今日も一日おつかれさま', 'いい調子だね！', 'ちょっと休憩する？'];

const IDLE_LINES = ['あれ、どこ行った…？', 'ねむいなあ', 'そろそろ戻ってきてね'];

function pickLine(lines) {
  return lines[Math.floor(Math.random() * lines.length)];
}

function speechForWindow(ownerName, title) {
  const haystack = `${ownerName || ''} ${title || ''}`;
  for (const entry of APP_LINES) {
    if (entry.match.test(haystack)) {
      return pickLine(entry.lines);
    }
  }
  return pickLine(DEFAULT_LINES);
}

function speechForIdle() {
  return pickLine(IDLE_LINES);
}

function speechForLevelUp(level) {
  return `レベル${level}になったよ！`;
}

function speechForCompanion(companions) {
  return `子分が増えた！ (計${companions}匹)`;
}

module.exports = {
  speechForWindow,
  speechForIdle,
  speechForLevelUp,
  speechForCompanion,
};
