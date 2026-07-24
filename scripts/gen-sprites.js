// ドット絵スキンの box-shadow CSS を生成する。
// グリッドやパレットを直接編集し、`node scripts/gen-sprites.js` の出力を
// renderer/style.css 末尾の該当ブロックに貼り直す。
//
// パレット値に 'var(--outfit-color)' を指定すると、その部分だけ
// 色選択(data-color)と連動して塗り替わる(犬猫=リボン、少女/ヨウガイ=服)。
const PALETTES = {
  dog: { E: '#8a5a3b', F: '#e8c39e', S: '#f6e6cf', N: '#3a2a1a', R: 'var(--outfit-color)' },
  cat: { F: '#e8933f', W: '#fdf6ee', N: '#e8607a', R: 'var(--outfit-color)' },
  girl: { H: '#5b3a29', S: '#f7d9c4', C: 'var(--outfit-color)' },
  yougai: { H: '#2f2a26', S: '#f0c8a0', C: 'var(--outfit-color)' },
  fish: { F: '#ff9640', T: '#ffc670' },
  jellyfish: { B: '#c9a8f5', T: '#a888e0' },
  octopus: { O: '#c25b7c' },
  squid: { S: '#e8768f', T: '#d4586f' },
};

const GRIDS = {
  // 頭+耳+マズルは元の絵をほぼ踏襲しつつ、下2〜3行を4本足(前後2本ずつ、
  // 左右対称なので鏡像で計4本になる)専用に割り当てて、顔だけで浮いて
  // 見えないよう「4足で立っている」のがわかる姿にしている。頭頂にはRで
  // 色選択と連動するリボンを乗せる。
  dog: [
    '......RR',
    '.....FFF',
    '....FFFF',
    'E...FFFF',
    'EE..FFFF',
    'EEE.FFFF',
    'EEE.FFFF',
    'EE..FFFF',
    'E...FFFF',
    '....FFSS',
    '....FSSN',
    '....FFFF',
    '....FFFF',
    '.F..F...',
    '.F..F...',
    '.S..S...',
  ],
  cat: [
    '.....FRR',
    '....FF..',
    '...FFF..',
    '..FFFFF.',
    '.FFFFFFF',
    '.FFFFFFF',
    '.FFFFFFF',
    '.FFFFFFF',
    '.FFFFWWW',
    '.FFFWWWW',
    '.FFFWWWN',
    '.FFFWWWW',
    '.FFFFFFF',
    '..F..F..',
    '..F..F..',
    '..W..W..',
  ],
  // 少女。髪型はそのまま、下段をワンピース(色選択と連動)+素足に割り当てて
  // ちゃんと立っている姿にする。
  girl: [
    '.....HHH',
    '....HHHH',
    '..HHHHHH',
    '.HSSSSSS',
    '.HSSSSSS',
    '.HSSSSSS',
    '.HSSSSSS',
    '..CCCCC.',
    '.CCCCCCC',
    '.CCCCCCC',
    '.CCCCCCC',
    '.CCCCCCC',
    '...CC...',
    '...SS...',
    '...SS...',
    '........',
  ],
  // 男の子キャラ「ヨウガイ」。とがった短髪+服(色選択と連動)。二足なので
  // 左右対称の鏡像で脚が2本(左右1本ずつ)になるよう内側で1本にまとめている。
  // 髪の毛は中央(左右の鏡像の継ぎ目)を必ず繋げること。繋がっていないと
  // 頭が左右2つに割れて見えてしまう(実際に見た目が「二人いる」と指摘された)。
  yougai: [
    '..H.H.HH',
    'HHHHHHHH',
    'HHHHHHHH',
    'HSSSSSSH',
    'HSSSSSSH',
    'HSSSSSSH',
    'HSSSSSSH',
    'HSSSSSSH',
    '.CCCCCC.',
    '.CCCCCC.',
    '.CCCCCC.',
    '.CCCCCC.',
    '...CC...',
    '...CC...',
    '...SS...',
    '...SS...',
  ],
  // 主人用の魚スキン。正面向きの丸い体+胸びれ+尾びれ。
  fish: [
    '...FF...',
    '.FFFFFF.',
    'FFFFFFFF',
    'FFFFFFFF',
    'FFFFFFFF',
    'FFFFFFFF',
    'F.FFFFF.',
    '.FFFFFF.',
    '.FFFFFF.',
    '..FFFF..',
    '...FF...',
    '...TT...',
    '..TTTT..',
    '........',
    '........',
    '........',
  ],
  // 子分専用の海の仲間たち(main.jsの主人スキンとは無関係にランダムで選ばれる)。
  jellyfish: [
    '...BB...',
    '.BBBBBB.',
    'BBBBBBBB',
    'BBBBBBBB',
    'BBBBBBBB',
    'B.B.B.B.',
    'T.T.T.T.',
    '.T.T.T.T',
    'T.T.T.T.',
    '.T.T.T.T',
    'T.T.T.T.',
    '.T.T.T.T',
    'T.T.T.T.',
    '.T.T.T.T',
    'T.T.T.T.',
    '.T.T.T.T',
  ],
  octopus: [
    '...OO...',
    '.OOOOOO.',
    'OOOOOOOO',
    'OOOOOOOO',
    'OOOOOOOO',
    'OOOOOOOO',
    '.O..O...',
    '.O..O...',
    '.O..O...',
    '.O..O...',
    '.O..O...',
    '.O..O...',
    '.O..O...',
    '.O..O...',
    '........',
    '........',
  ],
  squid: [
    '...SS...',
    '..SSSS..',
    '.SSSSSS.',
    '.SSSSSS.',
    '.SSSSSS.',
    '.SSSSSS.',
    'S.SSSSS.',
    '.SSSSSS.',
    '.SSSSSS.',
    'T.T.T.T.',
    '.T.T.T.T',
    'T.T.T.T.',
    '.T.T.T.T',
    'T.T.T.T.',
    '.T.T.T.T',
    'T.T.T.T.',
  ],
};

const PX = 4;

for (const [skin, rows] of Object.entries(GRIDS)) {
  const palette = PALETTES[skin];
  const shadows = [];
  rows.forEach((leftHalf, r) => {
    if (leftHalf.length !== 8) throw new Error(`${skin} row ${r} is not 8 chars: "${leftHalf}"`);
    const full = leftHalf + [...leftHalf].reverse().join('');
    [...full].forEach((ch, c) => {
      if (ch === '.') return;
      const color = palette[ch];
      if (!color) throw new Error(`${skin} row ${r} unknown char "${ch}"`);
      // spread-radiusを少し持たせて隣同士を1pxずつ重ねる。子分表示ではscale(0.625)で
      // 縮小するため、重なりが無いと境界のアンチエイリアスで隙間(ポリゴンの継ぎ目)が
      // 見えてしまう。
      shadows.push(`${c * PX}px ${r * PX}px 0 1px ${color}`);
    });
  });
  console.log(`\n[[${skin}]]`);
  console.log(`  box-shadow:\n    ${shadows.join(',\n    ')};`);
}
