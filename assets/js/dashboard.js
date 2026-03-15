import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  serverTimestamp,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';

const elements = {
  form: document.getElementById('transaction-form'),
  list: document.getElementById('transaction-list'),
  clearButton: document.getElementById('clear-btn'),
  modal: document.getElementById('add-modal'),
  openModalButton: document.getElementById('open-add-modal'),
  tabs: document.querySelectorAll('.tab'),
  panels: document.querySelectorAll('.tab-panel'),
  transactionTabs: document.querySelectorAll('.transaction-tab'),
  incomeFields: document.querySelector('.income-fields'),
  expenseFields: document.querySelector('.expense-fields'),
  balance: document.getElementById('balance'),
  breakdownList: document.getElementById('breakdown-list'),
  openPercentagesButton: document.getElementById('open-percentages'),
  descriptionSelect: document.getElementById('description-select'),
  customDescriptionGroup: document.getElementById('custom-description-group'),
  customDescriptionInput: document.getElementById('custom-description'),
  headerGreeting: document.getElementById('header-greeting'),
  sidebarUserName: document.getElementById('sidebar-user-name'),
  sidebarUserEmail: document.getElementById('sidebar-user-email'),
  logoutButton: document.getElementById('logout-btn'),
  pageMessage: document.getElementById('page-message'),
  goalModal: document.getElementById('add-goal-modal'),
  openGoalModalButton: document.getElementById('open-add-goal-modal'),
  goalForm: document.getElementById('goal-form'),
  goalModalTitle: document.getElementById('goal-modal-title'),
  goalsList: document.getElementById('goals-list'),
  goalsHeaderMessage: document.getElementById('goals-header-message'),
  headerTools: document.querySelector('.header-tools'),
  openSettingsButton: document.getElementById('open-settings'),
  settingsPopover: document.getElementById('settings-popover')
};

let transactions = [];
let currentUser = null;
let unsubscribeTransactions = null;
let unsubscribeGoals = null;
let splitRatioRefreshIntervalId = null;
let goals = [];
let editingGoalId = null;
let lastPersistedSavingsAllocations = {};
let subPageTab = null;
let subPagePanel = null;
let goalMessageTimeoutId = null;
let subPagePrevActiveTab = 'dashboard';
let subPageHeightSyncIntervalId = null;
let pageSwitchTimeoutId = null;
let pageSwitchCleanupTimeoutId = null;
const PAGE_SWITCH_FADE_MS = 110;
const DEFAULT_SPLIT_RATIOS = {
  percentageCategories: [
    { name: 'Entertainment', percent: 40 },
    { name: 'Food', percent: 60 }
  ],
  savingsGoalCategories: [],
  billCategories: [
    { name: 'Insurance', amount: 120 },
    { name: 'Subscriptions', amount: 35 },
    { name: 'Gas', amount: 100 },
    { name: 'Utilities', amount: 140 }
  ]
};
let splitRatios = DEFAULT_SPLIT_RATIOS;

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(amount) {
  return `$${amount.toFixed(2)}`;
}

function setGoalMessage(text = '', type = '') {
  const el = elements.goalsHeaderMessage;
  if (!el) return;
  if (goalMessageTimeoutId) {
    clearTimeout(goalMessageTimeoutId);
    goalMessageTimeoutId = null;
  }
  el.textContent = text;
  el.className = 'goals-header-message' + (type ? ` ${type}` : '');
  if (text) {
    goalMessageTimeoutId = setTimeout(() => {
      el.textContent = '';
      el.className = 'goals-header-message';
      goalMessageTimeoutId = null;
    }, 3000);
  }
}

function setPageMessage(text = '', type = '') {
  if (!elements.pageMessage) {
    return;
  }

  elements.pageMessage.textContent = text;
  elements.pageMessage.className = 'page-message';

  if (type) {
    elements.pageMessage.classList.add(type);
  }
}

function updateSummary() {
  const income = transactions
    .filter((transaction) => transaction.type === 'income')
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const expense = transactions
    .filter((transaction) => transaction.type === 'expense')
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const balance = income - expense;

  elements.balance.textContent = formatCurrency(balance);
  elements.balance.className = `card-amount ${balance >= 0 ? 'positive' : 'negative'}`;
  updateBreakdown(balance);
}

function updateBreakdown(balance) {
  if (!elements.breakdownList) {
    return;
  }

  const usableBalance = Math.max(0, asNumber(balance));

  // Gross income (sum of all income transactions, before expenses)
  const grossIncome = transactions
    .filter((t) => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);

  // Expenses grouped by category so each category can deduct its own spending
  const expensesByCategory = {};
  for (const t of transactions) {
    if (t.type === 'expense') {
      expensesByCategory[t.category] = (expensesByCategory[t.category] || 0) + t.amount;
    }
  }

  const fixedBillAmounts = (splitRatios.billCategories || []).map((category) => ({
    label: category.name || 'Unnamed Bill',
    fixed: asNumber(category.amount)
  }));

  const billsTotal = fixedBillAmounts.reduce((sum, b) => sum + b.fixed, 0);

  // Allocation base from gross income (not net) so each category absorbs only its own expenses
  const grossAfterBills = Math.max(0, grossIncome - billsTotal);

  // Net balance after bills still used for savings goal persistence (unchanged behaviour)
  const balanceAfterBills = Math.max(0, usableBalance - billsTotal);

  const percentGroups = (splitRatios.percentageCategories || []).map((category) => {
    const percent = asNumber(category.percent);
    const grossAlloc = grossAfterBills * (percent / 100);
    const spent = expensesByCategory[category.name] || 0;
    return {
      label: category.name || 'Unnamed Category',
      amount: Math.max(0, grossAlloc - spent),
      percent
    };
  });

  // Bill groups show remaining budget (fixed amount minus expenses tagged to that bill)
  const billGroups = fixedBillAmounts.map((b) => {
    const spent = expensesByCategory[b.label] || 0;
    return {
      label: b.label,
      amount: Math.max(0, b.fixed - spent)
    };
  });

  const allSavingsGoalAllocations = (splitRatios.savingsGoalCategories || []).map((category) => {
    const percent = asNumber(category.percent);

    return {
      label: category.goalName || 'Unnamed Goal',
      amount: balanceAfterBills * (percent / 100),
      percent
    };
  });

  persistSavingsGoalAllocations(allSavingsGoalAllocations);

  const savingsGoalGroups = allSavingsGoalAllocations.filter((group) => group.amount > 0);

  if (percentGroups.length === 0 && fixedBillAmounts.length === 0) {
    elements.breakdownList.innerHTML = '<li class="empty-state">No split ratio groups configured yet.</li>';
    return;
  }

  const percentageSection = percentGroups.length === 0
    ? '<li class="empty-state">No percentage categories yet.</li>'
    : percentGroups.map((group) => `
      <li class="breakdown-item-row">
        <div>
          <span class="breakdown-label">${group.label}</span>
          <span class="breakdown-amount">${formatCurrency(group.amount)}</span>
        </div>
        <span class="progress-text">${group.percent}%</span>
      </li>
    `).join('');

  const billsSection = billGroups.length === 0
    ? '<li class="empty-state">No bill categories yet.</li>'
    : billGroups.map((group) => `
      <li class="breakdown-item-row">
        <div>
          <span class="breakdown-label">${group.label}</span>
          <span class="breakdown-amount">${formatCurrency(group.amount)}</span>
        </div>
        <span class="progress-text"></span>
      </li>
    `).join('');

  const savingsGoalsSection = savingsGoalGroups.length === 0
    ? ''
    : savingsGoalGroups.map((group) => `
      <li class="breakdown-item-row">
        <div>
          <span class="breakdown-label">${group.label}</span>
          <span class="breakdown-amount">${formatCurrency(group.amount)}</span>
        </div>
        <span class="progress-text">${group.percent}%</span>
      </li>
    `).join('');

  const percentagesTotal = percentGroups.reduce((sum, group) => sum + group.amount, 0);
  const billsTotalAmount = billGroups.reduce((sum, group) => sum + group.amount, 0);
  const savingsGoalsTotal = savingsGoalGroups.reduce((sum, group) => sum + group.amount, 0);

  const savingsGoalsHeader = savingsGoalGroups.length === 0
    ? ''
    : `<li class="breakdown-section-header"><span>Savings Goals</span><span class="breakdown-section-total">${formatCurrency(savingsGoalsTotal)}</span></li>`;

  elements.breakdownList.innerHTML = `
    <li class="breakdown-section-header"><span>Percentages</span><span class="breakdown-section-total">${formatCurrency(percentagesTotal)}</span></li>
    ${percentageSection}
    <li class="breakdown-section-header"><span>Bills</span><span class="breakdown-section-total">${formatCurrency(billsTotalAmount)}</span></li>
    ${billsSection}
    ${savingsGoalsHeader}
    ${savingsGoalsSection}
  `;
}

function persistSavingsGoalAllocations(allocations) {
  if (!currentUser || goals.length === 0 || allocations.length === 0) {
    return;
  }

  const writes = [];

  for (const allocation of allocations) {
    const matchingGoal = goals.find((goal) => goal.name === allocation.label);

    if (!matchingGoal) {
      continue;
    }

    const newSaved = Math.round(Math.min(allocation.amount, matchingGoal.amount) * 100) / 100;

    if (lastPersistedSavingsAllocations[matchingGoal.id] === newSaved) {
      continue;
    }

    lastPersistedSavingsAllocations[matchingGoal.id] = newSaved;
    writes.push(
      setDoc(doc(db, 'users', currentUser.uid, 'savingsGoals', matchingGoal.id), {
        saved: newSaved,
        updatedAt: serverTimestamp()
      }, { merge: true })
    );
  }

  if (writes.length > 0) {
    Promise.all(writes).catch((error) => {
      console.error('Failed to persist savings goal allocations:', error);
    });
  }
}

async function loadSplitRatios(userId) {
  try {
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
      const source = data.categories || data.percentageCategories;
      const savingsGoalsSource = data.savingsGoalCategories;

      if (Array.isArray(source)) {
        percentageCategories = source.map((category, index) => ({
          name: String(category?.name || `Category ${index + 1}`),
          percent: asNumber(category?.percent)
        }));
      }

      if (Array.isArray(savingsGoalsSource)) {
        savingsGoalCategories = savingsGoalsSource.map((category, index) => ({
          goalName: String(category?.goalName || `Goal ${index + 1}`),
          percent: asNumber(category?.percent)
        }));
      } else {
        savingsGoalCategories = [];
      }
    }

    if (billsSnapshot.exists()) {
      const data = billsSnapshot.data();
      const source = data.categories || data.billCategories;

      if (Array.isArray(source)) {
        billCategories = source.map((category, index) => ({
          name: String(category?.name || `Bill ${index + 1}`),
          amount: asNumber(category?.amount)
        }));
      }
    }

    if ((!percentageCategories || !billCategories) && legacySnapshot.exists()) {
      const data = legacySnapshot.data();

      if (!percentageCategories) {
        if (Array.isArray(data.percentageCategories)) {
          percentageCategories = data.percentageCategories.map((category, index) => ({
            name: String(category?.name || `Category ${index + 1}`),
            percent: asNumber(category?.percent)
          }));
        } else {
          percentageCategories = [
            { name: 'Entertainment', percent: asNumber(data.entertainmentPercent) },
            { name: 'Food', percent: asNumber(data.foodPercent) }
          ];
        }
      }

      if (!billCategories) {
        if (Array.isArray(data.billCategories)) {
          billCategories = data.billCategories.map((category, index) => ({
            name: String(category?.name || `Bill ${index + 1}`),
            amount: asNumber(category?.amount)
          }));
        } else {
          billCategories = [
            { name: 'Insurance', amount: asNumber(data.bills?.insuranceAmount) },
            { name: 'Subscriptions', amount: asNumber(data.bills?.subscriptionsAmount) },
            { name: 'Gas', amount: asNumber(data.bills?.gasAmount) },
            { name: 'Utilities', amount: asNumber(data.bills?.utilitiesAmount) }
          ];
        }
      }

      if (!Array.isArray(savingsGoalCategories)) {
        savingsGoalCategories = [];
      }
    }

    splitRatios = {
      percentageCategories: percentageCategories || DEFAULT_SPLIT_RATIOS.percentageCategories,
      savingsGoalCategories: savingsGoalCategories || DEFAULT_SPLIT_RATIOS.savingsGoalCategories,
      billCategories: billCategories || DEFAULT_SPLIT_RATIOS.billCategories
    };
  } catch (error) {
    console.warn('Could not load split ratios:', error);
    splitRatios = DEFAULT_SPLIT_RATIOS;
  }

  populateExpenseCategoryDropdown();
  updateSummary();
}

function populateExpenseCategoryDropdown() {
  const select = document.getElementById('expense-category');

  if (!select) {
    return;
  }

  const percentNames = (splitRatios.percentageCategories || []).map((c) => c.name).filter(Boolean);
  const billNames = (splitRatios.billCategories || []).map((c) => c.name).filter(Boolean);
  const seen = new Set();
  const allNames = [];

  for (const name of [...percentNames, ...billNames]) {
    if (!seen.has(name)) {
      seen.add(name);
      allNames.push(name);
    }
  }

  const currentValue = select.value;

  select.innerHTML = allNames
    .map((name) => `<option value="${name}">${name}</option>`)
    .join('') + '<option value="Other">Other</option>';

  if ([...select.options].some((opt) => opt.value === currentValue)) {
    select.value = currentValue;
  }
}

function startSplitRatioAutoRefresh(userId) {
  if (splitRatioRefreshIntervalId) {
    splitRatioRefreshIntervalId();
  }

  const percentageRef = doc(db, 'users', userId, 'splitRatios', 'percentageCategories');
  const billsRef = doc(db, 'users', userId, 'splitRatios', 'billCategories');
  let firstPercentFire = true;
  let firstBillsFire = true;

  const unsubPercent = onSnapshot(percentageRef, async () => {
    if (firstPercentFire) { firstPercentFire = false; return; }
    await loadSplitRatios(userId);
  }, (error) => {
    console.warn('Could not listen to split ratio categories:', error);
  });

  const unsubBills = onSnapshot(billsRef, async () => {
    if (firstBillsFire) { firstBillsFire = false; return; }
    await loadSplitRatios(userId);
  }, (error) => {
    console.warn('Could not listen to bill categories:', error);
  });

  splitRatioRefreshIntervalId = () => {
    unsubPercent();
    unsubBills();
  };
}

function stopSplitRatioAutoRefresh() {
  if (!splitRatioRefreshIntervalId) {
    return;
  }

  splitRatioRefreshIntervalId();
  splitRatioRefreshIntervalId = null;
}

function renderList() {
  if (transactions.length === 0) {
    elements.list.innerHTML = '<li class="empty-state">No transactions yet. Add one above!</li>';
    return;
  }

  elements.list.innerHTML = transactions.map((transaction) => `
    <li class="transaction-item ${transaction.type}">
      <div class="transaction-info">
        <span class="transaction-desc">${transaction.description}</span>
        <span class="transaction-category">${transaction.category}</span>
      </div>
      <div class="transaction-right">
        <span class="transaction-amount">${transaction.type === 'income' ? '+' : '-'}${formatCurrency(transaction.amount)}</span>
        <button class="btn-delete" type="button" data-id="${transaction.id}" aria-label="Delete ${transaction.description}">✕</button>
      </div>
    </li>
  `).join('');
}

function setTransactionTab(type) {
  elements.transactionTabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.type === type);
  });

  elements.incomeFields.style.display = type === 'income' ? 'grid' : 'none';
  elements.expenseFields.style.display = type === 'expense' ? 'grid' : 'none';
}

function toggleTransactionModal(show) {
  elements.modal.hidden = !show;
  document.body.style.overflow = show ? 'hidden' : '';

  if (show) {
    setTransactionTab('income');
    document.getElementById('amount').focus();
  }
}

function withPageFadeTransition(applySwitch) {
  const currentPanel = document.querySelector('.tab-panel:not([hidden])');

  if (!currentPanel) {
    applySwitch();
    return;
  }

  if (pageSwitchTimeoutId) {
    clearTimeout(pageSwitchTimeoutId);
    pageSwitchTimeoutId = null;
  }

  if (pageSwitchCleanupTimeoutId) {
    clearTimeout(pageSwitchCleanupTimeoutId);
    pageSwitchCleanupTimeoutId = null;
  }

  currentPanel.classList.remove('panel-fade-in');
  currentPanel.classList.add('panel-fade-out');

  pageSwitchTimeoutId = window.setTimeout(() => {
    applySwitch();
    currentPanel.classList.remove('panel-fade-out');

    const nextPanel = document.querySelector('.tab-panel:not([hidden])');

    if (nextPanel) {
      nextPanel.classList.add('panel-fade-in');
      pageSwitchCleanupTimeoutId = window.setTimeout(() => {
        nextPanel.classList.remove('panel-fade-in');
      }, PAGE_SWITCH_FADE_MS);
    }
  }, PAGE_SWITCH_FADE_MS);
}

function applyStaticTab(tabKey) {
  if (subPageTab) {
    subPageTab.classList.remove('active');
    subPageTab.setAttribute('aria-selected', 'false');
  }
  if (subPagePanel) {
    subPagePanel.hidden = true;
  }

  elements.tabs.forEach((tab) => {
    const isActive = tab.dataset.tab === tabKey;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });

  elements.panels.forEach((panel) => {
    panel.hidden = panel.dataset.panel !== tabKey;
  });
}

function setActiveTab(tabKey, options = {}) {
  if (options.skipAnimation) {
    applyStaticTab(tabKey);
    return;
  }

  withPageFadeTransition(() => applyStaticTab(tabKey));
}

async function removeTransaction(transactionId) {
  if (!currentUser || !transactionId) {
    return;
  }

  await deleteDoc(doc(db, 'users', currentUser.uid, 'transactions', transactionId));
}

function subscribeToTransactions(userId) {
  if (unsubscribeTransactions) {
    unsubscribeTransactions();
  }

  unsubscribeTransactions = onSnapshot(
    collection(db, 'users', userId, 'transactions'),
    (snapshot) => {
      transactions = snapshot.docs.map((entry) => {
        const data = entry.data();

        return {
          id: entry.id,
          description: data.description || 'Untitled',
          category: data.category || 'General',
          type: data.type === 'income' ? 'income' : 'expense',
          amount: Number(data.amount) || 0,
          notes: data.notes || ''
        };
      });

      renderList();
      updateSummary();
      setPageMessage('');
    },
    () => {
      setPageMessage('Could not load transactions. Check your Firestore rules and network connection.', 'error');
    }
  );
}

function normalizeGoal(entry) {
  const data = entry.data();
  const amount = Math.max(0, asNumber(data.amount));
  const saved = Math.min(Math.max(0, asNumber(data.saved)), amount);

  return {
    id: entry.id,
    name: String(data.name || 'Unnamed Goal').trim() || 'Unnamed Goal',
    amount,
    saved
  };
}

async function migrateLegacyGoalsToFirestore(userId) {
  let legacyGoals = [];

  try {
    legacyGoals = (JSON.parse(localStorage.getItem('goals')) || [])
      .map((goal) => ({
        name: String(goal?.name || '').trim(),
        amount: Math.max(0, asNumber(goal?.amount)),
        saved: Math.max(0, asNumber(goal?.saved))
      }))
      .filter((goal) => goal.name && goal.amount > 0)
      .map((goal) => ({
        ...goal,
        saved: Math.min(goal.saved, goal.amount)
      }));
  } catch {
    legacyGoals = [];
  }

  if (legacyGoals.length === 0) {
    return;
  }

  const existingGoalsSnapshot = await getDocs(collection(db, 'users', userId, 'savingsGoals'));

  if (!existingGoalsSnapshot.empty) {
    localStorage.removeItem('goals');
    return;
  }

  const writes = legacyGoals.map((goal) => addDoc(collection(db, 'users', userId, 'savingsGoals'), {
    name: goal.name,
    amount: goal.amount,
    saved: goal.saved,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }));

  await Promise.all(writes);
  localStorage.removeItem('goals');
}

function subscribeToGoals(userId) {
  if (unsubscribeGoals) {
    unsubscribeGoals();
  }

  unsubscribeGoals = onSnapshot(
    collection(db, 'users', userId, 'savingsGoals'),
    (snapshot) => {
      goals = snapshot.docs.map(normalizeGoal);
      renderGoals();
    },
    () => {
      setPageMessage('Could not load savings goals. Check your Firestore rules and network connection.', 'error');
    }
  );
}

function getTransactionFormValues() {
  const activeTab = document.querySelector('.transaction-tab.active')?.dataset.type || 'income';

  if (activeTab === 'income') {
    const amount = parseFloat(document.getElementById('amount').value);
    const selectedDescription = elements.descriptionSelect.value;
    const description = selectedDescription === 'Others'
      ? elements.customDescriptionInput.value.trim()
      : selectedDescription;

    return {
      description,
      amount,
      category: selectedDescription,
      type: 'income',
      notes: document.getElementById('notes').value.trim()
    };
  }

  return {
    description: document.getElementById('expense-title').value.trim(),
    amount: parseFloat(document.getElementById('expense-amount').value),
    category: document.getElementById('expense-category').value,
    type: 'expense',
    notes: document.getElementById('expense-notes').value.trim()
  };
}

function validateTransaction(values) {
  if (!values.description) {
    setPageMessage('Please enter a description/title.', 'error');
    return false;
  }

  if (Number.isNaN(values.amount)) {
    setPageMessage('Please enter a valid amount.', 'error');
    return false;
  }

  if (values.amount <= 0) {
    setPageMessage('Amount must be greater than 0.', 'error');
    return false;
  }

  return true;
}

async function handleTransactionSubmit(event) {
  event.preventDefault();

  if (!currentUser) {
    setPageMessage('You must be logged in to add transactions.', 'error');
    return;
  }

  const values = getTransactionFormValues();

  if (!validateTransaction(values)) {
    return;
  }

  try {
    await addDoc(collection(db, 'users', currentUser.uid, 'transactions'), {
      ...values,
      createdAt: serverTimestamp()
    });

    elements.form.reset();
    elements.customDescriptionGroup.style.display = 'none';
    toggleTransactionModal(false);
    setPageMessage('Transaction added.', 'success');
  } catch (error) {
    console.error('Failed to add transaction:', error);
    setPageMessage('Could not save that transaction.', 'error');
  }
}

async function handleClearTransactions() {
  if (!currentUser || transactions.length === 0) {
    return;
  }

  if (!window.confirm('Clear all transactions?')) {
    return;
  }

  try {
    const batch = writeBatch(db);

    transactions.forEach((transaction) => {
      batch.delete(doc(db, 'users', currentUser.uid, 'transactions', transaction.id));
    });

    await batch.commit();
    setPageMessage('All transactions cleared.', 'success');
  } catch (error) {
    console.error('Failed to clear transactions:', error);
    setPageMessage('Could not clear transactions.', 'error');
  }
}

async function handleLogout() {
  try {
    await signOut(auth);
    window.location.replace('login.html');
  } catch (error) {
    console.error('Failed to sign out:', error);
    setPageMessage('Could not sign out right now.', 'error');
  }
}

function renderGoals() {
  if (goals.length === 0) {
    elements.goalsList.innerHTML = '<li>No goals set yet.</li>';
    return;
  }

  elements.goalsList.innerHTML = goals.map((goal, index) => {
    const percentage = goal.amount > 0 ? Math.min((goal.saved / goal.amount) * 100, 100) : 0;

    return `
      <li>
        <strong>${goal.name}:</strong> <strong class="goal-amount">${formatCurrency(goal.saved)} / ${formatCurrency(goal.amount)}</strong>
        <div class="progress-bar">
          <div class="progress-fill ${percentage >= 100 ? 'complete' : ''}" style="width: ${percentage}%"></div>
        </div>
        <span class="progress-text">${percentage.toFixed(1)}%</span>
        <div class="goal-actions">
          <button class="btn-add-save" type="button" data-action="add-savings" data-index="${index}">Add Savings</button>
          <button class="btn-edit" type="button" data-action="edit-goal" data-index="${index}">Edit</button>
          <button class="btn-delete" type="button" data-action="delete-goal" data-index="${index}">Delete</button>
        </div>
      </li>
    `;
  }).join('');
}

function toggleGoalModal(show) {
  elements.goalModal.hidden = !show;
  document.body.style.overflow = show ? 'hidden' : '';

  if (show) {
    document.getElementById('goal-name').focus();
  }
}

function toggleSettingsPopover(show) {
  if (!elements.settingsPopover || !elements.openSettingsButton) {
    return;
  }

  const wasOpen = !elements.settingsPopover.hidden;

  elements.settingsPopover.hidden = !show;
  elements.openSettingsButton.setAttribute('aria-expanded', show ? 'true' : 'false');

  if (!show && wasOpen) {
    elements.openSettingsButton.focus();
  }
}

function applySubPageActivation() {
  const currentlyActive = [...elements.tabs].find((t) => t.classList.contains('active'));
  if (currentlyActive) {
    subPagePrevActiveTab = currentlyActive.dataset.tab;
  }

  elements.tabs.forEach((tab) => {
    tab.classList.remove('active');
    tab.setAttribute('aria-selected', 'false');
  });
  elements.panels.forEach((panel) => { panel.hidden = true; });

  if (subPageTab) {
    subPageTab.classList.add('active');
    subPageTab.setAttribute('aria-selected', 'true');
  }
  if (subPagePanel) {
    subPagePanel.hidden = false;
  }
}

function activateSubPage(options = {}) {
  if (options.skipAnimation) {
    applySubPageActivation();
    return;
  }

  withPageFadeTransition(() => applySubPageActivation());
}

function openSubPage(url, label) {
  toggleSettingsPopover(false);

  if (subPagePanel && subPagePanel.dataset.subpageUrl === url) {
    activateSubPage();
    return;
  }

  if (subPageTab) {
    subPageTab.remove();
    subPageTab = null;
  }
  if (subPagePanel) {
    subPagePanel.remove();
    subPagePanel = null;
  }
  if (subPageHeightSyncIntervalId) {
    clearInterval(subPageHeightSyncIntervalId);
    subPageHeightSyncIntervalId = null;
  }

  subPageTab = document.createElement('button');
  subPageTab.className = 'tab';
  subPageTab.setAttribute('role', 'tab');
  subPageTab.setAttribute('aria-selected', 'false');
  subPageTab.innerHTML = `${label}<span class="tab-close-btn" aria-label="Close ${label}" title="Close">&#x2715;</span>`;

  subPageTab.addEventListener('click', (event) => {
    if (event.target.closest('.tab-close-btn')) {
      closeSubPage();
      return;
    }
    activateSubPage();
  });

  elements.tabs[elements.tabs.length - 1].closest('.tabs').appendChild(subPageTab);

  subPagePanel = document.createElement('div');
  subPagePanel.className = 'tab-panel';
  subPagePanel.dataset.subpageUrl = url;
  subPagePanel.hidden = true;

  const iframe = document.createElement('iframe');
  iframe.className = 'subpage-iframe';
  iframe.src = `${url}?embedded=1`;
  iframe.title = label;
  iframe.setAttribute('scrolling', 'no');

  const syncIframeHeight = () => {
    try {
      const frameDocument = iframe.contentWindow?.document;

      if (!frameDocument) {
        return;
      }

      const bodyHeight = frameDocument.body?.scrollHeight || 0;
      const docHeight = frameDocument.documentElement?.scrollHeight || 0;
      const nextHeight = Math.max(bodyHeight, docHeight, 600);
      iframe.style.height = `${nextHeight}px`;
    } catch {
      iframe.style.height = '600px';
    }
  };

  iframe.addEventListener('load', () => {
    syncIframeHeight();

    try {
      const frameWindow = iframe.contentWindow;
      const frameDocument = frameWindow?.document;

      frameWindow?.addEventListener('resize', syncIframeHeight);
      frameDocument?.addEventListener('input', syncIframeHeight, true);
      frameDocument?.addEventListener('change', syncIframeHeight, true);
      subPageHeightSyncIntervalId = setInterval(syncIframeHeight, 500);
    } catch {
      // no-op
    }
  });

  subPagePanel.appendChild(iframe);

  document.querySelector('[data-panel="history"]').after(subPagePanel);

  activateSubPage();
}

function closeSubPage() {
  if (subPageTab) {
    subPageTab.remove();
    subPageTab = null;
  }
  if (subPagePanel) {
    subPagePanel.remove();
    subPagePanel = null;
  }
  if (subPageHeightSyncIntervalId) {
    clearInterval(subPageHeightSyncIntervalId);
    subPageHeightSyncIntervalId = null;
  }
  setActiveTab(subPagePrevActiveTab || 'dashboard');
}

function openCreateGoalModal() {
  editingGoalId = null;
  elements.goalModalTitle.textContent = 'Add Savings Goal';
  elements.goalForm.reset();
  document.getElementById('goal-saved').value = 0;
  toggleGoalModal(true);
}

function openEditGoalModal(index) {
  const goal = goals[index];

  if (!goal) {
    return;
  }

  document.getElementById('goal-name').value = goal.name;
  document.getElementById('goal-amount').value = goal.amount;
  document.getElementById('goal-saved').value = goal.saved;
  editingGoalId = goal.id;
  elements.goalModalTitle.textContent = 'Edit Savings Goal';
  toggleGoalModal(true);
}

async function deleteGoal(index) {
  if (!goals[index]) {
    return;
  }

  if (!window.confirm('Delete this goal?')) {
    return;
  }

  if (!currentUser) {
    setGoalMessage('You must be logged in to delete a goal.', 'error');
    return;
  }

  await deleteDoc(doc(db, 'users', currentUser.uid, 'savingsGoals', goals[index].id));
  setGoalMessage('Savings goal deleted.', 'success');
}

async function addSavings(index) {
  if (!goals[index]) {
    return;
  }

  const amountText = window.prompt('Enter amount to add to savings:');
  const amount = parseFloat(amountText || '');

  if (Number.isNaN(amount) || amount <= 0) {
    return;
  }

  if (!currentUser) {
    setGoalMessage('You must be logged in to update savings.', 'error');
    return;
  }

  const goal = goals[index];
  const nextSaved = Math.min(goal.saved + amount, goal.amount);

  await setDoc(doc(db, 'users', currentUser.uid, 'savingsGoals', goal.id), {
    saved: nextSaved,
    updatedAt: serverTimestamp()
  }, { merge: true });

  setGoalMessage('Savings updated.', 'success');
}

async function handleGoalFormSubmit(event) {
  event.preventDefault();

  if (!currentUser) {
    setGoalMessage('You must be logged in to save goals.', 'error');
    return;
  }

  const name = document.getElementById('goal-name').value.trim();
  const amount = parseFloat(document.getElementById('goal-amount').value);
  const saved = parseFloat(document.getElementById('goal-saved').value) || 0;

  if (!name || Number.isNaN(amount) || amount <= 0) {
    setGoalMessage('Please provide a valid goal name and target amount.', 'error');
    return;
  }

  const payload = {
    name,
    amount,
    saved: Math.min(Math.max(0, saved), amount),
    updatedAt: serverTimestamp()
  };

  if (editingGoalId) {
    await setDoc(doc(db, 'users', currentUser.uid, 'savingsGoals', editingGoalId), payload, { merge: true });
    setGoalMessage('Savings goal updated.', 'success');
  } else {
    await addDoc(collection(db, 'users', currentUser.uid, 'savingsGoals'), {
      ...payload,
      createdAt: serverTimestamp()
    });
    setGoalMessage('Savings goal created.', 'success');
  }

  elements.goalForm.reset();
  editingGoalId = null;
  toggleGoalModal(false);
}

async function handleGoalActions(event) {
  const button = event.target.closest('button[data-action]');

  if (!button) {
    return;
  }

  const index = Number(button.dataset.index);

  try {
    if (button.dataset.action === 'add-savings') {
      await addSavings(index);
      return;
    }

    if (button.dataset.action === 'edit-goal') {
      openEditGoalModal(index);
      return;
    }

    if (button.dataset.action === 'delete-goal') {
      await deleteGoal(index);
    }
  } catch (error) {
    console.error('Savings goal action failed:', error);
    setPageMessage('Could not update savings goal right now.', 'error');
  }
}

function getDayPeriodGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) {
    return 'Good morning';
  }

  if (hour < 18) {
    return 'Good afternoon';
  }

  return 'Good evening';
}

function getHeaderGreeting(firstName) {
  const dayGreeting = getDayPeriodGreeting();
  const messages = [
    `Hi, ${firstName}`,
    `${dayGreeting}, ${firstName}`,
    `Glad to see you, ${firstName}`,
    `${dayGreeting}! Ready to budget, ${firstName}?`
  ];

  const minute = new Date().getMinutes();
  const messageIndex = minute % messages.length;
  return messages[messageIndex];
}

async function resolveUserFirstName(user) {
  const displayNameFirstName = (user.displayName || '').trim().split(' ')[0];

  if (displayNameFirstName) {
    return displayNameFirstName;
  }

  try {
    const userProfile = await getDoc(doc(db, 'users', user.uid));

    if (userProfile.exists()) {
      const firstName = (userProfile.data()?.firstName || '').trim();

      if (firstName) {
        return firstName;
      }
    }
  } catch (error) {
    console.warn('Could not load user profile:', error);
  }

  const emailFirstPart = (user.email || '').split('@')[0];
  return emailFirstPart || 'User';
}

async function handleAuthStateChanged(user) {
  if (!user) {
    stopSplitRatioAutoRefresh();

    if (unsubscribeTransactions) {
      unsubscribeTransactions();
      unsubscribeTransactions = null;
    }

    if (unsubscribeGoals) {
      unsubscribeGoals();
      unsubscribeGoals = null;
    }

    goals = [];
    lastPersistedSavingsAllocations = {};
    renderGoals();

    window.location.replace('login.html');
    return;
  }

  currentUser = user;

  const firstName = await resolveUserFirstName(user);

  if (elements.headerGreeting) {
    elements.headerGreeting.textContent = getHeaderGreeting(firstName);
  }

  if (elements.sidebarUserName) {
    elements.sidebarUserName.textContent = firstName;
  }

  if (elements.sidebarUserEmail) {
    elements.sidebarUserEmail.textContent = user.email || 'Signed in';
  }

  if (elements.logoutButton) {
    elements.logoutButton.hidden = false;
  }

  await loadSplitRatios(user.uid);
  startSplitRatioAutoRefresh(user.uid);
  await migrateLegacyGoalsToFirestore(user.uid);
  subscribeToGoals(user.uid);
  subscribeToTransactions(user.uid);
}

function setupListeners() {
  elements.transactionTabs.forEach((tab) => {
    tab.addEventListener('click', () => setTransactionTab(tab.dataset.type));
  });

  elements.openModalButton.addEventListener('click', () => toggleTransactionModal(true));

  elements.modal.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) {
      toggleTransactionModal(false);
    }
  });

  elements.descriptionSelect.addEventListener('change', () => {
    if (elements.descriptionSelect.value === 'Others') {
      elements.customDescriptionGroup.style.display = 'block';
      return;
    }

    elements.customDescriptionGroup.style.display = 'none';
  });

  elements.tabs.forEach((tab) => {
    tab.addEventListener('click', () => setActiveTab(tab.dataset.tab));
  });

  elements.form.addEventListener('submit', handleTransactionSubmit);
  elements.list.addEventListener('click', async (event) => {
    const button = event.target.closest('.btn-delete[data-id]');

    if (!button) {
      return;
    }

    try {
      await removeTransaction(button.dataset.id);
      setPageMessage('Transaction deleted.', 'success');
    } catch (error) {
      console.error('Failed to delete transaction:', error);
      setPageMessage('Could not delete that transaction.', 'error');
    }
  });

  elements.clearButton.addEventListener('click', handleClearTransactions);

  if (elements.logoutButton) {
    elements.logoutButton.addEventListener('click', handleLogout);
  }

  elements.openGoalModalButton.addEventListener('click', openCreateGoalModal);

  elements.goalModal.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) {
      toggleGoalModal(false);
    }
  });

  elements.goalForm.addEventListener('submit', handleGoalFormSubmit);
  elements.goalsList.addEventListener('click', handleGoalActions);

  if (elements.openSettingsButton && elements.settingsPopover) {
    elements.openSettingsButton.addEventListener('click', () => {
      toggleSettingsPopover(elements.settingsPopover.hidden);
    });

    document.addEventListener('click', (event) => {
      const clickedInsidePopover = elements.settingsPopover.contains(event.target);
      const clickedSettingsButton = elements.openSettingsButton.contains(event.target);

      if (!clickedInsidePopover && !clickedSettingsButton) {
        toggleSettingsPopover(false);
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !elements.settingsPopover.hidden) {
        toggleSettingsPopover(false);
      }
    });
  }

  if (elements.openPercentagesButton) {
    elements.openPercentagesButton.addEventListener('click', () => {
      openSubPage('splitRatio.html', 'Split Ratios');
    });
  }

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-subpage]');
    if (target) {
      openSubPage(target.dataset.subpage, target.dataset.subpageLabel || 'Page');
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    const target = event.target.closest('[data-subpage]');
    if (target && target.tagName !== 'BUTTON') {
      event.preventDefault();
      openSubPage(target.dataset.subpage, target.dataset.subpageLabel || 'Page');
    }
  });
}

function init() {
  setActiveTab('dashboard', { skipAnimation: true });
  renderGoals();
  setupListeners();
  onAuthStateChanged(auth, handleAuthStateChanged);
}

init();
