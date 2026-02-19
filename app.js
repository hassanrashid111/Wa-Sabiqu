/**
 * Wa Sabiqu - Ramadan Habit Tracker (Mended & Optimized)
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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

/* --- State --- */
const AppState = {
    categories: [],
    habits: [],
    days: [],
    achievements: [],
    totalDiamonds: 0,
    isEditMode: false,
    user: null
};

const STORAGE_KEY = 'waSabiquData';
const DEFAULT_CATEGORIES = [
    { id: 'c_pray', name: 'الصلاة', color: 'bg-emerald-50 text-emerald-800' },
    { id: 'c_quran', name: 'القرآن', color: 'bg-amber-50 text-amber-800' },
    { id: 'c_hadith', name: 'الحديث', color: 'bg-blue-50 text-blue-800' },
    { id: 'c_azkar', name: 'الذكر', color: 'bg-purple-50 text-purple-800' }
];

const BADGES = [
    { id: 'starter_1_day', title: 'بداية الغيث', desc: 'إتمام يوم واحد كامل بنسبة 100%', icon: 'fa-solid fa-droplet', color: 'text-blue-500' }
];

let currentOpenDayIndex = null;
let unsubscribeDoc = null;

/* --- Init Logic --- */
document.addEventListener('DOMContentLoaded', () => {
    const isAuthPage = window.location.pathname.includes('login.html') || window.location.pathname.includes('signup.html');
    
    loadTheme();

    onAuthStateChanged(auth, (user) => {
        if (user) {
            AppState.user = user;
            if (isAuthPage) {
                window.location.href = 'index.html';
            } else {
                initTrackerApp();
                loadDataCloud(user.uid);
            }
        } else {
            AppState.user = null;
            if (!isAuthPage) {
                // If not on auth page and not logged in, you can choose to force login or show local data
                // For "Wa Sabiqu", we'll allow local but redirect is safer for cloud sync
                initTrackerApp();
                loadDataLocal();
            } else {
                setupAuthPageEvents();
            }
        }
        renderAuthUI();
    });
});

function initTrackerApp() {
    const daysBody = document.getElementById('daysBody');
    if (!daysBody) return; // Exit if not on index.html

    setupEvents();
    renderApp();
}

/* --- Utility: Safe DOM Helper --- */
const updateElement = (id, callback) => {
    const el = document.getElementById(id);
    if (el) callback(el);
};

/* --- Data Layer --- */
function loadDataLocal() {
    const saved = localStorage.getItem(STORAGE_KEY);
    parseData(saved);
    renderApp();
}

async function loadDataCloud(uid) {
    const docRef = doc(db, "users", uid, "data", "trackerState");
    if (unsubscribeDoc) unsubscribeDoc();

    unsubscribeDoc = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            parseData(JSON.stringify(docSnap.data()));
            renderApp();
        } else {
            saveData();
        }
    });
}

function parseData(jsonString) {
    if (!jsonString) {
        resetState();
        return;
    }
    const parsed = JSON.parse(jsonString);
    AppState.categories = parsed.categories || [...DEFAULT_CATEGORIES];
    AppState.habits = parsed.habits || [];
    AppState.days = parsed.days || [];
    AppState.achievements = parsed.achievements || [];
    
    const stats = calculateDiamonds(AppState.days, AppState.habits);
    AppState.totalDiamonds = stats.total;
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(AppState));
    if (AppState.user) {
        const docRef = doc(db, "users", AppState.user.uid, "data", "trackerState");
        setDoc(docRef, {
            categories: AppState.categories,
            habits: AppState.habits,
            days: AppState.days,
            achievements: AppState.achievements,
            totalDiamonds: AppState.totalDiamonds
        }, { merge: true }).catch(console.error);

        setDoc(doc(db, "users", AppState.user.uid), {
            totalDiamonds: AppState.totalDiamonds,
            lastUpdated: new Date()
        }, { merge: true });
    }
}

/* --- Auth UI & Actions --- */
function renderAuthUI() {
    updateElement('sidebarProfileContainer', (el) => {
        if (AppState.user) {
            const photo = AppState.user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(AppState.user.displayName || 'User')}&background=0D9488&color=fff`;
            el.innerHTML = `
                <img src="${photo}" class="w-16 h-16 rounded-full border-4 border-white/10 mb-3 shadow-lg object-cover">
                <h3 class="text-white font-serif font-bold text-lg">${AppState.user.displayName}</h3>
                <button id="logoutBtn" class="text-xs text-red-300 hover:text-red-100 font-bold mt-2 border border-red-500/30 px-3 py-1 rounded-full bg-red-500/10">تسجيل الخروج</button>
            `;
            document.getElementById('logoutBtn')?.addEventListener('click', logoutApp);
        } else {
            el.innerHTML = `<div class="flex flex-col gap-2 w-full px-8"><a href="login.html" class="bg-ramadan-gold text-ramadan-dark text-center py-2 rounded-lg font-bold">دخول</a></div>`;
        }
    });

    updateElement('trophyCountDisplay', (el) => el.innerText = AppState.totalDiamonds);
}

function setupAuthPageEvents() {
    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
    document.getElementById('signupForm')?.addEventListener('submit', handleSignup);
    document.querySelectorAll('.google-login-btn').forEach(btn => btn.addEventListener('click', loginWithGoogle));
}

async function loginWithGoogle() {
    try {
        const result = await signInWithPopup(auth, provider);
        const userRef = doc(db, "users", result.user.uid);
        const snap = await getDoc(userRef);
        if (!snap.exists()) {
            await setDoc(userRef, {
                displayName: result.user.displayName,
                email: result.user.email,
                photoURL: result.user.photoURL,
                totalDiamonds: 0,
                createdAt: new Date()
            });
        }
        window.location.href = 'index.html';
    } catch (error) {
        alert("خطأ: " + error.message);
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    try {
        await signInWithEmailAndPassword(auth, email, password);
        window.location.href = 'index.html';
    } catch (error) {
        alert("فشل الدخول: " + error.message);
    }
}

async function handleSignup(e) {
    e.preventDefault();
    const fullname = document.getElementById('fullname').value;
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: fullname });
        await setDoc(doc(db, "users", cred.user.uid), { displayName: fullname, email, totalDiamonds: 0 });
        window.location.href = 'index.html';
    } catch (error) {
        alert("خطأ في الإنشاء: " + error.message);
    }
}

function logoutApp() {
    if (confirm('هل تريد الخروج؟')) signOut(auth).then(() => window.location.reload());
}

/* --- Tracker Rendering --- */
function renderApp() {
    if (!document.getElementById('daysBody')) return;
    renderHeaders();
    renderRows();
    updateElement('trophyCountDisplay', el => el.innerText = AppState.totalDiamonds);
}

function renderHeaders() {
    const catRow = document.getElementById('categoryHeaderRow');
    const habitRow = document.getElementById('habitHeaderRow');
    if (!catRow || !habitRow) return;

    // Clear existing (except first th)
    while (catRow.children.length > 1) catRow.lastChild.remove();
    while (habitRow.children.length > 1) habitRow.lastChild.remove();

    AppState.categories.forEach(cat => {
        const catHabits = AppState.habits.filter(h => h.categoryId === cat.id);
        if (catHabits.length === 0) return;

        const th = document.createElement('th');
        th.colSpan = catHabits.length;
        th.className = `p-3 text-center border-l border-b border-gray-200 text-sm font-bold ${cat.color}`;
        th.textContent = cat.name;
        catRow.appendChild(th);

        catHabits.forEach(h => {
            const hh = document.createElement('th');
            hh.className = 'p-3 min-w-[100px] text-center border-l text-xs font-semibold text-gray-600';
            hh.innerHTML = `<span>${h.name}</span>`;
            habitRow.appendChild(hh);
        });
    });
}

function renderRows() {
    const tbody = document.getElementById('daysBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    AppState.days.forEach((day, idx) => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50 transition-colors group';
        
        const isDiamond = (Object.keys(day.habits).length === AppState.habits.length && AppState.habits.length > 0);
        
        // Day Cell
        const tdDay = document.createElement('td');
        tdDay.className = `p-4 sticky-col text-center font-bold border-b border-gray-200 ${isDiamond ? 'bg-emerald-50' : ''}`;
        tdDay.innerHTML = `<div class="font-serif text-lg">${day.label}</div>`;
        tdDay.onclick = () => openDayDetails(idx);
        tr.appendChild(tdDay);

        // Habit Cells
        AppState.categories.forEach(cat => {
            AppState.habits.filter(h => h.categoryId === cat.id).forEach(h => {
                const td = document.createElement('td');
                const done = !!day.habits[h.id];
                td.className = `p-0 border-l border-b text-center cursor-pointer ${done ? 'bg-emerald-50' : ''}`;
                td.setAttribute('data-label', h.name); // For Mobile
                td.innerHTML = `<div class="h-14 flex items-center justify-center">${done ? '<i class="fa-solid fa-check text-emerald-500"></i>' : '•'}</div>`;
                td.onclick = () => toggleHabit(idx, h.id);
                tr.appendChild(td);
            });
        });
        tbody.appendChild(tr);
    });
}

/* --- Logic --- */
function toggleHabit(dayIdx, habitId) {
    const day = AppState.days[dayIdx];
    if (day.habits[habitId]) delete day.habits[habitId];
    else day.habits[habitId] = true;

    const stats = calculateDiamonds(AppState.days, AppState.habits);
    AppState.totalDiamonds = stats.total;
    saveData();
    renderApp();
}

function calculateDiamonds(days, habits) {
    if (habits.length === 0) return { total: 0 };
    const count = days.filter(d => Object.keys(d.habits).length === habits.length).length;
    return { total: count };
}

function loadTheme() {
    if (localStorage.getItem('waSabiquTheme') === 'dark') document.documentElement.classList.add('dark');
}

function updateBadgeCount() {
    updateElement('badgeCount', el => {
        const c = AppState.achievements.length;
        el.innerText = c;
        el.classList.toggle('hidden', c === 0);
    });
}

/* --- Modal & Export Logic (Fixed) --- */
async function prepareCaptureArea() {
    const area = document.getElementById('captureArea');
    const extra = document.createElement('div');
    extra.className = 'p-6 bg-white mt-4 border-t';
    extra.innerHTML = `<h3 class="text-xl font-bold mb-4">سجل الإنجازات - وسابقوا</h3>`;
    area.appendChild(extra);
    return extra;
}

window.exportToImage = async () => {
    const el = document.getElementById('captureArea');
    const extra = await prepareCaptureArea();
    const canvas = await html2canvas(el);
    const link = document.createElement('a');
    link.download = 'tracker.png';
    link.href = canvas.toDataURL();
    link.click();
    extra.remove();
};

function setupEvents() {
    document.getElementById('menuBtn')?.addEventListener('click', () => updateElement('sidebarDrawer', s => s.classList.remove('translate-x-full')));
    document.getElementById('sidebarOverlay')?.addEventListener('click', () => updateElement('sidebarDrawer', s => s.classList.add('translate-x-full')));
    document.getElementById('addDayBtn')?.addEventListener('click', () => {
        AppState.days.push({ id: Date.now(), label: `اليوم ${AppState.days.length+1}`, habits: {}, reflection: "" });
        saveData();
        renderApp();
    });
}