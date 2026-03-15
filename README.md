# RocketHacks2026

Basic budget tracker with Firebase Authentication and Firestore-backed transactions.

## File layout

- `index.html`: entry redirect to login
- `login.html`: login and sign-up markup
- `dashboard.html`: main budget dashboard
- `account.html`, `faq.html`, `terms.html`, `splitRatio.html`, `visuals.html`: settings/support subpages
- `styles.css`: shared styling for all pages (single source of truth)
- `assets/css/styles.css`: compatibility forwarder to `styles.css`
- `assets/js/auth.js`: login, sign-up, and password reset behavior
- `assets/js/dashboard.js`: dashboard behavior, transactions, goals, and subpage tabs
- `assets/js/account.js`: profile and account updates
- `assets/js/split-ratio.js`: split ratio configuration
- `assets/js/visuals.js`: theme/animation preference UI
- `assets/js/theme.js`: global theme application from user settings
- `assets/js/presets.js`: built-in visual presets
- `assets/js/firebase-config.js`: Firebase app initialization
- `assets/js/cache-registration.js`: service worker registration
- `service-worker.js`: offline caching for local static assets

## What should work

- `login.html` lets a user sign up, log in, and request a password reset.
- `dashboard.html` shows the authenticated user's transactions, totals, add form, delete, and clear-all.
- `styles.css` styles auth, dashboard, and settings pages.

## Required Firebase setup

The front end is already wired to Firebase, but the project still depends on Firebase Console setup:

1. Enable `Authentication > Sign-in method > Email/Password`.
2. Create a Firestore database.
3. Use rules that allow a signed-in user to read and write their own user document and `transactions` subcollection.

Example Firestore rules for this app shape:

```txt
rules_version = '2';
service cloud.firestore {
	match /databases/{database}/documents {
		match /users/{userId} {
			allow read, write: if request.auth != null && request.auth.uid == userId;

			match /transactions/{transactionId} {
				allow read, write: if request.auth != null && request.auth.uid == userId;
			}
		}
	}
}
```

## Notes

- Transactions are stored under `users/{uid}/transactions`.
- Open `login.html` first if you are not already authenticated.
- Serve the project from `http://localhost` or hosting instead of opening the HTML files directly with `file://`.