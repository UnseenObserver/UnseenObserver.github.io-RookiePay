import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
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
  descriptionSelect: document.getElementById('description-select'),
  customDescriptionGroup: document.getElementById('custom-description-group'),
  customDescriptionInput: document.getElementById('custom-description'),
  userEmail: document.getElementById('user-email'),
  logoutButton: document.getElementById('logout-btn'),
  pageMessage: document.getElementById('page-message'),
  goalModal: document.getElementById('add-goal-modal'),
  openGoalModalButton: document.getElementById('open-add-goal-modal'),
  goalForm: document.getElementById('goal-form'),
  goalModalTitle: document.getElementById('goal-modal-title'),
  goalsList: document.getElementById('goals-list')
};

let transactions = [];
let currentUser = null;
let unsubscribeTransactions = null;
let goals = JSON.parse(localStorage.getItem('goals')) || [];
goals = goals.map((goal) => ({ ...goal, saved: goal.saved || 0 }));
let editingGoalIndex = -1;

function formatCurrency(amount) {
  return `$${amount.toFixed(2)}`;
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

function setActiveTab(tabKey) {
  elements.tabs.forEach((tab) => {
    const isActive = tab.dataset.tab === tabKey;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });

  elements.panels.forEach((panel) => {
    panel.hidden = panel.dataset.panel !== tabKey;
  });
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

  const transactionsRef = collection(db, 'users', userId, 'transactions');
  const transactionsQuery = query(transactionsRef, orderBy('createdAt', 'desc'));

  unsubscribeTransactions = onSnapshot(
    transactionsQuery,
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

function saveGoals() {
  localStorage.setItem('goals', JSON.stringify(goals));
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

function openCreateGoalModal() {
  editingGoalIndex = -1;
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
  editingGoalIndex = index;
  elements.goalModalTitle.textContent = 'Edit Savings Goal';
  toggleGoalModal(true);
}

function deleteGoal(index) {
  if (!goals[index]) {
    return;
  }

  if (!window.confirm('Delete this goal?')) {
    return;
  }

  goals.splice(index, 1);
  saveGoals();
  renderGoals();
}

function addSavings(index) {
  if (!goals[index]) {
    return;
  }

  const amountText = window.prompt('Enter amount to add to savings:');
  const amount = parseFloat(amountText || '');

  if (Number.isNaN(amount) || amount <= 0) {
    return;
  }

  goals[index].saved += amount;

  if (goals[index].saved > goals[index].amount) {
    goals[index].saved = goals[index].amount;
  }

  saveGoals();
  renderGoals();
}

function handleGoalFormSubmit(event) {
  event.preventDefault();

  const name = document.getElementById('goal-name').value.trim();
  const amount = parseFloat(document.getElementById('goal-amount').value);
  const saved = parseFloat(document.getElementById('goal-saved').value) || 0;

  if (!name || Number.isNaN(amount) || amount <= 0) {
    return;
  }

  if (editingGoalIndex >= 0) {
    goals[editingGoalIndex] = { name, amount, saved };
  } else {
    goals.push({ name, amount, saved });
  }

  saveGoals();
  renderGoals();
  elements.goalForm.reset();
  toggleGoalModal(false);
}

function handleGoalActions(event) {
  const button = event.target.closest('button[data-action]');

  if (!button) {
    return;
  }

  const index = Number(button.dataset.index);

  if (button.dataset.action === 'add-savings') {
    addSavings(index);
    return;
  }

  if (button.dataset.action === 'edit-goal') {
    openEditGoalModal(index);
    return;
  }

  if (button.dataset.action === 'delete-goal') {
    deleteGoal(index);
  }
}

function handleAuthStateChanged(user) {
  if (!user) {
    if (unsubscribeTransactions) {
      unsubscribeTransactions();
      unsubscribeTransactions = null;
    }

    window.location.replace('login.html');
    return;
  }

  currentUser = user;

  if (elements.userEmail) {
    elements.userEmail.textContent = user.email || user.displayName || 'Signed in';
    elements.userEmail.hidden = false;
  }

  if (elements.logoutButton) {
    elements.logoutButton.hidden = false;
  }

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
}

function init() {
  setActiveTab('dashboard');
  renderGoals();
  setupListeners();
  onAuthStateChanged(auth, handleAuthStateChanged);
}

init();
