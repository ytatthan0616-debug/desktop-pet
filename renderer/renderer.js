const petsEl = document.getElementById('pets');
const bubbleEl = document.getElementById('speech-bubble');
const expFillEl = document.getElementById('exp-fill');

let hideBubbleTimer = null;
let renderedCompanionCount = -1;

// 子分は主人のスキン選択とは無関係に、この中からランダムに選ばれる
// 海の仲間のドット絵を表示する。
const COMPANION_SKINS = ['jellyfish', 'octopus', 'squid'];

// 子分は主人と同じウィンドウの中に並べて表示する。歩く/走る/跳ぶ/転がる等の
// アニメーションは共通のCSSクラス経由で全ての.petに掛かるので、主人と全く同じ
// 動きをする(別ウィンドウにして個別のtransformを持たせると、この同期が崩れる)。
function createPetElement(isCompanion) {
  const pet = document.createElement('div');
  pet.className = isCompanion ? 'pet companion' : 'pet main';

  const sprite = document.createElement('div');
  sprite.className = 'pixel-sprite';

  const left = document.createElement('div');
  left.className = 'eye left';
  const right = document.createElement('div');
  right.className = 'eye right';

  pet.appendChild(sprite);
  pet.appendChild(left);
  pet.appendChild(right);

  if (isCompanion) {
    // 見た目(海の仲間の種類)と、明度/彩度を少しだけランダムにずらして
    // 同じ子分でも1匹ずつ違って見えるようにする。
    pet.dataset.skin = COMPANION_SKINS[Math.floor(Math.random() * COMPANION_SKINS.length)];
    const brightness = Math.round(90 + Math.random() * 20);
    const saturation = Math.round(85 + Math.random() * 30);
    pet.style.filter = `brightness(${brightness}%) saturate(${saturation}%)`;
  } else {
    // タスク固有アクション(ヘッドホン等)・就寝中のZZZは自分自身(メインのペット)にだけ表示する
    const accessory = document.createElement('div');
    accessory.className = 'accessory';
    pet.appendChild(accessory);

    const zzz = document.createElement('div');
    zzz.className = 'zzz';
    zzz.innerHTML = '<span>Z</span><span>Z</span><span>Z</span>';
    pet.appendChild(zzz);
  }

  return pet;
}

// 主人が常に中央に来るよう、子分を左右交互に振り分けて並べる。
function renderPets(companionCount) {
  if (companionCount === renderedCompanionCount) return;
  renderedCompanionCount = companionCount;

  petsEl.innerHTML = '';
  const leftSide = [];
  const rightSide = [];
  for (let i = 0; i < companionCount; i++) {
    (i % 2 === 0 ? rightSide : leftSide).push(createPetElement(true));
  }
  leftSide.forEach((el) => petsEl.appendChild(el));
  petsEl.appendChild(createPetElement(false));
  rightSide.forEach((el) => petsEl.appendChild(el));
}

function showSpeech(text) {
  bubbleEl.textContent = text;
  bubbleEl.classList.remove('hidden');

  if (hideBubbleTimer) clearTimeout(hideBubbleTimer);
  hideBubbleTimer = setTimeout(() => {
    bubbleEl.classList.add('hidden');
  }, 7000);
}

window.petAPI.onState((data) => {
  renderPets(data.companions);
  const percent = Math.min(100, Math.round(data.ratio * 100));
  expFillEl.style.width = `${percent}%`;
  document.body.dataset.color = data.color || 'white';
  document.body.dataset.skin = data.skin || 'square';
});

window.petAPI.onSpeech((data) => {
  showSpeech(data.text);
});

window.petAPI.onWalkState((data) => {
  document.body.classList.toggle('walking', !!data.walking);
  document.body.classList.toggle('falling', !!data.falling);
  document.body.classList.toggle('dragging', !!data.dragging);
  document.body.classList.toggle('facing-left', data.facing === 'left');
  document.body.classList.toggle('facing-right', data.facing === 'right');
  document.body.dataset.moveStyle = data.moveStyle || 'walk';

  const height = Math.max(0, Math.min(200, data.heightAboveGround || 0));
  const shadowScale = Math.max(0.15, 1 - height / 260);
  const shadowOpacity = Math.max(0.04, 0.32 - height / 700);
  document.body.style.setProperty('--shadow-scale', shadowScale.toFixed(3));
  document.body.style.setProperty('--shadow-opacity', shadowOpacity.toFixed(3));
});

window.petAPI.onSystemLoad((data) => {
  document.body.dataset.expression = data.expression || 'calm';
});

window.petAPI.onTaskAction((data) => {
  if (data.action) {
    document.body.dataset.action = data.action;
  } else {
    delete document.body.dataset.action;
  }
});

// 敵/コイン/骨の本体は別ウィンドウ(item.html)側で表示するので、
// メインのペット側ではその場に居る間の反応アニメーションだけを切り替える。
window.petAPI.onEnemySpawn(() => {
  document.body.classList.add('battling');
});

window.petAPI.onEnemyClear(() => {
  document.body.classList.remove('battling');
});

window.petAPI.onSleepState((data) => {
  document.body.classList.toggle('sleeping', !!data.sleeping);
});

window.petAPI.onLootSpawn(() => {
  document.body.classList.add('looting');
});

window.petAPI.onLootClear(() => {
  document.body.classList.remove('looting');
});

window.petAPI.onLanded(() => {
  document.body.classList.remove('landed');
  // 強制リフローしてアニメーションを再始動させる
  void document.body.offsetWidth;
  document.body.classList.add('landed');
  setTimeout(() => document.body.classList.remove('landed'), 320);
});

document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.petAPI.requestContextMenu();
});

window.petAPI.requestReady();
