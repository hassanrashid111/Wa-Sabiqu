/**
 * Wa Sabiqu - Ramadan Habit Tracker (V12 Refactored)
 * Eng Hassan Rashid
 * Refactored for Robustness & Modularity
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

/* --- 1. Services & Config --- */
const firebaseConfig = {
    apiKey: "AIzaSyBo_Sep6WTMTnQXg-maJYk-uz1tN9xgVDo",
    authDomain: "wa-sabiqu.firebaseapp.com",
    projectId: "wa-sabiqu",
    storageBucket: "wa-sabiqu.firebasestorage.app",
    messagingSenderId: "432042357",
    appId: "1:432042357:web:b2945e5efd5b42937ea33c"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

const STORAGE_KEY = 'waSabiquData';
const THEME_KEY = 'waSabiquTheme';

/* --- 2. State & Constants --- */
const DEFAULT_CATEGORIES = [
    { id: 'c_pray', name: 'الصلاة', color: 'bg-emerald-50 text-emerald-800' },
    { id: 'c_quran', name: 'القرآن', color: 'bg-amber-50 text-amber-800' },
    { id: 'c_hadith', name: 'الحديث', color: 'bg-blue-50 text-blue-800' },
    { id: 'c_azkar', name: 'الذكر', color: 'bg-purple-50 text-purple-800' }
];

const BADGES = [
    { id: 'starter_1_day', title: 'بداية الغيث', desc: 'إتمام يوم واحد كامل بنسبة 100%', icon: 'fa-solid fa-droplet', color: 'text-blue-500' },
    { id: 'week_streak', title: 'مثابرة أسبوع', desc: 'إتمام 7 أيام متتالية', icon: 'fa-solid fa-fire', color: 'text-orange-500' },
    { id: 'diamond_collector', title: 'جامع الماس', desc: 'جمع 10 ماسات', icon: 'fa-solid fa-gem', color: 'text-cyan-400' }
];

const AppState = {
    categories: [],
    habits: [],
    days: [],
    achievements: [],
    totalDiamonds: 0,
    isEditMode: false,
    user: null
};

let currentOpenDayIndex = null;
let unsubscribeDoc = null;
let myChart = null;

/* --- 3. DOM Helpers (Null Checks) --- */
const $ = (id) => document.getElementById(id);
const on = (id, event, handler) => {
    const el = $(id);
    if (el) el.addEventListener(event, handler);
};
const show = (id) => { const el = $(id); if (el) el.classList.remove('hidden'); };
const hide = (id) => { const el = $(id); if (el) el.classList.add('hidden'); };

/* --- 4. Initialization --- */
document.addEventListener('DOMContentLoaded', () => {
    const isTrackerPage = !!$('daysBody'); // Heuristic to check if we are on the main app page

    // Auth Listener
    onAuthStateChanged(auth, (user) => {
        if (user) {
            AppState.user = user;
            if (isTrackerPage) {
                loadDataCloud(user.uid);
            } else {
                // Redirect to tracker if on auth pages
                if (window.location.pathname.includes('login') || window.location.pathname.includes('signup')) {
                    window.location.href = 'index.html';
                }
            }
        } else {
            AppState.user = null;
            if (unsubscribeDoc) unsubscribeDoc();
            if (isTrackerPage) {
                // Strict Auth: Redirect to login
                window.location.href = 'login.html';
            }
        }
        renderAuthUI();
    });

    // Page Specific Init
    if (isTrackerPage) {
        initTracker();
    } else {
        initAuthPages();
    }
});

function initTracker() {
    loadTheme();
    // Setup Global Helpers for inline HTML calls
    window.toggleSidebar = toggleSidebar;
    window.openSidebar = openSidebar;
    window.closeSidebar = closeSidebar;
    window.closeDeleteConfirm = closeDeleteConfirm;
    window.deleteDay = deleteDay;
    window.deleteHabit = deleteHabit;
    window.fetchLeaderboard = fetchLeaderboard;
    window.addDay = addDay;
    window.renderAchievementsModal = renderAchievementsModal;
    window.showChart = showChart;
    window.logoutApp = logoutApp;

    // Event Listeners
    setupTrackerEvents();
}

function initAuthPages() {
    setupAuthEvents();
}

/* --- 5. Data Logic --- */
async function loadDataCloud(uid) {
    const docRef = doc(db, "users", uid, "data", "trackerState");
    unsubscribeDoc = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            parseData(docSnap.data());
        } else {
            // New User Setup
            resetState();
            saveData();
        }
        renderApp();
    }, (error) => {
        console.error("Data Load Error:", error);
    });
}

function parseData(data) {
    if (!data) return resetState();
    AppState.categories = data.categories || [...DEFAULT_CATEGORIES];
    AppState.habits = data.habits || [];
    AppState.days = data.days || [];
    AppState.achievements = data.achievements || [];

    // Migration Logic
    if (data.totalDiamonds !== undefined) {
        AppState.totalDiamonds = data.totalDiamonds;
    } else {
        const stats = calculateDiamonds(AppState.days, AppState.habits);
        AppState.totalDiamonds = stats.total;
    }
}

function resetState() {
    AppState.categories = [...DEFAULT_CATEGORIES];
    AppState.habits = [];
    AppState.days = [];
    AppState.achievements = [];
    AppState.totalDiamonds = 0;
}

function saveData() {
    if (!AppState.user) return;

    const docRef = doc(db, "users", AppState.user.uid, "data", "trackerState");
    const dataToSave = {
        categories: AppState.categories,
        habits: AppState.habits,
        days: AppState.days,
        achievements: AppState.achievements,
        totalDiamonds: AppState.totalDiamonds
    };

    setDoc(docRef, dataToSave, { merge: true }).catch(console.error);

    // Sync Helper Doc for Leaderboard
    const userDocRef = doc(db, "users", AppState.user.uid);
    setDoc(userDocRef, {
        totalDiamonds: AppState.totalDiamonds,
        lastUpdated: new Date()
    }, { merge: true }).catch(console.error);
}

/* --- 6. Core Domain Logic --- */
function calculateDiamonds(days, habits) {
    let count = 0;
    if (!habits || habits.length === 0) return { total: 0 };

    days.forEach(day => {
        // Ensure habits object exists
        if (!day.habits) day.habits = {};
        const doneCount = Object.keys(day.habits).length;
        // Strict Check: completed all habits
        if (doneCount >= habits.length && habits.length > 0) {
            count++;
        }
    });
    return { total: count };
}

function checkAchievements() {
    let newUnlock = false;
    let unlockedBadge = null;

    // 1. Starter Badge
    if (!AppState.achievements.includes('starter_1_day')) {
        const hasPerfectDay = AppState.days.some(d => Object.keys(d.habits || {}).length >= AppState.habits.length && AppState.habits.length > 0);
        if (hasPerfectDay) {
            unlockBadge('starter_1_day');
            newUnlock = true;
            unlockedBadge = BADGES.find(b => b.id === 'starter_1_day');
        }
    }

    // 2. Diamond Collector
    if (!AppState.achievements.includes('diamond_collector') && AppState.totalDiamonds >= 10) {
        unlockBadge('diamond_collector');
        newUnlock = true;
        unlockedBadge = BADGES.find(b => b.id === 'diamond_collector');
    }

    if (newUnlock && unlockedBadge) triggerCelebration(unlockedBadge);
}

function unlockBadge(id) {
    if (!AppState.achievements.includes(id)) {
        AppState.achievements.push(id);
    }
}

/* --- 7. UI Actions --- */
function openSidebar() {
    const sidebar = $('sidebarDrawer');
    const overlay = $('sidebarOverlay');
    if (!sidebar || !overlay) return;
    show('sidebarOverlay');
    requestAnimationFrame(() => { // Ensure transition plays
        overlay.classList.add('opacity-100');
        sidebar.classList.remove('translate-x-full');
    });
}

function closeSidebar() {
    const sidebar = $('sidebarDrawer');
    const overlay = $('sidebarOverlay');
    if (!sidebar || !overlay) return;
    sidebar.classList.add('translate-x-full');
    overlay.classList.remove('opacity-100');
    setTimeout(() => hide('sidebarOverlay'), 300);
}

function toggleSidebar() {
    const sidebar = $('sidebarDrawer');
    if (!sidebar) return;
    if (sidebar.classList.contains('translate-x-full')) openSidebar();
    else closeSidebar();
}

function toggleEditMode() {
    AppState.isEditMode = !AppState.isEditMode;
    renderApp();
    // Update button states if they exist
    const btn = $('toggleEditBtn');
    if (btn) {
        if (AppState.isEditMode) {
            btn.classList.add('bg-red-500', 'text-white');
            btn.querySelector('i').className = 'fa-solid fa-check text-lg';
        } else {
            btn.classList.remove('bg-red-500', 'text-white');
            btn.querySelector('i').className = 'fa-solid fa-pen-to-square text-lg';
        }
    }
}

function toggleDarkMode() {
    const html = document.documentElement;
    const isDark = html.classList.toggle('dark');
    localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
    updateThemeIcon(isDark);
}

function updateThemeIcon(isDark) {
    const btn = $('themeToggleBtn');
    if (btn) btn.innerHTML = isDark ? '<i class="fa-solid fa-sun text-lg text-yellow-300"></i>' : '<i class="fa-solid fa-moon text-lg text-gray-200"></i>';
}

function loadTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark') {
        document.documentElement.classList.add('dark');
        updateThemeIcon(true);
    } else {
        updateThemeIcon(false);
    }
}

/* --- 8. Modals & Popups --- */
function showTrophyToast(msg) {
    const toast = $('trophyToast');
    const msgEl = $('trophyToastMessage');
    if (toast && msgEl) {
        msgEl.textContent = msg;
        toast.classList.remove('translate-y-20', 'opacity-0');
        setTimeout(() => toast.classList.add('translate-y-20', 'opacity-0'), 3000);
    }
}

function triggerCelebration(badge) {
    if (window.confetti) {
        window.confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
    }
    const modal = $('celebrationModal');
    const text = $('celebrationText');
    if (modal && text) {
        text.textContent = `مبارك! نلت ${badge.title}`;
        show('celebrationModal');
        setTimeout(() => hide('celebrationModal'), 4000);
    }
}

let confirmCallback = null;
function confirmAction(message, onConfirm) {
    const modal = $('deleteConfirmModal');
    const msgEl = $('deleteModalMessage');
    if (modal && msgEl) {
        msgEl.textContent = message;
        show('deleteConfirmModal');
        confirmCallback = onConfirm;
    } else {
        if (confirm(message)) onConfirm();
    }
}

function closeDeleteConfirm() {
    hide('deleteConfirmModal');
    confirmCallback = null;
}

/* --- 9. Export Functions --- */
async function prepareCaptureArea() {
    const original = $('gridWrapper');
    if (!original) return null;

    // Create a cleanup clone
    const clone = original.cloneNode(true);
    const container = document.createElement('div');
    container.id = 'export-temp-container';
    container.className = 'bg-white p-8 rounded-xl shadow-none';
    container.style.width = '1200px'; // Fixed width for export
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '0';

    // Header
    const header = document.createElement('div');
    header.className = 'text-center mb-6 border-b-2 border-ramadan-gold pb-4';
    header.innerHTML = `
        <h1 class="text-3xl font-bold font-serif text-ramadan-dark">تتبع عادات شهر رمضان</h1>
        <p class="text-gray-500 mt-2">${AppState.user ? AppState.user.displayName : 'مستخدم'}</p>
    `;
    container.appendChild(header);

    // Table
    clone.style.overflow = 'visible';
    clone.style.maxHeight = 'none';
    container.appendChild(clone);

    // Reflections Section
    const reflections = AppState.days.filter(d => d.reflection);
    if (reflections.length > 0) {
        const refDiv = document.createElement('div');
        refDiv.className = 'mt-8 border-t pt-6';
        refDiv.innerHTML = '<h3 class="text-2xl font-serif text-ramadan-dark mb-4">خواطر مسجلة</h3>';
        reflections.forEach(day => {
            const p = document.createElement('div');
            p.className = 'mb-4 bg-gray-50 p-3 rounded-lg border-r-4 border-ramadan-gold';
            p.innerHTML = `<strong class="text-lg block mb-1">${day.label}</strong><span class="font-hand text-gray-700 text-xl">${day.reflection}</span>`;
            refDiv.appendChild(p);
        });
        container.appendChild(refDiv);
    }

    document.body.appendChild(container);
    return container;
}

async function exportToImage() {
    const tempContainer = await prepareCaptureArea();
    if (!tempContainer) return;

    try {
        const canvas = await html2canvas(tempContainer, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff'
        });
        const link = document.createElement('a');
        link.download = `wa-sabiqu-tracker-${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    } catch (err) {
        console.error("Export Image Failed", err);
        alert('فشل تصدير الصورة');
    } finally {
        document.body.removeChild(tempContainer);
    }
}

async function exportToPDF() {
    const tempContainer = await prepareCaptureArea();
    if (!tempContainer) return;

    try {
        const canvas = await html2canvas(tempContainer, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
        const imgData = canvas.toDataURL('image/png');

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

        pdf.addImage(imgData, 'PNG', 0, 10, pdfWidth, pdfHeight);
        pdf.save(`wa-sabiqu-tracker-${Date.now()}.pdf`);
    } catch (err) {
        console.error("Export PDF Failed", err);
        alert('فشل تصدير PDF');
    } finally {
        document.body.removeChild(tempContainer);
    }
}

/* --- 10. Rendering --- */
function renderApp() {
    renderHeaders();
    renderRows();
    const countEl = $('trophyCountDisplay');
    if (countEl) countEl.innerText = AppState.totalDiamonds;

    // Update Achievements badge in navbar
    const badgeEl = $('badgeCount');
    if (badgeEl) {
        const count = AppState.achievements.length;
        if (count > 0) {
            badgeEl.innerText = count;
            badgeEl.classList.remove('hidden');
        } else {
            badgeEl.classList.add('hidden');
        }
    }
}

function renderHeaders() {
    const catRow = $('categoryHeaderRow');
    const habitRow = $('habitHeaderRow');
    if (!catRow || !habitRow) return;

    // Clear existing dynamic headers (keep first child)
    while (catRow.children.length > 1) catRow.lastChild.remove();
    while (habitRow.children.length > 1) habitRow.lastChild.remove();

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

            const delBtnClass = AppState.isEditMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100';

            thHabit.innerHTML = `
                <div class="flex flex-col items-center justify-center gap-1">
                    <span>${habit.name}</span>
                    <button class="${delBtnClass} text-red-400 hover:text-red-600 transition-opacity p-1" onclick="deleteHabit('${habit.id}')">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            `;
            habitRow.appendChild(thHabit);
        });
    });
}

function renderRows() {
    const tbody = $('daysBody');
    const emptyState = $('emptyState');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (AppState.days.length === 0) {
        if (emptyState) show('emptyState');
        return;
    }
    if (emptyState) hide('emptyState');

    AppState.days.forEach((day, index) => {
        const tr = document.createElement('tr');
        tr.className = 'group hover:bg-gray-50 transition-colors border-b border-gray-100';

        // 1. Day Label Cell
        const completedCount = Object.keys(day.habits || {}).length;
        const totalHabits = AppState.habits.length;
        const isDiamond = totalHabits > 0 && completedCount >= totalHabits;

        const tdDay = document.createElement('td');
        const dayBg = isDiamond ? 'bg-emerald-50/60' : 'bg-gray-100';
        tdDay.className = `p-4 sticky-col text-center font-bold text-ramadan-dark border-b border-gray-200 ${dayBg} group-hover:bg-gray-200 transition-colors cursor-pointer`;

        // Show indicator if reflection exists
        const hasReflection = day.reflection && day.reflection.trim().length > 0;

        tdDay.innerHTML = `
            <div class="flex flex-col items-center relative gap-1" onclick="openDayDetails(${index})">
                <span class="font-serif text-lg">${day.label}</span>
                <div class="flex items-center gap-1">
                    ${isDiamond ? '<i class="fa-solid fa-gem text-cyan-400 text-xs shadow-cyan-200 drop-shadow-sm"></i>' : ''}
                    ${hasReflection ? '<i class="fa-solid fa-feather text-ramadan-gold text-xs"></i>' : ''}
                </div>
                ${AppState.isEditMode ?
                `<button class="absolute top-1 right-1 text-red-500 hover:text-red-700 bg-white/80 rounded-full w-5 h-5 flex items-center justify-center shadow-sm" onclick="event.stopPropagation(); deleteDay(${index})" title="حذف اليوم">
                        <i class="fa-solid fa-trash-can text-[10px]"></i>
                    </button>` : ''
            }
            </div>
        `;
        tr.appendChild(tdDay);

        // 2. Habit Cells
        AppState.categories.forEach(cat => {
            const catHabits = AppState.habits.filter(h => h.categoryId === cat.id);
            catHabits.forEach(habit => {
                const td = document.createElement('td');
                const isDone = day.habits && day.habits[habit.id];

                td.className = `p-0 border-l border-gray-100 text-center cursor-pointer transition-all duration-200 h-16 relative ${isDone ? 'bg-emerald-50' : 'hover:bg-gray-100/50'}`;
                td.onclick = () => toggleHabit(index, habit.id);

                // Icon
                let icon = `<div class="w-2 h-2 rounded-full bg-gray-200"></div>`;
                if (isDone) {
                    icon = `<i class="fa-solid fa-check text-emerald-500 text-xl animate-bounce-short"></i>`;
                }

                td.innerHTML = `<div class="w-full h-full flex items-center justify-center">${icon}</div>`;
                tr.appendChild(td);
            });
        });

        tbody.appendChild(tr);
    });
}

function openDayDetails(index) {
    currentOpenDayIndex = index;
    const day = AppState.days[index];
    const modal = $('dayDetailsModal');
    if (!modal) return;

    // Populate Data
    $('detailsDayLabel').textContent = day.label;

    // Calculate Progress
    const total = AppState.habits.length;
    const done = Object.keys(day.habits || {}).length;
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);

    $('detailsPercentage').textContent = `${percent}%`;
    $('detailsProgressBar').style.width = `${percent}%`;

    $('reflectionInput').value = day.reflection || "";

    // Lists
    const compList = $('detailsCompletedList');
    const pendList = $('detailsPendingList');
    compList.innerHTML = ''; pendList.innerHTML = '';

    AppState.habits.forEach(h => {
        const li = document.createElement('li');
        li.className = "flex items-center gap-2";
        if (day.habits && day.habits[h.id]) {
            li.innerHTML = `<i class="fa-solid fa-check text-emerald-500"></i> ${h.name}`;
            compList.appendChild(li);
        } else {
            li.innerHTML = `<i class="fa-regular fa-circle text-gray-300"></i> ${h.name}`;
            pendList.appendChild(li);
        }
    });

    show('dayDetailsModal');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);

    // Setup Save Reflection
    const saveBtn = $('saveReflectionBtn');
    saveBtn.onclick = () => {
        const val = $('reflectionInput').value;
        AppState.days[index].reflection = val;
        saveData();
        renderRows(); // Update icon
        const fb = $('saveFeedback');
        fb.classList.remove('opacity-0');
        setTimeout(() => fb.classList.add('opacity-0'), 2000);
    };
}

/* --- 11. Domain & Interaction Logic --- */
function addCategory(name) {
    if (!name) return;
    const id = 'c_' + Date.now();
    AppState.categories.push({ id, name, color: 'bg-gray-50 text-gray-700' });
    saveData();
    renderApp();
}

function addHabit(name, catId) {
    if (!name || !catId) return;
    const id = 'h_' + Date.now();
    AppState.habits.push({ id, name, categoryId });
    saveData();
    renderApp();
}

function addDay() {
    const nextNum = AppState.days.length + 1;
    AppState.days.push({
        id: Date.now(),
        label: `اليوم ${nextNum}`,
        habits: {},
        reflection: ""
    });
    saveData();
    renderRows();
    // Scroll to bottom
    const w = $('gridWrapper');
    if (w) setTimeout(() => w.scrollTo({ top: w.scrollHeight, behavior: 'smooth' }), 100);
}

function deleteDay(index) {
    confirmAction('هل أنت متأكد من حذف هذا اليوم؟', () => {
        AppState.days.splice(index, 1);
        saveData();
        renderApp();
        closeDeleteConfirm();
    });
}

function deleteHabit(habitId) {
    confirmAction('حذف العادة سيحذف كل سجلاتها. هل أنت متأكد؟', () => {
        AppState.habits = AppState.habits.filter(h => h.id !== habitId);
        // Clean up days
        AppState.days.forEach(d => {
            if (d.habits && d.habits[habitId]) delete d.habits[habitId];
        });
        saveData();
        renderApp();
        closeDeleteConfirm();
    });
}

function toggleHabit(dayIndex, habitId) {
    const day = AppState.days[dayIndex];
    if (!day.habits) day.habits = {};

    if (day.habits[habitId]) {
        delete day.habits[habitId];
    } else {
        day.habits[habitId] = true;
    }

    // Check Diamond
    const stats = calculateDiamonds(AppState.days, AppState.habits);
    const oldD = AppState.totalDiamonds;
    AppState.totalDiamonds = stats.total;

    if (AppState.totalDiamonds > oldD) {
        showTrophyToast('مبارك! يوم ماسي جديد!');
    }

    checkAchievements();
    saveData();
    renderRows(); // Simplest is to rerender rows to update totals/icons
    renderApp();
}

function renderAchievementsModal() {
    const grid = $('achievementsGrid');
    if (!grid) return;
    grid.innerHTML = '';

    BADGES.forEach(badge => {
        const isUnlocked = AppState.achievements.includes(badge.id);
        const card = document.createElement('div');
        card.className = `p-4 rounded-xl border-2 flex flex-col items-center text-center transition-opacity ${isUnlocked ? 'border-amber-200 bg-amber-50' : 'border-gray-100 bg-gray-50 opacity-60'}`;
        card.innerHTML = `
            <div class="w-12 h-12 rounded-full flex items-center justify-center mb-2 ${isUnlocked ? 'bg-white shadow-sm' : 'bg-gray-200'}">
                <i class="${badge.icon} text-2xl ${isUnlocked ? badge.color : 'text-gray-400'}"></i>
            </div>
            <h4 class="font-bold font-serif text-ramadan-dark">${badge.title}</h4>
            <p class="text-[10px] text-gray-500 mt-1">${badge.desc}</p>
        `;
        grid.appendChild(card);
    });
    show('achievementsModal');
}

async function fetchLeaderboard() {
    const list = $('leaderboardList');
    const loading = $('leaderboardLoading');
    if (list) list.innerHTML = '';
    if (loading) show('leaderboardLoading');
    show('leaderboardModal');

    try {
        const q = query(collection(db, "users"), orderBy("totalDiamonds", "desc"), limit(20));
        const snap = await getDocs(q);
        const users = [];
        snap.forEach(doc => users.push(doc.data()));

        if (loading) hide('leaderboardLoading');
        if (list) {
            if (users.length === 0) list.innerHTML = '<p class="text-center text-gray-400">لا يوجد متسابقون</p>';
            users.forEach((u, i) => {
                const isMe = AppState.user && AppState.user.uid === u.uid; // Note: Ensure uid stored in user doc
                const row = document.createElement('div');
                row.className = `flex items-center gap-3 p-3 rounded-xl border ${i === 0 ? 'border-yellow-300 bg-yellow-50' : 'border-gray-100 bg-white'}`;
                const photo = u.photoURL || `https://ui-avatars.com/api/?name=${u.displayName}`;
                row.innerHTML = `
                    <span class="font-bold w-6 text-center text-gray-400">${i + 1}</span>
                    <img src="${photo}" class="w-10 h-10 rounded-full object-cover">
                    <div class="flex-grow">
                        <div class="font-bold text-gray-800 font-serif">${u.displayName}</div>
                    </div>
                    <div class="flex items-center gap-1 font-bold text-cyan-600 bg-white px-2 py-1 rounded">
                        <span>${u.totalDiamonds || 0}</span>
                        <i class="fa-solid fa-gem text-xs"></i>
                    </div>
                `;
                list.appendChild(row);
            });
        }
    } catch (e) {
        console.error(e);
        if (loading) hide('leaderboardLoading');
        if (list) list.innerHTML = '<p class="text-red-400 text-center">خطأ في التحميل</p>';
    }
}

function showChart() {
    show('chartModal');
    const ctx = $('mainChart').getContext('2d');

    // Prepare Data
    const labels = AppState.days.map(d => d.label);
    const dataPoints = AppState.days.map(d => {
        const total = AppState.habits.length;
        if (total === 0) return 0;
        const done = Object.keys(d.habits || {}).length;
        return Math.round((done / total) * 100);
    });

    if (myChart) myChart.destroy();

    myChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'نسبة الإنجاز',
                data: dataPoints,
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, max: 100 } }
        }
    });
}


/* --- 12. Auth Actions --- */
function setupAuthEvents() {
    const loginForm = $('loginForm');
    const signupForm = $('signupForm');

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = $('email').value;
            const pass = $('password').value;
            try {
                await signInWithEmailAndPassword(auth, email, pass);
                window.location.href = 'index.html';
            } catch (err) { alert('خطأ في الدخول: ' + err.message); }
        });
    }

    if (signupForm) {
        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = $('fullname').value;
            const email = $('email').value;
            const pass = $('password').value;
            try {
                const cred = await createUserWithEmailAndPassword(auth, email, pass);
                await updateProfile(cred.user, { displayName: name });
                // Init User Doc
                await setDoc(doc(db, "users", cred.user.uid), {
                    displayName: name, email, photoURL: null, totalDiamonds: 0, uid: cred.user.uid
                });
                window.location.href = 'index.html';
            } catch (err) { alert('خطأ في التسجيل: ' + err.message); }
        });
    }

    document.querySelectorAll('.google-login-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                const res = await signInWithPopup(auth, provider);
                // Check if user doc exists
                const userRef = doc(db, 'users', res.user.uid);
                const snap = await getDoc(userRef);
                if (!snap.exists()) {
                    await setDoc(userRef, {
                        displayName: res.user.displayName,
                        email: res.user.email,
                        photoURL: res.user.photoURL,
                        totalDiamonds: 0,
                        uid: res.user.uid
                    });
                }
                window.location.href = 'index.html';
            } catch (err) { alert('خطأ Google: ' + err.message); }
        });
    });
}

function logoutApp() {
    if (confirm('تسجيل خروج؟')) {
        signOut(auth).then(() => window.location.href = 'login.html');
    }
}

function renderAuthUI() {
    const profile = $('sidebarProfileContainer');
    if (!profile) return;

    if (AppState.user) {
        const photo = AppState.user.photoURL || `https://ui-avatars.com/api/?name=${AppState.user.displayName}`;
        profile.innerHTML = `
            <img src="${photo}" class="w-16 h-16 rounded-full border-4 border-white/10 mb-2 shadow-sm">
            <h3 class="text-white font-bold font-serif">${AppState.user.displayName}</h3>
            <button onclick="logoutApp()" class="text-red-300 text-xs mt-2 border border-red-500/30 px-2 py-1 rounded">خروج</button>
        `;
    } else {
        profile.innerHTML = `
            <div class="border-2 border-dashed border-white/20 w-12 h-12 rounded-full flex items-center justify-center mb-2"><i class="fa-solid fa-user"></i></div>
            <a href="login.html" class="bg-ramadan-gold text-ramadan-dark px-4 py-1 rounded font-bold text-sm">تسجيل دخول</a>
        `;
    }
}

/* --- 13. Event Setup (Main) --- */
function setupTrackerEvents() {
    // Buttons
    on('menuBtn', 'click', openSidebar);
    on('sidebarOverlay', 'click', closeSidebar);
    on('addDayBtn', 'click', addDay); // FAB

    // Sidebar Actions
    on('sidebarAddHabitBtn', 'click', () => { closeSidebar(); show('habitModal'); });
    on('sidebarAddCategoryBtn', 'click', () => { closeSidebar(); show('categoryModal'); });
    on('sidebarToggleEditBtn', 'click', () => { closeSidebar(); toggleEditMode(); });
    on('sidebarExportImgBtn', 'click', () => { closeSidebar(); exportToImage(); });
    on('sidebarExportPdfBtn', 'click', () => { closeSidebar(); exportToPDF(); });

    // Header Actions
    on('themeToggleBtn', 'click', toggleDarkMode);
    on('showLeaderboardBtn', 'click', fetchLeaderboard); // If exists in header

    // Modal Saves
    on('saveCategoryBtn', 'click', () => {
        const val = $('newCategoryInput').value;
        if (val) { addCategory(val); $('newCategoryInput').value = ''; hide('categoryModal'); }
    });

    on('saveHabitBtn', 'click', () => {
        const val = $('newHabitInput').value;
        const cat = $('newHabitCategorySelect').value;
        if (val && cat) { addHabit(val, cat); $('newHabitInput').value = ''; hide('habitModal'); }
    });

    on('confirmDeleteBtn', 'click', () => { if (confirmCallback) confirmCallback(); });

    // Populate Selects when opening modal
    // Note: We used inline onclick in HTML or handled above.
    // Let's refine the 'Add Habit' logic to populate Categories
    const habitBtn = $('sidebarAddHabitBtn'); // Also need to handle if opened from elsewhere? 
    // Actually the observer logic or just re-populate when opening is better.
    // Let's add a MutationObserver or just populate on click.
    const populateCats = () => {
        const sel = $('newHabitCategorySelect');
        if (sel) {
            sel.innerHTML = '';
            AppState.categories.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id; opt.textContent = c.name;
                sel.appendChild(opt);
            });
        }
    };
    if (habitBtn) habitBtn.addEventListener('click', populateCats);

    // Close Modals on click outside or X is handled by inline onclicks usually,
    // But let's add a global closer for .close-modal
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modal = e.target.closest('.fixed');
            if (modal) {
                modal.classList.add('opacity-0');
                setTimeout(() => hide(modal.id), 300);
            }
        });
    });
}
