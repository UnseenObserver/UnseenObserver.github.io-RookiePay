import { auth, db } from './firebase-config.js';
import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  updateEmail,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js';
import {
  doc,
  getDoc,
  serverTimestamp,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';

const elements = {
  form: document.getElementById('account-form'),
  firstNameInput: document.getElementById('first-name'),
  lastNameInput: document.getElementById('last-name'),
  usernameInput: document.getElementById('username'),
  emailInput: document.getElementById('email'),
  saveButton: document.getElementById('save-btn'),
  resetPasswordButton: document.getElementById('reset-password-btn'),
  pageMessage: document.getElementById('page-message')
};

let currentUser = null;

function setPageMessage(text = '', type = '') {
  elements.pageMessage.textContent = text;
  elements.pageMessage.className = 'page-message';
  if (type) {
    elements.pageMessage.classList.add(type);
  }
}

function setFormDisabled(disabled) {
  elements.saveButton.disabled = disabled;
  elements.firstNameInput.disabled = disabled;
  elements.lastNameInput.disabled = disabled;
  elements.usernameInput.disabled = disabled;
  elements.emailInput.disabled = disabled;
}

async function loadAccountData(user) {
  setFormDisabled(true);
  setPageMessage('Loading account information…');

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    const data = userDoc.exists() ? userDoc.data() : {};

    elements.firstNameInput.value = data.firstName || (user.displayName || '').split(' ')[0] || '';
    elements.lastNameInput.value = data.lastName || (user.displayName || '').split(' ').slice(1).join(' ') || '';
    elements.usernameInput.value = data.username || '';
    elements.emailInput.value = user.email || '';

    setPageMessage('');
  } catch (error) {
    console.error('Failed to load account data:', error);
    setPageMessage('Could not load account information. Please refresh the page.', 'error');
  } finally {
    setFormDisabled(false);
  }
}

async function handleSave(event) {
  event.preventDefault();

  if (!currentUser) {
    setPageMessage('You must be signed in to save changes.', 'error');
    return;
  }

  const firstName = elements.firstNameInput.value.trim();
  const lastName = elements.lastNameInput.value.trim();
  const username = elements.usernameInput.value.trim();
  const newEmail = elements.emailInput.value.trim();

  if (!firstName) {
    setPageMessage('First name is required.', 'error');
    return;
  }

  if (!username) {
    setPageMessage('Username is required.', 'error');
    return;
  }

  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
    setPageMessage('Username must be 3–30 characters and use only letters, numbers, or underscores.', 'error');
    return;
  }

  if (!newEmail) {
    setPageMessage('Email is required.', 'error');
    return;
  }

  setFormDisabled(true);
  setPageMessage('Saving…');

  try {
    const displayName = `${firstName} ${lastName}`.trim();
    const writes = [];

    // Update Firebase Auth display name
    if (currentUser.displayName !== displayName) {
      writes.push(updateProfile(currentUser, { displayName }));
    }

    // Update email in Firebase Auth if it changed
    if (currentUser.email !== newEmail) {
      writes.push(updateEmail(currentUser, newEmail));
    }

    await Promise.all(writes);

    // Update Firestore profile document
    await updateDoc(doc(db, 'users', currentUser.uid), {
      firstName,
      lastName,
      username,
      email: newEmail,
      updatedAt: serverTimestamp()
    });

    setPageMessage('Account updated successfully.', 'success');
  } catch (error) {
    console.error('Failed to save account changes:', error);

    if (error.code === 'auth/requires-recent-login') {
      setPageMessage('Changing your email requires a recent sign-in. Please log out, sign back in, and try again.', 'error');
    } else if (error.code === 'auth/email-already-in-use') {
      setPageMessage('That email address is already associated with another account.', 'error');
    } else if (error.code === 'auth/invalid-email') {
      setPageMessage('Please enter a valid email address.', 'error');
    } else {
      setPageMessage('Could not save changes. Please try again.', 'error');
    }
  } finally {
    setFormDisabled(false);
  }
}

async function handleResetPassword() {
  if (!currentUser?.email) {
    setPageMessage('No email address is associated with this account.', 'error');
    return;
  }

  elements.resetPasswordButton.disabled = true;

  try {
    await sendPasswordResetEmail(auth, currentUser.email);
    setPageMessage(`Password reset email sent to ${currentUser.email}.`, 'success');
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    setPageMessage('Could not send password reset email. Please try again.', 'error');
  } finally {
    elements.resetPasswordButton.disabled = false;
  }
}

function handleAuthStateChanged(user) {
  if (!user) {
    window.location.replace('login.html');
    return;
  }

  currentUser = user;
  loadAccountData(user);
}

elements.form.addEventListener('submit', handleSave);
elements.resetPasswordButton.addEventListener('click', handleResetPassword);

onAuthStateChanged(auth, handleAuthStateChanged);
