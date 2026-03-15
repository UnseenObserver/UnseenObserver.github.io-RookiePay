import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js';
import { addDoc, collection, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';

const elements = {
  form: document.getElementById('contact-form'),
  nameInput: document.getElementById('contact-name'),
  emailInput: document.getElementById('contact-email'),
  issueInput: document.getElementById('contact-issue'),
  message: document.getElementById('contact-message'),
  submitButton: document.getElementById('contact-submit')
};

let currentUser = null;
let messageTimeoutId = null;

function setMessage(text = '', type = '') {
  if (!elements.message) {
    return;
  }

  if (messageTimeoutId) {
    clearTimeout(messageTimeoutId);
    messageTimeoutId = null;
  }

  elements.message.textContent = text;
  elements.message.className = 'inline-save-message' + (type ? ` ${type}` : '');

  if (text && type === 'success') {
    messageTimeoutId = setTimeout(() => {
      elements.message.textContent = '';
      elements.message.className = 'inline-save-message';
      messageTimeoutId = null;
    }, 3500);
  }
}

function setFormDisabled(disabled) {
  elements.nameInput.disabled = disabled;
  elements.emailInput.disabled = disabled;
  elements.issueInput.disabled = disabled;
  elements.submitButton.disabled = disabled;
}

async function handleSubmit(event) {
  event.preventDefault();

  if (!currentUser) {
    setMessage('You must be signed in to submit a support ticket.', 'error');
    return;
  }

  const name = String(elements.nameInput.value || '').trim();
  const returnEmail = String(elements.emailInput.value || '').trim();
  const issueDescription = String(elements.issueInput.value || '').trim();

  if (!name || !returnEmail || !issueDescription) {
    setMessage('Please complete all fields before submitting.', 'error');
    return;
  }

  setFormDisabled(true);
  setMessage('Submitting your ticket...');

  try {
    await addDoc(collection(db, 'supportTickets'), {
      uid: currentUser.uid,
      name,
      returnEmail,
      issueDescription,
      userEmail: currentUser.email || '',
      status: 'new',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    elements.form.reset();
    elements.emailInput.value = currentUser.email || '';
    setMessage('Support ticket submitted successfully.', 'success');
  } catch (error) {
    console.error('Failed to submit support ticket:', error);
    setMessage('Could not submit your ticket right now. Please try again.', 'error');
  } finally {
    setFormDisabled(false);
  }
}

function handleAuthStateChanged(user) {
  if (!user) {
    window.location.replace('login.html');
    return;
  }

  currentUser = user;
  if (!elements.emailInput.value) {
    elements.emailInput.value = user.email || '';
  }
}

elements.form.addEventListener('submit', handleSubmit);
onAuthStateChanged(auth, handleAuthStateChanged);
