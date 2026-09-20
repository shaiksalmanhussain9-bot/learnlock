/* ===========================================================
   LEARNLOCK — app.js
   All the app's behavior lives here. Read the comments — they
   explain what each part does, since you're new to coding.
=========================================================== */

const MAX_ACTIVE_COURSES = 3; 
const POINTS_PER_MODULE = 50;
const STREAK_RECOVERY_COST = 4000;

const REWARDS = [
  { points: 500, icon: '🎁', label: '500 XP Reward' },
  { points: 1000, icon: '🏅', label: '1,000 XP Reward' },
  { points: 2500, icon: '🏆', label: '2,500 XP Reward' },
  { points: 5000, icon: '👑', label: '5,000 XP Reward' }
];

// One-time bonus for reaching each streak length. If the streak ever
// resets to 0, these become re-earnable — see loadUserStats().
const STREAK_MILESTONES = [
  { days: 3, bonus: 50 },
  { days: 7, bonus: 150 },
  { days: 15, bonus: 500 },
  { days: 30, bonus: 2000 },
];

// XP needed to go from one level to the next (flat — level 2 needs
// 500 XP total, level 3 needs 1000, etc).
const LEVEL_XP_STEP = 500;

// Titles shown at and after the given level, until the next one.
const LEVEL_TITLES = [
  { level: 1, icon: '🌱', title: 'Beginner' },
  { level: 2, icon: '📖', title: 'Learner' },
  { level: 3, icon: '🔍', title: 'Explorer' },
  { level: 4, icon: '🧠', title: 'Knowledge Seeker' },
  { level: 5, icon: '⚡', title: 'Fast Learner' },
  { level: 10, icon: '🏆', title: 'Dedicated Learner' },
  { level: 15, icon: '🔥', title: 'Committed Scholar' },
  { level: 20, icon: '👑', title: 'Learning Master' },
  { level: 30, icon: '🚀', title: 'Momentum Master' },
  { level: 40, icon: '🌟', title: 'Elite Learner' },
  { level: 50, icon: '💎', title: 'Knowledge Legend' },
];

// Converts a raw XP total into { level, xpIntoLevel, xpForNext, icon, title }.
function getLevelInfo(xp) {
  const level = Math.floor(xp / LEVEL_XP_STEP) + 1;
  const xpIntoLevel = xp % LEVEL_XP_STEP;
  let current = LEVEL_TITLES[0];
  for (const t of LEVEL_TITLES) {
    if (level >= t.level) current = t;
  }
  return { level, xpIntoLevel, xpForNext: LEVEL_XP_STEP, icon: current.icon, title: current.title };
}

const ACHIEVEMENTS = [
  { id: 'first_module', icon: '🏆', label: 'First module completed', check: (s) => s.modulesCompleted >= 1, progress: (s) => ({ current: Math.min(s.modulesCompleted, 1), target: 1 }) },
  { id: 'streak_7', icon: '🔥', label: '7-day streak', check: (s) => s.streak >= 7, progress: (s) => ({ current: Math.min(s.streak, 7), target: 7 }) },
  { id: 'streak_30', icon: '🔥', label: '30-day streak', check: (s) => s.streak >= 30, progress: (s) => ({ current: Math.min(s.streak, 30), target: 30 }) },
  { id: 'first_course', icon: '📚', label: 'First course completed', check: (s) => s.coursesCompleted >= 1, progress: (s) => ({ current: Math.min(s.coursesCompleted, 1), target: 1 }) },
  { id: 'hundred_modules', icon: '💯', label: '100 modules completed', check: (s) => s.modulesCompleted >= 100, progress: (s) => ({ current: Math.min(s.modulesCompleted, 100), target: 100 }) },
];

// Set briefly when a missed-day streak event happens (saved or reset),
// so we can show one toast about it right after the dashboard loads.
let pendingStreakToast = null;



// ---------- App state (kept in memory while the page is open) ----------
let currentUser = null;
let userStats = null;      // { points, streak, lastActiveDate, modulesCompleted, coursesCompleted, achievements }
let coursesCache = [];     // list of course docs for the logged-in user
let activeCourseId = null;
let activeModuleId = null;
let activeSubModuleId = null; // set when the current module has sub-modules
let reviewMode = false; // true when watching a COMPLETED unit again — no completion, no resume tracking
let isSignupMode = false;
let activeCourseType = 'personal'; // 'personal' or 'shared'
let sharedCoursesCache = [];

// Timer state
let timerSecondsLeft = 0;
let timerTotalSeconds = 0;
let timerInterval = null;
let timerRunning = false;
let youtubePlayer = null;
let youtubeMaxWatchedSeconds = 0;
let youtubeAPIReady = false;
let pendingYouTubeRequest = null;

// ---------- Small helpers ----------

function $(id) { return document.getElementById(id); }

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $('view-' + name).classList.add('active');
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 3200);
}

// Builds a "YYYY-MM-DD" string from LOCAL date parts. We deliberately
// avoid toISOString() here — it converts to UTC first, which silently
// shifts the date for anyone not in UTC (e.g. India is UTC+5:30, so
// toISOString() can report "yesterday" during early morning hours).
function toLocalDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayStr() {
  return toLocalDateStr(new Date());
}

function daysBetween(a, b) {
  const d1 = new Date(a), d2 = new Date(b);
  return Math.round((d2 - d1) / 86400000);
}

function timeToSeconds(time) {
  const parts = time.split(':').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return 0;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function formatTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// ===========================================================
// RESUME STATE — lets a module pick up where you left off if you
// close the browser and come back within 24 hours. Stored in this
// browser's localStorage (not Firestore) so it saves instantly and
// reliably at the exact moment the tab/browser closes.
// ===========================================================

const RESUME_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

function resumeStorageKey() {
  return currentUser ? `learnlock_resume_${currentUser.uid}` : null;
}

// Called right as the page is closing/unloading. Saves how far into
// the current module the user got, IF a module is actually open and
// partway through.
function saveResumeState() {
  const key = resumeStorageKey();
  if (!key || !activeModuleId || reviewMode) return;
  if (!timerTotalSeconds || timerSecondsLeft <= 0) return; // nothing to resume

  const elapsedSeconds = timerTotalSeconds - timerSecondsLeft;
  if (elapsedSeconds <= 0) return; // hadn't started yet, nothing to save

  const state = {
    courseId: activeCourseId,
    courseType: activeCourseType,
    moduleId: activeModuleId,
    subModuleId: activeSubModuleId || null,
    elapsedSeconds,
    pausedAt: Date.now()
  };

  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch (e) {
    // Storage full or unavailable — safe to ignore, resume just won't work.
  }
}

// Returns the saved resume state if one exists and is still within
// the 24-hour window, otherwise null (and clears it if expired).
function loadResumeState() {
  const key = resumeStorageKey();
  if (!key) return null;

  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const state = JSON.parse(raw);
    if (!state || !state.pausedAt) return null;

    if (Date.now() - state.pausedAt > RESUME_WINDOW_MS) {
      localStorage.removeItem(key);
      return null;
    }

    return state;
  } catch (e) {
    return null;
  }
}

function clearResumeState() {
  const key = resumeStorageKey();
  if (!key) return;
  try { localStorage.removeItem(key); } catch (e) {}
}

// Save right as the browser/tab is actually closing.
window.addEventListener('beforeunload', saveResumeState);
window.addEventListener('pagehide', saveResumeState);

// ===========================================================
// AUTH
// ===========================================================

$('auth-toggle-btn').addEventListener('click', () => {
  isSignupMode = !isSignupMode;
  $('auth-submit-btn').textContent = isSignupMode ? 'Create account' : 'Log in';
  $('auth-toggle-text').textContent = isSignupMode ? 'Already have an account?' : 'New to LearnLock?';
  $('auth-toggle-btn').textContent = isSignupMode ? 'Log in' : 'Create an account';
  $('auth-error').style.display = 'none';
});

$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('auth-email').value.trim();
  const password = $('auth-password').value;
  const errEl = $('auth-error');
  errEl.style.display = 'none';
  $('auth-submit-btn').disabled = true;

  try {
    if (isSignupMode) {
      const credential = await auth.createUserWithEmailAndPassword(email, password);

await db.collection('users').doc(credential.user.uid).set({
  email: email.toLowerCase()
}, { merge: true });

    } else {
      await auth.signInWithEmailAndPassword(email, password);
    }
  } catch (err) {
    errEl.textContent = friendlyAuthError(err);
    errEl.style.display = 'block';
  } finally {
    $('auth-submit-btn').disabled = false;
  }
});
$('forgot-password-btn').addEventListener('click', async () => {
  const email = $('auth-email').value.trim();

  if (!email) {
    $('auth-error').textContent = 'Enter your email address first.';
    $('auth-error').style.display = 'block';
    return;
  }

  try {
    await auth.sendPasswordResetEmail(email);

    $('auth-error').textContent =
      'Password reset email sent. Check your inbox.';
    $('auth-error').style.display = 'block';
  } catch (err) {
    $('auth-error').textContent = friendlyAuthError(err);
    $('auth-error').style.display = 'block';
  }
});

function friendlyAuthError(err) {
  const code = err.code || '';
  if (code.includes('invalid-api-key') || code.includes('api-key-not-valid')) {
    return "Firebase isn't set up yet — open firebase-config.js and follow the setup steps.";
  }
  if (code.includes('email-already-in-use')) return 'That email already has an account — try logging in instead.';
  if (code.includes('weak-password')) return 'Password should be at least 6 characters.';
  if (code.includes('invalid-email')) return 'That email address looks invalid.';
  if (code.includes('user-not-found') || code.includes('wrong-password') || code.includes('invalid-credential')) {
    return 'Email or password is incorrect.';
  }
  return err.message || 'Something went wrong. Please try again.';
}

$('logout-btn').addEventListener('click', () => auth.signOut());

// Loads everything the dashboard needs, showing a loading state while
// it works and a retryable error state if anything fails (e.g. no
// network connection).
async function loadAndShowDashboard() {
  showView('loading');
  try {
    await loadUserStats();
    await loadCourses();
    await loadSharedCourses();
    renderDashboard();
    showView('dashboard');
    if (pendingStreakToast) {
      toast(pendingStreakToast);
      pendingStreakToast = null;
    }
  } catch (err) {
    console.error('Failed to load dashboard data:', err);
    showView('load-error');
  }
}

$('btn-retry-load').addEventListener('click', () => {
  loadAndShowDashboard();
});

auth.onAuthStateChanged(async (user) => {
  currentUser = user;
  if (user) {
    $('user-email-label').textContent = user.email;
    await loadAndShowDashboard();
  } else {
    showView('auth');
  }
});
 
// ===========================================================
// USER STATS (points, streak, achievements)
// ===========================================================

async function loadUserStats() {
    await db.collection('userLookup')
    .doc(currentUser.email.toLowerCase())
    .set({
      uid: currentUser.uid
    });
  const ref = db.collection('users').doc(currentUser.uid);
  const snap = await ref.get();
  if (snap.exists) {
    userStats = snap.data();
    if (userStats.rewards === undefined) userStats.rewards = [];
    if (userStats.streakMilestones === undefined) userStats.streakMilestones = [];
    if (userStats.activeDates === undefined) userStats.activeDates = [];
     if (userStats.learningSessions === undefined) userStats.learningSessions = [];
    // Old field from the previous lock-based system — no longer used,
    // but harmless to leave if it exists on old accounts.
    delete userStats.missedDay;
    delete userStats.challenges;

    if (
      userStats.lastActiveDate &&
      daysBetween(userStats.lastActiveDate, todayStr()) > 1 &&
      userStats.streak > 0
    ) {
      // Missed a day. If there are enough points saved up, auto-spend
      // them to keep the streak exactly where it was. Otherwise the
      // streak resets to 0 — but learning is never locked either way.
      if (userStats.points >= STREAK_RECOVERY_COST) {
        userStats.points -= STREAK_RECOVERY_COST;
        pendingStreakToast = `🔥 Missed a day, but ${STREAK_RECOVERY_COST} XP kept your ${userStats.streak}-day streak alive!`;
      } else {
        const oldStreak = userStats.streak;
        userStats.streak = 0;
        userStats.streakMilestones = [];
        pendingStreakToast = oldStreak > 0
          ? `😬 You missed a day — your streak reset to 0. Earn ${STREAK_RECOVERY_COST} XP to auto-save it next time.`
          : null;
      }
      await saveUserStats();
    }
  } else {
    userStats = {
      points: 0,
      streak: 0,
      lastActiveDate: null,
      modulesCompleted: 0,
      coursesCompleted: 0,
      achievements: [],
      rewards: [],
      streakMilestones: [],
      activeDates: []
    };
    await ref.set(userStats);
  }
}

async function saveUserStats() {
  await db.collection('users').doc(currentUser.uid).set(userStats, { merge: true });
}

function registerCompletionForStreak() {
  const today = todayStr();
  if (userStats.lastActiveDate === today) {
    // already logged activity today — streak unchanged
  } else if (userStats.lastActiveDate && daysBetween(userStats.lastActiveDate, today) === 1) {
    userStats.streak += 1;
  } else {
    userStats.streak = 1;
  }
  userStats.lastActiveDate = today;
}

function checkNewAchievements() {
  const newlyEarned = [];
  ACHIEVEMENTS.forEach(a => {
    if (!userStats.achievements.includes(a.id) && a.check(userStats)) {
      userStats.achievements.push(a.id);
      newlyEarned.push(a);
    }
  });
  return newlyEarned;
}

// Checks if the current streak just crossed a milestone (3/7/15/30
// days) and awards the one-time bonus if so. Called right after a
// streak increments from completing a module.
function checkStreakMilestones() {
  if (!userStats.streakMilestones) userStats.streakMilestones = [];
  const newlyReached = [];

  STREAK_MILESTONES.forEach(m => {
    if (userStats.streak >= m.days && !userStats.streakMilestones.includes(m.days)) {
      userStats.streakMilestones.push(m.days);
      userStats.points += m.bonus;
      newlyReached.push(m);
    }
  });

  return newlyReached;
}

function checkNewRewards() {
  const newlyEarned = [];

  REWARDS.forEach(reward => {
    if (
      userStats.points >= reward.points &&
      !userStats.rewards.includes(reward.points)
    ) {
      userStats.rewards.push(reward.points);
      newlyEarned.push(reward);
    }
  });

  return newlyEarned;
}

// ============ RENDER BADGES (FIXED) ============
function renderBadges(badges, containerId) {
  const container = $(containerId);
  if (!container) return;

  // Safety check: ensure badges is an array
  if (!badges || !Array.isArray(badges)) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = '';

  badges.forEach(badge => {
    // Skip undefined or invalid badges
    if (!badge || typeof badge !== 'object') return;
    
    // Check that badge has required properties
    if (!badge.icon || !badge.label) return;

    const badgeEl = document.createElement('div');
    badgeEl.className = 'badge';
    badgeEl.innerHTML = `
      <div class="badge-icon">${badge.icon}</div>
      <div class="badge-label">${badge.label}</div>
    `;
    container.appendChild(badgeEl);
  });
}

// Shows each streak milestone (3/7/15/30 days) as a locked card with
// live progress ("2/3 days") until it's reached, then flips to an
// unlocked, celebratory card once the bonus has been claimed.
function renderStreakMilestones() {
  const row = $('streak-milestone-row');
  if (!row) return;
  row.innerHTML = '';

  if (!userStats.streakMilestones) userStats.streakMilestones = [];

  STREAK_MILESTONES.forEach(m => {
    const earned = userStats.streakMilestones.includes(m.days);
    const div = document.createElement('div');
    div.className = 'badge ' + (earned ? 'earned' : 'locked');

    if (earned) {
      div.innerHTML = `
        <span class="badge-icon">🎉</span>
        <span>${m.days}-day streak — +${m.bonus} XP unlocked!</span>
      `;
    } else {
      const progress = Math.min(userStats.streak, m.days);
      div.innerHTML = `
        <span class="badge-icon">🔒</span>
        <span>${m.days}-day streak (${progress}/${m.days}) — +${m.bonus} XP</span>
      `;
    }

    row.appendChild(div);
  });
}

// Finds the first available module (or current sub-module) across the
// user's active personal courses — the thing they'd naturally do next.
function findNextLearningTarget() {
  const course = coursesCache.find(c => !c.completed && c.modules.some(m => m.status === 'available'));
  if (!course) return null;
  const mod = course.modules.find(m => m.status === 'available');
  if (!mod) return null;
  const sub = getCurrentSubModule(mod);
  return { course, mod, sub };
}

function renderContinueLearningCard() {
  const el = $('continue-learning-card');
  if (!el) return;

  const target = findNextLearningTarget();
  if (!target) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }

  const resumeState = loadResumeState();
  const isResumable = resumeState
    && resumeState.courseId === target.course.id
    && resumeState.courseType === 'personal'
    && resumeState.moduleId === target.mod.id
    && resumeState.subModuleId === (target.sub ? target.sub.id : null);

  const nextLabel = target.sub ? target.sub.name : target.mod.name;

  el.style.display = 'block';
  el.innerHTML = `
    <div class="continue-card-label">Continue learning</div>
    <div class="continue-card-course">${escapeHtml(target.course.name)}</div>
    <div class="continue-card-next">Next: ${escapeHtml(nextLabel)}</div>
    <button class="btn-primary" id="btn-continue-learning">${isResumable ? '▶ Continue' : '▶ Start learning'}</button>
  `;

  $('btn-continue-learning').addEventListener('click', () => {
    activeCourseId = target.course.id;
    activeCourseType = 'personal';
    openModule(target.mod.id);
  });
}

function renderLevelBanner() {
  const el = $('level-banner');
  if (!el) return;
  const info = getLevelInfo(userStats.points);
  const pct = Math.round((info.xpIntoLevel / info.xpForNext) * 100);

  el.innerHTML = `
    <div class="level-title">${info.icon} Level ${info.level} — ${info.title}</div>
    <div class="level-xp-bar"><div class="level-xp-fill" style="width:${pct}%"></div></div>
    <div class="level-xp-text">${info.xpIntoLevel} / ${info.xpForNext} XP to Level ${info.level + 1}</div>
  `;
}

// ===========================================================
// COURSES
// ===========================================================

function coursesRef() {
  return db.collection('users').doc(currentUser.uid).collection('courses');
}

async function loadCourses() {
  const snap = await coursesRef().get();
  coursesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function loadSharedCourses() {
  const snap = await db.collection('sharedCourses')
    .where('participants', 'array-contains', currentUser.uid)
    .get();
  sharedCoursesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function renderSharedCourses() {
  const list = $('shared-course-list');
  if (!list) return;
  list.innerHTML = '';

  if (sharedCoursesCache.length === 0) {
    list.innerHTML = '<div class="empty-state">No shared courses yet. Hit "🔗 Share" on one of your courses above.</div>';
    return;
  }

  const acceptedCourses = sharedCoursesCache.filter(sc => sc.status === 'accepted');

  if (acceptedCourses.length === 0) {
    list.innerHTML = '<div class="empty-state">No shared courses yet. Hit "🔗 Share" on one of your courses above.</div>';
    return;
  }

  acceptedCourses.forEach(sc => {
    const friendUid = sc.participants.find(u => u !== currentUser.uid);
    const friendEmail = sc.emails[friendUid] || 'Friend';
    const myModules = sc.progress[currentUser.uid] || [];
    const friendModules = sc.progress[friendUid] || [];
    const myDone = myModules.filter(m => m.status === 'completed').length;
    const friendDone = friendModules.filter(m => m.status === 'completed').length;
    const total = myModules.length;

    const item = document.createElement('div');
    item.className = 'course-item';
    item.dataset.courseId = sc.id;

    const myPct = total ? Math.round((myDone / total) * 100) : 0;

    const info = document.createElement('div');
    info.className = 'course-info';
    info.innerHTML = `
      <div class="course-name">${escapeHtml(sc.name)}</div>
      <div class="course-meta">You: ${myDone}/${total} · ${escapeHtml(friendEmail)}: ${friendDone}/${total}</div>
      <div class="course-progress-bar"><div class="course-progress-bar-fill" style="width:${myPct}%"></div></div>
    `;

    const menu = createSharedCourseMenu(sc.id);

    const progress = document.createElement('div');
    progress.className = 'course-progress-ring';
    progress.textContent = `${myPct}%`;

    item.appendChild(info);
    item.appendChild(menu);
    item.appendChild(progress);

    item.addEventListener('click', () => openSharedCoursePath(sc.id));
    menu.addEventListener('click', e => e.stopPropagation());

    list.appendChild(item);
  });
}

async function getFriendsList() {
  const snapshot = await db.collection('users').doc(currentUser.uid).collection('friends').get();
  return snapshot.docs.map(d => ({ uid: d.id, ...d.data() }));
}

async function openSharePicker(courseId) {
  const course = getCourse(courseId);
  if (!course) return;
  await showSharePanel(course, courseId);
}

// Builds and attaches the friend-picker panel under the given card.
// courseLike needs { id, name, source, modules }; anchorId must match
// the data-course-id on the DOM element to attach the panel to.
async function showSharePanel(courseLike, anchorId) {
  const friends = await getFriendsList();
  if (friends.length === 0) { toast('Add a friend first before sharing a course.'); return; }

  const anchorItem = document.querySelector(`.course-item[data-course-id="${anchorId}"]`);
  if (!anchorItem) return;

  // Only one share panel open at a time.
  document.querySelectorAll('.course-share-panel').forEach(p => p.remove());

  const panel = document.createElement('div');
  panel.className = 'course-share-panel';
  panel.addEventListener('click', e => e.stopPropagation());

  const title = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = `Share "${courseLike.name}" with:`;
  title.appendChild(strong);
  panel.appendChild(title);

  friends.forEach(f => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'friend-email-share';
    btn.textContent = f.email;
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      await shareCourseWithFriend(courseLike, f);
    });
    panel.appendChild(btn);
  });

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'cancel-share';
  closeBtn.textContent = 'Cancel';
  closeBtn.addEventListener('click', e => {
    e.stopPropagation();
    panel.remove();
  });
  panel.appendChild(closeBtn);

  anchorItem.appendChild(panel);
}

async function shareCourseWithFriend(course, friend) {
  const resetModules = (mods) => mods.map((m, i) => ({
    id: m.id, name: m.name, startTime: m.startTime, endTime: m.endTime,
    status: i === 0 ? 'available' : 'locked'
  }));

  // One fixed document per (course, friend) pair — repeated clicks
  // can't create duplicate invites.
  const shareId = `${course.id}_${friend.uid}`;
  const shareRef = db.collection('sharedCourses').doc(shareId);

  const existingSnap = await shareRef.get();
  if (existingSnap.exists) {
    const data = existingSnap.data();
    if (data.status === 'pending' || data.status === 'accepted') {
      toast(`This course has already been shared with ${friend.email}.`);
      return;
    }
  }

  // Status starts as 'pending' — the friend has to accept before this
  // becomes a live shared course. invitedBy records who sent it, so we
  // can tell "invites I sent" apart from "invites I received."
  try {
    await shareRef.set({
      courseId: course.id,
      name: course.name,
      source: course.source,
      participants: [currentUser.uid, friend.uid],
      emails: { [currentUser.uid]: currentUser.email, [friend.uid]: friend.email },
      progress: {
        [currentUser.uid]: resetModules(course.modules),
        [friend.uid]: resetModules(course.modules)
      },
      status: 'pending',
      invitedBy: currentUser.uid,
      createdBy: currentUser.uid,
      createdAt: Date.now()
    });
  } catch (err) {
    console.error('Could not send course invite:', err);
    toast('Could not send the course invitation. Please try again.');
    return;
  }

  toast(`✅ "${course.name}" successfully sent to ${friend.email}.`);
  document.querySelectorAll('.course-share-panel').forEach(p => p.remove());
  await loadSharedCourses();
  renderDashboard();
}

async function deleteCourse(courseId) {
  const course = getCourse(courseId);
  if (!course) return;

  const confirmed = window.confirm(`Delete "${course.name}"? This can't be undone.`);
  if (!confirmed) return;

  try {
    await coursesRef().doc(courseId).delete();

    if (activeCourseId === courseId) {
      activeCourseId = null;
      activeModuleId = null;
      activeCourseType = 'personal';
    }

    await loadCourses();
    renderDashboard();
    toast('Course deleted.');
  } catch (err) {
    console.error('Could not delete course:', err);
    toast('Could not delete the course. Please try again.');
  }
}

function closeCourseMenus() {
  document.querySelectorAll('.course-menu-dropdown').forEach(menu => {
    menu.classList.remove('open');
  });
}

// Builds the "⋮" menu (Share / Delete) attached to a course card.
// Generic ⋮ menu builder — used for both personal and shared courses,
// each passing in their own Share/Remove actions.
function createGenericCourseMenu(shareLabel, removeLabel, onShare, onRemove) {
  const wrapper = document.createElement('div');
  wrapper.className = 'course-menu-wrap';

  const menuButton = document.createElement('button');
  menuButton.type = 'button';
  menuButton.className = 'course-menu-btn';
  menuButton.title = 'More options';
  menuButton.setAttribute('aria-label', 'Course menu');
  menuButton.textContent = '⋮';

  const dropdown = document.createElement('div');
  dropdown.className = 'course-menu-dropdown';

  const shareButton = document.createElement('button');
  shareButton.type = 'button';
  shareButton.textContent = shareLabel;
  shareButton.addEventListener('click', async (e) => {
    e.stopPropagation();
    closeCourseMenus();
    await onShare();
  });

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'danger';
  removeButton.textContent = removeLabel;
  removeButton.addEventListener('click', async (e) => {
    e.stopPropagation();
    closeCourseMenus();
    await onRemove();
  });

  dropdown.appendChild(shareButton);
  dropdown.appendChild(removeButton);

  menuButton.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = dropdown.classList.contains('open');
    closeCourseMenus();
    if (!wasOpen) dropdown.classList.add('open');
  });

  wrapper.appendChild(menuButton);
  wrapper.appendChild(dropdown);
  return wrapper;
}

function createCourseMenu(courseId) {
  return createGenericCourseMenu(
    '🔗 Share course', '🗑 Delete course',
    () => openSharePicker(courseId),
    () => deleteCourse(courseId)
  );
}

function createSharedCourseMenu(sharedId) {
  return createGenericCourseMenu(
    '🔗 Share with another friend', '🗑 Remove',
    () => openSharePickerForShared(sharedId),
    () => deleteSharedCourse(sharedId)
  );
}

// Shares a course you're already learning WITH a friend, out to one
// more friend — reuses your own current progress as the template.
async function openSharePickerForShared(sharedId) {
  const sc = sharedCoursesCache.find(c => c.id === sharedId);
  if (!sc) return;

  const courseLike = {
    id: sc.id,
    name: sc.name,
    source: sc.source,
    modules: sc.progress[currentUser.uid]
  };

  await showSharePanel(courseLike, sharedId);
}

// Removes a shared course entirely (for either participant — cleans up
// duplicates or courses you no longer want to see).
async function deleteSharedCourse(sharedId) {
  const sc = sharedCoursesCache.find(c => c.id === sharedId);
  if (!sc) return;

  const confirmed = window.confirm(`Remove "${sc.name}" from Shared With Friends? This can't be undone.`);
  if (!confirmed) return;

  try {
    await db.collection('sharedCourses').doc(sharedId).delete();
    if (activeCourseId === sharedId) {
      activeCourseId = null;
      activeModuleId = null;
      activeCourseType = 'personal';
    }
    await loadSharedCourses();
    renderDashboard();
    toast('Removed.');
  } catch (err) {
    console.error('Could not remove shared course:', err);
    toast('Could not remove it. Please try again.');
  }
}

// Close any open course menu when clicking anywhere else on the page.
document.addEventListener('click', () => closeCourseMenus());

// Called when the RECIPIENT of a course invite clicks Accept or Reject.
async function respondToCourseInvite(sharedId, accept) {
  if (accept) {
    await db.collection('sharedCourses').doc(sharedId).update({ status: 'accepted' });
    toast('Course accepted — Day 1 is ready for both of you!');
  } else {
    await db.collection('sharedCourses').doc(sharedId).delete();
    toast('Invite declined.');
  }
  await loadSharedCourses();
  renderDashboard();
}

// Shows invites where someone ELSE shared a course with me, and I
// haven't responded yet.
function renderIncomingCourseInvites() {
  const list = $('incoming-invites-list');
  if (!list) return;
  list.innerHTML = '';

  const incoming = sharedCoursesCache.filter(
    sc => sc.status === 'pending' && sc.invitedBy !== currentUser.uid
  );

  if (incoming.length === 0) {
    list.innerHTML = '<div class="empty-state">No course invitations yet. Invitations will appear here when someone shares a course with you.</div>';
    return;
  }

  incoming.forEach(sc => {
    const fromEmail = sc.emails[sc.invitedBy] || 'Someone';
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
      <p><strong>${escapeHtml(fromEmail)}</strong> wants to share "${escapeHtml(sc.name)}" with you.</p>
      <button class="btn-primary btn-accept-invite">Accept</button>
      <button class="btn-secondary btn-reject-invite">Reject</button>
    `;
    div.querySelector('.btn-accept-invite').addEventListener('click', () => respondToCourseInvite(sc.id, true));
    div.querySelector('.btn-reject-invite').addEventListener('click', () => respondToCourseInvite(sc.id, false));
    list.appendChild(div);
  });
}

// Shows invites I sent that are still waiting on the other person.
function renderOutgoingCourseInvites() {
  const list = $('outgoing-invites-list');
  if (!list) return;
  list.innerHTML = '';

  const outgoing = sharedCoursesCache.filter(
    sc => sc.status === 'pending' && sc.invitedBy === currentUser.uid
  );

  if (outgoing.length === 0) {
    list.innerHTML = '';
    return;
  }

  outgoing.forEach(sc => {
    const friendUid = sc.participants.find(u => u !== currentUser.uid);
    const friendEmail = sc.emails[friendUid] || 'Friend';
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `<p>Waiting for <strong>${escapeHtml(friendEmail)}</strong> to accept "${escapeHtml(sc.name)}".</p>`;
    list.appendChild(div);
  });
}

function getActiveCourse() {
  if (activeCourseType === 'shared') {
    const sc = sharedCoursesCache.find(c => c.id === activeCourseId);
    if (!sc) return null;
    const friendUid = sc.participants.find(u => u !== currentUser.uid);
    return {
      name: sc.name, source: sc.source, modules: sc.progress[currentUser.uid],
      isShared: true, friendEmail: sc.emails[friendUid], friendModules: sc.progress[friendUid]
    };
  }
  const course = getCourse(activeCourseId);
  if (!course) return null;
  return { name: course.name, source: course.source, modules: course.modules, isShared: false };
}

function openSharedCoursePath(sharedCourseId) {
  activeCourseId = sharedCourseId;
  activeCourseType = 'shared';
  renderPath();
  showView('path');
}

function activeCourseCount() {
  return coursesCache.filter(c => !c.completed).length;
}

function renderDashboard() {
  $('stat-streak').textContent = userStats.streak;
  $('stat-points').textContent = userStats.points;
  $('stat-modules').textContent = userStats.modulesCompleted;
  $('course-count-note').textContent = `${activeCourseCount()} / ${MAX_ACTIVE_COURSES} active`;

  const list = $('course-list');
  list.innerHTML = '';

  if (coursesCache.length === 0) {
    list.innerHTML = `<div class="empty-state">No courses yet. Add one below — paste a YouTube playlist, a Udemy course, anything you're learning from, and break it into modules.</div>`;
  } else {
    coursesCache.forEach(course => {
      const done = course.modules.filter(m => m.status === 'completed').length;
      const total = course.modules.length;
      const item = document.createElement('div');
      item.className = 'course-item';
      item.dataset.courseId = course.id;

      const pct = total ? Math.round((done / total) * 100) : 0;

      const info = document.createElement('div');
      info.className = 'course-info';
      info.innerHTML = `
        <div class="course-name">${escapeHtml(course.name)}</div>
        <div class="course-meta">${done} / ${total} modules${course.completed ? ' · Completed 🎉' : ''}</div>
        <div class="course-progress-bar"><div class="course-progress-bar-fill" style="width:${pct}%"></div></div>
      `;

      const menu = createCourseMenu(course.id);

      const progress = document.createElement('div');
      progress.className = 'course-progress-ring';
      progress.textContent = `${pct}%`;

      item.appendChild(info);
      item.appendChild(menu);
      item.appendChild(progress);

      item.addEventListener('click', () => openCoursePath(course.id));
      menu.addEventListener('click', e => e.stopPropagation());

      list.appendChild(item);
    });
  }

  renderBadges();
  renderContinueLearningCard();
  renderLevelBanner();
  renderStreakMilestones();
  renderLearningProgressCalendar();
  renderIncomingCourseInvites();
  renderOutgoingCourseInvites();
  renderSharedCourses();
loadFriendRequests();
loadFriends();
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ---------- Course builder ----------

$('btn-new-course').addEventListener('click', () => {
  if (activeCourseCount() >= MAX_ACTIVE_COURSES) {
    toast(`You've hit the ${MAX_ACTIVE_COURSES}-course limit. Finish or remove one before adding another — it keeps you focused.`);
    return;
  }
  $('course-name').value = '';
  $('course-source').value = '';
  $('module-rows').innerHTML = '';
  addModuleRow();
  addModuleRow();
  showView('builder');
});

document.querySelectorAll('[data-nav]').forEach(btn => {
  btn.addEventListener('click', () => {
    showView(btn.dataset.nav);
    if (btn.dataset.nav === 'dashboard') renderDashboard();
    if (btn.dataset.nav === 'path') renderPath();
  });
});

function addSubModuleRow(container, name = '', start = '00:00:00', end = '00:00:00') {
  const row = document.createElement('div');
  row.className = 'submodule-row';
  row.innerHTML = `
    <div class="field">
      <input type="text" placeholder="Sub-module name (e.g. 1.1 Basics)" class="submod-name" value="${escapeHtml(name)}" />
    </div>
    <div class="field time">
      <label>Start</label>
      <input type="text" placeholder="00:00:00" class="submod-start" value="${escapeHtml(start)}" />
    </div>
    <div class="field time">
      <label>End</label>
      <input type="text" placeholder="00:00:00" class="submod-end" value="${escapeHtml(end)}" />
    </div>
    <button type="button" class="remove-module" title="Remove" aria-label="Remove">✕</button>
  `;
  row.querySelector('.remove-module').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

function addModuleRow(name = '', duration = '') {
  const row = document.createElement('div');
  row.className = 'module-row';
  row.innerHTML = `
    <div class="module-row-main">
      <div class="field">
        <input type="text" placeholder="Module name (e.g. Introduction)" class="mod-name" value="${escapeHtml(name)}" />
      </div>
      <div class="field time">
    <label>Start</label>
    <input type="text" placeholder="00:00:00" class="mod-start" value="00:00:00" />
  </div>

  <div class="field time">
    <label>End</label>
    <input type="text" placeholder="00:00:00" class="mod-end" value="00:00:00" />
  </div>
      <button type="button" class="remove-module" title="Remove" aria-label="Remove">✕</button>
    </div>
    <div class="submodule-list"></div>
    <button type="button" class="btn-add-submodule">+ Add sub-module (optional)</button>
  `;
  row.querySelector('.remove-module').addEventListener('click', () => row.remove());
  const subList = row.querySelector('.submodule-list');
  row.querySelector('.btn-add-submodule').addEventListener('click', () => addSubModuleRow(subList));
  $('module-rows').appendChild(row);
}

$('btn-add-module').addEventListener('click', () => addModuleRow());

$('btn-create-plan').addEventListener('click', async () => {
  const name = $('course-name').value.trim();
  const source = $('course-source').value.trim();
  const rows = Array.from(document.querySelectorAll('.module-row'));

  if (!name) { toast('Give your course a name first.'); return; }

  const modules = rows.map(row => {
    const m = {
      id: uid(),
      name: row.querySelector('.mod-name').value.trim(),
      startTime: row.querySelector('.mod-start').value.trim(),
      endTime: row.querySelector('.mod-end').value.trim(),
    };

    const subRows = Array.from(row.querySelectorAll('.submodule-row'));
    const subModules = subRows.map(subRow => ({
      id: uid(),
      name: subRow.querySelector('.submod-name').value.trim(),
      startTime: subRow.querySelector('.submod-start').value.trim(),
      endTime: subRow.querySelector('.submod-end').value.trim(),
    })).filter(s => s.name && s.startTime && s.endTime);

    if (subModules.length > 0) {
      m.subModules = subModules;
      // When sub-modules exist, they're authoritative for timing — the
      // module's own Start/End fields default to 00:00:00 and aren't a
      // reliable signal of "user meant this," so always derive from
      // the sub-modules instead.
      if (!m.name) m.name = subModules[0].name;
      m.startTime = subModules[0].startTime;
      m.endTime = subModules[subModules.length - 1].endTime;
    }

    return m;
  }).filter(m => m.name && m.startTime && m.endTime);

  if (modules.length === 0) {
    toast('Add at least one module with a name, start time, and end time.');
    return;
  }

  for (const m of modules) {
  const start = timeToSeconds(m.startTime);
  const end = timeToSeconds(m.endTime);

  if (end <= start) {
    toast(`End time must be after start time for "${m.name}".`);
    return;
  }

  if (m.subModules) {
    for (const s of m.subModules) {
      const sStart = timeToSeconds(s.startTime);
      const sEnd = timeToSeconds(s.endTime);
      if (sEnd <= sStart) {
        toast(`End time must be after start time for sub-module "${s.name}".`);
        return;
      }
    }
  }
}
  modules.forEach((m, i) => {
    m.status = i === 0 ? 'available' : 'locked';
    if (m.subModules) {
      m.subModules.forEach((s, j) => { s.status = (i === 0 && j === 0) ? 'available' : 'locked'; });
    }
  });

  const docRef = await coursesRef().add({
    name,
    source,
    modules,
    completed: false,
    createdAt: Date.now(),
  });

  await loadCourses();
  toast('Learning plan created — Day 1 is ready.');
  openCoursePath(docRef.id);
});

// ===========================================================
// LEARNING PATH (the locked/unlocked day sequence)
// ===========================================================

function getCourse(courseId) {
  return coursesCache.find(c => c.id === courseId);
}

// ============ OPEN PATH ============
function openPath(courseId) {
  const course = userCourses.find(c => c.id === courseId);
  if (!course) return;

  $('path-course-title').textContent = course.name;
  $('path-course-meta').textContent = `${course.modules.length} modules`;

  const pathContainer = $('path-container');
  pathContainer.innerHTML = '';

  course.modules.forEach((module, index) => {
    const isCompleted = module.completed;
    const isNext = !isCompleted && course.modules.slice(0, index).every(m => m.completed);
    const isLocked = !isCompleted && !isNext;

    const moduleEl = document.createElement('div');
    moduleEl.className = `path-module ${isCompleted ? 'completed' : isNext ? 'active' : 'locked'}`;
    
    let statusBadge = '';
    if (isCompleted) {
      statusBadge = '✅ Completed';
    } else if (isNext) {
      statusBadge = '▶ Continue';
    } else {
      statusBadge = '🔒 Locked';
    }

    let actionButton = '';
    if (isCompleted) {
      actionButton = `<button class="btn-watch" data-course-id="${courseId}" data-module-index="${index}">👁 Watch again</button>`;
    } else if (isNext) {
      actionButton = `<button class="btn-continue-module" data-course-id="${courseId}" data-module-index="${index}">▶ Start module</button>`;
    }

    moduleEl.innerHTML = `
      <div class="path-module-header">
        <div class="path-day">Day ${index + 1}</div>
        <div class="path-status">${statusBadge}</div>
      </div>
      <div class="path-module-title">${module.name}</div>
      <div class="path-module-time">${module.minutes || 30} minutes</div>
      ${actionButton}
    `;

    if (isCompleted) {
      moduleEl.querySelector('.btn-watch')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openModule(courseId, index);
      });
    } else if (isNext) {
      moduleEl.querySelector('.btn-continue-module')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openModule(courseId, index);
      });
    }

    pathContainer.appendChild(moduleEl);
  });

  showView('view-path');
}

// If a module has sub-modules, returns the first one that isn't
// completed yet (the one the user should be on). Returns null for
// modules with no sub-modules — meaning "operate on the module itself,
// exactly like before."
function getCurrentSubModule(mod) {
  if (!mod.subModules || mod.subModules.length === 0) return null;
  return mod.subModules.find(s => s.status === 'available') || null;
}

// Resolves the actual unit currently being watched — the active
// sub-module if one is set, otherwise the module itself. Used by the
// timer/YouTube end-boundary checks so they stop at the right point.
function getActiveUnit(course) {
  const mod = course.modules.find(m => m.id === activeModuleId);
  if (!mod) return null;
  if (activeSubModuleId) {
    return (mod.subModules || []).find(s => s.id === activeSubModuleId) || mod;
  }
  return mod;
}

function openCoursePath(courseId) {
  activeCourseId = courseId;
  activeCourseType = 'personal';
  renderPath();
  showView('path');
}

function renderPath() {
  const course = getActiveCourse();
  if (!course) return;

  $('path-course-title').textContent = course.name;
  const done = course.modules.filter(m => m.status === 'completed').length;
  $('path-course-meta').textContent = `${done} / ${course.modules.length} modules complete`
    + (course.source ? ` · ${course.source}` : '')
    + (course.isShared ? ` · ${escapeHtml(course.friendEmail)}: ${course.friendModules.filter(m => m.status === 'completed').length}/${course.modules.length}` : '');
  const container = $('path-container');
  container.innerHTML = '';

  course.modules.forEach((mod, i) => {
    const node = document.createElement('div');
    node.className = 'path-node ' + mod.status;

    const dotContent = mod.status === 'completed' ? '✓' : String(i + 1);
    const statusText = mod.status === 'completed' ? 'Completed'
      : mod.status === 'available' ? 'Available today'
      : 'Locked — finish the module above first';

    const currentSub = mod.status === 'available' ? getCurrentSubModule(mod) : null;
    const hasSubModules = mod.subModules && mod.subModules.length > 0;

    const durationText = hasSubModules
      ? `${mod.subModules.filter(s => s.status === 'completed').length}/${mod.subModules.length} sub-modules complete`
      : `${mod.startTime} → ${mod.endTime}`;

    // Check if the unit the user would open right now (the module
    // itself, or its current sub-module) has a resumable session from
    // within the last 24 hours.
    const resumeState = mod.status === 'available' ? loadResumeState() : null;
    const isResumable = resumeState
      && resumeState.courseId === activeCourseId
      && resumeState.courseType === activeCourseType
      && resumeState.moduleId === mod.id
      && resumeState.subModuleId === (currentSub ? currentSub.id : null);

    // Build a visible list of each individual sub-module (1.1, 1.2...)
    // with its own status, so the user can see what's inside, not just
    // a "0/3 complete" count. Completed ones get a Watch again button.
    const subListHtml = hasSubModules
      ? `<div class="submodule-progress-list">${mod.subModules.map((s, si) => {
          const subIcon = s.status === 'completed' ? '✓' : s.status === 'available' ? '▶' : '🔒';
          const rewatchBtn = s.status === 'completed'
            ? `<button class="btn-rewatch" data-mod="${mod.id}" data-sub="${s.id}">▶ Watch again</button>`
            : '';
          return `<div class="submodule-progress-item ${s.status}">
            <span class="submodule-progress-icon">${subIcon}</span>
            <span class="submodule-progress-label">${i + 1}.${si + 1} ${escapeHtml(s.name)}</span>
            ${rewatchBtn}
          </div>`;
        }).join('')}</div>`
      : '';

    // A completed module with NO sub-modules also gets its own
    // Watch again button.
    const rewatchModuleBtn = (mod.status === 'completed' && !hasSubModules)
      ? `<button class="btn-rewatch" data-mod="${mod.id}">▶ Watch again</button>`
      : '';

    node.innerHTML = `
      <div class="node-dot">${dotContent}</div>
      <div class="node-card">
        <div class="node-day">Day ${i + 1}${currentSub ? ` · ${escapeHtml(currentSub.name)}` : ''}</div>
        <div class="node-title">${escapeHtml(mod.name)}</div>
        <div class="node-duration">${durationText}</div>
        ${subListHtml}
        <div class="node-status">${statusText}</div>
        ${mod.status === 'available' ? `<button class="btn-start" data-mod="${mod.id}">${isResumable ? '▶ Continue module' : 'Start module'}</button>` : ''}
        ${rewatchModuleBtn}
      </div>
    `;
    container.appendChild(node);
  });

  container.querySelectorAll('.btn-start').forEach(btn => {
    btn.addEventListener('click', () => openModule(btn.dataset.mod));
  });

  container.querySelectorAll('.btn-rewatch').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openModuleForReview(btn.dataset.mod, btn.dataset.sub || null);
    });
  });
}

// ===========================================================
// MODULE DASHBOARD (countdown timer + completion)
// ===========================================================

// YouTube calls this automatically when the IFrame API finishes loading
window.onYouTubeIframeAPIReady = function () {
  youtubeAPIReady = true;

  if (pendingYouTubeRequest) {
    const { videoId, startSeconds } = pendingYouTubeRequest;

    pendingYouTubeRequest = null;

    createYouTubePlayer(videoId, startSeconds);
  }
};

function extractYouTubeId(url) {
  if (!url) return null;

  const trimmed = url.trim();

  try {
    const u = new URL(trimmed);
    const host = u.hostname.replace('www.', '');

    if (host === 'youtu.be') {
      return u.pathname.slice(1).split('/')[0] || null;
    }

    if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com'
    ) {
      if (u.pathname === '/watch') {
        return u.searchParams.get('v');
      }

      const match = u.pathname.match(
        /^\/(embed|shorts|live)\/([^/?]+)/
      );

      if (match) {
        return match[2];
      }
    }
  } catch (e) {
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
      return trimmed;
    }
  }

  return null;
}

 function checkYouTubeSkip() {
  if (!youtubePlayer || typeof youtubePlayer.getCurrentTime !== 'function') {
    return false;
  }

  const currentTime = youtubePlayer.getCurrentTime();

if (currentTime > youtubeMaxWatchedSeconds + 2) {
  youtubePlayer.seekTo(youtubeMaxWatchedSeconds, true);
  return true;
}

youtubeMaxWatchedSeconds = Math.max(
  youtubeMaxWatchedSeconds,
  currentTime
);

return false;
}

function onYouTubeStateChange(event) {
  // Auto-skip ads more aggressively
  if (event.data === YT.PlayerState.UNSTARTED) {
    try {
      let skipBtn = document.querySelector('.ytp-ad-skip-button');
      if (!skipBtn) skipBtn = document.querySelector('[aria-label*="Skip"]');
      if (skipBtn) skipBtn.click();
    } catch (e) {}
  }

  if (event.data === YT.PlayerState.PLAYING) {
    if (timerSecondsLeft > 0 && !timerRunning) {
      timerRunning = true;

      $('btn-timer-start').style.display = 'none';
      $('btn-timer-pause').style.display = 'inline-block';

      timerInterval = setInterval(() => {
        if (checkYouTubeSkip()) {
          return;
        }

        if (timerSecondsLeft > 0) {
          timerSecondsLeft -= 1;

          if (youtubePlayer && typeof youtubePlayer.getCurrentTime === 'function') {
            youtubeMaxWatchedSeconds = Math.max(
              youtubeMaxWatchedSeconds,
              youtubePlayer.getCurrentTime()
            );
          }

          updateTimerDisplay();
        }

        if (youtubePlayer && typeof youtubePlayer.getCurrentTime === 'function') {
          const course = getActiveCourse();
          const mod = getActiveUnit(course);

          if (mod) {
            const endSeconds = timeToSeconds(mod.endTime);
            const currentSeconds = youtubePlayer.getCurrentTime();

            if (currentSeconds >= endSeconds) {
              youtubePlayer.pauseVideo();
              timerSecondsLeft = 0;
              updateTimerDisplay();
            }
          }
        }

        if (timerSecondsLeft <= 0) {
          clearInterval(timerInterval);
          timerRunning = false;
          $('btn-timer-pause').style.display = 'none';
        }
      }, 1000);
    }
  }

  if (event.data === YT.PlayerState.PAUSED) {
    if (timerRunning) {
      timerRunning = false;
      clearInterval(timerInterval);

      $('btn-timer-pause').style.display = 'none';
      $('btn-timer-start').style.display = 'inline-block';
      $('btn-timer-start').textContent = '▶ Resume';
    }
  }
}

function createYouTubePlayer(videoId, startSeconds) {
  const container = $('youtube-player');

  if (!videoId) return;

  if (!youtubeAPIReady || typeof YT === 'undefined' || !YT.Player) {
    pendingYouTubeRequest = { videoId, startSeconds };
    container.innerHTML = '<div class="video-missing">Loading player…</div>';
    return;
  }

  container.innerHTML = '';

 const startTime = Math.floor(startSeconds);
const html = '<iframe src="https://www.youtube.com/embed/' + videoId + '?start=' + startTime + '&modestbranding=1&rel=0" style="width: 100%; height: 100%; border: none; min-height: 400px;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-presentation"></iframe>';

container.innerHTML = html;
youtubePlayer = null;
youtubeAPIReady = false;
}

// Enhanced function to handle and skip all YouTube ads
function onPlayerReady(event) {
  const player = event.target;
  
  // Aggressive ad-skipping with multiple selector attempts
  const skipAdsInterval = setInterval(() => {
    try {
      // Try multiple selectors for the skip button (YouTube changes these)
      const skipButton = 
        document.querySelector('.ytp-ad-skip-button') ||
        document.querySelector('button.ytp-ad-skip-button-modern') ||
        document.querySelector('.ytp-ad-skip-button-modern') ||
        document.querySelector('[aria-label="Skip ad"]') ||
        document.querySelector('[aria-label="Skip Ad"]') ||
        Array.from(document.querySelectorAll('button')).find(btn => 
          btn.textContent.includes('Skip') && btn.offsetParent !== null
        );
      
      if (skipButton && skipButton.offsetParent !== null) {
        // Button exists and is visible
        skipButton.click();
        console.log('Ad skipped');
        clearInterval(skipAdsInterval);
      }
    } catch (e) {
      // Silent fail
    }
  }, 300); // Check more frequently (every 300ms instead of 500ms)

  // Stop checking after 20 seconds
  setTimeout(() => clearInterval(skipAdsInterval), 20000);
}
function openModule(moduleId) {
  reviewMode = false;
  activeModuleId = moduleId;
  const course = getActiveCourse();
  const mod = course.modules.find(m => m.id === moduleId);
  const dayIndex = course.modules.findIndex(m => m.id === moduleId);

  // If this module has sub-modules, we operate on the current
  // (first-incomplete) one instead of the module's own times. A
  // module with no sub-modules behaves exactly as before.
  const currentSub = getCurrentSubModule(mod);
  activeSubModuleId = currentSub ? currentSub.id : null;
  const unit = currentSub || mod;

  $('module-day-tag').textContent = `Day ${dayIndex + 1}${currentSub ? ` · ${currentSub.name}` : ''}`;
  $('module-title').textContent = currentSub ? `${mod.name} — ${currentSub.name}` : mod.name;

  // Check whether we're resuming a session left off within the last
  // 24 hours (same module AND same sub-module, same course) — if so,
  // pick up from there instead of starting at 0.
  const resumeState = loadResumeState();
  const isResuming = resumeState
    && resumeState.courseId === activeCourseId
    && resumeState.courseType === activeCourseType
    && resumeState.moduleId === moduleId
    && resumeState.subModuleId === activeSubModuleId;

  const unitStartSeconds = timeToSeconds(unit.startTime);
  timerTotalSeconds = timeToSeconds(unit.endTime) - unitStartSeconds;
  const resumeElapsed = isResuming ? Math.min(resumeState.elapsedSeconds, timerTotalSeconds) : 0;
  const videoStartSeconds = unitStartSeconds + resumeElapsed;

if (youtubePlayer) {
  youtubePlayer.destroy();
  youtubePlayer = null;
}

const videoId = extractYouTubeId(course.source);
const playerContainer = $('youtube-player');

if (!videoId) {
  playerContainer.innerHTML = '<div class="video-missing">⚠️ No playable video found. Paste a direct video link (open the video, copy the URL from the address bar) — not a playlist link.</div>';
} else if (!youtubeAPIReady) {
  playerContainer.innerHTML = '<div class="video-missing">Loading player…</div>';
  pendingYouTubeRequest = {
    videoId,
    startSeconds: videoStartSeconds
  };
} else {
  createYouTubePlayer(videoId, videoStartSeconds);
}

  youtubeMaxWatchedSeconds = videoStartSeconds;
  timerSecondsLeft = timerTotalSeconds - resumeElapsed;
  timerRunning = false;
  clearInterval(timerInterval);

  if (youtubePlayer && typeof youtubePlayer.pauseVideo === 'function') {
  youtubePlayer.pauseVideo();
}

  updateTimerDisplay();
  $('btn-timer-start').style.display = 'inline-block';
  $('btn-timer-start').textContent = isResuming ? '▶ Continue' : '▶ Start learning';
  $('btn-timer-pause').style.display = 'none';
  $('btn-complete-module').style.display = 'block';
  $('btn-complete-module').textContent = 'Complete module';
  const extraNoteEl = document.querySelector('#view-module .extra-note');
  if (extraNoteEl) extraNoteEl.style.display = 'block';

    showView('module');
     monitorAndSkipAds();
   monitorAndSkipAds();
}

// Opens a COMPLETED module or sub-module again, purely to rewatch it.
// Doesn't touch progress, XP, or the resume-within-24h state — it's
// just a video player pointed at that unit's own start/end range.
function openModuleForReview(moduleId, subModuleId) {
  reviewMode = true;
  activeModuleId = moduleId;
  activeSubModuleId = subModuleId || null;

  const course = getActiveCourse();
  const mod = course.modules.find(m => m.id === moduleId);
  if (!mod) return;
  const unit = subModuleId ? (mod.subModules || []).find(s => s.id === subModuleId) : mod;
  if (!unit) return;

  const dayIndex = course.modules.findIndex(m => m.id === moduleId);
  $('module-day-tag').textContent = `Day ${dayIndex + 1}${subModuleId ? ` · ${unit.name}` : ''} · Replay`;
  $('module-title').textContent = subModuleId ? `${mod.name} — ${unit.name}` : mod.name;

  if (youtubePlayer) {
    youtubePlayer.destroy();
    youtubePlayer = null;
  }

  const videoId = extractYouTubeId(course.source);
  const playerContainer = $('youtube-player');
  const unitStartSeconds = timeToSeconds(unit.startTime);
  const unitEndSeconds = timeToSeconds(unit.endTime);

  if (!videoId) {
    playerContainer.innerHTML = '<div class="video-missing">⚠️ No playable video found.</div>';
  } else if (!youtubeAPIReady) {
    playerContainer.innerHTML = '<div class="video-missing">Loading player…</div>';
    pendingYouTubeRequest = { videoId, startSeconds: unitStartSeconds };
  } else {
    createYouTubePlayer(videoId, unitStartSeconds);
  }

  timerTotalSeconds = unitEndSeconds - unitStartSeconds;
  // Already fully "watched" — this disables the forward-skip lock so
  // the user can freely scrub anywhere within this replay.
  youtubeMaxWatchedSeconds = unitEndSeconds;
  timerSecondsLeft = 0;
  timerRunning = false;
  clearInterval(timerInterval);

  if (youtubePlayer && typeof youtubePlayer.pauseVideo === 'function') {
    youtubePlayer.pauseVideo();
  }

  $('timer-display').textContent = formatTime(timerTotalSeconds);
  $('timer-display').classList.remove('done');
  $('timer-label').textContent = '📼 Replay — this won\'t affect your progress';
  $('btn-timer-start').style.display = 'inline-block';
  $('btn-timer-start').textContent = '▶ Play';
  $('btn-timer-pause').style.display = 'none';
  $('btn-complete-module').style.display = 'none';
  const extraNoteEl = document.querySelector('#view-module .extra-note');
  if (extraNoteEl) extraNoteEl.style.display = 'none';

  showView('module');
}

function updateTimerDisplay() {
  const display = $('timer-display');
  display.textContent = formatTime(timerSecondsLeft);

  if (timerSecondsLeft <= 0) {
    display.classList.add('done');
    $('timer-label').textContent = 'Ready to complete!';
    $('btn-complete-module').disabled = false;
  } else {
    display.classList.remove('done');
    $('timer-label').textContent = 'Time remaining';
    $('btn-complete-module').disabled = true;
  }
}

$('btn-timer-start').addEventListener('click', () => {
  if (timerRunning) return;
  timerRunning = true;

  if (youtubePlayer && typeof youtubePlayer.playVideo === 'function') {
  youtubePlayer.playVideo();
  // Correct immediately if they seeked forward while paused, instead
  // of waiting up to 1 second for the first interval tick below.
  checkYouTubeSkip();
}
  $('btn-timer-start').style.display = 'none';
  $('btn-timer-pause').style.display = 'inline-block';

 timerInterval = setInterval(() => {

  if (checkYouTubeSkip()) {
    return;
  }

  if (timerSecondsLeft > 0) {
    timerSecondsLeft -= 1;

    updateTimerDisplay();
  }

  if (youtubePlayer && typeof youtubePlayer.getCurrentTime === 'function') {
    const course = getActiveCourse();
    const mod = getActiveUnit(course);

    if (mod) {
      const endSeconds = timeToSeconds(mod.endTime);
      const currentSeconds = youtubePlayer.getCurrentTime();

     if (currentSeconds >= endSeconds && youtubeMaxWatchedSeconds >= endSeconds) {
  youtubePlayer.pauseVideo();
  timerSecondsLeft = 0;
  updateTimerDisplay();

  $('btn-complete-module').disabled = false;
}
    }
  }

    if (timerSecondsLeft <= 0) {
    clearInterval(timerInterval);
    timerRunning = false;
    $('btn-timer-pause').style.display = 'none';
  }
}, 1000);
});

$('btn-timer-pause').addEventListener('click', () => {
  if (youtubePlayer && typeof youtubePlayer.pauseVideo === 'function') {
    youtubePlayer.pauseVideo();
  }

  timerRunning = false;
  clearInterval(timerInterval);

  $('btn-timer-pause').style.display = 'none';
  $('btn-timer-start').style.display = 'inline-block';
  $('btn-timer-start').textContent = '▶ Resume';
});

$('btn-complete-module').addEventListener('click', async () => {
  if (reviewMode) return; // safety net — button is hidden in review mode anyway
  clearInterval(timerInterval);
  $('btn-complete-module').disabled = true;
  $('btn-complete-module').textContent = 'Saving…';

  const course = getActiveCourse();
  const modules = course.modules;
  const idx = modules.findIndex(m => m.id === activeModuleId);
  const mod = modules[idx];

  // ---- SUB-MODULE BRANCH ----
  // If we're on a sub-module that isn't the last one, just mark it
  // done, move to the next sub-module, and stop — no XP, streak, or
  // achievements yet. Those only happen when the module's LAST
  // sub-module is completed (handled by falling through below).
  if (activeSubModuleId) {
    const subIdx = mod.subModules.findIndex(s => s.id === activeSubModuleId);
    mod.subModules[subIdx].status = 'completed';
    const isLastSub = subIdx + 1 >= mod.subModules.length;

    if (!isLastSub) {
      mod.subModules[subIdx + 1].status = 'available';
      clearResumeState();

      if (activeCourseType === 'shared') {
        await db.collection('sharedCourses').doc(activeCourseId).update({
          [`progress.${currentUser.uid}`]: modules
        });
      } else {
        await coursesRef().doc(activeCourseId).update({ modules });
      }

      await loadCourses();
      await loadSharedCourses();
      toast(`✓ "${mod.subModules[subIdx].name}" complete — next: ${mod.subModules[subIdx + 1].name}`);
      openModule(activeModuleId); // reopens straight into the next sub-module
      return;
    }
    // This WAS the last sub-module — fall through to the normal
    // module-completion flow below, exactly like a module with no
    // sub-modules at all. mod.subModules is already updated above,
    // and it's part of `modules`, so it'll be saved along with it.
  }

  clearResumeState();
  modules[idx].status = 'completed';

  let courseJustCompleted = false;
  if (idx + 1 < modules.length) {
    modules[idx + 1].status = 'available';
  } else {
    courseJustCompleted = true;
  }

  if (activeCourseType === 'shared') {
    // Shared courses live in a top-level collection, keyed by each
    // participant's own progress array — only update MY progress.
    await db.collection('sharedCourses').doc(activeCourseId).update({
      [`progress.${currentUser.uid}`]: modules
    });
  } else {
    const personalCourse = getCourse(activeCourseId);
    personalCourse.completed = personalCourse.completed || courseJustCompleted;
    await coursesRef().doc(personalCourse.id).update({
      modules,
      completed: personalCourse.completed
    });
  }

  const levelBefore = getLevelInfo(userStats.points).level;

  userStats.modulesCompleted += 1;
  userStats.points += POINTS_PER_MODULE;
  registerCompletionForStreak();

  if (!userStats.activeDates) userStats.activeDates = [];
  const todayForCalendar = todayStr();
  if (!userStats.activeDates.includes(todayForCalendar)) {
    userStats.activeDates.push(todayForCalendar);
  }

   // Track the learning session for the calendar
const unit = activeSubModuleId 
  ? (mod.subModules || []).find(s => s.id === activeSubModuleId) 
  : mod;

if (unit) {
  const unitStartSeconds = timeToSeconds(unit.startTime);
  const unitEndSeconds = timeToSeconds(unit.endTime);
  const sessionMinutes = Math.round((unitEndSeconds - unitStartSeconds) / 60);
  
  recordLearningSession(
    todayForCalendar,
    activeCourseId,
    course.name,
    activeModuleId,
    unit.name,
    sessionMinutes
  );
}

  const newMilestones = checkStreakMilestones();
  if (courseJustCompleted && activeCourseType === 'personal') userStats.coursesCompleted += 1;
  const newBadges = checkNewAchievements();
  const newRewards = checkNewRewards();
  const levelAfter = getLevelInfo(userStats.points);
  await saveUserStats();
  await loadCourses();
  await loadSharedCourses();

  let msg = `+${POINTS_PER_MODULE} XP`;
  if (newMilestones.length) {
    newMilestones.forEach(m => { msg += ` · 🔥 +${m.bonus} XP for ${m.days}-day streak!`; });
  }
  msg += ` · 🔥 ${userStats.streak}-day streak`;
  if (courseJustCompleted) msg = `🎉 Course completed! ${msg}`;
  toast(msg);

  if (levelAfter.level > levelBefore) {
    setTimeout(() => toast(`🎉 LEVEL UP! You reached Level ${levelAfter.level} — ${levelAfter.icon} ${levelAfter.title}`), 3400);
  }

  if (newBadges.length) {
    setTimeout(() => toast(`Achievement unlocked: ${newBadges[0].icon} ${newBadges[0].label}`), 5100);
  }

  if (newRewards.length) {
  setTimeout(() => toast(`🎁 Reward unlocked: ${newRewards[0].icon} ${newRewards[0].label}`), 6800);
}

  renderDashboard();
  if (activeCourseType === 'shared') {
    renderPath();
    showView('path');
  } else {
    renderPath();
    showView('path');
  }
});
// ===========================================================
// FRIENDS
// ===========================================================

$('btn-add-friend').addEventListener('click', async () => {
  const email = $('friend-email-input').value.trim().toLowerCase();

  if (!email) {
    toast("Enter your friend's email.");
    return;
  }

  if (email === currentUser.email.toLowerCase()) {
    toast("You can't add yourself.");
    return;
  }

  try {
   console.log('STEP 1: checking userLookup');
    const lookupSnap = await db.collection('userLookup')
  .doc(email)
  .get();
  console.log('STEP 2: userLookup worked', lookupSnap.exists);

if (!lookupSnap.exists) {
  toast('No LearnLock user found with that email.');
  return;
}

const friendUid = lookupSnap.data().uid;

const alreadyFriend = await db.collection('users')
  .doc(currentUser.uid)
  .collection('friends')
  .doc(friendUid)
  .get();

if (alreadyFriend.exists) {
  toast("You're already friends with this person.");
  return;
}

console.log('CURRENT USER UID:', currentUser.uid);
console.log('FRIEND UID:', friendUid);
console.log('REQUEST PATH:', `users/${friendUid}/friendRequests/${currentUser.uid}`);

   console.log('FIREBASE PROJECT:', firebase.app().options.projectId);
console.log('AUTH UID:', firebase.auth().currentUser.uid);
await db.collection('users')
  .doc(friendUid)
      .collection('friendRequests')
      .doc(currentUser.uid)
      .set({
        fromUid: currentUser.uid,
        fromEmail: currentUser.email,
        createdAt: Date.now(),
        status: 'pending'
      });

    $('friend-email-input').value = '';

    toast('Friend request sent!');

  } catch (err) {
    console.error(err);
    toast('Could not send friend request.');
  }
});
async function loadFriendRequests() {
  const list = $('friend-requests-list');

  if (!list || !currentUser) return;

  list.innerHTML = '';

  try {
    const snapshot = await db.collection('users')
      .doc(currentUser.uid)
      .collection('friendRequests')
      .where('status', '==', 'pending')
      .get();

    if (snapshot.empty) {
      list.innerHTML = '<p>No pending friend requests.</p>';
      return;
    }

    snapshot.forEach(doc => {
      const request = doc.data();

      const div = document.createElement('div');
      div.className = 'card';

      div.innerHTML = `
        <p><strong>${request.fromEmail}</strong> wants to be your friend.</p>
        <button class="btn-primary btn-accept-friend">Accept</button>
        <button class="btn-secondary btn-reject-friend">Reject</button>
      `;

      div.querySelector('.btn-accept-friend').addEventListener('click', async () => {
        await acceptFriendRequest(doc.id, request);
      });

      div.querySelector('.btn-reject-friend').addEventListener('click', async () => {
        await rejectFriendRequest(doc.id);
      });

      list.appendChild(div);
    });

  } catch (err) {
    console.error(err);
    list.innerHTML = '<p>Could not load friend requests.</p>';
  }
}
async function acceptFriendRequest(requestId, request) {
  try {
    await db.collection('users')
      .doc(currentUser.uid)
      .collection('friends')
      .doc(request.fromUid)
      .set({
        uid: request.fromUid,
        email: request.fromEmail,
        addedAt: Date.now()
      });

        await db.collection('users')
      .doc(currentUser.uid)
      .collection('friendRequests')
      .doc(requestId)
      .update({
        status: 'accepted'
      });

    await db.collection('users')
      .doc(request.fromUid)
      .collection('friends')
      .doc(currentUser.uid)
      .set({
        uid: currentUser.uid,
        email: currentUser.email,
        addedAt: Date.now()
      });

    toast('Friend request accepted!');

    await loadFriendRequests();

  } catch (err) {
    console.error(err);
    toast('Could not accept friend request.');
  }
}

async function rejectFriendRequest(requestId) {
  try {
    await db.collection('users')
      .doc(currentUser.uid)
      .collection('friendRequests')
      .doc(requestId)
      .delete();

    toast('Friend request declined.');

    await loadFriendRequests();

  } catch (err) {
    console.error(err);
    toast('Could not decline friend request.');
  }
}

async function loadFriends() {
  const list = $('friends-list');
  if (!list || !currentUser) return;

  list.innerHTML = '';

  try {
    const snapshot = await db.collection('users')
      .doc(currentUser.uid)
      .collection('friends')
      .get();

    if (snapshot.empty) {
      list.innerHTML = '<div class="empty-state">No friends yet — add one from the dashboard.</div>';
      return;
    }

    snapshot.forEach(doc => {
      const friend = doc.data();

      const div = document.createElement('div');
      div.className = 'friend-item';

      div.innerHTML = `
        <span class="friend-avatar">👤</span>
        <span class="friend-email">${escapeHtml(friend.email)}</span>
      `;

      list.appendChild(div);
    });

  } catch (err) {
    console.error(err);
    list.innerHTML = '<p>Could not load friends.</p>';
  }
}
/* ============================================================
   LEARNLOCK — Learning Progress Calendar Module
=========================================================== */

// Helper: Create a learning session record when a module is completed
function createLearningSession(date, courseId, courseTitle, moduleId, moduleTitle, minutes, xpEarned = 50) {
  return {
    date,
    courseId,
    courseTitle,
    moduleId,
    moduleTitle,
    minutes,
    completed: true,
    xpEarned
  };
}

// Helper: Add a session to the learning history
function recordLearningSession(date, courseId, courseTitle, moduleId, moduleTitle, minutes) {
  if (!userStats.learningSessions) userStats.learningSessions = [];
  const session = createLearningSession(date, courseId, courseTitle, moduleId, moduleTitle, minutes);
  userStats.learningSessions.push(session);
}

// Helper: Get all sessions for a specific date
function getSessionsForDate(dateStr) {
  if (!userStats.learningSessions) return [];
  return userStats.learningSessions.filter(s => s.date === dateStr);
}

// Helper: Get total minutes learned on a date
function getTotalMinutesForDate(dateStr) {
  const sessions = getSessionsForDate(dateStr);
  return sessions.reduce((total, s) => total + (s.minutes || 0), 0);
}

// Helper: Get total minutes for a week (starting Sunday)
function getTotalMinutesForWeek(weekStartDate) {
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStartDate);
    d.setDate(d.getDate() + i);
    const dateStr = toLocalDateStr(d);
    total += getTotalMinutesForDate(dateStr);
  }
  return total;
}

// Helper: Get total minutes for a month
function getTotalMinutesForMonth(year, month) {
  if (!userStats.learningSessions) return 0;
  return userStats.learningSessions
    .filter(s => {
      const [y, m] = s.date.split('-').slice(0, 2);
      return parseInt(y) === year && parseInt(m) === month;
    })
    .reduce((total, s) => total + (s.minutes || 0), 0);
}

// Helper: Format minutes as "1h 12m" or "45m"
function formatMinutes(totalMinutes) {
  if (totalMinutes === 0) return '0m';
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

// Helper: Get days learned and missed for the month
function getMonthStats(year, month) {
  const lastDay = new Date(year, month, 0).getDate();
  let daysLearned = 0;
  let daysMissed = 0;

  for (let day = 1; day <= lastDay; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const minutes = getTotalMinutesForDate(dateStr);
    if (minutes > 0) {
  daysLearned++;
} else {
  const d = new Date(dateStr);
  if (d < new Date()) {  
    daysMissed++;
  }
}
  }

  return { daysLearned, daysMissed };
}

// ============================================================
// NEW CALENDAR RENDERING
// ============================================================

// Calendar mode: 'month' or 'week'
let calendarMode = 'month';
let calendarDate = new Date(); // which month/week to display

// Render the complete Learning Progress Calendar
function renderLearningProgressCalendar() {
  const container = $('learning-calendar');
  if (!container) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth() + 1;

  // Get stats for the month
  const stats = getMonthStats(year, month);
  const totalMinutes = getTotalMinutesForMonth(year, month);
  const totalDays = new Date(year, month, 0).getDate();
  const avgMinutesPerLearningDay = stats.daysLearned > 0 ? Math.round(totalMinutes / stats.daysLearned) : 0;

  // Summary section
  const summaryHtml = `
    <div class="calendar-summary">
      <div class="summary-item">
        <div class="summary-label">Days learned</div>
        <div class="summary-value">${stats.daysLearned}</div>
      </div>
      <div class="summary-item">
        <div class="summary-label">Days missed</div>
        <div class="summary-value">${stats.daysMissed}</div>
      </div>
      <div class="summary-item">
        <div class="summary-label">Total time</div>
        <div class="summary-value">${formatMinutes(totalMinutes)}</div>
      </div>
      <div class="summary-item">
        <div class="summary-label">Avg per day</div>
        <div class="summary-value">${formatMinutes(avgMinutesPerLearningDay)}</div>
      </div>
    </div>
  `;

  // Controls (Month/Week toggle, Prev/Next)
  const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
  const controlsHtml = `
    <div class="calendar-controls">
      <button class="btn-calendar-nav" id="btn-cal-prev">← Prev</button>
      <div class="calendar-month-display">${monthName}</div>
      <button class="btn-calendar-nav" id="btn-cal-next">Next →</button>
    </div>
    <div class="calendar-mode-toggle">
      <button class="btn-cal-mode ${calendarMode === 'month' ? 'active' : ''}" data-mode="month">📅 Month</button>
      <button class="btn-cal-mode ${calendarMode === 'week' ? 'active' : ''}" data-mode="week">📊 Week</button>
    </div>
  `;

  // Calendar grid (for month view)
  let calendarGridHtml = '';
  if (calendarMode === 'month') {
    calendarGridHtml = renderMonthGrid(year, month);
  } else {
    calendarGridHtml = renderWeekView(year, month);
  }

  container.innerHTML = summaryHtml + controlsHtml + calendarGridHtml;

  // Attach event listeners
  $('btn-cal-prev')?.addEventListener('click', () => {
    calendarDate.setMonth(calendarDate.getMonth() - 1);
    renderLearningProgressCalendar();
  });

  $('btn-cal-next')?.addEventListener('click', () => {
    calendarDate.setMonth(calendarDate.getMonth() + 1);
    renderLearningProgressCalendar();
  });

  document.querySelectorAll('.btn-cal-mode').forEach(btn => {
    btn.addEventListener('click', () => {
      calendarMode = btn.dataset.mode;
      renderLearningProgressCalendar();
    });
  });

  // Attach date click handlers
  document.querySelectorAll('.calendar-day').forEach(el => {
    el.addEventListener('click', () => {
      const dateStr = el.dataset.date;
      showDateDetailsModal(dateStr);
    });
  });
}

// Render a month's grid of dates
function renderMonthGrid(year, month) {
  const firstDay = new Date(year, month - 1, 1).getDay(); // 0 = Sunday
  const lastDay = new Date(year, month, 0).getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let html = '<div class="calendar-grid">';
  
  // Day headers
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  dayNames.forEach(name => {
    html += `<div class="calendar-day-header">${name}</div>`;
  });

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) {
    html += '<div class="calendar-day empty"></div>';
  }

  // Days of month
  for (let day = 1; day <= lastDay; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dateObj = new Date(dateStr);
    const minutes = getTotalMinutesForDate(dateStr);
    const isFuture = dateObj > today;
    const isToday = toLocalDateStr(today) === dateStr;
    const hasActivity = minutes > 0;

    const classes = [
      'calendar-day',
      isFuture ? 'future' : '',
      isToday ? 'today' : '',
      hasActivity ? 'active' : 'inactive'
    ].filter(Boolean).join(' ');

    const timeText = minutes > 0 ? formatMinutes(minutes) : (isFuture || isToday ? '' : 'Missed');
    const progressPct = Math.min(minutes / 60 * 100, 100); // assume 1h = full progress

    html += `
      <div class="calendar-day ${classes}" data-date="${dateStr}" title="${dateStr}">
        <div class="day-number">${day}</div>
        <div class="day-time">${timeText}</div>
        <div class="day-progress-bar">
          <div class="day-progress-fill" style="width: ${progressPct}%"></div>
        </div>
      </div>
    `;
  }

  html += '</div>';
  return html;
}

// Render weekly breakdown view
function renderWeekView(year, month) {
  const today = new Date();
  const weeks = [];
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);

  // Generate all weeks in month
  let currentDate = new Date(firstDay);
  currentDate.setDate(currentDate.getDate() - currentDate.getDay()); // Start from Sunday

  while (currentDate < lastDay) {
    const weekStart = new Date(currentDate);
    const weekEnd = new Date(currentDate);
    weekEnd.setDate(weekEnd.getDate() + 6);

    weeks.push({
      start: weekStart,
      end: weekEnd
    });

    currentDate.setDate(currentDate.getDate() + 7);
  }

  let html = '<div class="calendar-weeks">';

  weeks.forEach(week => {
    const dayBreakdown = [];
    let weekTotal = 0;

    for (let i = 0; i < 7; i++) {
      const d = new Date(week.start);
      d.setDate(d.getDate() + i);
      const dateStr = toLocalDateStr(d);
      const minutes = getTotalMinutesForDate(dateStr);
      dayBreakdown.push({
        day: d.toLocaleString('default', { weekday: 'short' }).substring(0, 3),
        minutes,
        dateStr
      });
      weekTotal += minutes;
    }

    html += `
      <div class="week-card">
        <div class="week-header">
          <span class="week-range">${dayBreakdown[0].day} - ${dayBreakdown[6].day}</span>
          <span class="week-total">${formatMinutes(weekTotal)}</span>
        </div>
        <div class="week-bars">
          ${dayBreakdown.map((d, i) => `
            <div class="week-bar-item">
              <div class="week-bar-day">${d.day}</div>
              <div class="week-bar" style="height: ${Math.min(d.minutes / 60 * 100, 100)}%;" 
                   title="${d.dateStr}: ${formatMinutes(d.minutes)}"></div>
              <div class="week-bar-time">${formatMinutes(d.minutes)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  });

  html += '</div>';
  return html;
}

// Show modal with details for a clicked date
function showDateDetailsModal(dateStr) {
  const sessions = getSessionsForDate(dateStr);
  const totalMinutes = getTotalMinutesForDate(dateStr);

  let html = `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal-content">
        <div class="modal-header">
          <div class="modal-title">${dateStr}</div>
          <button class="modal-close" id="btn-close-modal">✕</button>
        </div>
        <div class="modal-body">
          <div class="modal-summary">
            <div class="modal-stat">
              <span class="modal-label">Total time</span>
              <span class="modal-value">${formatMinutes(totalMinutes)}</span>
            </div>
            <div class="modal-stat">
              <span class="modal-label">Sessions</span>
              <span class="modal-value">${sessions.length}</span>
            </div>
          </div>
  `;

  if (sessions.length === 0) {
    html += '<div class="no-sessions">No learning recorded for this date.</div>';
  } else {
    html += '<div class="sessions-list">';
    sessions.forEach(s => {
      html += `
        <div class="session-item">
          <div class="session-course">${escapeHtml(s.courseTitle)}</div>
          <div class="session-module">${escapeHtml(s.moduleTitle)}</div>
          <div class="session-time-xp">
            <span>⏱️ ${formatMinutes(s.minutes)}</span>
            <span>✨ +${s.xpEarned} XP</span>
          </div>
        </div>
      `;
    });
    html += '</div>';
  }

  html += `
        </div>
      </div>
    </div>
  `;

  // Show modal
  const modal = document.createElement('div');
  modal.innerHTML = html;
  document.body.appendChild(modal);

  const overlay = $('modal-overlay');
  $('btn-close-modal').addEventListener('click', () => {
    modal.remove();
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      modal.remove();
    }
  });
}

// ============================================================
// INITIALIZE CALENDAR
// ============================================================

// Call this in your loadAndShowDashboard() or renderDashboard()
function initLearningCalendar() {
  calendarDate = new Date();
  calendarMode = 'month';
  renderLearningProgressCalendar();}

// Continuous ad monitoring
function monitorAndSkipAds() {
  setInterval(() => {
    try {
      const skipBtn = document.querySelector('.ytp-ad-skip-button') || 
                      document.querySelector('[aria-label*="Skip"]');
      if (skipBtn && skipBtn.offsetParent !== null) skipBtn.click();
      
      const closeBtn = document.querySelector('.ytp-ad-overlay-close-button');
      if (closeBtn && closeBtn.offsetParent !== null) closeBtn.click();
    } catch (e) {}
  }, 250);
}
