import { auth, db } from './firebase-config.js';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js';
import {
  collection,
  doc,
  serverTimestamp,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';

const authTabs = document.querySelectorAll('.auth-tab');
const authPanels = document.querySelectorAll('.auth-panel');
const authForms = document.querySelectorAll('.auth-form');
const forgotPasswordLink = document.getElementById('forgot-password-link');
const loginEmailInput = document.getElementById('login-email');

let isAuthFlowInProgress = false;

function switchTab(isLogin) {
  authTabs.forEach((tab) => {
    const selected = tab.id === (isLogin ? 'login-tab' : 'signup-tab');
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', selected ? 'true' : 'false');
  });

  authPanels.forEach((panel) => {
    const showPanel = isLogin ? panel.id === 'login-panel' : panel.id === 'signup-panel';
    panel.classList.toggle('active', showPanel);
    panel.hidden = !showPanel;
  });
}

function setAuthMessage(form, text = '', type = '') {
  const message = form.querySelector('.auth-message');
  message.textContent = text;
  message.className = 'auth-message';

  if (type) {
    message.classList.add(type);
  }
}

function getFriendlyAuthMessage(error) {
  const code = error?.code;

  if (code === 'auth/configuration-not-found') {
    return 'Firebase Auth is not fully configured. In Firebase Console, enable Email/Password sign-in.';
  }

  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return 'Incorrect email or password.';
  }

  if (code === 'auth/email-already-in-use') {
    return 'That email is already registered. Try logging in instead.';
  }

  if (code === 'auth/weak-password') {
    return 'Password is too weak. Use at least 6 characters.';
  }

  if (code === 'auth/invalid-email') {
    return 'Please enter a valid email address.';
  }

  if (code === 'auth/too-many-requests') {
    return 'Too many attempts. Please wait a moment and try again.';
  }

  if (code === 'permission-denied') {
    return 'Firestore write blocked by rules. Allow users to write only to their own records.';
  }

  if (code === 'unavailable') {
    return 'Firestore is temporarily unavailable. Please retry in a moment.';
  }

  return error?.message || 'Authentication failed. Please try again.';
}

async function createAccount(form) {
  const firstName = document.getElementById('first-name').value.trim();
  const lastName = document.getElementById('last-name').value.trim();
  const username = document.getElementById('signup-username').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const confirmPassword = document.getElementById('confirm-password').value;

  if (!username) {
    setAuthMessage(form, 'Please enter a username.', 'error');
    return;
  }

  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
    setAuthMessage(form, 'Username must be 3-30 characters and use only letters, numbers, or underscores.', 'error');
    return;
  }

  if (password !== confirmPassword) {
    setAuthMessage(form, 'Passwords do not match.', 'error');
    return;
  }

  isAuthFlowInProgress = true;

  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const displayName = `${firstName} ${lastName}`.trim();
  const uid = credential.user.uid;

  if (displayName) {
    await updateProfile(credential.user, { displayName });
  }

  const batch = writeBatch(db);
  batch.set(doc(db, 'users', uid), {
    uid,
    firstName,
    lastName,
    email,
    username,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  const defaultTransactions = [
    { description: 'Starting Balance', amount: 0, category: 'General', type: 'income', createdAt: serverTimestamp() },
    { description: 'Example Expense', amount: 0, category: 'General', type: 'expense', createdAt: serverTimestamp() }
  ];
  defaultTransactions.forEach((transaction) => {
    batch.set(doc(collection(db, 'users', uid, 'transactions')), transaction);
  });

  await batch.commit();

  setAuthMessage(form, 'Account created. Redirecting...', 'success');
  window.location.href = 'dashboard.html';
}

async function signIn(form) {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  isAuthFlowInProgress = true;
  await signInWithEmailAndPassword(auth, email, password);
  setAuthMessage(form, 'Login successful. Redirecting...', 'success');
  window.location.href = 'dashboard.html';
}

async function handleFormSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  setAuthMessage(form);

  try {
    if (form.dataset.mode === 'login') {
      await signIn(form);
      return;
    }

    await createAccount(form);
  } catch (error) {
    console.error('Authentication failed:', error);
    isAuthFlowInProgress = false;
    setAuthMessage(form, getFriendlyAuthMessage(error), 'error');
  }
}

async function handleForgotPassword(event) {
  event.preventDefault();

  const loginForm = document.querySelector('.auth-form[data-mode="login"]');
  const email = loginEmailInput.value.trim();

  if (!email) {
    setAuthMessage(loginForm, 'Enter your login email first, then click forgot password.', 'error');
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    setAuthMessage(loginForm, 'Password reset email sent.', 'success');
  } catch (error) {
    setAuthMessage(loginForm, getFriendlyAuthMessage(error), 'error');
  }
}

authTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    switchTab(tab.id === 'login-tab');
  });
});

authForms.forEach((form) => {
  form.addEventListener('submit', handleFormSubmit);
});

forgotPasswordLink.addEventListener('click', handleForgotPassword);

onAuthStateChanged(auth, (user) => {
  if (user && !isAuthFlowInProgress) {
    window.location.replace('dashboard.html');
  }
});
