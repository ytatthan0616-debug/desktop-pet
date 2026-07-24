// ドット絵スキンの box-shadow CSS を生成する。
// グリッドやパレットを直接編集し、`node scripts/gen-sprites.js` の出力を
// renderer/style.css 末尾の該当ブロックに貼り直す。
const PALETTES = {
  dog: { E: '#8a5a3b', F: '#e8c39e', S: '#f6e6cf', N: '#3a2a1a' },
  cat: { F: '#e8933f', W: '#fdf6ee', N: '#e8607a' },
  girl: { H: '#5b3a29', S: '#f7d9c4' },
};

const GRIDS = {
  // 頭+耳+マズルは元の絵をほぼ踏襲しつつ、下2〜3行を4本足(前後2本ずつ、
  // 左右対称なので鏡像で計4本になる)専用に割り当てて、顔だけで浮いて
  // 見えないよう「4足で立っている」のがわかる姿にしている。
  dog: [
    '........',
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
    '.....F..',
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
  girl: [
    '.....HHH',
    '....HHHH',
    '..HHHHHH',
    '.HSSSSSS',
    '.HSSSSSS',
    '.HSSSSSS',
    '.HSSSSSS',
    '.HSSSSSS',
    '.HSSSSSS',
    '....HSSS',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
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
  console.log(`\nbody[data-skin='${skin}'] .pixel-sprite {`);
  console.log(`  box-shadow:\n    ${shadows.join(',\n    ')};`);
  console.log('}');
}
