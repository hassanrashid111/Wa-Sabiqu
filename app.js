/**
 * Wa Sabiqu - Ramadan Habit Tracker (V11 Firebase)
 * Eng Hassan Rashid
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    onAuthStateChanged,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    updateProfile
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    getFirestore,
    doc,
    setDoc,
    getDoc,
    onSnapshot,
    collection,
    query,
    orderBy,
    limit,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

/* --- Firebase Config --- */
const firebaseConfig = {
    apiKey: "AIzaSyBo_Sep6WTMTnQXg-maJYk-uz1tN9xgVDo",
    authDomain: "wa-sabiqu.firebaseapp.com",
    projectId: "wa-sabiqu",
    storageBucket: "wa-sabiqu.firebasestorage.app",
    messagingSenderId: "432042357",
    appId: "1:432042357:web:b2945e5efd5b42937ea33c"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

/* --- State --- */
const AppState = {
    categories: [],
    habits: [],
    days: [], // { id, label, habits: {}, reflection: "" }
    achievements: [], // strings of unlocked badge IDs
    totalDiamonds: 0, // NEW: Replaced totalTrophies
    isEditMode: false,
    user: null // Firebase User
};

/* --- Config --- */
const STORAGE_KEY = 'waSabiquData';
const DEFAULT_CATEGORIES = [
    { id: 'c_pray', name: 'الصلاة', color: 'bg-emerald-50 text-emerald-800' },
    { id: 'c_quran', name: 'القرآن', color: 'bg-amber-50 text-amber-800' },
    { id: 'c_hadith', name: 'الحديث', color: 'bg-blue-50 text-blue-800' },
    { id: 'c_azkar', name: 'الذكر', color: 'bg-purple-50 text-purple-800' }
];

/* --- Badges Definition --- */
const BADGES = [
    {
        id: 'starter_1_day',
        title: 'بداية الغيث',
        desc: 'إتمام يوم واحد كامل بنسبة 100%',
        icon: 'fa-solid fa-droplet',
        color: 'text-blue-500'
    },
    // We can add more Diamond-related badges later
];

/* --- Global State --- */
let currentOpenDayIndex = null;
let unsubscribeDoc = null; // Firestore listener unsubscription

/* --- Init --- */
document.addEventListener('DOMContentLoaded', () => {
    // Check which page we are on
    if (document.getElementById('daysBody')) {
        // Main Tracker Page
        initTrackerApp();
    } else {
        // Auth Pages (Login/Signup)
        setupAuthPageEvents();
    }
});

function initTrackerApp() {
    // Initial Load (Local Fallback)
    loadDataLocal();
    loadTheme();
    renderApp();
    setupEvents();

    // Auth Listener
    onAuthStateChanged(auth, (user) => {
        if (user) {
            AppState.user = user;
            loadDataCloud(user.uid);
        } else {
            AppState.user = null;
            if (unsubscribeDoc) unsubscribeDoc();
            loadDataLocal(); // Revert to local
        }
        renderAuthUI();
    });
}

function setupAuthPageEvents() {
    // Login Form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    // Signup Form
    const signupForm = document.getElementById('signupForm');
    if (signupForm) {
        signupForm.addEventListener('submit', handleSignup);
    }

    // Google Login Buttons (on login/signup pages)
    const googleBtns = document.querySelectorAll('.google-login-btn');
    googleBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            loginWithGoogle();
        });
    });
}

/* --- Data Layer (Cloud & Local) --- */
function loadDataLocal() {
    const saved = localStorage.getItem(STORAGE_KEY);
    parseData(saved);
    renderApp();
}

async function loadDataCloud(uid) {
    const docRef = doc(db, "users", uid, "data", "trackerState");

    // Real-time listener for cloud changes
    unsubscribeDoc = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            parseData(JSON.stringify(data)); // Reuse parse logic
            renderApp();
        } else {
            saveData();
        }
    });
}

function parseData(jsonString) {
    if (jsonString) {
        const parsed = JSON.parse(jsonString);
        AppState.categories = parsed.categories || [...DEFAULT_CATEGORIES];
        AppState.habits = parsed.habits || [];
        AppState.days = parsed.days || [];
        AppState.achievements = parsed.achievements || [];
        // Handle Migration: totalTrophies -> totalDiamonds
        if (parsed.totalDiamonds !== undefined) {
            AppState.totalDiamonds = parsed.totalDiamonds;
        } else {
            // First time migration: Recalculate based on new logic
            // Or just reset to 0 if we want a fresh start logic. 
            // Let's recalculate based on existing data using the NEW logic.
            const stats = calculateDiamonds(parsed.days || [], parsed.habits || []);
            AppState.totalDiamonds = stats.total;
        }
    } else {
        // Fresh Start
        resetState();
    }
    updateBadgeCount();
}

function resetState() {
    AppState.categories = [...DEFAULT_CATEGORIES];
    AppState.habits = [];
    AppState.days = [];
    AppState.achievements = [];
    AppState.totalDiamonds = 0;
}

function saveData() {
    // 1. Save Local (Backup/Offline Cache)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(AppState));

    // 2. Save Cloud (If Logged In)
    if (AppState.user) {
        // Save detailed state
        const docRef = doc(db, "users", AppState.user.uid, "data", "trackerState");
        const dataToSave = {
            categories: AppState.categories,
            habits: AppState.habits,
            days: AppState.days,
            achievements: AppState.achievements,
            totalDiamonds: AppState.totalDiamonds
        };
        setDoc(docRef, dataToSave, { merge: true })
            .catch((e) => console.error("Cloud save failed", e));

        // Sync HIGH-LEVEL stats to the User Doc for Leaderboard
        const userDocRef = doc(db, "users", AppState.user.uid);
        setDoc(userDocRef, {
            totalDiamonds: AppState.totalDiamonds,
            lastUpdated: new Date()
        }, { merge: true });
    }
}

/* --- Auth Actions --- */
function loginWithGoogle() {
    signInWithPopup(auth, provider)
        .then((result) => {
            console.log("Google Login Success:", result.user);
            const userRef = doc(db, "users", result.user.uid);
            getDoc(userRef).then((snap) => {
                if (!snap.exists()) {
                    setDoc(userRef, {
                        displayName: result.user.displayName,
                        email: result.user.email,
                        photoURL: result.user.photoURL,
                        totalDiamonds: 0,
                        createdAt: new Date()
                    });
                }
            });
            if (!window.location.pathname.endsWith('index.html') && window.location.pathname !== '/') {
                window.location.href = 'index.html';
            }
        })
        .catch((error) => {
            console.error(error);
            alert("فشل تسجيل الدخول: " + error.message);
        });
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const btn = e.target.querySelector('button[type="submit"]');

    const originalText = btn.innerText;
    btn.innerText = 'جاري التحميل...';
    btn.disabled = true;

    try {
        await signInWithEmailAndPassword(auth, email, password);
        window.location.href = 'index.html';
    } catch (error) {
        alert("خطأ في تسجيل الدخول: " + error.message);
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

async function handleSignup(e) {
    e.preventDefault();
    const fullname = document.getElementById('fullname').value;
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const btn = e.target.querySelector('button[type="submit"]');

    const originalText = btn.innerText;
    btn.innerText = 'جاري إنشاء الحساب...';
    btn.disabled = true;

    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        await updateProfile(user, { displayName: fullname });

        // Create User Doc (Root)
        await setDoc(doc(db, "users", user.uid), {
            displayName: fullname,
            email: email,
            photoURL: user.photoURL || null,
            totalDiamonds: 0,
            createdAt: new Date()
        });

        // Initialize Empty State
        await setDoc(doc(db, "users", user.uid, "data", "trackerState"), {
            categories: [...DEFAULT_CATEGORIES],
            habits: [],
            days: [],
            achievements: [],
            totalDiamonds: 0
        });

        window.location.href = 'index.html';
    } catch (error) {
        alert("خطأ في إنشاء الحساب: " + error.message);
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

function logoutApp() {
    if (confirm('هل أنت متأكد من تسجيل الخروج؟')) {
        signOut(auth).then(() => window.location.reload());
    }
}

// Expose to window for UI
window.loginWithGoogle = loginWithGoogle;
window.logoutApp = logoutApp;

/* --- UI Rendering --- */
function renderAuthUI() {
    // Header Auth Container (Hidden on mobile or just icon?)
    // Actually sidebar handles it now for mobile. 
    // Let's keep specific logic for Sidebar Profile Injection called 'sidebarProfileContainer'

    // 1. Sidebar Profile
    const sidebarProfile = document.getElementById('sidebarProfileContainer');
    if (sidebarProfile) {
        if (AppState.user) {
            const photo = AppState.user.photoURL || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(AppState.user.displayName || 'User') + '&background=0D9488&color=fff';
            sidebarProfile.innerHTML = `
               <img src="${photo}" class="w-16 h-16 rounded-full border-4 border-white/10 mb-3 shadow-lg object-cover" alt="User">
               <h3 class="text-white font-serif font-bold text-lg">${AppState.user.displayName}</h3>
               <button onclick="logoutApp()" class="text-xs text-red-300 hover:text-red-100 font-bold mt-2 border border-red-500/30 px-3 py-1 rounded-full bg-red-500/10 transition-colors">
                   <i class="fa-solid fa-right-from-bracket"></i> تسجيل الخروج
               </button>
            `;
        } else {
            sidebarProfile.innerHTML = `
               <div class="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mb-3 border-2 border-white/5 border-dashed text-white/30">
                   <i class="fa-solid fa-user text-2xl"></i>
               </div>
               <div class="flex flex-col gap-2 w-full px-8">
                   <a href="login.html" class="w-full bg-ramadan-gold text-ramadan-dark text-center py-2 rounded-lg font-bold text-sm hover:bg-yellow-500 transition-colors">دخول</a>
                   <a href="signup.html" class="w-full bg-white/10 text-white text-center py-2 rounded-lg font-bold text-sm hover:bg-white/20 transition-colors">حساب جديد</a>
               </div>
            `;
        }
    }

    // 2. Header Mini Auth (Optional, usually hidden if using drawer OR shown as mini icon)
    // We kept 'authContainer' in header. Let's update it to be just a mini avatar or hidden on small screens?
    const container = document.getElementById('authContainer');
    if (!container) return;

    // Only show on Desktop? Or keep consistent.
    if (AppState.user) {
        const photo = AppState.user.photoURL || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(AppState.user.displayName || 'User') + '&background=0D9488&color=fff';
        container.innerHTML = `
            <div class="hidden md:flex items-center gap-2 bg-emerald-800/50 rounded-full pr-1 pl-3 py-1 border border-emerald-600/30 cursor-pointer" onclick="toggleSidebar()">
                <img src="${photo}" class="w-8 h-8 rounded-full border-2 border-amber-300" alt="User">
                <span class="text-xs text-emerald-100 font-bold truncate max-w-[80px]">${AppState.user.displayName}</span>
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="hidden md:flex gap-2">
                <a href="login.html" class="bg-ramadan-gold text-ramadan-dark px-3 py-1.5 rounded-lg text-sm font-bold hover:bg-yellow-500 transition-colors flex items-center gap-2 shadow-sm">
                    <span>دخول</span>
                </a>
            </div>
        `;
    }
}

/* --- Actions --- */
function addDay() {
    const nextNum = AppState.days.length + 1;
    const newDay = {
        id: Date.now(),
        label: `اليوم ${nextNum}`,
        habits: {},
        reflection: ""
    };
    AppState.days.push(newDay);
    saveData();
    renderRows();

    setTimeout(() => {
        const wrapper = document.getElementById('gridWrapper');
        if (wrapper) wrapper.scrollTo({ top: wrapper.scrollHeight, behavior: 'smooth' });
    }, 100);
}

function deleteDay(index) {
    confirmAction('هل أنت متأكد من حذف هذا اليوم؟', () => {
        AppState.days.splice(index, 1);
        recalculateAllDiamonds(); // Simplified recalculation
        checkAchievements();
        saveData();
        renderApp();
    });
}
window.deleteDay = deleteDay;

function addCategory(name) {
    const id = 'c_' + Date.now();
    AppState.categories.push({ id, name, color: 'bg-gray-50 text-gray-700' });
    saveData();
    renderApp();
}

function addHabit(name, categoryId) {
    const id = 'h_' + Date.now();
    AppState.habits.push({ id, name, categoryId });
    saveData();
    renderApp();
}

function deleteHabit(habitId) {
    confirmAction('هل أنت متأكد من حذف هذه العادة؟ سيتم مسح كافة بياناتها المسجلة', () => {
        AppState.habits = AppState.habits.filter(h => h.id !== habitId);

        AppState.days.forEach(day => {
            if (day.habits[habitId]) delete day.habits[habitId];
        });

        recalculateAllDiamonds();
        checkAchievements();
        saveData();
        renderApp();
    });
}
window.deleteHabit = deleteHabit;

function toggleHabit(dayIndex, habitId) {
    if (dayIndex < 0 || dayIndex >= AppState.days.length) return;

    const day = AppState.days[dayIndex];

    // Toggle
    if (day.habits[habitId]) {
        delete day.habits[habitId];
    } else {
        day.habits[habitId] = true;
    }

    // NEW DIAMOND LOGIC
    const totalHabits = AppState.habits.length;
    const completedHabits = Object.keys(day.habits).length;

    // Recalculate Total Diamonds
    const oldDiamonds = AppState.totalDiamonds;
    const stats = calculateDiamonds(AppState.days, AppState.habits);
    AppState.totalDiamonds = stats.total;

    // Check for NEW Diamond earned just now
    if (AppState.totalDiamonds > oldDiamonds) {
        showTrophyToast(`أحسنت! أتممت جميع عادات هذا اليوم!`);
    }

    checkAchievements();
    saveData();

    // --- OPTIMIZED UI UPDATE (No Full Re-render) ---
    // 1. Update Header Count
    const trophyDisplay = document.getElementById('trophyCountDisplay');
    if (trophyDisplay) trophyDisplay.innerText = AppState.totalDiamonds;

    // 2. Find and Update the Specific Habit Cell
    const tbody = document.getElementById('daysBody');
    if (!tbody) return;

    const row = tbody.children[dayIndex];
    if (!row) { renderRows(); return; } // Fallback if row not found (shouldn't happen)

    // Find the cell. Logic: First cell is DayLabel. Habits follow order of AppState.categories -> catHabits
    let cellIndex = 1; // Start after Day Label
    let found = false;

    for (const cat of AppState.categories) {
        const catHabits = AppState.habits.filter(h => h.categoryId === cat.id);
        for (const habit of catHabits) {
            if (habit.id === habitId) {
                found = true;
                break;
            }
            cellIndex++; // Only increment if we didn't find it yet
        }
        if (found) break;
    }

    if (found) {
        const cell = row.children[cellIndex];
        if (cell) {
            const isDone = !!day.habits[habitId];
            cell.className = `p-0 border-l border-b border-gray-100 text-center cursor-pointer transition-all duration-200 ${isDone ? 'bg-emerald-50' : ''}`;
            cell.setAttribute('data-label', getHabitName(habitId));

            let iconHtml = '<div class="w-2 h-2 rounded-full bg-gray-200 group-hover:bg-gray-300 pointer-events-none"></div>';
            if (isDone) {
                iconHtml = '<i class="fa-solid fa-check text-emerald-500 text-xl animate-bounce pointer-events-none"></i>';
            }

            cell.innerHTML = `
               <div class="h-14 flex items-center justify-center relative pointer-events-none">
                    ${iconHtml}
               </div>
            `;
        }
    }

    // 3. Update Day Label Cell (for Diamond Glow/Icon)
    const dayCell = row.children[0];
    if (dayCell) {
        const isDiamondDay = (completedHabits === totalHabits && totalHabits > 0);
        const dayClass = isDiamondDay ? 'bg-emerald-50/50' : '';
        // Note: We need to preserve the base classes and just toggle the highlight
        dayCell.className = `p-4 sticky-col text-center font-bold text-ramadan-dark border-b border-gray-200 group-hover:bg-gray-50 cursor-context-menu ${dayClass}`;

        const hasReflection = day.reflection && day.reflection.length > 0;
        const deleteClass = AppState.isEditMode
            ? 'opacity-100 text-red-600 right-2'
            : 'opacity-0 group-hover/day:opacity-100 text-red-400 hover:text-red-600 right-2';

        dayCell.innerHTML = `
            <div class="flex flex-col items-center relative group/day">
                <span class="font-serif text-lg">${day.label}</span>
                <div class="flex items-center gap-1 mt-1">
                    <span class="text-[10px] text-gray-400 font-normal">Day ${dayIndex + 1}</span>
                    ${hasReflection ? `<i class="fa-solid fa-feather text-ramadan-gold text-xs animate-pulse pointer-events-none" title="يوجد خاطرة"></i>` : ''}
                    ${isDiamondDay ? `<i class="fa-solid fa-gem text-cyan-500 text-xs drop-shadow-sm" title="يوم ماسي"></i>` : ''}
                </div>
                <button class="absolute top-1/2 -translate-y-1/2 ${deleteClass} transition-all duration-200" title="حذف اليوم" onclick="event.stopPropagation(); deleteDay(${dayIndex})">
                    <i class="fa-solid fa-trash-can pointer-events-auto"></i>
                </button>
            </div>
        `;
    }
}

function recalculateAllDiamonds() {
    const stats = calculateDiamonds(AppState.days, AppState.habits);
    AppState.totalDiamonds = stats.total;
}

function saveReflection() {
    if (currentOpenDayIndex === null) return;

    const text = document.getElementById('reflectionInput').value.trim();
    AppState.days[currentOpenDayIndex].reflection = text;
    saveData();
    renderRows();

    const feedback = document.getElementById('saveFeedback');
    feedback.classList.remove('opacity-0');
    setTimeout(() => feedback.classList.add('opacity-0'), 2000);
}

function toggleEditMode() {
    AppState.isEditMode = !AppState.isEditMode;

    // Header Btn
    const btn = document.getElementById('toggleEditBtn');
    if (btn) {
        if (AppState.isEditMode) {
            btn.classList.add('bg-red-500', 'text-white', 'hover:bg-red-600');
            btn.classList.remove('bg-white/10', 'hover:bg-white/20');
            btn.querySelector('i').className = 'fa-solid fa-check text-lg';
        } else {
            btn.classList.remove('bg-red-500', 'hover:bg-red-600');
            btn.classList.add('bg-white/10', 'hover:bg-white/20');
            btn.querySelector('i').className = 'fa-solid fa-pen-to-square text-lg';
        }
    }

    // Sidebar Btn
    const sbBtn = document.getElementById('sidebarToggleEditBtn');
    if (sbBtn) {
        const span = sbBtn.querySelector('span:first-child');
        const text = sbBtn.querySelector('span:last-child');
        if (AppState.isEditMode) {
            span.classList.remove('group-hover:bg-red-500');
            span.classList.add('bg-red-500', 'text-white');
            text.textContent = 'إيقاف التعديل';
            text.classList.add('text-red-400');
        } else {
            span.classList.add('group-hover:bg-red-500');
            span.classList.remove('bg-red-500', 'text-white');
            text.textContent = 'وضع التعديل';
            text.classList.remove('text-red-400');
        }
    }

    renderApp();
}

function toggleDarkMode() {
    const html = document.documentElement;
    const isDark = html.classList.toggle('dark');
    localStorage.setItem('waSabiquTheme', isDark ? 'dark' : 'light');
    updateThemeIcon(isDark);
}

function updateThemeIcon(isDark) {
    const btn = document.getElementById('themeToggleBtn');
    if (btn) {
        btn.innerHTML = isDark ? '<i class="fa-solid fa-sun text-lg text-yellow-300"></i>' : '<i class="fa-solid fa-moon text-lg text-gray-200"></i>';
    }
}

function loadTheme() {
    const saved = localStorage.getItem('waSabiquTheme');
    if (saved === 'dark') {
        document.documentElement.classList.add('dark');
        updateThemeIcon(true);
    } else {
        updateThemeIcon(false);
    }
}
window.toggleDarkMode = toggleDarkMode;

/* --- Modal Logic --- */
let confirmCallback = null;

function confirmAction(message, onConfirm) {
    const msgEl = document.getElementById('deleteModalMessage');
    const modal = document.getElementById('deleteConfirmModal');
    if (msgEl && modal) {
        msgEl.textContent = message;
        modal.classList.remove('hidden');
        confirmCallback = onConfirm;
    } else {
        if (confirm(message)) onConfirm();
    }
}

window.closeDeleteConfirm = function () {
    const modal = document.getElementById('deleteConfirmModal');
    if (modal) modal.classList.add('hidden');
    confirmCallback = null;
}


/* --- Logic --- */
function getHabitName(id) {
    const h = AppState.habits.find(x => x.id === id);
    return h ? h.name : 'عادة';
}

function calculateDiamonds(days, habits) {
    let count = 0;
    if (habits.length === 0) return { total: 0 };

    days.forEach(day => {
        const doneCount = Object.keys(day.habits).length;
        if (doneCount === habits.length && doneCount > 0) {
            count++;
        }
    });
    return { total: count };
}

function checkAchievements() {
    let newUnlock = false;
    let unlockedBadge = null;
    const getProgress = (day) => !day || AppState.habits.length === 0 ? 0 : Object.keys(day.habits).length / AppState.habits.length;

    if (!AppState.achievements.includes('starter_1_day')) {
        if (AppState.days.some(d => getProgress(d) === 1)) {
            unlockBadge('starter_1_day');
            newUnlock = true;
            unlockedBadge = BADGES.find(b => b.id === 'starter_1_day');
        }
    }

    if (newUnlock && unlockedBadge) triggerCelebration(unlockedBadge);
}

function unlockBadge(id) {
    AppState.achievements.push(id);
    saveData();
    updateBadgeCount();
}

/* --- UI Helpers --- */

// Visual Hint Logic (Optional: Can render a faint diamond if 1 habit remains?)
function isDiamondHint(dayIndex) {
    // Logic: If user is missing only 1 habit to get a diamond? 
    // For now, let's keep simple.
    return false;
}

function showTrophyToast(msg) {
    const toast = document.getElementById('trophyToast');
    const msgEl = document.getElementById('trophyToastMessage');

    if (toast && msgEl) {
        msgEl.textContent = msg;
        toast.classList.remove('translate-y-20', 'opacity-0');
        toast.classList.add('trophy-toast-visible');

        setTimeout(() => {
            toast.classList.remove('trophy-toast-visible');
            toast.classList.add('translate-y-20', 'opacity-0');
        }, 4000);
    }
}

function triggerCelebration(badge) {
    if (typeof confetti === 'function') {
        const count = 200;
        const defaults = { origin: { y: 0.7 } };
        function fire(particleRatio, opts) {
            confetti(Object.assign({}, defaults, opts, { particleCount: Math.floor(count * particleRatio) }));
        }
        fire(0.25, { spread: 26, startVelocity: 55 });
    }

    const modal = document.getElementById('celebrationModal');
    const content = document.getElementById('celebrationContent');
    const text = document.getElementById('celebrationText');

    if (modal && content && text) {
        text.textContent = `مبارك! نلت ${badge.title} لإتمامك الإنجاز المطلوب.`;
        modal.classList.remove('hidden', 'pointer-events-none');
        setTimeout(() => { content.classList.remove('scale-0'); content.classList.add('scale-110'); setTimeout(() => content.classList.add('scale-100'), 150); }, 10);
    }
}

function closeCelebration() {
    const modal = document.getElementById('celebrationModal');
    const content = document.getElementById('celebrationContent');
    if (content) content.classList.add('scale-0');
    if (modal) setTimeout(() => { modal.classList.add('hidden', 'pointer-events-none'); }, 300);
}

function updateBadgeCount() {
    const el = document.getElementById('badgeCount');
    if (el) {
        const count = AppState.achievements.length;
        if (count > 0) { el.textContent = count; el.classList.remove('hidden'); }
        else { el.classList.add('hidden'); }
    }
}

/* --- Rendering --- */
function renderApp() {
    renderHeaders();
    renderRows();
    const trophyDisplay = document.getElementById('trophyCountDisplay');
    if (trophyDisplay) trophyDisplay.innerText = AppState.totalDiamonds;
}

function renderHeaders() {
    const catRow = document.getElementById('categoryHeaderRow');
    const habitRow = document.getElementById('habitHeaderRow');
    if (!catRow || !habitRow) return;

    navRemoveSiblings(catRow.firstElementChild);
    navRemoveSiblings(habitRow.firstElementChild);

    AppState.categories.forEach(cat => {
        const catHabits = AppState.habits.filter(h => h.categoryId === cat.id);
        if (catHabits.length === 0) return;

        const thCat = document.createElement('th');
        thCat.colSpan = catHabits.length;
        thCat.className = `p-3 text-center border-l border-b border-gray-200 text-sm font-bold font-serif ${cat.color}`;
        thCat.textContent = cat.name;
        catRow.appendChild(thCat);

        catHabits.forEach(habit => {
            const thHabit = document.createElement('th');
            thHabit.className = 'group p-3 min-w-[100px] text-center border-l border-gray-100 text-xs font-semibold text-gray-600 relative hover:bg-gray-50 transition-colors';

            const deleteClass = AppState.isEditMode
                ? 'opacity-100 text-red-600 scale-100'
                : 'opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600';

            const div = document.createElement('div');
            div.className = 'flex items-center justify-center gap-2';
            div.innerHTML = `
                <span>${habit.name}</span>
                <button class="${deleteClass} transition-all duration-200" title="حذف العادة" onclick="deleteHabit('${habit.id}')">
                    <i class="fa-solid fa-trash-can shadow-sm pointer-events-auto"></i>
                </button>
            `;

            thHabit.appendChild(div);
            habitRow.appendChild(thHabit);
        });
    });
}

function renderRows() {
    const tbody = document.getElementById('daysBody');
    if (!tbody) return;

    tbody.innerHTML = '';
    const emptyState = document.getElementById('emptyState');
    if (AppState.days.length === 0) {
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }
    if (emptyState) emptyState.classList.add('hidden');

    AppState.days.forEach((day, index) => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50 transition-colors group';

        const isDiamondDay = (Object.keys(day.habits).length === AppState.habits.length && AppState.habits.length > 0);

        const tdDay = document.createElement('td');
        // Add special glow if diamond day
        const dayClass = isDiamondDay ? 'bg-emerald-50/50' : '';
        tdDay.className = `p-4 sticky-col text-center font-bold text-ramadan-dark border-b border-gray-200 group-hover:bg-gray-50 cursor-context-menu ${dayClass}`;
        const hasReflection = day.reflection && day.reflection.length > 0;

        const deleteClass = AppState.isEditMode
            ? 'opacity-100 text-red-600 right-2'
            : 'opacity-0 group-hover/day:opacity-100 text-red-400 hover:text-red-600 right-2';

        tdDay.innerHTML = `
            <div class="flex flex-col items-center relative group/day">
                <span class="font-serif text-lg">${day.label}</span>
                <div class="flex items-center gap-1 mt-1">
                    <span class="text-[10px] text-gray-400 font-normal">Day ${index + 1}</span>
                    ${hasReflection ? `<i class="fa-solid fa-feather text-ramadan-gold text-xs animate-pulse pointer-events-none" title="يوجد خاطرة"></i>` : ''}
                    ${isDiamondDay ? `<i class="fa-solid fa-gem text-cyan-500 text-xs drop-shadow-sm" title="يوم ماسي"></i>` : ''}
                </div>
                <button class="absolute top-1/2 -translate-y-1/2 ${deleteClass} transition-all duration-200" title="حذف اليوم" onclick="event.stopPropagation(); deleteDay(${index})">
                    <i class="fa-solid fa-trash-can pointer-events-auto"></i>
                </button>
            </div>
        `;
        tdDay.addEventListener('contextmenu', (e) => { e.preventDefault(); openDayDetails(index); });
        tdDay.addEventListener('click', () => { if (window.innerWidth < 1024) openDayDetails(index); });
        tr.appendChild(tdDay);

        AppState.categories.forEach(cat => {
            const catHabits = AppState.habits.filter(h => h.categoryId === cat.id);
            catHabits.forEach(habit => {
                const td = document.createElement('td');
                const isDone = !!day.habits[habit.id];

                td.className = `p-0 border-l border-b border-gray-100 text-center cursor-pointer transition-all duration-200 ${isDone ? 'bg-emerald-50' : ''}`;
                // MOBILE: Add Data Label
                td.setAttribute('data-label', habit.name);

                td.onclick = (e) => {
                    toggleHabit(index, habit.id);
                };

                let iconHtml = '<div class="w-2 h-2 rounded-full bg-gray-200 group-hover:bg-gray-300 pointer-events-none"></div>';

                if (isDone) {
                    iconHtml = '<i class="fa-solid fa-check text-emerald-500 text-xl animate-bounce pointer-events-none"></i>';
                }

                td.innerHTML = `
                   <div class="h-14 flex items-center justify-center relative pointer-events-none">
                        ${iconHtml}
                   </div>
                `;
                tr.appendChild(td);
            });
        });

        tbody.appendChild(tr);
    });
}

// ... (Rest of UI/Modal functions same as before) ...
function openDayDetails(dayIndex) { /* ... (Same) ... */
    const day = AppState.days[dayIndex];
    if (!day) return;
    currentOpenDayIndex = dayIndex;
    const modal = document.getElementById('dayDetailsModal');
    const totalHabits = AppState.habits.length || 1;
    const completedHabits = Object.keys(day.habits).length;
    const percent = Math.round((completedHabits / totalHabits) * 100);
    document.getElementById('detailsDayLabel').textContent = day.label;
    document.getElementById('detailsPercentage').textContent = `${percent}%`;
    document.getElementById('detailsProgressBar').style.width = `${percent}%`;
    document.getElementById('reflectionInput').value = day.reflection || "";
    const completedList = document.getElementById('detailsCompletedList');
    const pendingList = document.getElementById('detailsPendingList');
    completedList.innerHTML = ''; pendingList.innerHTML = '';
    AppState.habits.forEach(h => {
        const li = document.createElement('li'); li.textContent = h.name;
        if (day.habits[h.id]) completedList.appendChild(li); else pendingList.appendChild(li);
    });
    modal.classList.remove('hidden');
    setTimeout(() => { modal.classList.remove('opacity-0'); modal.querySelector('#dayDetailsContent').classList.remove('scale-95'); modal.querySelector('#dayDetailsContent').classList.add('scale-100'); }, 10);
}
function renderAchievementsModal() {
    const grid = document.getElementById('achievementsGrid');
    if (!grid) return;
    grid.innerHTML = '';
    BADGES.forEach(badge => {
        const isUnlocked = AppState.achievements.includes(badge.id);
        const card = document.createElement('div');
        card.className = `badge-card p-6 rounded-2xl border-2 flex flex-col items-center text-center ${isUnlocked ? 'badge-unlocked' : 'badge-locked border-gray-200 bg-gray-50'}`;
        card.innerHTML = `<div class="w-16 h-16 rounded-full flex items-center justify-center mb-4 ${isUnlocked ? 'bg-emerald-100' : 'bg-gray-200'}"><i class="${badge.icon} text-3xl ${isUnlocked ? badge.color : 'text-gray-400'}"></i></div><h4 class="font-bold font-serif text-lg mb-2 text-ramadan-dark">${badge.title}</h4><div class="text-xs text-gray-500 font-sans leading-relaxed">${badge.desc}</div>${isUnlocked ? '<div class="mt-3 text-[10px] font-bold text-amber-500"><i class="fa-solid fa-check"></i> تم الحصول عليه</div>' : '<div class="mt-3 text-[10px] text-gray-400"><i class="fa-solid fa-lock"></i> مقفل</div>'}`;
        grid.appendChild(card);
    });
}
/* --- Leaderboard Logic --- */
async function fetchLeaderboard() {
    const modal = document.getElementById('leaderboardModal');
    const content = document.getElementById('leaderboardList');
    const loading = document.getElementById('leaderboardLoading');

    if (modal) modal.classList.remove('hidden');
    if (loading) loading.classList.remove('hidden');
    if (content) content.innerHTML = '';

    try {
        const q = query(collection(db, "users"), orderBy("totalDiamonds", "desc"), limit(20));
        const querySnapshot = await getDocs(q);
        const users = [];
        querySnapshot.forEach((doc) => {
            users.push({ id: doc.id, ...doc.data() });
        });
        renderLeaderboard(users);
    } catch (error) {
        console.error("Error fetching leaderboard:", error);
        if (content) content.innerHTML = `<div class="text-center text-red-500 p-4">فشل تحميل المتصدرين</div>`;
    } finally {
        if (loading) loading.classList.add('hidden');
    }
}

function renderLeaderboard(users) {
    const list = document.getElementById('leaderboardList');
    if (!list) return;

    list.innerHTML = '';

    if (users.length === 0) {
        list.innerHTML = `<div class="text-center text-gray-500 p-6 font-serif">لا يوجد متسابقون بعد. كن الأول!</div>`;
        return;
    }

    users.forEach((user, index) => {
        const rank = index + 1;
        const isCurrentUser = AppState.user && AppState.user.uid === user.id;

        let rankIcon = `<span class="font-bold text-gray-500 w-6 text-center">${rank}</span>`;
        let borderClass = 'border-gray-100';
        let bgClass = isCurrentUser ? 'bg-emerald-50 border-emerald-200' : 'bg-white';

        if (rank === 1) {
            rankIcon = `<i class="fa-solid fa-crown text-yellow-400 text-xl drop-shadow-sm"></i>`;
            borderClass = 'border-yellow-200';
            if (!isCurrentUser) bgClass = 'bg-yellow-50/30';
        } else if (rank === 2) {
            rankIcon = `<i class="fa-solid fa-medal text-gray-400 text-xl"></i>`;
            borderClass = 'border-gray-300';
        } else if (rank === 3) {
            rankIcon = `<i class="fa-solid fa-medal text-amber-700 text-xl"></i>`;
            borderClass = 'border-amber-200';
        }

        const photo = user.photoURL || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.displayName || 'User') + '&background=random';

        const item = document.createElement('div');
        item.className = `flex items-center gap-3 p-3 rounded-xl border ${borderClass} ${bgClass} transition-transform hover:scale-[1.01]`;
        item.innerHTML = `
            <div class="flex-shrink-0 w-8 flex justify-center">${rankIcon}</div>
            <img src="${photo}" class="w-10 h-10 rounded-full border border-gray-200 object-cover" alt="${user.displayName}">
            <div class="flex-grow min-w-0">
                <h4 class="font-bold text-gray-800 truncate font-serif ${isCurrentUser ? 'text-emerald-700' : ''}">
                    ${user.displayName || 'مستخدم مجهول'}
                    ${isCurrentUser ? '<span class="text-[10px] bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded mr-1">أنت</span>' : ''}
                </h4>
            </div>
            <div class="flex items-center gap-1 bg-white/50 px-2 py-1 rounded-lg border border-gray-100">
                <span class="font-bold text-cyan-600 font-sans">${user.totalDiamonds || 0}</span>
                <i class="fa-solid fa-gem text-cyan-400 text-xs"></i>
            </div>
        `;
        list.appendChild(item);
    });
}

function setupEvents() {
    const addDayBtn = document.getElementById('addDayBtn');
    if (addDayBtn) addDayBtn.addEventListener('click', addDay);

    const catModal = document.getElementById('categoryModal');
    const addCatBtn = document.getElementById('addCategoryBtn');
    if (addCatBtn) addCatBtn.addEventListener('click', () => catModal.classList.remove('hidden'));

    const saveCatBtn = document.getElementById('saveCategoryBtn');
    if (saveCatBtn) saveCatBtn.addEventListener('click', () => { const name = document.getElementById('newCategoryInput').value.trim(); if (name) { addCategory(name); document.getElementById('newCategoryInput').value = ''; catModal.classList.add('hidden'); } });

    const habitModal = document.getElementById('habitModal');
    const habitSelect = document.getElementById('newHabitCategorySelect');
    const addHabitBtn = document.getElementById('addHabitBtn');
    if (addHabitBtn) addHabitBtn.addEventListener('click', () => { habitSelect.innerHTML = AppState.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join(''); habitModal.classList.remove('hidden'); });

    const saveHabitBtn = document.getElementById('saveHabitBtn');
    if (saveHabitBtn) saveHabitBtn.addEventListener('click', () => { const name = document.getElementById('newHabitInput').value.trim(); const catId = habitSelect.value; if (name && catId) { addHabit(name, catId); document.getElementById('newHabitInput').value = ''; habitModal.classList.add('hidden'); } });

    const saveReflectBtn = document.getElementById('saveReflectionBtn');
    if (saveReflectBtn) saveReflectBtn.addEventListener('click', saveReflection);

    document.querySelectorAll('.close-modal').forEach(btn => { btn.addEventListener('click', (e) => { const modal = e.target.closest('.fixed'); closeModalAnimation(modal); }); });

    const showChartBtn = document.getElementById('showChartBtn');
    if (showChartBtn) showChartBtn.addEventListener('click', showChart);

    const showBadgeBtn = document.getElementById('showAchievementsBtn');
    if (showBadgeBtn) showBadgeBtn.addEventListener('click', () => { renderAchievementsModal(); document.getElementById('achievementsModal').classList.remove('hidden'); });

    // Leaderboard Btn
    const leaderboardBtn = document.getElementById('showLeaderboardBtn');
    if (leaderboardBtn) leaderboardBtn.addEventListener('click', fetchLeaderboard);

    // Theme Btn
    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) themeBtn.addEventListener('click', toggleDarkMode);

    const exportImgBtn = document.getElementById('exportImageBtn');
    if (exportImgBtn) exportImgBtn.addEventListener('click', exportToImage);

    // Global Expose
    window.fetchLeaderboard = fetchLeaderboard;
    window.renderRows = renderRows; // Expose for fallback logic
    // NEW EVENTS
    const toggleEdit = document.getElementById('toggleEditBtn');
    if (toggleEdit) toggleEdit.addEventListener('click', toggleEditMode);

    const confirmDelete = document.getElementById('confirmDeleteBtn');
    if (confirmDelete) confirmDelete.addEventListener('click', () => {
        if (confirmCallback) { confirmCallback(); window.closeDeleteConfirm(); }
    });
}
function closeModalAnimation(modal) { modal.classList.add('opacity-0'); const content = modal.querySelector('div[class*="scale"]'); if (content) { content.classList.add('scale-95'); content.classList.remove('scale-100'); } setTimeout(() => modal.classList.add('hidden'), 300); }
function navRemoveSiblings(node) { while (node && node.nextSibling) { node.nextSibling.remove(); } }
async function prepareCaptureArea() { /* ... (Same) ... */ const originalContainer = document.getElementById('captureArea'); const reflectionsDiv = document.createElement('div'); reflectionsDiv.id = 'export-reflections'; reflectionsDiv.className = 'p-6 bg-white border-t border-gray-200 mt-4'; reflectionsDiv.innerHTML = `<h3 class="text-2xl font-serif text-ramadan-dark mb-4 border-b pb-2">سجل الخواطر</h3>`; const daysWithReflections = AppState.days.filter(d => d.reflection && d.reflection.trim() !== ""); if (daysWithReflections.length > 0) { const list = document.createElement('div'); list.className = 'space-y-4'; daysWithReflections.forEach(d => { list.innerHTML += `<div class="bg-gray-50 p-4 rounded-lg border-r-4 border-ramadan-gold"><h4 class="font-bold text-gray-700 font-serif text-lg">${d.label}</h4><p class="font-hand text-xl text-gray-600 mt-2 leading-relaxed">${d.reflection}</p></div>`; }); reflectionsDiv.appendChild(list); } else { reflectionsDiv.innerHTML += `<p class="text-gray-400 font-serif">لا توجد خواطر مسجلة.</p>`; } originalContainer.appendChild(reflectionsDiv); return reflectionsDiv; }
async function exportToImage() { const element = document.getElementById('captureArea'); if (!element) return; const addedElement = await prepareCaptureArea(); try { const canvas = await html2canvas(element, { scale: 2 }); const link = document.createElement('a'); link.download = 'wa-sabiqu-tracker.png'; link.href = canvas.toDataURL(); link.click(); } catch (err) { alert('Export failed'); } finally { addedElement.remove(); } }
async function exportToPDF() { const element = document.getElementById('captureArea'); if (!element) return; const addedElement = await prepareCaptureArea(); try { const canvas = await html2canvas(element, { scale: 2 }); const imgData = canvas.toDataURL('image/png'); const { jsPDF } = window.jspdf; const pdf = new jsPDF('p', 'mm', 'a4'); const pdfWidth = pdf.internal.pageSize.getWidth(); const pdfHeight = (canvas.height * pdfWidth) / canvas.width; pdf.addImage(imgData, 'PNG', 0, 10, pdfWidth, pdfHeight); pdf.save('wa-sabiqu-tracker.pdf'); } catch (err) { alert('Export failed'); } finally { addedElement.remove(); } }
let myChart = null;
function showChart() { /* ... (Same) ... */ document.getElementById('chartModal').classList.remove('hidden'); const ctx = document.getElementById('mainChart').getContext('2d'); const labels = AppState.days.map(d => d.label); const data = AppState.days.map(d => { const total = AppState.habits.length; if (total === 0) return 0; const done = Object.keys(d.habits).length; return Math.round((done / total) * 100); }); if (myChart) myChart.destroy(); myChart = new Chart(ctx, { type: 'line', data: { labels: labels, datasets: [{ label: 'نسبة الإنجاز %', data: data, borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.2)', borderWidth: 2, fill: true, tension: 0.3 }] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100 } } } }); }
