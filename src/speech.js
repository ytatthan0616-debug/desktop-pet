// アクティブウィンドウの情報からセリフ・行動を選ぶモジュール。
// active-win から得られる owner.name / title をキーにマッチさせる。
// 分類ごとの match は上から順に評価されるので、ブラウザ内で動く
// 音楽/勉強/タイマー系サービス(タイトルにアプリ名やキーワードが出るもの)を
// 汎用のブラウザ分類より先に判定できるよう、具体的なものを上位に置く。

const CATEGORIES = [
  {
    key: 'music',
    match: /spotify|itunes|apple music|youtube music|windows media player|wmplayer|foobar|winamp|musicbee|groove music|vlc|audirvana|tidal/i,
    lines: [
      '今何聴いてるの?',
      'いい曲だといいな',
      'リズムに乗ってきた!',
      '音楽聴きながらだと捗るよね',
      'その曲、僕にも教えてほしいな',
    ],
  },
  {
    key: 'study',
    match: /notion|obsidian|onenote|evernote|anki|kindle|acrobat|sumatrapdf|foxit reader|udemy|coursera|khan ?academy|quizlet|duolingo|study|勉強|学習|参考書/i,
    lines: [
      '勉強がんばってるね',
      'その調子!応援してるよ',
      '集中してるとき邪魔しないようにするね',
      '休憩もちゃんと取ってね',
      '一歩ずつ賢くなってきてる気がする',
    ],
  },
  {
    key: 'timer',
    match: /pomodoro|pomofocus|forest|stopwatch|timer|toggl|clockify|タイマー|ストップウォッチ|ポモドーロ|\bclock\b|alarms ?& ?clock/i,
    lines: ['時間、計ってるんだね', 'あと何分くらい?', 'タイムアタック中?', 'その調子でいこう', 'ポモドーロ、応援してるよ'],
  },
  {
    key: 'coding',
    match: /code|cursor|webstorm|intellij|vim|neovim|rider|pycharm/i,
    lines: [
      'コーディング中だね、集中してる！',
      'そのバグ、倒せそう？',
      'いいコード書けてる？',
      'リファクタリング日和だね',
      'そのエラー、一緒に見よっか',
    ],
  },
  {
    key: 'browsing',
    match: /chrome|edge|firefox|safari|brave/i,
    lines: ['調べ物中？', 'ネットサーフィンも休憩のうち！', 'そのタブ、いくつ開いてるの…？', '何か面白いもの見つけた?', '目、疲れてきてない?'],
  },
  {
    key: 'chat',
    match: /slack|discord|teams|zoom/i,
    lines: ['コミュニケーション中だね', 'ちゃんと休憩も取ってね', '大事な話し中?', 'みんな元気にしてる?', '会議、長引いてない?'],
  },
  {
    key: 'terminal',
    match: /terminal|powershell|cmd|iterm|wt/i,
    lines: ['コマンド打ってる…かっこいい', 'ターミナル職人だ！', 'そのコマンド、なにしてるの?', 'エンター押す瞬間、ちょっとドキドキするよね', '黒い画面、似合ってるよ'],
  },
  {
    key: 'office',
    match: /excel|word|powerpoint|spreadsheet/i,
    lines: ['資料作成おつかれさま', 'そのグラフ、見やすいね', '締め切り、間に合いそう?', 'フォント選びも大事だよね', '保存はこまめにね'],
  },
];

// 固有アクション(見た目の変化+対象ウィンドウへの接近)を持つ分類。
// 例: music なら対象ウィンドウの近くに寄ってヘッドホンを着ける。
const ACTION_CATEGORY_KEYS = new Set(['music', 'study', 'timer']);

const DEFAULT_LINES = ['がんばえー', '今日も一日おつかれさま', 'いい調子だね！', 'ちょっと休憩する？'];

const IDLE_LINES = ['あれ、どこ行った…？', 'ねむいなあ', 'そろそろ戻ってきてね'];

const ENEMY_APPEAR_LINES = ['ウイルスが出た!みんな構えて!', '敵だ!やっつけよう!', '怪しいのが近づいてきた…!'];

const ENEMY_DEFEATED_LINES = ['やっつけた!', 'みんなのおかげだよ', 'もう安心!'];

function pickLine(lines) {
  return lines[Math.floor(Math.random() * lines.length)];
}

function matchCategory(ownerName, title) {
  const haystack = `${ownerName || ''} ${title || ''}`;
  for (const category of CATEGORIES) {
    if (category.match.test(haystack)) return category;
  }
  return null;
}

function actionForCategory(categoryKey) {
  return ACTION_CATEGORY_KEYS.has(categoryKey) ? categoryKey : null;
}

function speechForWindow(ownerName, title) {
  const category = matchCategory(ownerName, title);
  return category ? pickLine(category.lines) : pickLine(DEFAULT_LINES);
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

function speechForEnemyAppear() {
  return pickLine(ENEMY_APPEAR_LINES);
}

function speechForEnemyDefeated() {
  return pickLine(ENEMY_DEFEATED_LINES);
}

module.exports = {
  matchCategory,
  actionForCategory,
  speechForWindow,
  speechForIdle,
  speechForLevelUp,
  speechForCompanion,
  speechForEnemyAppear,
  speechForEnemyDefeated,
};
