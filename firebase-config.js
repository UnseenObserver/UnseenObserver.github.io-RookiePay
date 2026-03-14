import { getApp, getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAIJcw9lSDNQJTs1q7Sj2E9-gyFd0AtYBI',
  authDomain: 'moneyfirst-cce11.firebaseapp.com',
  projectId: 'moneyfirst-cce11',
  storageBucket: 'moneyfirst-cce11.firebasestorage.app',
  messagingSenderId: '832625214817',
  appId: '1:832625214817:web:caf1e4b8a6a6402f6bb120',
  measurementId: 'G-K7094QCS65'
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };