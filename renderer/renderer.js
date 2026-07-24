const petsEl = document.getElementById('pets');
const bubbleEl = document.getElementById('speech-bubble');
const expFillEl = document.getElementById('exp-fill');

let renderedCompanionCount = -1;
let hideBubbleTimer = null;
let enemyEl = null;
let lootEl = null;

// --- 子分の「わらわら」動き ---
// 子分は一列に並ばず、主人のまわりをそれぞれ独立に地面を跳ねながら動き回る。
// 横方向はランダムな目標位置へイージングで近づき、縦方向は常に地面(0)を基準に
// 跳ねる弧を描くことで「ぴょんぴょん」した見た目にする。
const SWARM_MARGIN_PX = 22; // 左右の端に寄りすぎないための余白
const SWARM_EASE = 0.06;
const HOP_HEIGHT_PX = 10; // 跳ねる高さ
const companionMotion = new WeakMap();

function ensureCompanionMotion(el) {
  let motion = companionMotion.get(el);
  if (!motion) {
    motion = {
      x: 0,
      targetX: 0,
      nextPickAt: 0,
      hopPeriodMs: 460 + Math.random() * 260,
      hopPhase: Math.random() * 1000,
    };
    companionMotion.set(el, motion);
  }
  return motion;
}

function pickSwarmTargetX(motion, now) {
  const halfWidth = Math.max(0, petsEl.clientWidth / 2 - SWARM_MARGIN_PX);
  motion.targetX = (Math.random() * 2 - 1) * halfWidth;
  motion.nextPickAt = now + 700 + Math.random() * 1200;
}

function swarmTick(now) {
  // 戦闘中は主人が pet-attack アニメーションで突撃するが、子分はCSSアニメーションを
  // 使わず(使うとこのtransformが上書きされ中央に固まって見えてしまうため)、
  // ここで震えを合成することで散らばった位置を保ったまま反応させる。
  const battling = document.body.classList.contains('battling');
  const attackJitter = battling ? Math.sin(now / 90) * 6 : 0;
  // ドラッグ中・就寝中は主人の足元に引き寄せられて大人しくなる
  const settle = document.body.classList.contains('dragging') || document.body.classList.contains('sleeping');

  const companions = petsEl.querySelectorAll('.pet.companion');
  companions.forEach((el) => {
    const motion = ensureCompanionMotion(el);

    if (settle) {
      motion.targetX = 0;
      motion.x += (motion.targetX - motion.x) * SWARM_EASE;
      el.style.transform = `translate(${motion.x.toFixed(1)}px, 0px)`;
      return;
    }

    if (now >= motion.nextPickAt) pickSwarmTargetX(motion, now);
    motion.x += (motion.targetX - motion.x) * SWARM_EASE;

    const hopT = ((now - motion.hopPhase) % motion.hopPeriodMs) / motion.hopPeriodMs;
    const hopY = -HOP_HEIGHT_PX * Math.sin(hopT * Math.PI);

    el.style.transform = `translate(${(motion.x + attackJitter).toFixed(1)}px, ${hopY.toFixed(1)}px)`;
  });
  requestAnimationFrame(swarmTick);
}
requestAnimationFrame(swarmTick);

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

  // タスク固有アクション(ヘッドホン等)・就寝中のZZZは自分自身(メインのペット)にだけ表示する
  if (!isCompanion) {
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

function renderPets(companionCount) {
  if (companionCount === renderedCompanionCount) return;
  renderedCompanionCount = companionCount;

  petsEl.innerHTML = '';
  petsEl.appendChild(createPetElement(false));
  for (let i = 0; i < companionCount; i++) {
    petsEl.appendChild(createPetElement(true));
  }
}

function spawnEnemy() {
  if (enemyEl) return;
  const enemy = document.createElement('div');
  enemy.className = 'enemy';
  const sprite = document.createElement('div');
  sprite.className = 'enemy-sprite';
  enemy.appendChild(sprite);
  petsEl.appendChild(enemy);
  enemyEl = enemy;
  document.body.classList.add('battling');
  // 追加直後は opacity:0 の状態なので、1フレーム後にクラスを付けて登場アニメーションさせる
  requestAnimationFrame(() => {
    if (enemyEl === enemy) enemy.classList.add('enemy-enter');
  });
}

function clearEnemy() {
  document.body.classList.remove('battling');
  if (!enemyEl) return;
  const el = enemyEl;
  enemyEl = null;
  el.classList.remove('enemy-enter');
  el.classList.add('enemy-defeated');
  setTimeout(() => el.remove(), 400);
}

function spawnLoot(kind) {
  if (lootEl) return;
  const loot = document.createElement('div');
  loot.className = `loot ${kind}`;
  petsEl.appendChild(loot);
  lootEl = loot;
  document.body.classList.add('looting');
  requestAnimationFrame(() => {
    if (lootEl === loot) loot.classList.add('loot-enter');
  });
}

function clearLoot() {
  document.body.classList.remove('looting');
  if (!lootEl) return;
  const el = lootEl;
  lootEl = null;
  el.classList.remove('loot-enter');
  el.classList.add('loot-cleared');
  setTimeout(() => el.remove(), 400);
}

function showSpeech(text) {
  bubbleEl.textContent = text;
  bubbleEl.classList.remove('hidden');

  if (hideBubbleTimer) clearTimeout(hideBubbleTimer);
  hideBubbleTimer = setTimeout(() => {
    bubbleEl.classList.add('hidden');
  }, 4500);
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

window.petAPI.onEnemySpawn(() => {
  spawnEnemy();
});

window.petAPI.onEnemyClear(() => {
  clearEnemy();
});

window.petAPI.onSleepState((data) => {
  document.body.classList.toggle('sleeping', !!data.sleeping);
});

window.petAPI.onLootSpawn((data) => {
  spawnLoot(data.kind);
});

window.petAPI.onLootClear(() => {
  clearLoot();
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
