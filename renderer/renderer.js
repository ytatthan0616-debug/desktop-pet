const petsEl = document.getElementById('pets');
const bubbleEl = document.getElementById('speech-bubble');
const expFillEl = document.getElementById('exp-fill');

let renderedCompanionCount = -1;
let hideBubbleTimer = null;

function createPetElement(isCompanion) {
  const pet = document.createElement('div');
  pet.className = isCompanion ? 'pet companion' : 'pet main';

  const left = document.createElement('div');
  left.className = 'eye left';
  const right = document.createElement('div');
  right.className = 'eye right';

  pet.appendChild(left);
  pet.appendChild(right);
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
});

window.petAPI.onSpeech((data) => {
  showSpeech(data.text);
});

window.petAPI.onWalkState((data) => {
  document.body.classList.toggle('walking', !!data.walking);
  document.body.classList.toggle('facing-left', data.facing === 'left');
  document.body.classList.toggle('facing-right', data.facing === 'right');
});

document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.petAPI.requestContextMenu();
});

window.petAPI.requestReady();
