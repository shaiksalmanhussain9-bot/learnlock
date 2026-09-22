/* ===========================================================
   LEARNLOCK — app.js (FIXED VERSION)
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

const STREAK_MILESTONES = [
  { days: 3, bonus: 50 },
  { days: 7, bonus: 150 },
  { days: 15, bonus: 500 },
  { days: 30, bonus: 2000 },
];

const LEVEL_XP_STEP = 500;

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

let pendingStreakToast = null;

let currentUser = null;
let userStats = null;
let coursesCache = [];
let activeCourseId = null;
let activeModuleId = null;
let activeSubModuleId = null;
let reviewMode = false;
let isSignupMode = false;
let activeCourseType = 'personal';
let sharedCoursesCache = [];

let timerSecondsLeft = 0;
let timerTotalSeconds = 0;
let timerInterval = null;
let timerRunning = false;
let youtubePlayer = null;
let youtubeMaxWatchedSeconds = 0;
let youtubeSeekProtectionInterval = null;
let youtubeAPIReady = false;
let pendingYouTubeRequest = null;
let currentCourseVideoId = null;

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

const RESUME_WINDOW_MS = 24 * 60 * 60 * 1000;

function resumeStorageKey() {
  return currentUser ? `learnlock_resume_${currentUser.uid}` : null;
}

function saveResumeState() {
  const key = resumeStorageKey();
  if (!key || !activeModuleId || reviewMode) return;
  if (!timerTotalSeconds || timerSecondsLeft <= 0) return;

  const elapsedSeconds = timerTotalSeconds - timerSecondsLeft;
  if (elapsedSeconds <= 0) return;

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
  } catch (e) {}
}

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

window.addEventListener('beforeunload', saveResumeState);
window.addEventListener('pagehide', saveResumeState);

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
    delete userStats.missedDay;
    delete userStats.challenges;

    if (
      userStats.lastActiveDate &&
      daysBetween(userStats.lastActiveDate, todayStr()) > 1 &&
      userStats.streak > 0
    ) {
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

function renderBadges(badges, containerId) {
  const container = $(containerId);
  if (!container) return;

  if (!badges || !Array.isArray(badges)) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = '';

  badges.forEach(badge => {
    if (!badge || typeof badge !== 'object') return;
    
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

async function showSharePanel(courseLike, anchorId) {
  const friends = await getFriendsList();
  if (friends.length === 0) { toast('Add a friend first before sharing a course.'); return; }

  const anchorItem = document.querySelector(`.course-item[data-course-id="${anchorId}"]`);
  if (!anchorItem) return;

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
  console.log('SHARING:', { courseName: course.name, friendEmail: friend.email, friendUid: friend.uid });
  
  const resetModules = (mods) => mods.map((m, i) => ({
    id: m.id, name: m.name, startTime: m.startTime, endTime: m.endTime,
    status: i === 0 ? 'available' : 'locked'
  }));

  const shareId = `${course.id}_${friend.uid}`;
  const shareRef = db.collection('sharedCourses').doc(shareId);

  try {
    const existingSnap = await shareRef.get();
    if (existingSnap.exists) {
      const data = existingSnap.data();
      if (data.status === 'pending' || data.status === 'accepted') {
        toast(`This course has already been shared with ${friend.email}.`);
        return;
      }
    }

    const shareData = {
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
    };

    console.log('WRITING TO FIREBASE:', shareData);
    await shareRef.set(shareData);
    console.log('SUCCESS: Course invite sent');
    toast(`✅ "${course.name}" successfully sent to ${friend.email}.`);
    document.querySelectorAll('.course-share-panel').forEach(p => p.remove());
    await loadSharedCourses();
    renderDashboard();
    
  } catch (err) {
    console.error('SHARING ERROR:', err);
    toast(`❌ Error sharing course: ${err.message}`);
  }
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

document.addEventListener('click', function (event) {
  closeCourseMenus();

  const backButton = event.target.closest('.back-link');

  if (!backButton) {
    return;
  }

  event.preventDefault();

  const destination = backButton.dataset.nav;

  // Module screen: Back to plan
  if (destination === 'path') {
    if (typeof pauseTimer === 'function') {
      pauseTimer();
    }

    const moduleView = document.getElementById('view-module');
    const pathView = document.getElementById('view-path');

    if (moduleView) {
      moduleView.classList.add('hidden');
      moduleView.classList.remove('active');
    }

    if (pathView) {
      pathView.classList.remove('hidden');
      pathView.classList.add('active');
    }

    return;
  }

  // Path screen: Back to dashboard
  if (destination === 'dashboard') {
    const pathView = document.getElementById('view-path');
    const dashboardView = document.getElementById('view-dashboard');

    if (pathView) {
      pathView.classList.add('hidden');
      pathView.classList.remove('active');
    }

    if (dashboardView) {
      dashboardView.classList.remove('hidden');
      dashboardView.classList.add('active');
    }

    return;
  }
});

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

// YouTube API for Auto-Module Generator
const YOUTUBE_API_KEY = 'AIzaSyAoaYH1sBAnDxQ9QHJ3vW8Wma6GpGoGyag';

async function fetchYouTubeVideoInfo(videoId) {
  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${YOUTUBE_API_KEY}&part=contentDetails,snippet`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch video info');
    const data = await response.json();
    if (!data.items || data.items.length === 0) throw new Error('Video not found');
    return data.items[0];
  } catch (err) {
    console.error('YouTube API error:', err);
    toast('Could not fetch video info. Make sure the YouTube link is public.');
    return null;
  }
}

function extractVideoIdFromUrl(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
    /youtube\.com\/embed\/([^&\n?#]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function parseDuration(isoDuration) {
  const regex = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/;
  const matches = isoDuration.match(regex);
  const hours = parseInt(matches[1] || 0);
  const minutes = parseInt(matches[2] || 0);
  const seconds = parseInt(matches[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

function extractChaptersFromDescription(description) {
  if (!description) return [];
  const lines = description.split('\n');
  const chapters = [];
  const timeRegex = /^(\d{1,2}):(\d{2}):?(\d{2})?\s*-?\s*(.+)/;
  
  for (const line of lines) {
    const match = line.trim().match(timeRegex);
    if (match) {
      const hours = parseInt(match[1]);
      const minutes = parseInt(match[2]);
      const secs = parseInt(match[3] || 0);
      const title = match[4].trim();
      chapters.push({
        seconds: hours * 3600 + minutes * 60 + secs,
        title
      });
    }
  }
  return chapters;
}

function generateTimeSegments(totalSeconds, segmentMinutes = 15) {
  const segments = [];
  const segmentSecs = segmentMinutes * 60;
  let currentTime = 0;
  
  while (currentTime < totalSeconds) {
    const startTime = currentTime;
    const endTime = Math.min(currentTime + segmentSecs, totalSeconds);
    segments.push({
      seconds: startTime,
      title: `Module ${segments.length + 1}`,
      endSeconds: endTime
    });
    currentTime = endTime;
  }
  
  return segments;
}

function secondsToTimeString(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function autoGenerateModules() {
  const youtubeUrl = $('auto-youtube-url').value.trim();
  if (!youtubeUrl) {
    toast('Paste a YouTube URL first.');
    return;
  }

  const videoId = extractVideoIdFromUrl(youtubeUrl);
  if (!videoId) {
    toast('Invalid YouTube URL. Paste a link like https://www.youtube.com/watch?v=...');
    return;
  }

  showPublicVideoWarningModal(() => runAutoGenerate(youtubeUrl));
}

async function runAutoGenerate(youtubeUrl) {
  const videoId = extractVideoIdFromUrl(youtubeUrl);

  $('btn-auto-generate').disabled = true;
  $('btn-auto-generate').textContent = '🔄 Analyzing video...';

  const videoInfo = await fetchYouTubeVideoInfo(videoId);
  if (!videoInfo) {
    $('btn-auto-generate').disabled = false;
    $('btn-auto-generate').textContent = '🎬 Analyze & auto-create modules';
    return;
  }

  const totalSeconds = parseDuration(videoInfo.contentDetails.duration);
  const videoTitle = videoInfo.snippet.title;
  const description = videoInfo.snippet.description || '';

    // Try to extract chapters from description
  let chapters = extractChaptersFromDescription(description);
  
  // If no chapters found, generate 15-min segments
  if (chapters.length === 0) {
    chapters = generateTimeSegments(totalSeconds, 15);
  } else {
    // Add end time to each chapter
    for (let i = 0; i < chapters.length; i++) {
      chapters[i].endSeconds = i + 1 < chapters.length ? chapters[i + 1].seconds : totalSeconds;
    }
  }

  // Set course name
  $('course-name').value = videoTitle;
  $('course-source').value = youtubeUrl;

  // Clear existing modules
  $('module-rows').innerHTML = '';

  // Add module rows
  chapters.forEach(chapter => {
    const startTime = secondsToTimeString(chapter.seconds);
    const endTime = secondsToTimeString(chapter.endSeconds);
    addModuleRow(chapter.title, '', startTime, endTime);
  });

  toast(`✅ Generated ${chapters.length} modules. Review and click "Create learning plan".`);

  $('btn-auto-generate').disabled = false;
  $('btn-auto-generate').textContent = '🎬 Analyze & auto-create modules';
  $('auto-youtube-url').value = '';
  
  $('auto-generator-section').style.display = 'none';
  $('manual-builder-section').style.display = 'block';
}

$('btn-new-course').addEventListener('click', () => {
  if (activeCourseCount() >= MAX_ACTIVE_COURSES) {
    toast(`You've hit the ${MAX_ACTIVE_COURSES}-course limit. Finish or remove one before adding another — it keeps you focused.`);
    return;
  }
  $('course-name').value = '';
  $('course-source').value = '';
  $('module-rows').innerHTML = '';
  $('auto-youtube-url').value = '';
  $('auto-generator-section').style.display = 'block';
  $('manual-builder-section').style.display = 'none';
  showView('builder');
});

$('btn-auto-generate').addEventListener('click', autoGenerateModules);
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

function timeToSeconds(value) {
  if (typeof value === 'number') {
    return Math.floor(value);
  }

  const parts = String(value || '00:00:00')
    .trim()
    .split(':')
    .map(Number);

  if (parts.some(Number.isNaN)) {
    return NaN;
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  return parts[0];
}

function secondsToTime(totalSeconds) {
  totalSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0')
  ].join(':');
}

function fillGeneratedModuleTimes(chapters, videoDurationSeconds) {
  const moduleRows = $('module-rows');

  moduleRows.innerHTML = '';

  const validChapters = chapters
    .map(chapter => ({
      name: String(chapter.name || chapter.title || '').trim(),
      startSeconds: timeToSeconds(
        chapter.startTime ?? chapter.start ?? chapter.timestamp
      )
    }))
    .filter(chapter =>
      chapter.name &&
      Number.isFinite(chapter.startSeconds)
    )
    .sort((a, b) => a.startSeconds - b.startSeconds);

  if (validChapters.length === 0) {
    toast('No valid modules with timestamps were generated.');
    return;
  }

  const totalDuration = Number(videoDurationSeconds);

  if (!Number.isFinite(totalDuration) || totalDuration <= 0) {
    toast('Video duration is missing or invalid.');
    return;
  }

  for (let i = 0; i < validChapters.length; i++) {
    const current = validChapters[i];
    const next = validChapters[i + 1];

    const startSeconds = current.startSeconds;
    const endSeconds = next
      ? next.startSeconds
      : totalDuration;

    if (startSeconds < 0 || endSeconds <= startSeconds) {
      continue;
    }

    addModuleRow(
      current.name,
      '',
      secondsToTime(startSeconds),
      secondsToTime(endSeconds)
    );
  }
}

function addModuleRow(name = '', duration = '', startTime = '00:00:00', endTime = '00:00:00') {
  const row = document.createElement('div');
  row.className = 'module-row';
  row.innerHTML = `
    <div class="module-row-main">
      <div class="field">
        <input type="text" placeholder="Module name (e.g. Introduction)" class="mod-name" value="${escapeHtml(name)}" />
      </div>
      <div class="field time">
    <label>Start</label>
    <input type="text" placeholder="00:00:00" class="mod-start" value="${escapeHtml(startTime)}" />
  </div>

  <div class="field time">
    <label>End</label>
    <input type="text" placeholder="00:00:00" class="mod-end" value="${escapeHtml(endTime)}" />
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

  if (source && extractYouTubeId(source)) {
    showPublicVideoWarningModal(() => finishCreatePlan(name, source, rows));
    return;
  }

  await finishCreatePlan(name, source, rows);
});

async function finishCreatePlan(name, source, rows) {
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
}

function getCourse(courseId) {
  return coursesCache.find(c => c.id === courseId);
}

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

function getCurrentSubModule(mod) {
  if (!mod.subModules || mod.subModules.length === 0) return null;
  return mod.subModules.find(s => s.status === 'available') || null;
}

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

    const resumeState = mod.status === 'available' ? loadResumeState() : null;
    const isResumable = resumeState
      && resumeState.courseId === activeCourseId
      && resumeState.courseType === activeCourseType
      && resumeState.moduleId === mod.id
      && resumeState.subModuleId === (currentSub ? currentSub.id : null);

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

  const trimmed = String(url).trim();

  try {
    const parsedUrl = new URL(trimmed);
    const host = parsedUrl.hostname.replace(/^www\./, '').toLowerCase();

    if (host === 'youtu.be') {
      return parsedUrl.pathname
        .split('/')
        .filter(Boolean)[0] || null;
    }

    if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com'
    ) {
      if (parsedUrl.pathname === '/watch') {
        return parsedUrl.searchParams.get('v');
      }

      const pathParts = parsedUrl.pathname
        .split('/')
        .filter(Boolean);

      if (
        pathParts[0] === 'embed' ||
        pathParts[0] === 'shorts' ||
        pathParts[0] === 'live'
      ) {
        return pathParts[1] || null;
      }
    }
  } catch (error) {
    // Allow a plain 11-character YouTube video ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
      return trimmed;
    }
  }

  return null;
}


function isAdPlaying() {
  if (
    !youtubePlayer ||
    typeof youtubePlayer.getVideoData !== 'function'
  ) {
    return false;
  }

  try {
    const data = youtubePlayer.getVideoData();

    if (!data || !data.video_id) {
      return false;
    }

    return Boolean(
      currentCourseVideoId &&
      data.video_id !== currentCourseVideoId
    );
  } catch (error) {
    return false;
  }
}


function checkYouTubeSkip() {
  if (
    reviewMode ||
    !youtubePlayer ||
    typeof youtubePlayer.getCurrentTime !== 'function'
  ) {
    return false;
  }

  const currentTime = youtubePlayer.getCurrentTime();
  const allowedTime = youtubeMaxWatchedSeconds + 1;

  if (currentTime > allowedTime) {
    youtubePlayer.seekTo(youtubeMaxWatchedSeconds, true);
    return true;
  }

  youtubeMaxWatchedSeconds = Math.max(
    youtubeMaxWatchedSeconds,
    currentTime
  );

  return false;
}


function startForwardSeekProtection() {
  stopForwardSeekProtection();

  if (
    reviewMode ||
    !youtubePlayer ||
    typeof youtubePlayer.getCurrentTime !== 'function'
  ) {
    return;
  }

  youtubeSeekProtectionInterval = setInterval(() => {
    checkYouTubeSkip();
  }, 100);
}


function stopForwardSeekProtection() {
  if (youtubeSeekProtectionInterval) {
    clearInterval(youtubeSeekProtectionInterval);
    youtubeSeekProtectionInterval = null;
  }
}

// Shows/hides a cover over the video whenever it's paused, so YouTube's
// own "more videos" suggestion panel (which YouTube shows automatically
// on pause and can't be turned off via player settings) is hidden and
// un-clickable. The cover only ever appears while paused; playing
// (course video OR an ad) always hides it again.
function showPauseShield() {
  const shield = $('youtube-pause-shield');
  if (shield) shield.classList.remove('hidden');
}

function hidePauseShield() {
  const shield = $('youtube-pause-shield');
  if (shield) shield.classList.add('hidden');
}

function onYouTubeStateChange(event) {
  if (event.data === YT.PlayerState.UNSTARTED) {
    try {
      let skipBtn = document.querySelector('.ytp-ad-skip-button');
      if (!skipBtn) skipBtn = document.querySelector('[aria-label*="Skip"]');
      if (skipBtn) skipBtn.click();
    } catch (e) {}
  }

  if (event.data === YT.PlayerState.PLAYING) {
    hidePauseShield(); // playing — whether it's the course video or an ad, no cover needed

    if (isAdPlaying()) {
      $('timer-label').textContent = '⏸ Ad playing — timer paused';
      if (timerRunning) {
        timerRunning = false;
        clearInterval(timerInterval);
        $('btn-timer-pause').style.display = 'none';
        $('btn-timer-start').style.display = 'inline-block';
        $('btn-timer-start').textContent = '▶ Resume';
      }
      return;
    }

    if (timerSecondsLeft > 0 && !timerRunning && $('btn-timer-start').dataset.playRequested === 'true') {
      startTimerInterval();
      $('btn-timer-start').dataset.playRequested = 'false';
    }
  }

  if (event.data === YT.PlayerState.PAUSED) {
    showPauseShield(); // paused — cover the video so YouTube's suggestion panel can't be seen/clicked

    if (timerRunning) {
      timerRunning = false;
      clearInterval(timerInterval);

      $('btn-timer-pause').style.display = 'none';
      $('btn-timer-start').style.display = 'inline-block';
      $('btn-timer-start').textContent = '▶ Resume';
    }
  }
}

function startTimerInterval() {
  timerRunning = true;
  $('btn-timer-start').style.display = 'none';
  $('btn-timer-pause').style.display = 'inline-block';
  $('timer-label').textContent = 'Time remaining';

  timerInterval = setInterval(() => {
    if (isAdPlaying()) {
      $('timer-label').textContent = '⏸ Ad playing — timer paused';
      timerRunning = false;
      clearInterval(timerInterval);
      $('btn-timer-pause').style.display = 'none';
      $('btn-timer-start').style.display = 'inline-block';
      $('btn-timer-start').textContent = '▶ Resume';
      return;
    }

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
  
  // STOP VIDEO when timer reaches 00:00:00
  if (youtubePlayer && typeof youtubePlayer.pauseVideo === 'function') {
    youtubePlayer.pauseVideo();
  }
}
  }, 1000);
}

function onPlayerReady(event) {
  const player = event.target;

  startForwardSeekProtection();

  const skipAdsInterval = setInterval(() => {
    try {
      const skipButton =
        document.querySelector('.ytp-ad-skip-button') ||
        document.querySelector('button.ytp-ad-skip-button-modern') ||
        document.querySelector('.ytp-ad-skip-button-modern') ||
        document.querySelector('[aria-label="Skip ad"]') ||
        document.querySelector('[aria-label="Skip Ad"]') ||
        Array.from(document.querySelectorAll('button')).find(btn =>
          btn.textContent.includes('Skip') &&
          btn.offsetParent !== null
        );

      if (skipButton && skipButton.offsetParent !== null) {
        skipButton.click();
        console.log('Ad skipped');
        clearInterval(skipAdsInterval);
      }
    } catch (e) {}
  }, 300);

  setTimeout(() => clearInterval(skipAdsInterval), 20000);
}

function createYouTubePlayer(videoId, startSeconds) {
  currentCourseVideoId = videoId;
  const container = $('youtube-player');

  if (!videoId) return;

  if (!youtubeAPIReady || typeof YT === 'undefined' || !YT.Player) {
    pendingYouTubeRequest = { videoId, startSeconds };
    container.innerHTML = '<div class="video-missing">Loading player…</div>';
    return;
  }

  container.innerHTML = '';

  function createYouTubePlayer(videoId, startSeconds = 0) {
  if (!videoId) {
    toast('YouTube video ID is missing.');
    return;
  }

  const createPlayer = () => {
    if (
      typeof window.YT === 'undefined' ||
      typeof window.YT.Player === 'undefined'
    ) {
      toast('YouTube player is still loading. Please try again.');
      return;
    }

    const playerContainer = document.getElementById('youtube-player');

    if (!playerContainer) {
      toast('YouTube player area was not found.');
      return;
    }

    if (
      youtubePlayer &&
      typeof youtubePlayer.destroy === 'function'
    ) {
      youtubePlayer.destroy();
      youtubePlayer = null;
    }

    playerContainer.innerHTML = '';

    youtubePlayer = new YT.Player('youtube-player', {
      videoId: videoId,
      playerVars: {
        autoplay: 0,
        controls: 1,
        disablekb: 1,
        fs: 1,
        cc_load_policy: 0,
        iv_load_policy: 3,
        rel: 0,
        start: Math.max(0, Math.floor(startSeconds)),
        modestbranding: 1,
        playsinline: 1
      },
      events: {
        onReady: onPlayerReady,
        onStateChange: onYouTubeStateChange,
        onError: function (event) {
          console.error('YouTube player error code:', event.data);

          if (event.data === 101 || event.data === 150) {
            toast('This video does not allow embedded playback.');
          } else if (event.data === 100) {
            toast('This video is unavailable or private.');
          } else {
            toast('YouTube could not play this video.');
          }
        }
      }
    });
  };

  if (
    typeof window.YT !== 'undefined' &&
    typeof window.YT.Player !== 'undefined'
  ) {
    createPlayer();
  } else {
    window.onYouTubeIframeAPIReady = createPlayer;
  }
}

function openModule(moduleId) {
  reviewMode = false;
  activeModuleId = moduleId;
  const course = getActiveCourse();
  const mod = course.modules.find(m => m.id === moduleId);
  const dayIndex = course.modules.findIndex(m => m.id === moduleId);

  const currentSub = getCurrentSubModule(mod);
  activeSubModuleId = currentSub ? currentSub.id : null;
  const unit = currentSub || mod;

  $('module-day-tag').textContent = `Day ${dayIndex + 1}${currentSub ? ` · ${currentSub.name}` : ''}`;
  $('module-title').textContent = currentSub ? `${mod.name} — ${currentSub.name}` : mod.name;

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

stopForwardSeekProtection();

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

startForwardSeekProtection();   

youtubeMaxWatchedSeconds = videoStartSeconds;

timerSecondsLeft = timerTotalSeconds - resumeElapsed;
timerRunning = false;
clearInterval(timerInterval);

if (youtubePlayer && typeof youtubePlayer.pauseVideo === 'function') {
  youtubePlayer.pauseVideo();
}

showPauseShield(); // module opens paused, so keep the shield up until Start/Continue is pressed

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
}

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
  youtubeMaxWatchedSeconds = unitEndSeconds;
  timerSecondsLeft = 0;
  timerRunning = false;
  clearInterval(timerInterval);

  if (youtubePlayer && typeof youtubePlayer.pauseVideo === 'function') {
    youtubePlayer.pauseVideo();
  }

  showPauseShield();

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

  $('btn-timer-start').dataset.playRequested = 'true';

  if (youtubePlayer && typeof youtubePlayer.playVideo === 'function') {
    youtubePlayer.playVideo();
    checkYouTubeSkip();
  }

  $('btn-timer-start').style.display = 'none';
  $('btn-timer-pause').style.display = 'inline-block';
});

$('btn-timer-pause').addEventListener('click', () => {
  if (youtubePlayer && typeof youtubePlayer.pauseVideo === 'function') {
    youtubePlayer.pauseVideo();
  }

  checkYouTubeSkip();

  timerRunning = false;
  clearInterval(timerInterval);

  $('btn-timer-pause').style.display = 'none';
  $('btn-timer-start').style.display = 'inline-block';
  $('btn-timer-start').textContent = '▶ Resume';
});

$('btn-complete-module').addEventListener('click', async () => {
  if (reviewMode) return;

  stopForwardSeekProtection();
  clearInterval(timerInterval);

  $('btn-complete-module').disabled = true;
  $('btn-complete-module').textContent = 'Saving…';

  const course = getActiveCourse();
  const modules = course.modules;
  const idx = modules.findIndex(m => m.id === activeModuleId);
  const mod = modules[idx];

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
      openModule(activeModuleId);
      return;
    }
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

function recordLearningSession(date, courseId, courseTitle, moduleId, moduleTitle, minutes) {
  if (!userStats.learningSessions) userStats.learningSessions = [];
  const session = createLearningSession(date, courseId, courseTitle, moduleId, moduleTitle, minutes);
  userStats.learningSessions.push(session);
}

function getSessionsForDate(dateStr) {
  if (!userStats.learningSessions) return [];
  return userStats.learningSessions.filter(s => s.date === dateStr);
}

function getTotalMinutesForDate(dateStr) {
  const sessions = getSessionsForDate(dateStr);
  return sessions.reduce((total, s) => total + (s.minutes || 0), 0);
}

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

function getTotalMinutesForMonth(year, month) {
  if (!userStats.learningSessions) return 0;
  return userStats.learningSessions
    .filter(s => {
      const [y, m] = s.date.split('-').slice(0, 2);
      return parseInt(y) === year && parseInt(m) === month;
    })
    .reduce((total, s) => total + (s.minutes || 0), 0);
}

function formatMinutes(totalMinutes) {
  if (totalMinutes === 0) return '0m';
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

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

let calendarMode = 'month';
let calendarDate = new Date();

function renderLearningProgressCalendar() {
  const container = $('learning-calendar');
  if (!container) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth() + 1;

  const stats = getMonthStats(year, month);
  const totalMinutes = getTotalMinutesForMonth(year, month);
  const totalDays = new Date(year, month, 0).getDate();
  const avgMinutesPerLearningDay = stats.daysLearned > 0 ? Math.round(totalMinutes / stats.daysLearned) : 0;

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

  let calendarGridHtml = '';
  if (calendarMode === 'month') {
    calendarGridHtml = renderMonthGrid(year, month);
  } else {
    calendarGridHtml = renderWeekView(year, month);
  }

  container.innerHTML = summaryHtml + controlsHtml + calendarGridHtml;

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

  document.querySelectorAll('.calendar-day').forEach(el => {
    el.addEventListener('click', () => {
      const dateStr = el.dataset.date;
      showDateDetailsModal(dateStr);
    });
  });
}

function renderMonthGrid(year, month) {
  const firstDay = new Date(year, month - 1, 1).getDay();
  const lastDay = new Date(year, month, 0).getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let html = '<div class="calendar-grid">';
  
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  dayNames.forEach(name => {
    html += `<div class="calendar-day-header">${name}</div>`;
  });

  for (let i = 0; i < firstDay; i++) {
    html += '<div class="calendar-day empty"></div>';
  }

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
    const progressPct = Math.min(minutes / 60 * 100, 100);

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

function renderWeekView(year, month) {
  const today = new Date();
  const weeks = [];
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);

  let currentDate = new Date(firstDay);
  currentDate.setDate(currentDate.getDate() - currentDate.getDay());

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

function initLearningCalendar() {
  calendarDate = new Date();
  calendarMode = 'month';
  renderLearningProgressCalendar();
}

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
function showPublicVideoWarningModal(onContinue) {
  const html = `
    <div class="modal-overlay" id="public-video-modal-overlay">
      <div class="modal-content">
        <div class="modal-header">
          <div class="modal-title">⚠️ Video must be public</div>
          <button class="modal-close" id="btn-close-public-modal">✕</button>
        </div>
        <div class="modal-body">
          <p style="margin-bottom:12px;">
            LearnLock can only read videos that are set to <strong>Public</strong> on YouTube.
            Private and unlisted videos will fail to load, even with a valid link.
          </p>
          <p style="margin-bottom:16px;">
            To check: open the video on YouTube, click below the player, and confirm
            it says <strong>Public</strong> — not Private or Unlisted.
          </p>
          <button class="btn-primary" id="btn-continue-public-modal">Got it, continue</button>
        </div>
      </div>
    </div>
  `;

  const modal = document.createElement('div');
  modal.innerHTML = html;
  document.body.appendChild(modal);

  const overlay = $('public-video-modal-overlay');
  const close = () => modal.remove();

  $('btn-close-public-modal').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  $('btn-continue-public-modal').addEventListener('click', () => {
    close();
    if (onContinue) onContinue();
  });

