import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';
import { applyAnimationMode, applyVisualTheme } from './theme.js';
import { BUILT_IN_PRESETS } from './presets.js';

const elements = {
  message: document.getElementById('visuals-message'),
  presetsGrid: document.getElementById('visuals-presets-grid'),
  animationMode: document.getElementById('visuals-animation-mode'),
  saveButton: document.getElementById('visuals-save-btn')
};

let currentUser = null;
let selectedPresetId = null;
const messageBaseClass = elements.message?.classList.contains('page-message') ? 'page-message' : 'inline-save-message';

function setMessage(text = '', type = '') {
  elements.message.textContent = text;
  elements.message.className = messageBaseClass;

  if (type) {
    elements.message.classList.add(type);
  }
}

function renderPresetCards() {
  if (BUILT_IN_PRESETS.length === 0) {
    elements.presetsGrid.innerHTML = '<p class="visuals-empty">No presets found yet.</p>';
    return;
  }

  elements.presetsGrid.innerHTML = BUILT_IN_PRESETS
    .map((preset) => {
      const isSelected = preset.id === selectedPresetId;

      return `
        <button
          type="button"
          class="visual-preset-card ${isSelected ? 'active' : ''}"
          data-preset-id="${preset.id}"
          aria-pressed="${isSelected ? 'true' : 'false'}"
        >
          <span class="visual-preset-name">${preset.name}</span>
          <span class="visual-preset-preview" style="--preview-bg: ${preset.background}; --preview-accent: ${preset.accent};"></span>
          <span class="visual-preset-meta">Built-in</span>
        </button>
      `;
    })
    .join('');
}

async function ensureSettingsDoc(userId) {
  const settingsRef = doc(db, 'users', userId, 'visuals', 'settings');
  const settingsSnapshot = await getDoc(settingsRef);

  if (!settingsSnapshot.exists()) {
    await setDoc(settingsRef, {
      kind: 'settings',
      activePresetId: BUILT_IN_PRESETS[0].id,
      animationMode: 'normal',
      updatedAt: serverTimestamp()
    });
  }
}

async function loadVisualPreferences(userId) {
  setMessage('Loading visual preferences…');

  await ensureSettingsDoc(userId);

  const settingsSnapshot = await getDoc(doc(db, 'users', userId, 'visuals', 'settings'));
  const settings = settingsSnapshot.exists() ? settingsSnapshot.data() : {};

  selectedPresetId = settings.activePresetId || BUILT_IN_PRESETS[0]?.id || null;
  elements.animationMode.value = settings.animationMode || 'normal';

  renderPresetCards();

  const activePreset = BUILT_IN_PRESETS.find((preset) => preset.id === selectedPresetId);
  if (activePreset) {
    applyVisualTheme(activePreset);
  }

  applyAnimationMode(elements.animationMode.value);
  setMessage('');
}

async function savePreferences() {
  if (!currentUser || !selectedPresetId) {
    setMessage('Please select a preset first.', 'error');
    return;
  }

  try {
    await setDoc(doc(db, 'users', currentUser.uid, 'visuals', 'settings'), {
      kind: 'settings',
      activePresetId: selectedPresetId,
      animationMode: elements.animationMode.value,
      updatedAt: serverTimestamp()
    }, { merge: true });

    const activePreset = BUILT_IN_PRESETS.find((preset) => preset.id === selectedPresetId);
    if (activePreset) {
      applyVisualTheme(activePreset);
    }
    applyAnimationMode(elements.animationMode.value);

    setMessage('Visual preferences saved.', 'success');
  } catch (error) {
    console.error('Failed to save visual preferences:', error);
    setMessage('Could not save visual preferences right now.', 'error');
  }
}

function onPresetSelected(event) {
  const card = event.target.closest('[data-preset-id]');

  if (!card) {
    return;
  }

  selectedPresetId = card.dataset.presetId;
  renderPresetCards();

  const activePreset = BUILT_IN_PRESETS.find((preset) => preset.id === selectedPresetId);
  if (activePreset) {
    applyVisualTheme(activePreset);
  }
}

function onAnimationModeChanged() {
  applyAnimationMode(elements.animationMode.value);
}

function handleAuthStateChanged(user) {
  if (!user) {
    window.location.replace('login.html');
    return;
  }

  currentUser = user;
  loadVisualPreferences(user.uid).catch((error) => {
    console.error('Failed to load visual preferences:', error);
    setMessage('Could not load visual preferences.', 'error');
  });
}

function init() {
  if (!elements.presetsGrid || !elements.animationMode || !elements.saveButton || !elements.message) {
    return;
  }

  elements.presetsGrid.addEventListener('click', onPresetSelected);
  elements.animationMode.addEventListener('change', onAnimationModeChanged);
  elements.saveButton.addEventListener('click', savePreferences);
  onAuthStateChanged(auth, handleAuthStateChanged);
}

init();
