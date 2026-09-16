# LearnLock — V1 (free, no build tools)

## What's here
- `index.html` — all screens (login, dashboard, course builder, learning path, module timer)
- `style.css` — visual design
- `app.js` — all the app logic
- `firebase-config.js` — where your free Firebase keys go (has full setup steps inside)

## What this version does
- Email/password accounts
- Create a course, add modules with a name + duration in minutes
- Automatic learning plan: Day 1 unlocked, everything else locked
- Countdown timer per module; can't complete until it hits 00:00:00
- Completing a module unlocks the next one
- Points, streaks, and 5 starter achievements
- Max 3 active courses at once

Not included yet (from your full doc, saved for later so V1 stays simple):
friends/challenges, quizzes/assessments, emergency skips, missed-day suspensions, AI features.

## Step 1 — Set up Firebase (free, ~5 minutes)
Open `firebase-config.js` — every step is written inside it as comments. You'll:
1. Create a free Firebase project
2. Register a web app and copy your config into the file
3. Turn on Email/Password login
4. Create a free Firestore database and paste in the security rules given

## Step 2 — Try it locally
Just double-click `index.html` to open it in your browser. (Some browsers block Firebase
from a `file://` page — if login doesn't work locally, skip straight to Step 3, hosting
solves this automatically.)

## Step 3 — Put it online for free
Easiest option — **Netlify Drop**, no account or command line needed:
1. Go to https://app.netlify.com/drop
2. Drag the whole `learnlock` folder onto the page
3. Netlify gives you a live link instantly (e.g. `yourapp.netlify.app`) — free forever on their free tier

Alternative — **Firebase Hosting** (also free, a bit more setup, keeps everything in one place):
1. Install Node.js if you don't have it, then run `npm install -g firebase-tools`
2. In the `learnlock` folder run: `firebase login`, then `firebase init hosting`
3. Point it at this folder, then run `firebase deploy`

## Next steps once V1 works
- Add the quiz/assessment system (Section 21–23 of your doc)
- Add friends + challenges (Section 24–26)
- Add emergency skips + missed-day suspensions (Section 15–16)
- Later: AI-powered course/module generation from a pasted YouTube link
