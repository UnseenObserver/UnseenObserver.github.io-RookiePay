import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';

const DEFAULT_SPLIT_RATIOS = {
  percentageCategories: [
    { name: 'Entertainment', percent: 40 },
    { name: 'Food', percent: 60 }
  ],
  savingsGoalCategories: [],
  billCategories: [
    { name: 'Insurance', amount: 0 },
    { name: 'Subscriptions', amount: 0 },
    { name: 'Gas', amount: 0 },
    { name: 'Utilities', amount: 0 }
  ]
};

const elements = {
  form: document.getElementById('split-ratio-form'),
  message: document.getElementById('split-ratio-message'),
  percentList: document.getElementById('percent-categories-list'),
  goalList: document.getElementById('goal-categories-list'),
  billList: document.getElementById('bill-categories-list'),
  addPercentButton: document.getElementById('add-percent-category'),
  addGoalButton: document.getElementById('add-goal-category'),
  addBillButton: document.getElementById('add-bill-category'),
  saveBottomButton: document.getElementById('save-ratios-bottom')
};

let currentUserId = null;
let percentageCategories = [];
let savingsGoalCategories = [];
let billCategories = [];
let lastSavedPayload = null;
let availableSavingsGoals = [];
const UNSPECIFIED_CATEGORY_NAME = 'Unspecified';

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function setMessage(text = '', type = '') {
  elements.message.textContent = text;
  elements.message.className = 'page-message';

  if (type) {
    elements.message.classList.add(type);
  }
}

function normalizePercentCategories(categories) {
  if (!Array.isArray(categories) || categories.length === 0) {
    return DEFAULT_SPLIT_RATIOS.percentageCategories.map((category) => ({ ...category }));
  }

  const normalized = categories.map((category, index) => ({
    name: String(category?.name || `Category ${index + 1}`).trim() || `Category ${index + 1}`,
    percent: Math.max(0, asNumber(category?.percent))
  }));

  return ensureUnspecifiedCategory(normalized);
}

function normalizeSavingsGoalCategories(categories) {
  if (!Array.isArray(categories) || categories.length === 0) {
    return [];
  }

  return categories.map((category, index) => ({
    goalName: String(category?.goalName || `Goal ${index + 1}`).trim() || `Goal ${index + 1}`,
    percent: Math.max(0, asNumber(category?.percent))
  }));
}

function normalizeBillCategories(categories) {
  if (!Array.isArray(categories) || categories.length === 0) {
    return DEFAULT_SPLIT_RATIOS.billCategories.map((category) => ({ ...category }));
  }

  return categories.map((category, index) => ({
    name: String(category?.name || `Bill ${index + 1}`).trim() || `Bill ${index + 1}`,
    amount: Math.max(0, asNumber(category?.amount))
  }));
}

function getPercentTotal() {
  const categoryTotal = percentageCategories.reduce((sum, category) => sum + asNumber(category.percent), 0);
  const goalsTotal = savingsGoalCategories.reduce((sum, category) => sum + asNumber(category.percent), 0);
  return categoryTotal + goalsTotal;
}

function isUnspecifiedCategory(category) {
  return String(category?.name || '').trim().toLowerCase() === UNSPECIFIED_CATEGORY_NAME.toLowerCase();
}

function findUnspecifiedCategoryIndex(categories) {
  return categories.findIndex((category) => isUnspecifiedCategory(category));
}

function ensureUnspecifiedCategory(categories) {
  const clone = categories.map((category) => ({ ...category }));
  const index = findUnspecifiedCategoryIndex(clone);

  if (index === -1) {
    clone.push({ name: UNSPECIFIED_CATEGORY_NAME, percent: 0 });
    return clone;
  }

  clone[index].name = UNSPECIFIED_CATEGORY_NAME;
  clone[index].percent = Math.max(0, asNumber(clone[index].percent));
  return clone;
}

function syncUnspecifiedPercentageCategory() {
  percentageCategories = ensureUnspecifiedCategory(percentageCategories);

  const unspecifiedIndex = findUnspecifiedCategoryIndex(percentageCategories);

  const nonUnspecifiedTotal = percentageCategories
    .filter((_, index) => index !== unspecifiedIndex)
    .reduce((sum, category) => sum + asNumber(category.percent), 0);

  const goalTotal = savingsGoalCategories.reduce((sum, category) => sum + asNumber(category.percent), 0);
  const undistributedPercent = Math.max(0, 100 - (nonUnspecifiedTotal + goalTotal));

  percentageCategories[unspecifiedIndex].percent = Math.round(undistributedPercent * 100) / 100;
}

function syncSavingsGoalAllocationsWithGoals() {
  const validGoalNames = new Set(availableSavingsGoals);
  let removedPercentTotal = 0;

  savingsGoalCategories = savingsGoalCategories.filter((category) => {
    const goalName = String(category.goalName || '').trim();

    if (validGoalNames.has(goalName)) {
      return true;
    }

    removedPercentTotal += Math.max(0, asNumber(category.percent));
    return false;
  });

  if (removedPercentTotal > 0) {
    percentageCategories = ensureUnspecifiedCategory(percentageCategories);
    const unspecifiedIndex = findUnspecifiedCategoryIndex(percentageCategories);
    percentageCategories[unspecifiedIndex].percent += removedPercentTotal;
  }

  syncUnspecifiedPercentageCategory();
}

function updateSaveButtonsState(total) {
  const canSave = total >= 0;

  if (elements.saveBottomButton) {
    elements.saveBottomButton.disabled = !canSave;
  }
}

function renderPercentTotal() {
  syncUnspecifiedPercentageCategory();

  const total = getPercentTotal();
  const overAllocated = total > 100;
  const guidance = overAllocated
    ? `Percentage total: ${total}% (over 100%, please reduce some allocations).`
    : `Percentage total: ${total}% (any undistributed amount is sent to ${UNSPECIFIED_CATEGORY_NAME}).`;

  setMessage(guidance, overAllocated ? 'error' : 'success');
  updateSaveButtonsState(total);
}

function updatePercentCategory(index, key, value) {
  if (!percentageCategories[index]) {
    return;
  }

  if (isUnspecifiedCategory(percentageCategories[index])) {
    return;
  }

  if (key === 'name') {
    percentageCategories[index].name = value;
    return;
  }

  percentageCategories[index].percent = Math.max(0, asNumber(value));
  renderPercentTotal();
}

function updateBillCategory(index, key, value) {
  if (!billCategories[index]) {
    return;
  }

  if (key === 'name') {
    billCategories[index].name = value;
    return;
  }

  billCategories[index].amount = Math.max(0, asNumber(value));
}

function updateSavingsGoalCategory(index, key, value) {
  if (!savingsGoalCategories[index]) {
    return;
  }

  if (key === 'goalName') {
    savingsGoalCategories[index].goalName = value;
    return;
  }

  savingsGoalCategories[index].percent = Math.max(0, asNumber(value));
  renderPercentTotal();
}

function removePercentCategory(index) {
  if (isUnspecifiedCategory(percentageCategories[index])) {
    setMessage(`${UNSPECIFIED_CATEGORY_NAME} is managed automatically.`, 'error');
    return;
  }

  if (percentageCategories.length <= 1) {
    setMessage('At least one percentage category is required.', 'error');
    return;
  }

  percentageCategories.splice(index, 1);
  renderPercentCategories();
  renderPercentTotal();
}

function removeBillCategory(index) {
  if (billCategories.length <= 1) {
    setMessage('At least one bill category is required.', 'error');
    return;
  }

  billCategories.splice(index, 1);
  renderBillCategories();
}

function removeSavingsGoalCategory(index) {
  savingsGoalCategories.splice(index, 1);
  renderSavingsGoalCategories();
  renderPercentTotal();
}

function renderPercentCategories() {
  elements.percentList.innerHTML = percentageCategories.map((category, index) => `
    <div class="split-row" data-index="${index}">
      <div class="form-group">
        <label>Category</label>
        <input type="text" data-role="percent-name" value="${escapeHtml(category.name)}" ${isUnspecifiedCategory(category) ? 'readonly' : ''} />
      </div>
      <div class="form-group">
        <label>Percent (%)</label>
        <input type="number" min="0" max="100" step="1" data-role="percent-value" value="${category.percent}" ${isUnspecifiedCategory(category) ? 'readonly' : ''} />
      </div>
      <button type="button" class="btn-secondary split-row-remove" data-role="remove-percent" ${isUnspecifiedCategory(category) ? 'disabled title="Managed automatically"' : ''}>✕</button>
    </div>
  `).join('');
}

function renderBillCategories() {
  elements.billList.innerHTML = billCategories.map((category, index) => `
    <div class="split-row" data-index="${index}">
      <div class="form-group">
        <label>Bill Category</label>
        <input type="text" data-role="bill-name" value="${escapeHtml(category.name)}" />
      </div>
      <div class="form-group">
        <label>Amount ($)</label>
        <input type="number" min="0" step="1" data-role="bill-value" value="${category.amount}" />
      </div>
      <button type="button" class="btn-secondary split-row-remove" data-role="remove-bill">✕</button>
    </div>
  `).join('');
}

function getAvailableGoalOptions(selectedGoalName = '') {
  if (availableSavingsGoals.length === 0) {
    return '<option value="">No savings goals available</option>';
  }

  return availableSavingsGoals
    .map((goal) => {
      const safeGoal = escapeHtml(goal);
      return `<option value="${safeGoal}" ${goal === selectedGoalName ? 'selected' : ''}>${safeGoal}</option>`;
    })
    .join('');
}

function renderSavingsGoalCategories() {
  if (availableSavingsGoals.length === 0) {
    elements.goalList.innerHTML = '<div class="empty-state">Create a savings goal on the dashboard first.</div>';

    if (elements.addGoalButton) {
      elements.addGoalButton.disabled = true;
    }

    return;
  }

  if (elements.addGoalButton) {
    elements.addGoalButton.disabled = false;
  }

  if (savingsGoalCategories.length === 0) {
    elements.goalList.innerHTML = '<div class="empty-state">No savings goal allocations yet.</div>';
    return;
  }

  elements.goalList.innerHTML = savingsGoalCategories.map((category, index) => `
    <div class="split-row" data-index="${index}">
      <div class="form-group">
        <label>Savings Goal</label>
        <select data-role="goal-name">${getAvailableGoalOptions(category.goalName)}</select>
      </div>
      <div class="form-group">
        <label>Percent (%)</label>
        <input type="number" min="0" max="100" step="1" data-role="goal-percent" value="${category.percent}" />
      </div>
      <button type="button" class="btn-secondary split-row-remove" data-role="remove-goal">✕</button>
    </div>
  `).join('');
}

function readLegacySchema(data) {
  return {
    percentageCategories: [
      { name: 'Entertainment', percent: asNumber(data.entertainmentPercent) },
      { name: 'Food', percent: asNumber(data.foodPercent) }
    ],
    savingsGoalCategories: [],
    billCategories: [
      { name: 'Insurance', amount: asNumber(data.bills?.insuranceAmount) },
      { name: 'Subscriptions', amount: asNumber(data.bills?.subscriptionsAmount) },
      { name: 'Gas', amount: asNumber(data.bills?.gasAmount) },
      { name: 'Utilities', amount: asNumber(data.bills?.utilitiesAmount) }
    ]
  };
}

function collectPayload() {
  return {
    percentageCategories: percentageCategories.map((category) => ({
      name: category.name.trim() || 'Unnamed Category',
      percent: asNumber(category.percent)
    })),
    savingsGoalCategories: savingsGoalCategories.map((category) => ({
      goalName: category.goalName.trim() || 'Unnamed Goal',
      percent: asNumber(category.percent)
    })),
    billCategories: billCategories.map((category) => ({
      name: category.name.trim() || 'Unnamed Bill',
      amount: asNumber(category.amount)
    }))
  };
}

function serializeForCompare(value) {
  return JSON.stringify(value);
}

function getChangedFields(payload) {
  const changedFields = {};

  if (!lastSavedPayload || serializeForCompare(payload.percentageCategories) !== serializeForCompare(lastSavedPayload.percentageCategories)) {
    changedFields.percentageCategories = payload.percentageCategories;
  }

  if (!lastSavedPayload || serializeForCompare(payload.savingsGoalCategories) !== serializeForCompare(lastSavedPayload.savingsGoalCategories)) {
    changedFields.savingsGoalCategories = payload.savingsGoalCategories;
  }

  if (!lastSavedPayload || serializeForCompare(payload.billCategories) !== serializeForCompare(lastSavedPayload.billCategories)) {
    changedFields.billCategories = payload.billCategories;
  }

  return changedFields;
}

function validatePayload(payload) {
  if (payload.percentageCategories.length === 0) {
    return 'Add at least one percentage category.';
  }

  if (payload.billCategories.length === 0) {
    return 'Add at least one bill category.';
  }

  const categoryPercentTotal = payload.percentageCategories.reduce((sum, category) => sum + asNumber(category.percent), 0);
  const savingsGoalPercentTotal = payload.savingsGoalCategories.reduce((sum, category) => sum + asNumber(category.percent), 0);
  const percentTotal = categoryPercentTotal + savingsGoalPercentTotal;

  if (percentTotal > 100) {
    return 'Total percentage cannot exceed 100%.';
  }

  if (payload.percentageCategories.some((category) => !category.name.trim())) {
    return 'Each percentage category needs a name.';
  }

  if (payload.savingsGoalCategories.some((category) => !category.goalName.trim())) {
    return 'Each savings goal allocation needs a goal.';
  }

  if (payload.billCategories.some((category) => !category.name.trim())) {
    return 'Each bill category needs a name.';
  }

  if (payload.billCategories.some((category) => asNumber(category.amount) < 0)) {
    return 'Bill amounts cannot be negative.';
  }

  return '';
}

async function ensureSplitRatioDoc(userId) {
  const percentageRef = doc(db, 'users', userId, 'splitRatios', 'percentageCategories');
  const billsRef = doc(db, 'users', userId, 'splitRatios', 'billCategories');
  const legacyRef = doc(db, 'users', userId, 'splitRatios', 'current');

  const [percentageSnapshot, billsSnapshot, legacySnapshot] = await Promise.all([
    getDoc(percentageRef),
    getDoc(billsRef),
    getDoc(legacyRef)
  ]);

  let percentageCategories = null;
  let savingsGoalCategories = null;
  let billCategories = null;

  if (percentageSnapshot.exists()) {
    const data = percentageSnapshot.data();
    percentageCategories = normalizePercentCategories(data.categories || data.percentageCategories);
    savingsGoalCategories = normalizeSavingsGoalCategories(data.savingsGoalCategories);
  }

  if (billsSnapshot.exists()) {
    const data = billsSnapshot.data();
    billCategories = normalizeBillCategories(data.categories || data.billCategories);
  }

  if ((!percentageCategories || !billCategories) && legacySnapshot.exists()) {
    const legacyData = legacySnapshot.data();

    if (!percentageCategories) {
      if (Array.isArray(legacyData.percentageCategories)) {
        percentageCategories = normalizePercentCategories(legacyData.percentageCategories);
      } else {
        percentageCategories = readLegacySchema(legacyData).percentageCategories;
        savingsGoalCategories = readLegacySchema(legacyData).savingsGoalCategories;
      }
    }

    if (!billCategories) {
      if (Array.isArray(legacyData.billCategories)) {
        billCategories = normalizeBillCategories(legacyData.billCategories);
      } else {
        billCategories = readLegacySchema(legacyData).billCategories;
      }
    }
  }

  if (!percentageCategories) {
    percentageCategories = DEFAULT_SPLIT_RATIOS.percentageCategories.map((category) => ({ ...category }));
  }

  if (!savingsGoalCategories) {
    savingsGoalCategories = [];
  }

  if (!billCategories) {
    billCategories = DEFAULT_SPLIT_RATIOS.billCategories.map((category) => ({ ...category }));
  }

  if (!percentageSnapshot.exists()) {
    await setDoc(percentageRef, {
      categories: percentageCategories,
      savingsGoalCategories,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

  if (!billsSnapshot.exists()) {
    await setDoc(billsRef, {
      categories: billCategories,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

  return { percentageCategories, savingsGoalCategories, billCategories };
}

async function saveSplitRatios(event) {
  event.preventDefault();

  if (!currentUserId) {
    setMessage('You must be logged in.', 'error');
    return;
  }

  syncSavingsGoalAllocationsWithGoals();

  const payload = collectPayload();
  const validationMessage = validatePayload(payload);

  if (validationMessage) {
    setMessage(validationMessage, 'error');
    return;
  }

  const changedFields = getChangedFields(payload);

  if (Object.keys(changedFields).length === 0) {
    setMessage('No changes to save.', 'success');
    return;
  }

  const writes = [];

  if (changedFields.percentageCategories) {
    const percentageRef = doc(db, 'users', currentUserId, 'splitRatios', 'percentageCategories');
    const percentageDocPayload = {
      categories: payload.percentageCategories,
      updatedAt: serverTimestamp()
    };

    if (changedFields.savingsGoalCategories) {
      percentageDocPayload.savingsGoalCategories = payload.savingsGoalCategories;
    }

    writes.push(setDoc(percentageRef, {
      ...percentageDocPayload
    }, { merge: true }));
  } else if (changedFields.savingsGoalCategories) {
    const percentageRef = doc(db, 'users', currentUserId, 'splitRatios', 'percentageCategories');
    writes.push(setDoc(percentageRef, {
      savingsGoalCategories: payload.savingsGoalCategories,
      updatedAt: serverTimestamp()
    }, { merge: true }));
  }

  if (changedFields.billCategories) {
    const billsRef = doc(db, 'users', currentUserId, 'splitRatios', 'billCategories');
    writes.push(setDoc(billsRef, {
      categories: changedFields.billCategories,
      updatedAt: serverTimestamp()
    }, { merge: true }));
  }

  await Promise.all(writes);

  lastSavedPayload = payload;

  setMessage('Split ratios saved.', 'success');
}

function addPercentCategory() {
  percentageCategories.push({ name: 'New Category', percent: 0 });
  syncUnspecifiedPercentageCategory();
  renderPercentCategories();
  renderPercentTotal();
}

function addBillCategory() {
  billCategories.push({ name: 'New Bill', amount: 0 });
  renderBillCategories();
}

function getDefaultGoalForNewAllocation() {
  if (availableSavingsGoals.length === 0) {
    return '';
  }

  const usedGoals = new Set(savingsGoalCategories.map((category) => category.goalName));
  return availableSavingsGoals.find((goal) => !usedGoals.has(goal)) || availableSavingsGoals[0];
}

function addSavingsGoalCategory() {
  const goalName = getDefaultGoalForNewAllocation();

  if (!goalName) {
    setMessage('Create a savings goal on the dashboard first.', 'error');
    return;
  }

  savingsGoalCategories.push({ goalName, percent: 0 });
  renderSavingsGoalCategories();
  renderPercentTotal();
}

function bindDynamicListListeners() {
  elements.percentList.addEventListener('input', (event) => {
    const row = event.target.closest('.split-row');

    if (!row) {
      return;
    }

    const index = Number(row.dataset.index);

    if (event.target.matches('[data-role="percent-name"]')) {
      updatePercentCategory(index, 'name', event.target.value);
      return;
    }

    if (event.target.matches('[data-role="percent-value"]')) {
      updatePercentCategory(index, 'percent', event.target.value);
    }
  });

  elements.percentList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-role="remove-percent"]');

    if (!button) {
      return;
    }

    const row = button.closest('.split-row');
    removePercentCategory(Number(row.dataset.index));
  });

  elements.billList.addEventListener('input', (event) => {
    const row = event.target.closest('.split-row');

    if (!row) {
      return;
    }

    const index = Number(row.dataset.index);

    if (event.target.matches('[data-role="bill-name"]')) {
      updateBillCategory(index, 'name', event.target.value);
      return;
    }

    if (event.target.matches('[data-role="bill-value"]')) {
      updateBillCategory(index, 'amount', event.target.value);
    }
  });

  elements.billList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-role="remove-bill"]');

    if (!button) {
      return;
    }

    const row = button.closest('.split-row');
    removeBillCategory(Number(row.dataset.index));
  });

  elements.goalList.addEventListener('input', (event) => {
    const row = event.target.closest('.split-row');

    if (!row) {
      return;
    }

    const index = Number(row.dataset.index);

    if (event.target.matches('[data-role="goal-name"]')) {
      updateSavingsGoalCategory(index, 'goalName', event.target.value);
      return;
    }

    if (event.target.matches('[data-role="goal-percent"]')) {
      updateSavingsGoalCategory(index, 'percent', event.target.value);
    }
  });

  elements.goalList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-role="remove-goal"]');

    if (!button) {
      return;
    }

    const row = button.closest('.split-row');
    removeSavingsGoalCategory(Number(row.dataset.index));
  });
}

function bindListeners() {
  elements.form.addEventListener('submit', async (event) => {
    try {
      await saveSplitRatios(event);
    } catch (error) {
      console.error('Failed to save split ratios:', error);
      setMessage('Could not save split ratios right now.', 'error');
    }
  });

  elements.addPercentButton.addEventListener('click', addPercentCategory);
  elements.addBillButton.addEventListener('click', addBillCategory);

  if (elements.addGoalButton) {
    elements.addGoalButton.addEventListener('click', addSavingsGoalCategory);
  }

  bindDynamicListListeners();
}

async function loadAvailableSavingsGoals(userId) {
  const snapshot = await getDocs(collection(db, 'users', userId, 'savingsGoals'));
  const names = snapshot.docs
    .map((entry) => String(entry.data()?.name || '').trim())
    .filter((goalName) => Boolean(goalName));

  availableSavingsGoals = Array.from(new Set(names));
  syncSavingsGoalAllocationsWithGoals();
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace('login.html');
    return;
  }

  currentUserId = user.uid;

  try {
    const splitRatios = await ensureSplitRatioDoc(user.uid);
    percentageCategories = normalizePercentCategories(splitRatios.percentageCategories);
    savingsGoalCategories = normalizeSavingsGoalCategories(splitRatios.savingsGoalCategories);
    billCategories = normalizeBillCategories(splitRatios.billCategories);
    await loadAvailableSavingsGoals(user.uid);
    syncUnspecifiedPercentageCategory();
    lastSavedPayload = collectPayload();
    renderPercentCategories();
    renderSavingsGoalCategories();
    renderBillCategories();
    renderPercentTotal();
  } catch (error) {
    console.error('Failed to load split ratios:', error);
    setMessage('Could not load split ratios.', 'error');
  }
});

bindListeners();
