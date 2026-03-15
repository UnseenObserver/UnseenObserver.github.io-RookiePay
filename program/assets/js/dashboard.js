import { auth, db } from './firebase-config.js';
import { listFamilyMembers } from './family.js';
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
  openIncomeModalButton: document.getElementById('open-add-income-modal'),
  openExpenseModalButton: document.getElementById('open-add-expense-modal'),
  tabs: document.querySelectorAll('.tab'),
  panels: document.querySelectorAll('.tab-panel'),
  incomeFields: document.querySelector('.income-fields'),
  expenseFields: document.querySelector('.expense-fields'),
  transactionModalTitle: document.getElementById('modal-title'),
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
  settingsPopover: document.getElementById('settings-popover'),
  settingsAvatarImage: document.getElementById('settings-avatar-image'),
  settingsAvatarFallback: document.getElementById('settings-avatar-fallback'),
  sidebarAvatarImage: document.getElementById('sidebar-avatar-image'),
  sidebarAvatarFallback: document.getElementById('sidebar-avatar-fallback'),
  parentPortalTab: document.querySelector('[data-tab="parent-portal"]'),
  parentPortalPanel: document.querySelector('[data-panel="parent-portal"]'),
  parentPortalCopy: document.getElementById('parent-portal-copy'),
  parentChildFilter: document.getElementById('parent-child-filter'),
  portalChildCount: document.getElementById('portal-child-count'),
  portalTotalBalance: document.getElementById('portal-total-balance'),
  portalTotalSpending: document.getElementById('portal-total-spending'),
  parentChildCards: document.getElementById('parent-child-cards'),
  parentRecentActivity: document.getElementById('parent-recent-activity')
};

let transactions = [];
let currentUser = null;
let activeTransactionModalType = 'income';
let unsubscribeTransactions = null;
let unsubscribeGoals = null;
let splitRatioRefreshIntervalId = null;
let goals = [];
let editingGoalId = null;
let lastPersistedSavingsAllocations = {};
let subPageTab = null;
let subPagePanel = null;
let goalMessageTimeoutId = null;
let pageMessageTimeoutId = null;
let subPagePrevActiveTab = 'dashboard';
let subPageHeightSyncIntervalId = null;
let pageSwitchTimeoutId = null;
let pageSwitchCleanupTimeoutId = null;
let transactionModalAnchor = null;
let goalModalAnchor = null;
const PAGE_SWITCH_FADE_MS = 110;
const DEFAULT_SPLIT_RATIOS = {
  percentageCategories: [
    { name: 'Entertainment', percent: 50 },
    { name: 'Food', percent: 50 }
  ],
  savingsGoalCategories: [],
  billCategories: [
    { name: 'Insurance', amount: 0 },
    { name: 'Subscriptions', amount: 0 },
    { name: 'Gas', amount: 0 },
    { name: 'Utilities', amount: 0 }
  ]
};
let splitRatios = DEFAULT_SPLIT_RATIOS;
let currentUserProfile = null;
let parentPortalChildren = [];

const PRESET_AVATAR_SOURCES = {
  astronaut: '../assets/images/avatars/avatar-1.svg',
  'blue-cap': '../assets/images/avatars/avatar-2.svg',
  'green-hoodie': '../assets/images/avatars/avatar-3.svg',
  'star-glasses': '../assets/images/avatars/avatar-4.svg',
  'orange-playful': '../assets/images/avatars/avatar-5.svg',
  superhero: '../assets/images/avatars/avatar-6.svg'
};

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(amount) {
  return `$${amount.toFixed(2)}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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

  if (pageMessageTimeoutId) {
    clearTimeout(pageMessageTimeoutId);
    pageMessageTimeoutId = null;
  }

  elements.pageMessage.textContent = text;
  elements.pageMessage.className = 'page-message';

  if (type) {
    elements.pageMessage.classList.add(type);
  }

  if (text) {
    pageMessageTimeoutId = setTimeout(() => {
      elements.pageMessage.textContent = '';
      elements.pageMessage.className = 'page-message';
      pageMessageTimeoutId = null;
    }, 10000);
  }
}

function formatTransactionTimestamp(dateValue) {
  if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(dateValue);
}

function formatMoneyInputOnBlur(inputElement) {
  if (!inputElement) {
    return;
  }

  const rawValue = String(inputElement.value || '').trim();

  if (!rawValue) {
    return;
  }

  const normalized = Number(rawValue.replace(/,/g, ''));

  if (!Number.isFinite(normalized)) {
    inputElement.value = '';
    return;
  }

  inputElement.value = normalized.toFixed(2);
}

function stepAmountInput(inputElement, direction) {
  if (!inputElement || inputElement.disabled || inputElement.readOnly) {
    return;
  }

  const parsedValue = Number.parseFloat(String(inputElement.value || '').replace(/,/g, ''));
  const min = Number.parseFloat(inputElement.min);
  const max = Number.parseFloat(inputElement.max);

  const currentValue = Number.isFinite(parsedValue)
    ? parsedValue
    : 0;

  let nextValue = currentValue + (direction > 0 ? 1 : -1);

  if (Number.isFinite(min)) {
    nextValue = Math.max(min, nextValue);
  }

  if (Number.isFinite(max)) {
    nextValue = Math.min(max, nextValue);
  }

  inputElement.value = nextValue.toFixed(2);

  inputElement.dispatchEvent(new Event('input', { bubbles: true }));
  inputElement.dispatchEvent(new Event('change', { bubbles: true }));
  inputElement.focus();
}

function setupAmountSteppers() {
  const amountInputs = document.querySelectorAll('.amount-input input[type="number"]');

  amountInputs.forEach((inputElement) => {
    const wrapper = inputElement.closest('.amount-input');

    if (!wrapper || wrapper.querySelector('.amount-stepper')) {
      return;
    }

    const stepper = document.createElement('div');
    stepper.className = 'amount-stepper';

    const increaseButton = document.createElement('button');
    increaseButton.type = 'button';
    increaseButton.className = 'amount-step-btn amount-step-up';
    increaseButton.setAttribute('aria-label', 'Increase amount');
    increaseButton.textContent = '▲';

    const decreaseButton = document.createElement('button');
    decreaseButton.type = 'button';
    decreaseButton.className = 'amount-step-btn amount-step-down';
    decreaseButton.setAttribute('aria-label', 'Decrease amount');
    decreaseButton.textContent = '▼';

    increaseButton.addEventListener('click', () => stepAmountInput(inputElement, 1));
    decreaseButton.addEventListener('click', () => stepAmountInput(inputElement, -1));

    stepper.append(increaseButton, decreaseButton);
    inputElement.insertAdjacentElement('afterend', stepper);
  });
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

  // Gross-income model: category allocations are calculated before expenses, then category spend is subtracted.
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

  // Savings goals remain tied to net-after-bills to preserve existing user-visible behavior.
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
          <span class="breakdown-label">${escapeHtml(group.label)}</span>
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
          <span class="breakdown-label">${escapeHtml(group.label)}</span>
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
          <span class="breakdown-label">${escapeHtml(group.label)}</span>
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

    // Skip unchanged writes to avoid unnecessary Firestore updates during frequent recalculations.
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
    .map((name) => {
      const safeName = escapeHtml(name);
      return `<option value="${safeName}">${safeName}</option>`;
    })
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

  elements.list.innerHTML = transactions.map((transaction) => {
    const timestampLabel = formatTransactionTimestamp(transaction.createdAtDate);
    return `
    <li class="transaction-item ${transaction.type}">
      <div class="transaction-info">
        <span class="transaction-desc">${escapeHtml(transaction.description)}</span>
        <span class="transaction-category">${escapeHtml(transaction.category)}${timestampLabel ? ` • ${escapeHtml(timestampLabel)}` : ''}</span>
      </div>
      <div class="transaction-right">
        <span class="transaction-amount">${transaction.type === 'income' ? '+' : '-'}${formatCurrency(transaction.amount)}</span>
        <button class="btn-delete" type="button" data-id="${escapeHtml(transaction.id)}" aria-label="Delete ${escapeHtml(transaction.description)}">✕</button>
      </div>
    </li>
  `;
  }).join('');
}

function setTransactionTab(type) {
  activeTransactionModalType = type === 'expense' ? 'expense' : 'income';

  elements.incomeFields.style.display = activeTransactionModalType === 'income' ? 'grid' : 'none';
  elements.expenseFields.style.display = activeTransactionModalType === 'expense' ? 'grid' : 'none';

  const incomeAmountInput = document.getElementById('amount');
  const expenseTitleInput = document.getElementById('expense-title');
  const expenseAmountInput = document.getElementById('expense-amount');

  if (incomeAmountInput) {
    const isIncome = activeTransactionModalType === 'income';
    incomeAmountInput.required = isIncome;
    incomeAmountInput.disabled = !isIncome;
  }

  if (expenseTitleInput) {
    const isExpense = activeTransactionModalType === 'expense';
    expenseTitleInput.required = isExpense;
    expenseTitleInput.disabled = !isExpense;
  }

  if (expenseAmountInput) {
    const isExpense = activeTransactionModalType === 'expense';
    expenseAmountInput.required = isExpense;
    expenseAmountInput.disabled = !isExpense;
  }

  elements.expenseFields
    .querySelectorAll('input, select, textarea, button')
    .forEach((field) => {
      field.disabled = activeTransactionModalType !== 'expense';
    });

  elements.incomeFields
    .querySelectorAll('input, select, textarea, button')
    .forEach((field) => {
      field.disabled = activeTransactionModalType !== 'income';
    });

  if (elements.transactionModalTitle) {
    elements.transactionModalTitle.textContent = activeTransactionModalType === 'income' ? 'Add Income' : 'Add Expense';
  }
}

function getModalContent(modalElement) {
  return modalElement?.querySelector('.modal-content') || null;
}

function positionModalNearAnchor(modalElement, anchorElement) {
  const content = getModalContent(modalElement);

  if (!modalElement || !content) {
    return;
  }

  const fallbackAnchor = anchorElement
    || (modalElement === elements.modal ? elements.openIncomeModalButton : elements.openGoalModalButton);

  if (!fallbackAnchor) {
    return;
  }

  const anchorRect = fallbackAnchor.getBoundingClientRect();
  const margin = 10;
  const gap = 8;
  const contentRect = content.getBoundingClientRect();
  const contentWidth = contentRect.width || 360;
  const contentHeight = contentRect.height || 420;

  let left = anchorRect.right - contentWidth;
  left = Math.max(margin, Math.min(left, window.innerWidth - contentWidth - margin));

  let top = anchorRect.bottom + gap;
  if (top + contentHeight > window.innerHeight - margin) {
    top = anchorRect.top - contentHeight - gap;
  }
  top = Math.max(margin, Math.min(top, window.innerHeight - contentHeight - margin));

  content.style.left = `${Math.round(left)}px`;
  content.style.top = `${Math.round(top)}px`;
}

function repositionAnchoredPopups() {
  if (!elements.modal.hidden) {
    positionModalNearAnchor(elements.modal, transactionModalAnchor);
  }

  if (!elements.goalModal.hidden) {
    positionModalNearAnchor(elements.goalModal, goalModalAnchor);
  }
}

function toggleTransactionModal(show, transactionType = 'income', anchorElement = null) {
  elements.modal.hidden = !show;
  transactionModalAnchor = show
    ? (anchorElement || (transactionType === 'expense' ? elements.openExpenseModalButton : elements.openIncomeModalButton))
    : null;

  if (show) {
    const targetType = transactionType === 'expense' ? 'expense' : 'income';
    setTransactionTab(targetType);
    requestAnimationFrame(() => positionModalNearAnchor(elements.modal, transactionModalAnchor));
    if (targetType === 'expense') {
      document.getElementById('expense-title').focus();
      return;
    }
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
          notes: data.notes || '',
          createdAtDate: normalizeSnapshotDate(data.createdAt)
        };
      }).sort((left, right) => (right.createdAtDate?.getTime() || 0) - (left.createdAtDate?.getTime() || 0));

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
  const activeTab = activeTransactionModalType;

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
        <strong>${escapeHtml(goal.name)}:</strong> <strong class="goal-amount">${formatCurrency(goal.saved)} / ${formatCurrency(goal.amount)}</strong>
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

function toggleGoalModal(show, anchorElement = null) {
  elements.goalModal.hidden = !show;
  goalModalAnchor = show ? (anchorElement || elements.openGoalModalButton) : null;

  if (show) {
    requestAnimationFrame(() => positionModalNearAnchor(elements.goalModal, goalModalAnchor));
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
  const safeLabel = escapeHtml(label);
  subPageTab.innerHTML = `${safeLabel}<span class="tab-close-btn" aria-label="Close ${safeLabel}" title="Close">&#x2715;</span>`;

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

function openCreateGoalModal(anchorElement = elements.openGoalModalButton) {
  editingGoalId = null;
  elements.goalModalTitle.textContent = 'Add Savings Goal';
  elements.goalForm.reset();
  document.getElementById('goal-saved').value = 0;
  toggleGoalModal(true, anchorElement);
}

function openEditGoalModal(index, anchorElement = elements.openGoalModalButton) {
  const goal = goals[index];

  if (!goal) {
    return;
  }

  document.getElementById('goal-name').value = goal.name;
  document.getElementById('goal-amount').value = goal.amount;
  document.getElementById('goal-saved').value = goal.saved;
  editingGoalId = goal.id;
  elements.goalModalTitle.textContent = 'Edit Savings Goal';
  toggleGoalModal(true, anchorElement);
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
      openEditGoalModal(index, button);
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

function getDefaultProfilePhotoUrl() {
  return '../assets/images/default-profile.svg';
}

function getPresetAvatarSource(avatarName = '') {
  const normalizedName = String(avatarName || '').trim();
  return PRESET_AVATAR_SOURCES[normalizedName] || '';
}

function resolveProfilePhotoSource(photoURL = '', photoAvatarName = '') {
  const presetSource = getPresetAvatarSource(photoAvatarName);

  if (presetSource) {
    return presetSource;
  }

  const trimmedPhotoUrl = String(photoURL || '').trim();
  if (trimmedPhotoUrl) {
    return trimmedPhotoUrl;
  }

  return '';
}

function getLocalProfilePhotoKey(userId) {
  return `mf_profile_photo_${userId}`;
}

function getLocalProfilePhoto(userId) {
  if (!userId) {
    return '';
  }

  return localStorage.getItem(getLocalProfilePhotoKey(userId)) || '';
}

function updateAvatarUI(photoURL, photoAvatarName = '') {
  const imageUrl = resolveProfilePhotoSource(photoURL, photoAvatarName);

  [
    {
      image: elements.settingsAvatarImage,
      fallback: elements.settingsAvatarFallback,
      fallbackText: '👤'
    },
    {
      image: elements.sidebarAvatarImage,
      fallback: elements.sidebarAvatarFallback,
      fallbackText: '👤'
    }
  ].forEach((entry) => {
    if (!entry.image || !entry.fallback) {
      return;
    }

    if (imageUrl) {
      entry.image.src = imageUrl;
      entry.image.hidden = false;
      entry.fallback.hidden = true;
      return;
    }

    entry.image.src = getDefaultProfilePhotoUrl();
    entry.image.hidden = true;
    entry.fallback.hidden = false;
    entry.fallback.textContent = entry.fallbackText;
  });
}

function setParentPortalVisibility(show) {
  if (elements.parentPortalTab) {
    elements.parentPortalTab.hidden = !show;
  }

  if (!show && document.querySelector('.tab.active')?.dataset.tab === 'parent-portal') {
    setActiveTab('dashboard', { skipAnimation: true });
  }
}

function getCurrentMonthExpenseTotal(transactionsList) {
  const now = new Date();

  return transactionsList
    .filter((transaction) => transaction.type === 'expense')
    .filter((transaction) => {
      const createdAt = transaction.createdAtDate;
      return createdAt
        && createdAt.getMonth() === now.getMonth()
        && createdAt.getFullYear() === now.getFullYear();
    })
    .reduce((sum, transaction) => sum + transaction.amount, 0);
}

function normalizeSnapshotDate(timestampValue) {
  if (!timestampValue) {
    return null;
  }

  if (typeof timestampValue.toDate === 'function') {
    return timestampValue.toDate();
  }

  const parsedDate = new Date(timestampValue);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

async function loadParentPortalChildren(profile) {
  parentPortalChildren = [];

  if (profile?.role !== 'parent') {
    renderParentPortal();
    return;
  }

  try {
    const currentParentUid = currentUser?.uid;

    if (!currentParentUid) {
      renderParentPortal();
      return;
    }

    const ownMembers = await listFamilyMembers(currentParentUid);
    const linkedParentUids = ownMembers
      .filter((member) => member.role === 'parent' && member.status === 'active' && member.uid !== currentParentUid)
      .map((member) => member.uid);

    const linkedParentMembers = await Promise.all(linkedParentUids.map((uid) => listFamilyMembers(uid)));

    const childMembers = [
      ...ownMembers,
      ...linkedParentMembers.flat()
    ].filter((member) => member.role === 'child' && member.status === 'active');

    const uniqueChildMembers = Array.from(new Map(childMembers.map((member) => [member.uid, member])).values());

    parentPortalChildren = await Promise.all(uniqueChildMembers.map(async (member) => {
      const [userSnapshot, transactionsSnapshot, goalsSnapshot] = await Promise.all([
        getDoc(doc(db, 'users', member.uid)),
        getDocs(collection(db, 'users', member.uid, 'transactions')),
        getDocs(collection(db, 'users', member.uid, 'savingsGoals'))
      ]);

      const userData = userSnapshot.exists() ? userSnapshot.data() : {};
      const permissions = member.permissions || {};
      const transactionsList = permissions.canViewTransactions || permissions.canViewDashboardSummary
        ? transactionsSnapshot.docs.map((entry) => {
          const data = entry.data();
          return {
            id: entry.id,
            description: data.description || 'Untitled',
            category: data.category || 'General',
            type: data.type === 'income' ? 'income' : 'expense',
            amount: Number(data.amount) || 0,
            createdAtDate: normalizeSnapshotDate(data.createdAt)
          };
        })
        : [];

      const goalsList = permissions.canViewGoals
        ? goalsSnapshot.docs.map((entry) => entry.data())
        : [];

      const income = transactionsList
        .filter((transaction) => transaction.type === 'income')
        .reduce((sum, transaction) => sum + transaction.amount, 0);
      const expense = transactionsList
        .filter((transaction) => transaction.type === 'expense')
        .reduce((sum, transaction) => sum + transaction.amount, 0);

      return {
        uid: member.uid,
        displayName: member.displayName || userData.firstName || member.email || 'Child Account',
        email: member.email || userData.email || 'No email',
        photoURL: String(userData.photoURL || '').trim(),
        photoAvatarName: String(userData.photoAvatarName || '').trim(),
        permissions,
        balance: income - expense,
        monthlySpending: getCurrentMonthExpenseTotal(transactionsList),
        goalCount: goalsList.length,
        transactions: transactionsList
          .sort((left, right) => (right.createdAtDate?.getTime() || 0) - (left.createdAtDate?.getTime() || 0))
          .slice(0, 5)
      };
    }));
  } catch (error) {
    console.error('Failed to load parent portal data:', error);
    setPageMessage('Could not load parent portal data right now.', 'error');
  }

  renderParentPortal();
}

function getFilteredParentPortalChildren() {
  const selectedUid = elements.parentChildFilter?.value || 'all';

  if (selectedUid === 'all') {
    return parentPortalChildren;
  }

  return parentPortalChildren.filter((child) => child.uid === selectedUid);
}

function renderParentPortal() {
  if (!elements.parentPortalTab || !elements.parentPortalPanel) {
    return;
  }

  const children = parentPortalChildren;
  const filteredChildren = getFilteredParentPortalChildren();

  if (elements.parentChildFilter) {
    const currentValue = elements.parentChildFilter.value || 'all';
    elements.parentChildFilter.innerHTML = '<option value="all">All linked children</option>' + children.map((child) => (
      `<option value="${child.uid}">${escapeHtml(child.displayName)}</option>`
    )).join('');

    if ([...elements.parentChildFilter.options].some((option) => option.value === currentValue)) {
      elements.parentChildFilter.value = currentValue;
    }
  }

  elements.portalChildCount.textContent = String(children.length);
  elements.portalTotalBalance.textContent = formatCurrency(filteredChildren.reduce((sum, child) => sum + child.balance, 0));
  elements.portalTotalSpending.textContent = formatCurrency(filteredChildren.reduce((sum, child) => sum + child.monthlySpending, 0));

  if (children.length === 0) {
    elements.parentPortalCopy.textContent = 'No linked children yet. Add them from Account settings using your invite code.';
    elements.parentChildCards.innerHTML = '<li class="empty-state">No linked children yet.</li>';
    elements.parentRecentActivity.innerHTML = '<li class="empty-state">No child activity to display yet.</li>';
    return;
  }

  elements.parentPortalCopy.textContent = 'Monitor linked child accounts, recent activity, and savings progress.';

  elements.parentChildCards.innerHTML = filteredChildren.map((child) => `
    <li class="family-member-card compact-family-member-card">
      <div class="family-member-header">
        <div class="parent-child-avatar-wrap" aria-hidden="true">
              ${resolveProfilePhotoSource(child.photoURL, child.photoAvatarName)
            ? `<img class="parent-child-avatar" src="${escapeHtml(resolveProfilePhotoSource(child.photoURL, child.photoAvatarName))}" alt="" />`
    : '<span class="parent-child-avatar-fallback">👤</span>'}
        </div>
        <div>
          <strong>${escapeHtml(child.displayName)}</strong>
          <p>${escapeHtml(child.email)}</p>
        </div>
      </div>
      <div class="parent-child-metrics">
        <span>Balance <strong>${formatCurrency(child.balance)}</strong></span>
        <span>Monthly Spending <strong>${formatCurrency(child.monthlySpending)}</strong></span>
        <span>Goals <strong>${child.goalCount}</strong></span>
      </div>
      <div class="profile-photo-actions">
        <button type="button" class="btn-secondary" data-parent-action="add-child-goal" data-child-uid="${escapeHtml(child.uid)}" data-child-name="${escapeHtml(child.displayName)}">Add Savings Goal</button>
      </div>
    </li>
  `).join('');

  const recentActivity = filteredChildren
    .flatMap((child) => child.transactions.map((transaction) => ({
      childName: child.displayName,
      ...transaction
    })))
    .sort((left, right) => (right.createdAtDate?.getTime() || 0) - (left.createdAtDate?.getTime() || 0))
    .slice(0, 8);

  elements.parentRecentActivity.innerHTML = recentActivity.length === 0
    ? '<li class="empty-state">No child activity to display yet.</li>'
    : recentActivity.map((transaction) => `
      <li>
        <strong>${escapeHtml(transaction.childName)}</strong>: ${escapeHtml(transaction.description)}
        <span class="breakdown-amount">${transaction.type === 'expense' ? '-' : '+'}${formatCurrency(transaction.amount)}</span>
      </li>
    `).join('');
}

async function handleParentPortalAction(event) {
  const actionButton = event.target.closest('[data-parent-action="add-child-goal"]');

  if (!actionButton || !currentUser || currentUserProfile?.role !== 'parent') {
    return;
  }

  const childUid = actionButton.dataset.childUid;
  const childName = actionButton.dataset.childName || 'this child';

  if (!childUid) {
    return;
  }

  const goalName = window.prompt(`Enter a savings goal name for ${childName}:`);

  if (!goalName || !goalName.trim()) {
    return;
  }

  const amountRaw = window.prompt('Enter target amount (numbers only):');
  const amount = Number(amountRaw);

  if (!Number.isFinite(amount) || amount <= 0) {
    setPageMessage('Please enter a valid target amount greater than 0.', 'error');
    return;
  }

  try {
    await addDoc(collection(db, 'users', childUid, 'savingsGoals'), {
      name: goalName.trim(),
      amount: Math.round(amount * 100) / 100,
      saved: 0,
      createdByParentUid: currentUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    setPageMessage(`Savings goal added for ${childName}.`, 'success');
    await loadParentPortalChildren(currentUserProfile);
  } catch (error) {
    console.error('Failed to add child savings goal:', error);
    setPageMessage('Could not add savings goal for that child right now.', 'error');
  }
}

async function resolveUserProfile(user) {
  const profile = {
    firstName: (user.displayName || '').trim().split(' ')[0],
    photoURL: user.photoURL || '',
    photoAvatarName: '',
    role: 'solo',
    primaryFamilyId: null,
    needsRoleMigrationPrompt: false
  };

  try {
    const userProfile = await getDoc(doc(db, 'users', user.uid));

    if (userProfile.exists()) {
      const data = userProfile.data() || {};
      const hasRoleField = Object.prototype.hasOwnProperty.call(data, 'role');
      const firstName = String(data.firstName || '').trim();
      const photoURL = String(data.photoURL || '').trim();
      const photoAvatarName = String(data.photoAvatarName || '').trim();
      const role = String(data.role || 'solo').trim() || 'solo';
      const primaryFamilyId = String(data.primaryFamilyId || '').trim() || (role === 'parent' ? user.uid : null);

      if (firstName) {
        profile.firstName = firstName;
      }

      if (photoURL) {
        profile.photoURL = photoURL;
      }

      if (photoAvatarName) {
        profile.photoAvatarName = photoAvatarName;
      }

      profile.role = role;
      profile.primaryFamilyId = primaryFamilyId;
      profile.needsRoleMigrationPrompt = !hasRoleField;
    }
  } catch (error) {
    console.warn('Could not load user profile:', error);
  }

  if (!profile.firstName) {
    const emailFirstPart = (user.email || '').split('@')[0];
    profile.firstName = emailFirstPart || 'User';
  }

  return profile;
}

async function applyLegacyRoleMigration(user, profile) {
  if (!profile?.needsRoleMigrationPrompt) {
    return profile;
  }

  try {
    await setDoc(doc(db, 'users', user.uid), {
      role: 'solo',
      primaryFamilyId: null,
      rolePromptedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    const migratedProfile = {
      ...profile,
      role: 'solo',
      primaryFamilyId: null,
      needsRoleMigrationPrompt: false
    };

    const wantsRoleSetup = window.confirm(
      'Your account was upgraded and set to Individual. Are you a Parent Portal or Child account? Click OK to open Account settings and update your role.'
    );

    if (wantsRoleSetup) {
      setPageMessage('Open Account settings to switch your role and family setup.', 'success');
      setTimeout(() => {
        openSubPage('account.html', 'Account');
      }, 0);
    } else {
      setPageMessage('Account role set to Individual. You can update this later in Account settings.', 'success');
    }

    return migratedProfile;
  } catch (error) {
    console.error('Failed to migrate legacy account role:', error);
    return profile;
  }
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
    parentPortalChildren = [];
    currentUserProfile = null;
    setParentPortalVisibility(false);
    renderParentPortal();
    lastPersistedSavingsAllocations = {};
    renderGoals();

    window.location.replace('login.html');
    return;
  }

  currentUser = user;

  let profile = await resolveUserProfile(user);
  profile = await applyLegacyRoleMigration(user, profile);
  currentUserProfile = profile;
  const firstName = profile.firstName;

  if (elements.headerGreeting) {
    elements.headerGreeting.textContent = getHeaderGreeting(firstName);
  }

  if (elements.sidebarUserName) {
    elements.sidebarUserName.textContent = firstName;
  }

  if (elements.sidebarUserEmail) {
    elements.sidebarUserEmail.textContent = user.email || 'Signed in';
  }

  const localPhotoDataUrl = getLocalProfilePhoto(user.uid);
  updateAvatarUI(localPhotoDataUrl || profile.photoURL, profile.photoAvatarName);
  setParentPortalVisibility(profile.role === 'parent');
  await loadParentPortalChildren({
    role: profile.role,
    primaryFamilyId: profile.primaryFamilyId
  });

  if (elements.logoutButton) {
    elements.logoutButton.hidden = false;
  }

  await loadSplitRatios(user.uid);
  startSplitRatioAutoRefresh(user.uid);
  await migrateLegacyGoalsToFirestore(user.uid);
  subscribeToGoals(user.uid);
  subscribeToTransactions(user.uid);
}

function setupProfilePhotoSyncListeners() {
  window.addEventListener('storage', (event) => {
    if (event.key !== 'mf_profile_updated' || !event.newValue) {
      return;
    }

    try {
      const data = JSON.parse(event.newValue);
      if (currentUser && data.userId && data.userId !== currentUser.uid) {
        return;
      }

      updateAvatarUI(data.localPhotoDataUrl || data.photoURL || '', data.photoAvatarName || '');
    } catch {
      // no-op
    }
  });

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) {
      return;
    }

    if (event.data?.type === 'mf-profile-updated') {
      if (currentUser && event.data.userId && event.data.userId !== currentUser.uid) {
        return;
      }

      updateAvatarUI(event.data.localPhotoDataUrl || event.data.photoURL || '', event.data.photoAvatarName || '');
    }
  });
}

function setupListeners() {
  const incomeAmountInput = document.getElementById('amount');
  const expenseAmountInput = document.getElementById('expense-amount');

  incomeAmountInput?.addEventListener('blur', () => {
    formatMoneyInputOnBlur(incomeAmountInput);
  });

  expenseAmountInput?.addEventListener('blur', () => {
    formatMoneyInputOnBlur(expenseAmountInput);
  });

  if (elements.openIncomeModalButton) {
    elements.openIncomeModalButton.addEventListener('click', (event) => {
      toggleTransactionModal(true, 'income', event.currentTarget);
    });
  }

  if (elements.openExpenseModalButton) {
    elements.openExpenseModalButton.addEventListener('click', (event) => {
      toggleTransactionModal(true, 'expense', event.currentTarget);
    });
  }

  elements.modal.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) {
      toggleTransactionModal(false);
    }
  });

  document.addEventListener('click', (event) => {
    if (!elements.modal.hidden) {
      const transactionContent = getModalContent(elements.modal);
      const clickedInsideTransaction = transactionContent?.contains(event.target);
      const clickedTransactionAnchor = transactionModalAnchor?.contains(event.target);

      if (!clickedInsideTransaction && !clickedTransactionAnchor) {
        toggleTransactionModal(false);
      }
    }

    if (!elements.goalModal.hidden) {
      const goalContent = getModalContent(elements.goalModal);
      const clickedInsideGoal = goalContent?.contains(event.target);
      const clickedGoalAnchor = goalModalAnchor?.contains(event.target);

      if (!clickedInsideGoal && !clickedGoalAnchor) {
        toggleGoalModal(false);
      }
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

  if (elements.parentChildFilter) {
    elements.parentChildFilter.addEventListener('change', renderParentPortal);
  }

  if (elements.parentChildCards) {
    elements.parentChildCards.addEventListener('click', handleParentPortalAction);
  }

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

  elements.openGoalModalButton.addEventListener('click', (event) => {
    openCreateGoalModal(event.currentTarget);
  });

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

  window.addEventListener('resize', repositionAnchoredPopups);
  window.addEventListener('scroll', repositionAnchoredPopups, true);
}

function init() {
  setActiveTab('dashboard', { skipAnimation: true });
  setupAmountSteppers();
  renderGoals();
  setupListeners();
  setupProfilePhotoSyncListeners();
  onAuthStateChanged(auth, handleAuthStateChanged);
}

init();
