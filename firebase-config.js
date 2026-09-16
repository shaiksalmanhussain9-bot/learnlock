/* ===========================================================
   FIREBASE SETUP — one-time, free, takes about 5 minutes
   ===========================================================

   Firebase is what stores your users, courses, and progress.
   The free "Spark" plan is more than enough for LearnLock and
   does NOT require a credit card.

   STEP 1 — Create a Firebase project
   -----------------------------------
   1. Go to https://console.firebase.google.com
   2. Click "Add project" → give it a name, e.g. "learnlock"
   3. You can disable Google Analytics for this project (not needed)
   4. Click "Create project"

   STEP 2 — Register a Web App
   -----------------------------------
   1. On your new project's home page, click the "</>" (web) icon
   2. Give the app a nickname, e.g. "learnlock-web"
   3. You do NOT need Firebase Hosting checked at this step (we'll
      cover free hosting separately below)
   4. Click "Register app"
   5. Firebase will show you a `firebaseConfig` object — copy it

   STEP 3 — Paste your config below
   -----------------------------------
   Replace the placeholder object below with the one Firebase gave you.

   STEP 4 — Turn on Email/Password login
   -----------------------------------
   1. In the Firebase console, go to Build → Authentication
   2. Click "Get started"
   3. Click "Email/Password" → toggle it "Enable" → Save

   STEP 5 — Create the database
   -----------------------------------
   1. In the Firebase console, go to Build → Firestore Database
   2. Click "Create database"
   3. Choose "Start in production mode" → pick any location close to you
   4. Once created, go to the "Rules" tab and replace the rules with:

      rules_version = '2';
      service cloud.firestore {
        match /databases/{database}/documents {
          match /users/{userId} {
            allow read, write: if request.auth != null && request.auth.uid == userId;
            match /{document=**} {
              allow read, write: if request.auth != null && request.auth.uid == userId;
            }
          }
        }
      }

   5. Click "Publish"

   That's it — everything below this line is code, not something
   you need to edit except the config object.
=========================================================== */

const firebaseConfig = {
  apiKey: "AIzaSyDNGJxOjVNLoRhN_T2RoFz1f6P0lJNcL7s",
  authDomain: "learnlock-7e9e8.firebaseapp.com",
  projectId: "learnlock-7e9e8",
  storageBucket: "learnlock-7e9e8.firebasestorage.app",
  messagingSenderId: "1031249123529",
  appId: "1:1031249123529:web:9a94178b530f7d65b55518"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();
db.settings({
  experimentalAutoDetectLongPolling: true,
  merge: true
});
