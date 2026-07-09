// Aura Workout Coin Economy State & Logic

const DEFAULT_STATE = {
  coins: 100, // Preload with 100 coins to begin
  workouts: [], // { id, date, type, duration, intensity, coins } (date is YYYY-MM-DD)
  meals: [], // { id, date, type, desc } (date is YYYY-MM-DD)
  treats: [
    { id: 1, name: 'Sweet fruits', cost: 15, category: 'Small', emoji: '🥭' },
    { id: 2, name: 'Ice cream / dessert', cost: 35, category: 'Small', emoji: '🍦' },
    { id: 3, name: 'Chocolate / candy', cost: 40, category: 'Small', emoji: '🍫' },
    { id: 4, name: 'Bakery', cost: 45, category: 'Small', emoji: '🥐' }
  ],
  transactions: [], // { id, date, amount, type: 'earn'|'spend', desc }
  currentLanguage: 'en',
  darkMode: false,
  fitStreak: 0,
  foodStreak: 0,
  cashTransactions: [] // { id, date, type: 'income'|'expense', amount, category, desc }
};

// Default GitHub Settings structure fallback
const DEFAULT_GITHUB_SETTINGS = { username: '', repo: '', token: '', autoSync: false };

// State Manager
let state = JSON.parse(localStorage.getItem('aura_coin_state')) || { ...DEFAULT_STATE };

// Translation Dictionary
const TRANSLATIONS = {
  en: {
    "txt-brand-name": "Aura",
    "txt-synced": "Synced",
    "txt-my-balance": "My Balance",
    "txt-coins-lbl": "coins",
    "txt-shop-title": "Treat Shop",
    "txt-new-treat": "Add Treat",
    "txt-add-treat-header": "New Custom Treat",
    "txt-today-summary": "Today's Logs",
    "txt-today-workouts": "Workouts logged today",
    "txt-today-meals": "Meals logged today",
    "txt-food-title": "Food",
    "txt-food-subtitle": "Meals + logging streak",
    "txt-log-meal-header": "Log a meal",
    "txt-what-eat-lbl": "What did you eat?",
    "txt-save-meal": "Save",
    "txt-food-streak": "Streak",
    "txt-last-30": "last 30 days",
    "txt-food-streak-desc": "days logged in a row — like writing the diary every night",
    "txt-food-this-week": "This week",
    "txt-fit-this-week": "This week",
    "txt-fit-title": "Fit",
    "txt-fit-subtitle": "Workout coin economy",
    "txt-coach-name": "Dr. Yuna",
    "txt-quest-title": "Weekly quest",
    "txt-quest-desc": "Five cardio or walk sessions this week — let's keep that heart happily pumping. 💗",
    "txt-log-workout-header": "Log a workout",
    "txt-workout-type": "Type",
    "w_walk": "Walk (1.0x)",
    "w_cardio": "Cardio (1.2x)",
    "w_gym": "Gym (1.5x)",
    "txt-workout-intensity": "Intensity",
    "i_low": "Low (1.0x)",
    "i_medium": "Medium (1.5x)",
    "i_high": "High (2.0x)",
    "txt-workout-duration": "Duration (minutes)",
    "txt-save-workout": "Save",
    "txt-fit-streak": "Streak",
    "txt-tap-day": "tap a day",
    "txt-chart-title": "Coin flow",
    "txt-chart-days": "30 days",
    "txt-earned-lbl": "Earned",
    "txt-spent-lbl": "Spent",
    "txt-more-title": "More",
    "txt-more-subtitle": "App configurations and data tools",
    "txt-data-tools": "Data Management",
    "txt-data-tools-desc": "Your workouts and coins are stored privately in your browser cache. You can backup your profile to a file or restore it below.",
    "txt-export-btn-lbl": "Export JSON",
    "txt-import-btn-lbl": "Import JSON",
    "txt-reset-section": "Reset Options",
    "txt-reset-desc": "Clear all data and start completely fresh. This action cannot be undone.",
    "txt-reset-btn-lbl": "Reset Workspace",
    
    // Meal Types
    "meal_breakfast": "Breakfast",
    "meal_lunch": "Lunch",
    "meal_dinner": "Dinner",
    "meal_snack": "Snack",

    // Navigation
    "nav_home": "Home",
    "nav_food": "Food",
    "nav_more": "More",
    "nav_finance": "Finance",
    "txt-finance-title": "Finance",
    "txt-finance-subtitle": "Cash Income & Expense Tracker",
    "txt-finance-balance": "Net Balance",
    "txt-total-income": "Income",
    "txt-total-expense": "Expense",
    "txt-log-finance-header": "Log Transaction",
    "btn-cash-expense": "Expense",
    "btn-cash-income": "Income",
    "txt-cash-category": "Category",
    "txt-cash-amount": "Amount (฿)",
    "txt-cash-desc": "Description",
    "txt-save-cash": "Save",
    "txt-finance-history": "History Logs",
    "txt-redeem-history-title": "Redemption Logs",
    "no_redeems": "No rewards redeemed yet.",
    "txt-github-sync-title": "GitHub Cloud Sync",
    "txt-github-sync-desc": "Sync your data securely between your PC and mobile device using a private GitHub repository.",
    "lbl-github-username": "GitHub Username",
    "lbl-github-repo": "Repository Name",
    "lbl-github-token": "Personal Access Token (PAT)",
    "txt-token-link": "Create token (repo scope required)",
    "lbl-github-autosync": "Auto-Sync on Changes",
    "txt-test-btn": "Test",
    "txt-sync-btn": "Sync Now",

    // Alert and dynamics
    "buy": "Buy",
    "cost": "Cost",
    "delete": "Delete",
    "cant_afford": "Not enough coins! Go work out first. 💪",
    "purchased": "Redeemed:",
    "weekly_quest_done": "Weekly Quest Completed! +100 bonus coins added! 🎉",
    "import_success": "Data imported successfully!",
    "import_fail": "Failed to parse data. File is invalid.",
    "quest_progress": "this week",
    
    // Coach messages
    "coach_welcome": "Hello! Dr. Yuna here. Let's make exercise a game. Log a workout to start earning!",
    "coach_streak": "🔥 Awesome! You're on a streak. Extra multipliers are active!",
    "coach_quest_status": "Quest progress: [progress]/5 sessions on the board. Keep going!",
    "coach_gym_log": "💪 Workout logged! [duration] min, [coins] coins on the board. Excellent job!",
    "coach_treat": "🍰 Bought a treat? Enjoy it guilt-free. You earned it!"
  },
  th: {
    "txt-brand-name": "Aura",
    "txt-synced": "บันทึกแล้ว",
    "txt-my-balance": "เหรียญสะสมของฉัน",
    "txt-coins-lbl": "เหรียญ",
    "txt-shop-title": "ร้านค้าของรางวัล",
    "txt-new-treat": "เพิ่มรางวัล",
    "txt-add-treat-header": "สร้างของรางวัลใหม่",
    "txt-today-summary": "บันทึกของวันนี้",
    "txt-today-workouts": "ออกกำลังกายแล้ววันนี้",
    "txt-today-meals": "บันทึกอาหารแล้ววันนี้",
    "txt-food-title": "อาหาร",
    "txt-food-subtitle": "มื้ออาหาร + สถิติต่อเนื่อง",
    "txt-log-meal-header": "บันทึกอาหาร",
    "txt-what-eat-lbl": "วันนี้ทานอะไรไปบ้าง?",
    "txt-save-meal": "บันทึก",
    "txt-food-streak": "สถิติต่อเนื่อง",
    "txt-last-30": "30 วันที่ผ่านมา",
    "txt-food-streak-desc": "วันที่มีการบันทึกอาหารติดต่อกัน — เสมือนการเขียนบันทึกความใส่ใจในทุกคืน",
    "txt-food-this-week": "สัปดาห์นี้",
    "txt-fit-this-week": "สัปดาห์นี้",
    "txt-fit-title": "ออกกำลังกาย",
    "txt-fit-subtitle": "ระบบสะสมเหรียญวินัย",
    "txt-coach-name": "ดร. ยูนะ",
    "txt-quest-title": "เควสต์ประจำสัปดาห์",
    "txt-quest-desc": "คาร์ดิโอหรือเดิน 5 เซสชันในสัปดาห์นี้ — ให้หัวใจได้สูบฉีดอย่างแข็งแรง 💗",
    "txt-log-workout-header": "บันทึกออกกำลังกาย",
    "txt-workout-type": "ประเภท",
    "w_walk": "เดิน (1.0x)",
    "w_cardio": "คาร์ดิโอ (1.2x)",
    "w_gym": "ฟิตเนส/เวท (1.5x)",
    "txt-workout-intensity": "ความเข้มข้น",
    "i_low": "ต่ำ (1.0x)",
    "i_medium": "ปานกลาง (1.5x)",
    "i_high": "สูง (2.0x)",
    "txt-workout-duration": "ระยะเวลา (นาที)",
    "txt-save-workout": "บันทึก",
    "txt-fit-streak": "สถิติต่อเนื่อง",
    "txt-tap-day": "แตะที่วันเพื่อสลับเช็ก",
    "txt-chart-title": "ประวัติเหรียญ",
    "txt-chart-days": "30 วันที่ผ่านมา",
    "txt-earned-lbl": "ได้รับ",
    "txt-spent-lbl": "ใช้ไป",
    "txt-more-title": "เพิ่มเติม",
    "txt-more-subtitle": "ตั้งค่าแอปพลิเคชันและจัดการข้อมูล",
    "txt-data-tools": "การจัดการข้อมูล",
    "txt-data-tools-desc": "ประวัติการออกกำลังกายและเหรียญของคุณจะถูกจัดเก็บไว้เฉพาะในเบราว์เซอร์ส่วนตัวเท่านั้น คุณสามารถสำรองข้อมูลหรือกู้คืนได้ที่ด้านล่างนี้",
    "txt-export-btn-lbl": "ส่งออก JSON",
    "txt-import-btn-lbl": "นำเข้า JSON",
    "txt-reset-section": "รีเซ็ตระบบ",
    "txt-reset-desc": "ล้างข้อมูลทั้งหมดในแอปพลิเคชันและเริ่มต้นใหม่ทั้งหมด การกระทำนี้ไม่สามารถย้อนกลับได้",
    "txt-reset-btn-lbl": "รีเซ็ตแอปทั้งหมด",
    
    // Meal Types
    "meal_breakfast": "มื้อเช้า",
    "meal_lunch": "มื้อกลางวัน",
    "meal_dinner": "มื้อเย็น",
    "meal_snack": "ของว่าง",

    // Navigation
    "nav_home": "แดชบอร์ด",
    "nav_food": "มื้ออาหาร",
    "nav_fit": "ออกกำลังกาย",
    "nav_finance": "รายรับ-รายจ่าย",
    "nav_more": "ตั้งค่า",
    "txt-finance-title": "บัญชี",
    "txt-finance-subtitle": "บันทึกรายรับ-รายจ่ายเงินบาทจริง (฿)",
    "txt-finance-balance": "ยอดคงเหลือ",
    "txt-total-income": "รายรับรวม",
    "txt-total-expense": "รายจ่ายรวม",
    "txt-log-finance-header": "จดรายรับ-รายจ่าย",
    "btn-cash-expense": "รายจ่าย",
    "btn-cash-income": "รายรับ",
    "txt-cash-category": "หมวดหมู่",
    "txt-cash-amount": "จำนวนเงิน (฿)",
    "txt-cash-desc": "รายละเอียด",
    "txt-save-cash": "บันทึก",
    "txt-finance-history": "ประวัติธุรกรรม",
    "txt-redeem-history-title": "ประวัติการแลกของรางวัล",
    "no_redeems": "ยังไม่มีประวัติการแลกของรางวัล",
    "txt-github-sync-title": "การซิงค์ข้อมูลกับ GitHub",
    "txt-github-sync-desc": "สำรองและซิงค์ข้อมูลอย่างปลอดภัยระหว่างคอมพิวเตอร์และมือถือของคุณโดยใช้คลังเก็บข้อมูลส่วนตัวของ GitHub",
    "lbl-github-username": "ชื่อผู้ใช้ GitHub",
    "lbl-github-repo": "ชื่อคลังเก็บข้อมูล (Repository)",
    "lbl-github-token": "สิทธิ์เข้าถึงส่วนตัว (Token)",
    "txt-token-link": "สร้างสิทธิ์การซิงค์ใหม่ (ติ๊กเลือกช่อง repo)",
    "lbl-github-autosync": "ซิงค์อัตโนมัติเมื่อมีการจดบันทึก",
    "txt-test-btn": "ทดสอบ",
    "txt-sync-btn": "ซิงค์ทันที",

    // Alert and dynamics
    "buy": "ซื้อ",
    "cost": "ราคา",
    "delete": "ลบ",
    "cant_afford": "เหรียญไม่พอ! ไปออกกำลังกายสะสมเหรียญก่อนนะ 💪",
    "purchased": "แลกซื้อรางวัลสำเร็จ:",
    "weekly_quest_done": "สำเร็จเควสต์ประจำสัปดาห์! ได้รับโบนัส +100 เหรียญ! 🎉",
    "import_success": "นำเข้าข้อมูลสำเร็จแล้ว!",
    "import_fail": "กู้คืนข้อมูลล้มเหลว โครงสร้างไฟล์ไม่ถูกต้อง",
    "quest_progress": "ในสัปดาห์นี้",
    
    // Coach messages
    "coach_welcome": "สวัสดี! หมอยูนะค่ะ มาทำให้การออกกำลังกายสนุกเหมือนเล่นเกมกันเถอะ บันทึกเพื่อสะสมเหรียญแรกกันเลย!",
    "coach_streak": "🔥 ยอดเยี่ยมมาก! คุณทำได้ต่อเนื่องรวดเร็ว โบนัสทวีคูณพร้อมทำงานแล้ว!",
    "coach_quest_status": "ความคืบหน้าเควสต์: บันทึกไปแล้ว [progress]/5 ครั้ง สู้ต่อไปนะ!",
    "coach_gym_log": "💪 บันทึกสำเร็จแล้ว! ทำไป [duration] นาที รับเพิ่ม [coins] เหรียญ เก่งมากค่ะ!",
    "coach_treat": "🍰 แลกซื้อรางวัลมาแล้วสินะ? มีความสุขกับรางวัลได้เลยอย่างสบายใจเพราะคุณสมควรได้รับมันแล้วค่ะ!"
  }
};

// Date helper utility
function getTodayString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const date = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${date}`;
}

// Format local date string
function formatLocalDate(dateStr) {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  
  if (state.currentLanguage === 'th') {
    return `${day}/${month}/${year}`;
  }
  return `${month}/${day}/${year}`;
}

function safeCreateIcons() {
  try {
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  } catch (e) {
    console.warn("Lucide icons failed to load:", e);
  }
}

// ----------------------------------------------------
// UI Logic & Router Setup
// ----------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  initRouter();
  initStateAndUI();
  initHomeShopController();
  initFoodController();
  initFitController();
  initFinanceController();
  initMoreController();
  initPullToRefresh();
  
  // Activate initial Lucide Icons
  safeCreateIcons();

  // Trigger initial cloud sync if enabled
  if (state.githubSettings && state.githubSettings.autoSync) {
    const statusEl = document.getElementById('github-sync-status');
    if (statusEl) {
      statusEl.textContent = state.currentLanguage === 'th' ? 'กำลังดาวน์โหลดข้อมูลล่าสุด...' : 'Downloading latest data...';
    }
    syncWithGitHub('sync').then(success => {
      if (success) {
        if (statusEl) {
          statusEl.style.color = 'var(--color-primary)';
          statusEl.textContent = state.currentLanguage === 'th' ? 'ซิงค์ข้อมูลกับคลาวด์แล้ว! ✅' : 'Cloud synced! ✅';
        }
        // Refresh UI with merged data
        initStateAndUI();
        renderTreatShop();
        renderFoodUI();
        renderFitUI();
        populateCashCategories();
        renderFinanceUI();
      } else if (statusEl) {
        statusEl.style.color = 'var(--color-danger)';
        statusEl.textContent = state.currentLanguage === 'th' ? 'การซิงค์ข้อมูลเริ่มต้นล้มเหลว ❌' : 'Initial sync failed ❌';
      }
    });
  }
});

function initRouter() {
  const navButtons = document.querySelectorAll('.nav-btn');
  const panes = document.querySelectorAll('.pane');

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-target');
      
      navButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      panes.forEach(pane => {
        pane.classList.remove('active');
        if (pane.id === target) {
          pane.classList.add('active');
        }
      });
      
      // If switching to Fit tab, redraw chart to match dimension
      if (target === 'pane-fit') {
        drawCoinFlowChart();
      }
      if (target === 'pane-finance') {
        renderFinanceUI();
      }
    });
  });
}

function initStateAndUI() {
  // Check migration/default
  if (state.coins === undefined) state = { ...DEFAULT_STATE };
  if (!state.workouts) state.workouts = [];
  if (!state.meals) state.meals = [];
  if (!state.treats || state.treats.length === 0 || !state.treats[0].emoji) {
    state.treats = [...DEFAULT_STATE.treats];
  }
  if (!state.transactions) state.transactions = [];
  if (!state.cashTransactions) state.cashTransactions = [];
  if (!state.githubSettings) state.githubSettings = { ...DEFAULT_GITHUB_SETTINGS };

  // Theme Sync
  if (state.darkMode) {
    document.body.classList.add('dark-theme');
    document.getElementById('theme-icon').setAttribute('data-lucide', 'sun');
  } else {
    document.body.classList.remove('dark-theme');
    document.getElementById('theme-icon').setAttribute('data-lucide', 'moon');
  }

  applyLanguage();
  updateCoinsDisplay();
  updateSummaryLogs();
  renderRedeemedHistory();
}

function saveState() {
  localStorage.setItem('aura_coin_state', JSON.stringify(state));
  updateCoinsDisplay();
  updateSummaryLogs();
  renderRedeemedHistory();

  // Trigger background auto sync if enabled
  if (state.githubSettings && state.githubSettings.autoSync) {
    syncWithGitHub('upload').then(success => {
      const statusEl = document.getElementById('github-sync-status');
      if (statusEl) {
        if (success) {
          statusEl.style.color = 'var(--color-primary)';
          statusEl.textContent = state.currentLanguage === 'th' ? 'ซิงค์อัตโนมัติแล้ว! ✅' : 'Auto-synced! ✅';
        } else {
          statusEl.style.color = 'var(--color-danger)';
          statusEl.textContent = state.currentLanguage === 'th' ? 'การซิงค์อัตโนมัติล้มเหลว ❌' : 'Auto-sync failed ❌';
        }
      }
    });
  }
}

function updateCoinsDisplay() {
  document.getElementById('coin-value').textContent = state.coins;
}

function updateSummaryLogs() {
  const today = getTodayString();
  
  const todayWorkouts = state.workouts.filter(w => w.date === today).length;
  const todayMeals = state.meals.filter(m => m.date === today).length;

  document.getElementById('today-workout-count').textContent = todayWorkouts;
  document.getElementById('today-meal-count').textContent = todayMeals;
}

function applyLanguage() {
  const lang = state.currentLanguage || 'en';
  document.querySelector('.lang-text').textContent = lang === 'en' ? 'TH' : 'EN';

  // ID Elements
  Object.keys(TRANSLATIONS[lang]).forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (el.tagName === 'INPUT') {
        el.placeholder = TRANSLATIONS[lang][id];
      } else {
        el.textContent = TRANSLATIONS[lang][id];
      }
    }
  });

  // Data keys Translation
  document.querySelectorAll('[data-key]').forEach(el => {
    const key = el.getAttribute('data-key');
    if (TRANSLATIONS[lang][key]) {
      if (el.tagName === 'INPUT') {
        el.placeholder = TRANSLATIONS[lang][key];
      } else {
        el.textContent = TRANSLATIONS[lang][key];
      }
    }
  });

  // Update dropdown options
  document.querySelectorAll('select option[data-key]').forEach(option => {
    const key = option.getAttribute('data-key');
    if (TRANSLATIONS[lang][key]) {
      option.textContent = TRANSLATIONS[lang][key];
    }
  });
}

function t(key) {
  const lang = state.currentLanguage || 'en';
  return TRANSLATIONS[lang][key] || key;
}

// ----------------------------------------------------
// Home Tab & Treat Shop Controller
// ----------------------------------------------------

function initHomeShopController() {
  const addBtn = document.getElementById('add-treat-btn');
  const formContainer = document.getElementById('treat-form-container');
  const cancelBtn = document.getElementById('treat-cancel-btn');
  const saveBtn = document.getElementById('treat-save-btn');
  const treatNameInput = document.getElementById('treat-input-name');
  const treatEmojiInput = document.getElementById('treat-input-emoji');
  const treatCostInput = document.getElementById('treat-input-cost');

  addBtn.addEventListener('click', () => {
    formContainer.classList.remove('hidden');
    treatNameInput.focus();
  });

  cancelBtn.addEventListener('click', () => {
    formContainer.classList.add('hidden');
    treatNameInput.value = '';
    treatEmojiInput.value = '';
    treatCostInput.value = '';
  });

  saveBtn.addEventListener('click', () => {
    const name = treatNameInput.value.trim();
    const emoji = treatEmojiInput.value.trim() || '🎁';
    const cost = parseInt(treatCostInput.value);

    if (!name || isNaN(cost) || cost <= 0) return;

    let category = 'Small';
    if (cost >= 150) {
      category = 'Big';
    } else if (cost >= 60) {
      category = 'Medium';
    }

    const newTreat = {
      id: Date.now(),
      name: name,
      cost: cost,
      category: category,
      emoji: emoji
    };

    state.treats.push(newTreat);
    saveState();

    // Clear
    formContainer.classList.add('hidden');
    treatNameInput.value = '';
    treatEmojiInput.value = '';
    treatCostInput.value = '';

    renderTreatShop();
  });

  renderTreatShop();
}

function renderTreatShop() {
  const listContainer = document.getElementById('treats-list');
  if (!listContainer) return;
  listContainer.innerHTML = '';

  state.treats.forEach(tItem => {
    const card = document.createElement('div');
    card.className = 'treat-item-card';

    const itemEmoji = tItem.emoji || '🎁';
    
    card.innerHTML = `
      <button class="treat-delete-btn" data-id="${tItem.id}">
        <i data-lucide="x" style="width:14px;height:14px;"></i>
      </button>
      <div class="treat-emoji-circle">${itemEmoji}</div>
      <div class="treat-card-title">${tItem.name}</div>
      <div class="treat-card-meta">${tItem.cost} coins · ${tItem.category.toLowerCase()}</div>
      <button class="redeem-btn" data-id="${tItem.id}">Redeem</button>
    `;

    // Redeem action listener
    card.querySelector('.redeem-btn').addEventListener('click', () => {
      purchaseTreat(tItem.id);
    });

    // Delete action listener
    card.querySelector('.treat-delete-btn').addEventListener('click', () => {
      deleteTreat(tItem.id);
    });

    listContainer.appendChild(card);
  });

  safeCreateIcons();
}

function purchaseTreat(id) {
  const treat = state.treats.find(tItem => tItem.id === id);
  if (!treat) return;

  if (state.coins < treat.cost) {
    alert(t('cant_afford'));
    return;
  }

  // Deduct coins and record transaction
  state.coins -= treat.cost;
  
  const today = getTodayString();
  state.transactions.push({
    id: Date.now(),
    date: today,
    amount: treat.cost,
    type: 'spend',
    desc: treat.name,
    emoji: treat.emoji || '🎁'
  });

  // Dr Yuna congrats speech
  updateDrYunaCoachMessage(t('coach_treat'), 'treat');

  saveState();
  renderTreatShop();
  alert(`${t('purchased')} ${treat.name} (-${treat.cost} coins)`);
}

function deleteTreat(id) {
  state.treats = state.treats.filter(tItem => tItem.id !== id);
  saveState();
  renderTreatShop();
}

// ----------------------------------------------------
// Food Tab Controller
// ----------------------------------------------------

function initFoodController() {
  const saveBtn = document.getElementById('save-meal-btn');
  const mealDescInput = document.getElementById('meal-input-desc');
  const mealBtns = document.querySelectorAll('.meal-btn');
  let selectedMealType = 'Breakfast';

  mealBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      mealBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedMealType = btn.getAttribute('data-meal');
    });
  });

  saveBtn.addEventListener('click', () => {
    const desc = mealDescInput.value.trim();
    if (!desc) return;

    const newMeal = {
      id: Date.now(),
      date: getTodayString(),
      type: selectedMealType,
      desc: desc
    };

    state.meals.push(newMeal);
    
    // Update streak logic
    updateStreakCounter('food');

    saveState();
    mealDescInput.value = '';
    
    renderFoodUI();
  });

  renderFoodUI();
}

function renderFoodUI() {
  render30DaysGrid('food');
  renderWeeklyHistoryList('food');
}

// Dynamic 30-day Grid drawing (Matching the image)
// Let the user tap a circle to log a generic entry for that date (satisfying "tap a day")
function render30DaysGrid(moduleKey) {
  const gridContainer = document.getElementById(`${moduleKey}-streak-grid`);
  if (!gridContainer) return;
  gridContainer.innerHTML = '';

  const records = moduleKey === 'food' ? state.meals : state.workouts;
  const today = new Date();

  // Create grid of 30 circles, going backward from today
  for (let i = 29; i >= 0; i--) {
    const targetDate = new Date();
    targetDate.setDate(today.getDate() - i);

    const year = targetDate.getFullYear();
    const month = String(targetDate.getMonth() + 1).padStart(2, '0');
    const day = String(targetDate.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    const isLogged = records.some(r => r.date === dateStr);

    const dot = document.createElement('div');
    dot.className = `streak-dot ${isLogged ? 'checked' : ''}`;
    dot.setAttribute('title', formatLocalDate(dateStr));
    dot.innerHTML = isLogged ? '<i data-lucide="check"></i>' : '';

    // "Tap a day" functionality to add/remove mock logs for testing
    dot.addEventListener('click', () => {
      toggleDayLog(moduleKey, dateStr, isLogged);
    });

    gridContainer.appendChild(dot);
  }

  safeCreateIcons();

  // Display streak value
  updateStreakCounterDisplay(moduleKey);
}

function toggleDayLog(moduleKey, dateStr, isAlreadyLogged) {
  if (isAlreadyLogged) {
    // Delete logs on that day
    if (moduleKey === 'food') {
      state.meals = state.meals.filter(m => m.date !== dateStr);
    } else {
      state.workouts = state.workouts.filter(w => w.date !== dateStr);
      state.transactions = state.transactions.filter(tItem => !(tItem.date === dateStr && tItem.type === 'earn'));
    }
  } else {
    // Log generic item on that day
    if (moduleKey === 'food') {
      state.meals.push({
        id: Date.now(),
        date: dateStr,
        type: 'Snack',
        desc: 'Quick check-in'
      });
    } else {
      const genericCoins = 50;
      state.workouts.push({
        id: Date.now(),
        date: dateStr,
        type: 'Walk',
        duration: 30,
        intensity: 'Low',
        coins: genericCoins
      });

      state.transactions.push({
        id: Date.now(),
        date: dateStr,
        amount: genericCoins,
        type: 'earn',
        desc: 'Walk'
      });
      state.coins += genericCoins;
    }
  }

  // Recalculate streaks
  updateStreakCounter(moduleKey);
  
  saveState();
  if (moduleKey === 'food') {
    renderFoodUI();
  } else {
    renderFitUI();
  }
}

function updateStreakCounter(moduleKey) {
  const records = moduleKey === 'food' ? state.meals : state.workouts;
  if (records.length === 0) {
    if (moduleKey === 'food') state.foodStreak = 0;
    else state.fitStreak = 0;
    return;
  }

  let streak = 0;
  let checkDate = new Date();
  
  while (true) {
    const year = checkDate.getFullYear();
    const month = String(checkDate.getMonth() + 1).padStart(2, '0');
    const day = String(checkDate.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    const logged = records.some(r => r.date === dateStr);
    if (logged) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1); // Go back one day
    } else {
      // If today is not logged yet, check yesterday to continue streak
      if (streak === 0 && dateStr === getTodayString()) {
        checkDate.setDate(checkDate.getDate() - 1);
        continue;
      }
      break;
    }
  }

  if (moduleKey === 'food') {
    state.foodStreak = streak;
  } else {
    state.fitStreak = streak;
  }
}

function updateStreakCounterDisplay(moduleKey) {
  const countEl = document.getElementById(`${moduleKey}-streak-count`);
  if (countEl) {
    const value = moduleKey === 'food' ? state.foodStreak : state.fitStreak;
    countEl.textContent = value;
  }
}

function renderWeeklyHistoryList(moduleKey) {
  const container = document.getElementById(`weekly-${moduleKey === 'food' ? 'meals' : 'workouts'}-list`);
  if (!container) return;
  container.innerHTML = '';

  const records = moduleKey === 'food' ? state.meals : state.workouts;
  if (records.length === 0) {
    container.innerHTML = `<div style="text-align:center;font-size:12px;color:var(--text-light);padding:10px 0;">No logs this week</div>`;
    return;
  }

  // Get start of current week (e.g. Sunday)
  const today = new Date();
  const dayOfWeek = today.getDay();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - dayOfWeek); // Set to Sunday

  // Get dates of the current week (Sunday to Saturday)
  const weeklyRecords = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    
    // Format header e.g. "Sun - Jun 14"
    const options = { weekday: 'short', month: 'short', day: 'numeric' };
    const label = d.toLocaleDateString(state.currentLanguage === 'th' ? 'th-TH' : 'en-US', options);
    
    weeklyRecords[dateStr] = {
      label: label,
      items: records.filter(r => r.date === dateStr)
    };
  }

  // Render HTML
  Object.keys(weeklyRecords).forEach(dateStr => {
    const group = weeklyRecords[dateStr];
    if (group.items.length === 0) return; // Only display days with items

    const groupDiv = document.createElement('div');
    groupDiv.className = 'history-day-group';
    
    let itemsHTML = '';
    group.items.forEach(item => {
      if (moduleKey === 'food') {
        const typeLabel = t(`meal_${item.type.toLowerCase()}`);
        itemsHTML += `
          <div class="history-item-row">
            <div class="history-item-desc">
              <span class="meal-type-tag">${typeLabel}</span>
              <span>${item.desc}</span>
            </div>
          </div>
        `;
      } else if (moduleKey === 'fit') {
        itemsHTML += `
          <div class="history-item-row">
            <div class="history-item-desc">
              <span class="meal-type-tag" style="background-color: var(--color-primary-tint); color: var(--color-primary);">${item.type}</span>
              <span style="font-size:12px; color: var(--text-muted);">${item.intensity} · ${item.duration} min</span>
            </div>
            <span class="history-item-coins">+${item.coins} 🪙</span>
          </div>
        `;
      }
    });

    groupDiv.innerHTML = `
      <div class="history-day-header">${group.label}</div>
      ${itemsHTML}
    `;

    container.appendChild(groupDiv);
  });
}

function renderRedeemedHistory() {
  const listContainer = document.getElementById('redeem-history-list');
  if (!listContainer) return;
  listContainer.innerHTML = '';

  const spends = state.transactions
    .filter(tItem => tItem.type === 'spend')
    .sort((a, b) => b.id - a.id);

  if (spends.length === 0) {
    listContainer.innerHTML = `<div style="text-align:center;font-size:12px;color:var(--text-light);padding:10px 0;">${t('no_redeems')}</div>`;
    return;
  }

  spends.forEach(item => {
    const row = document.createElement('div');
    row.className = 'history-item-row';
    
    const dateFormatted = formatLocalDate(item.date);
    const itemEmoji = item.emoji || '🎁';
    
    row.innerHTML = `
      <div class="history-item-desc">
        <span style="font-size:16px; margin-right: 4px;">${itemEmoji}</span>
        <span>${item.desc}</span>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="font-size:11px; color:var(--text-muted);">${dateFormatted}</span>
        <span style="font-family:var(--font-brand); font-weight:800; color:var(--color-danger); font-size: 13px;">-${item.amount} 🪙</span>
      </div>
    `;
    listContainer.appendChild(row);
  });
}

// ----------------------------------------------------
// Fit Tab Controller (Workout, Dr. Yuna & Quests)
// ----------------------------------------------------

function initFitController() {
  const saveWorkoutBtn = document.getElementById('save-workout-btn');
  const durationInput = document.getElementById('workout-input-duration');

  let selectedWorkoutType = 'Gym';
  let selectedWorkoutIntensity = 'Moderate';

  // Workout type selector pills
  const typeBtns = document.querySelectorAll('.type-pill-btn');
  typeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      typeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedWorkoutType = btn.getAttribute('data-type');
    });
  });

  // Intensity selector pills
  const intensityBtns = document.querySelectorAll('.intensity-pill-btn');
  intensityBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      intensityBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedWorkoutIntensity = btn.getAttribute('data-intensity');
    });
  });

  saveWorkoutBtn.addEventListener('click', () => {
    const type = selectedWorkoutType;
    const intensity = selectedWorkoutIntensity;
    const duration = parseInt(durationInput.value);

    if (isNaN(duration) || duration <= 0) {
      alert(state.currentLanguage === 'th' ? 'กรุณาระบุระยะเวลาการออกกำลังกายที่ถูกต้อง' : 'Please enter a valid workout duration.');
      return;
    }

    // Calculators
    let typeMult = 1.0;
    if (type === 'Bodyweight') typeMult = 1.1;
    if (type === 'Cardio') typeMult = 1.2;
    if (type === 'Gym') typeMult = 1.5;

    let intMult = 1.0;
    if (intensity === 'Moderate') intMult = 1.5;
    if (intensity === 'Hard') intMult = 2.0;

    // Base math
    let coinsEarned = Math.round(duration * typeMult * intMult);

    // Apply Streak multiplier if streak exists (+10% per day, up to +50%)
    const comboPercent = Math.min(50, state.fitStreak * 10);
    const multiplier = 1 + (comboPercent / 100);
    const finalCoins = Math.round(coinsEarned * multiplier);

    // Record workout
    const today = getTodayString();
    state.workouts.push({
      id: Date.now(),
      date: today,
      type: type,
      duration: duration,
      intensity: intensity,
      coins: finalCoins
    });

    // Record Earn Transaction
    state.transactions.push({
      id: Date.now(),
      date: today,
      amount: finalCoins,
      type: 'earn',
      desc: type
    });

    // Update balance
    state.coins += finalCoins;

    // Update streak
    updateStreakCounter('fit');

    // Check weekly quest additions
    checkWeeklyQuest(type);

    // Dr Yuna comments congrats
    let message = t('coach_gym_log')
      .replace('[duration]', duration)
      .replace('[coins]', finalCoins);
    
    if (state.fitStreak > 1) {
      message += " " + t('coach_streak');
    }
    updateDrYunaCoachMessage(message, 'active');

    saveState();
    durationInput.value = '45';
    
    renderFitUI();
  });

  renderFitUI();
}

function renderFitUI() {
  render30DaysGrid('fit');
  updateWeeklyQuestProgress();
  renderWeeklyHistoryList('fit');
  drawCoinFlowChart();
}

function checkWeeklyQuest(type) {
  // Weekly Quest target: 5 Cardio or Walk sessions
  if (type === 'Cardio' || type === 'Walk') {
    const weeklyQuestProgress = getWeeklyQuestCount() + 1;
    if (weeklyQuestProgress === 5) {
      // Award quest completion
      state.coins += 100;
      state.transactions.push({
        id: Date.now(),
        date: getTodayString(),
        amount: 100,
        type: 'earn',
        desc: 'Weekly Quest Completed'
      });
      updateDrYunaCoachMessage(t('weekly_quest_done'), 'celebrate');
      alert(t('weekly_quest_done'));
    }
  }
}

function getWeeklyQuestCount() {
  // Get count of Cardio/Walk workouts logged in the last 7 days
  const today = new Date();
  let count = 0;
  
  state.workouts.forEach(w => {
    const wDate = new Date(w.date);
    const diffTime = Math.abs(today - wDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays <= 7 && (w.type === 'Cardio' || w.type === 'Walk')) {
      count++;
    }
  });

  return count;
}

function updateWeeklyQuestProgress() {
  const count = getWeeklyQuestCount();
  const fill = document.getElementById('quest-progress-fill');
  const ratio = document.getElementById('quest-progress-ratio');

  const percentage = Math.min(100, (count / 5) * 100);
  fill.style.width = `${percentage}%`;
  ratio.textContent = `${count}/5 ${t('quest_progress')}`;
}

function updateDrYunaCoachMessage(customText, mood = 'neutral') {
  const displayEl = document.getElementById('coach-message-display');
  if (displayEl) displayEl.textContent = customText;

  const avatarEl = document.querySelector('.coach-avatar');
  if (avatarEl) {
    if (mood === 'active') avatarEl.textContent = '💪';
    else if (mood === 'celebrate') avatarEl.textContent = '🎉';
    else if (mood === 'treat') avatarEl.textContent = '🍰';
    else avatarEl.textContent = '🩺';
  }
}

// ----------------------------------------------------
// Dynamic 30-Day Coin Flow Column Chart (SVG layout)
// ----------------------------------------------------

function drawCoinFlowChart() {
  const container = document.getElementById('chart-bars-container');
  if (!container) return;
  container.innerHTML = '';

  const today = new Date();
  const maxVal = 60; // Max amplitude for scale alignment

  // Create columns for the last 30 calendar days
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    // Sum transactions for this day
    const earned = state.transactions
      .filter(tItem => tItem.date === dateStr && tItem.type === 'earn')
      .reduce((sum, item) => sum + item.amount, 0);

    const spent = state.transactions
      .filter(tItem => tItem.date === dateStr && tItem.type === 'spend')
      .reduce((sum, item) => sum + item.amount, 0);

    const column = document.createElement('div');
    column.className = 'chart-bar-col';
    column.setAttribute('title', `${formatLocalDate(dateStr)}: Earned ${earned}, Spent ${spent}`);

    // Dynamic segments sizes heights calculations
    const earnedHeight = Math.min(50, (earned / maxVal) * 50); // Percent height cap at 50%
    const spentHeight = Math.min(50, (spent / maxVal) * 50);

    column.innerHTML = `
      ${earned > 0 ? `<div class="chart-bar-segment chart-bar-earned" style="height: ${earnedHeight}%"></div>` : ''}
      ${spent > 0 ? `<div class="chart-bar-segment chart-bar-spent" style="height: ${spentHeight}%"></div>` : ''}
    `;

    container.appendChild(column);
  }
}

// ----------------------------------------------------
// More Settings Panel Logic
// ----------------------------------------------------

function initMoreController() {
  const themeToggle = document.getElementById('theme-toggle-btn');
  const langToggle = document.getElementById('lang-toggle-btn');
  const backupBtn = document.getElementById('backup-btn');
  const restoreBtn = document.getElementById('restore-btn');
  const fileInput = document.getElementById('import-file-input');
  const resetBtn = document.getElementById('reset-data-btn');

  // Dark/Light Theme Switcher
  themeToggle.addEventListener('click', () => {
    state.darkMode = !state.darkMode;
    saveState();
    
    // Toggle class
    if (state.darkMode) {
      document.body.classList.add('dark-theme');
      document.getElementById('theme-icon').setAttribute('data-lucide', 'sun');
    } else {
      document.body.classList.remove('dark-theme');
      document.getElementById('theme-icon').setAttribute('data-lucide', 'moon');
    }
    safeCreateIcons();
  });

  // Language Toggle Switcher
  langToggle.addEventListener('click', () => {
    state.currentLanguage = state.currentLanguage === 'en' ? 'th' : 'en';
    saveState();
    applyLanguage();
    
    // Redraw lists
    renderTreatShop();
    renderFoodUI();
    renderFitUI();
    populateCashCategories();
    renderFinanceUI();
  });

  // Backup Export
  backupBtn.addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `aura-coins-backup-${getTodayString()}.json`);
    dlAnchorElem.click();
  });

  // Restore Import
  restoreBtn.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
      try {
        const importedData = JSON.parse(evt.target.result);
        if (typeof importedData.coins === 'number' && Array.isArray(importedData.workouts)) {
          state = { ...DEFAULT_STATE, ...importedData };
          saveState();

          // Refresh UI
          initStateAndUI();
          renderTreatShop();
          renderFoodUI();
          renderFitUI();
          populateCashCategories();
          renderFinanceUI();
          
          alert(t('import_success'));
        } else {
          alert(t('import_fail'));
        }
      } catch (err) {
        alert(t('import_fail'));
      }
    };
    reader.readAsText(file);
  });

  // Reset Application Data
  resetBtn.addEventListener('click', () => {
    const confirmation = confirm("Are you sure you want to reset all data? This will clear your entire coins balance, meals, and workouts log.");
    if (confirmation) {
      state = { ...DEFAULT_STATE };
      saveState();

      // Refresh everything
      initStateAndUI();
      renderTreatShop();
      renderFoodUI();
      renderFitUI();
      populateCashCategories();
      renderFinanceUI();
    }
  });

  // GitHub Cloud Sync Elements & Listeners
  const ghUserEl = document.getElementById('github-input-username');
  const ghRepoEl = document.getElementById('github-input-repo');
  const ghTokenEl = document.getElementById('github-input-token');
  const ghAutoSyncEl = document.getElementById('github-input-autosync');

  if (ghUserEl && state.githubSettings) {
    ghUserEl.value = state.githubSettings.username || '';
    ghRepoEl.value = state.githubSettings.repo || '';
    ghTokenEl.value = state.githubSettings.token || '';
    ghAutoSyncEl.checked = !!state.githubSettings.autoSync;

    const saveSettings = () => {
      state.githubSettings.username = ghUserEl.value.trim();
      state.githubSettings.repo = ghRepoEl.value.trim();
      state.githubSettings.token = ghTokenEl.value.trim();
      state.githubSettings.autoSync = ghAutoSyncEl.checked;
      saveState();
    };

    ghUserEl.addEventListener('input', saveSettings);
    ghRepoEl.addEventListener('input', saveSettings);
    ghTokenEl.addEventListener('input', saveSettings);
    ghAutoSyncEl.addEventListener('change', saveSettings);

    // Test Connection
    document.getElementById('github-test-btn').addEventListener('click', async () => {
      const statusEl = document.getElementById('github-sync-status');
      if (!statusEl) return;
      statusEl.style.color = 'var(--text-muted)';
      statusEl.textContent = state.currentLanguage === 'th' ? 'กำลังเชื่อมต่อ...' : 'Connecting...';

      const success = await testGitHubConnection();
      if (success) {
        statusEl.style.color = 'var(--color-primary)';
        statusEl.textContent = state.currentLanguage === 'th' ? 'เชื่อมต่อสำเร็จ! ✅' : 'Connected successfully! ✅';
      } else {
        statusEl.style.color = 'var(--color-danger)';
        statusEl.textContent = state.currentLanguage === 'th' ? 'การเชื่อมต่อล้มเหลว ❌ ตรวจสอบ Token และชื่อคลังข้อมูล' : 'Connection failed ❌ Check Token and Repo name.';
      }
    });

    // Sync Now
    document.getElementById('github-sync-btn').addEventListener('click', async () => {
      const statusEl = document.getElementById('github-sync-status');
      if (!statusEl) return;
      statusEl.style.color = 'var(--text-muted)';
      statusEl.textContent = state.currentLanguage === 'th' ? 'กำลังซิงค์ข้อมูล...' : 'Syncing...';

      const success = await syncWithGitHub('sync');
      if (success) {
        statusEl.style.color = 'var(--color-primary)';
        statusEl.textContent = state.currentLanguage === 'th' ? 'ซิงค์ข้อมูลเสร็จสิ้น! 🎉' : 'Sync completed! 🎉';
        
        // Refresh UI
        initStateAndUI();
        renderTreatShop();
        renderFoodUI();
        renderFitUI();
        populateCashCategories();
        renderFinanceUI();
      } else {
        statusEl.style.color = 'var(--color-danger)';
        statusEl.textContent = state.currentLanguage === 'th' ? 'การซิงค์ข้อมูลล้มเหลว ❌' : 'Sync failed ❌';
      }
    });
  }
}

// ----------------------------------------------------
// Personal Finance Logic (Income & Expense)
// ----------------------------------------------------

const FINANCE_CATEGORIES = {
  expense: {
    en: ['Food', 'Travel', 'Shopping', 'Bills', 'Others'],
    th: ['อาหาร', 'เดินทาง', 'ช็อปปิ้ง', 'ค่าสาธารณูปโภค/บิล', 'อื่นๆ']
  },
  income: {
    en: ['Salary', 'Investment', 'Others'],
    th: ['เงินเดือน', 'การลงทุน', 'อื่นๆ']
  }
};

let currentCashType = 'expense';

function initFinanceController() {
  const typeBtns = document.querySelectorAll('.cash-type-btn');
  const categorySelect = document.getElementById('cash-input-category');
  const amountInput = document.getElementById('cash-input-amount');
  const descInput = document.getElementById('cash-input-desc');
  const saveBtn = document.getElementById('save-cash-btn');

  if (!saveBtn) return;

  // Toggle Type
  typeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      typeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCashType = btn.getAttribute('data-type');
      populateCashCategories();
    });
  });

  // Save Transaction
  saveBtn.addEventListener('click', () => {
    const amount = parseFloat(amountInput.value);
    const desc = descInput.value.trim();
    const category = categorySelect.value;

    if (isNaN(amount) || amount <= 0) {
      alert(state.currentLanguage === 'th' ? 'กรุณาระบุจำนวนเงินที่ถูกต้อง' : 'Please enter a valid amount.');
      return;
    }

    const newTx = {
      id: Date.now(),
      date: getTodayString(),
      type: currentCashType,
      category: category,
      amount: amount,
      desc: desc
    };

    state.cashTransactions.push(newTx);
    saveState();
    
    // Clear inputs
    amountInput.value = '';
    descInput.value = '';

    renderFinanceUI();
  });

  populateCashCategories();
  renderFinanceUI();
}

function populateCashCategories() {
  const categorySelect = document.getElementById('cash-input-category');
  if (!categorySelect) return;
  categorySelect.innerHTML = '';

  const lang = state.currentLanguage || 'en';
  const cats = FINANCE_CATEGORIES[currentCashType][lang];
  cats.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    categorySelect.appendChild(opt);
  });
}

function renderFinanceUI() {
  const balanceVal = document.getElementById('cash-balance-value');
  const incomeVal = document.getElementById('cash-income-value');
  const expenseVal = document.getElementById('cash-expense-value');
  const listContainer = document.getElementById('cash-history-list');

  if (!balanceVal) return;

  // Calculate totals
  let totalIncome = 0;
  let totalExpense = 0;

  state.cashTransactions.forEach(tx => {
    if (tx.type === 'income') {
      totalIncome += tx.amount;
    } else {
      totalExpense += tx.amount;
    }
  });

  const netBalance = totalIncome - totalExpense;

  // Format currency
  balanceVal.textContent = netBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  incomeVal.textContent = `฿${totalIncome.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  expenseVal.textContent = `฿${totalExpense.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Set net balance color based on positive/negative
  if (netBalance >= 0) {
    balanceVal.style.color = 'var(--color-primary)';
  } else {
    balanceVal.style.color = 'var(--color-danger)';
  }

  // Render History List
  listContainer.innerHTML = '';
  if (state.cashTransactions.length === 0) {
    listContainer.innerHTML = `
      <div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 13px;">
        ${state.currentLanguage === 'th' ? 'ไม่มีบันทึกรายรับ-รายจ่าย' : 'No transactions recorded yet.'}
      </div>
    `;
    return;
  }

  // Sort latest first
  const sorted = [...state.cashTransactions].sort((a, b) => b.id - a.id);

  sorted.forEach(tx => {
    const item = document.createElement('div');
    item.className = 'weekly-history-item';
    item.style.padding = '12px 14px';

    const isIncome = tx.type === 'income';
    const colorClass = isIncome ? 'color: var(--color-primary); font-weight: 700;' : 'color: var(--color-danger); font-weight: 700;';
    const prefix = isIncome ? '+' : '-';
    
    // Choose appropriate emoji based on category
    let emoji = '💰';
    if (tx.type === 'expense') {
      if (tx.category.includes('อาหาร') || tx.category.toLowerCase().includes('food')) emoji = '🍲';
      else if (tx.category.includes('เดินทาง') || tx.category.toLowerCase().includes('travel')) emoji = '🚗';
      else if (tx.category.includes('ช็อปปิ้ง') || tx.category.toLowerCase().includes('shop')) emoji = '🛍️';
      else if (tx.category.includes('บิล') || tx.category.toLowerCase().includes('bill')) emoji = '📄';
      else emoji = '💸';
    } else {
      if (tx.category.includes('เงินเดือน') || tx.category.toLowerCase().includes('salary')) emoji = '💼';
      else if (tx.category.includes('ลงทุน') || tx.category.toLowerCase().includes('invest')) emoji = '📈';
      else emoji = '💵';
    }

    item.innerHTML = `
      <div class="weekly-item-main" style="display: flex; align-items: center; gap: 10px; flex: 1;">
        <span style="font-size: 20px;">${emoji}</span>
        <div>
          <div style="font-weight: 700; font-size: 13px; color: var(--text-main);">${tx.category}</div>
          <div style="font-size: 11px; color: var(--text-muted);">${tx.desc || (state.currentLanguage === 'th' ? 'ไม่มีคำอธิบาย' : 'No description')}</div>
        </div>
      </div>
      <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end;">
        <span style="${colorClass}">฿${prefix}${tx.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        <span style="font-size: 9px; color: var(--text-muted); margin-top: 2px;">${formatLocalDate(tx.date)}</span>
      </div>
      <button class="item-delete-btn" style="background: none; border: none; color: var(--text-muted); cursor: pointer; margin-left: 8px; display: flex; align-items: center; justify-content: center; padding: 4px;" data-id="${tx.id}">
        <i data-lucide="x" style="width: 14px; height: 14px;"></i>
      </button>
    `;

    // Hook up delete listener
    item.querySelector('.item-delete-btn').addEventListener('click', () => {
      if (confirm(state.currentLanguage === 'th' ? 'ต้องการลบบันทึกนี้ใช่หรือไม่?' : 'Delete this transaction?')) {
        state.cashTransactions = state.cashTransactions.filter(t => t.id !== tx.id);
        saveState();
        renderFinanceUI();
      }
    });

    listContainer.appendChild(item);
  });

  safeCreateIcons();
}

// ----------------------------------------------------
// GitHub Synchronization Services
// ----------------------------------------------------

async function testGitHubConnection() {
  const settings = state.githubSettings;
  if (!settings.username || !settings.repo || !settings.token) return false;

  const url = `https://api.github.com/repos/${settings.username}/${settings.repo}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${settings.token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    return res.ok;
  } catch (err) {
    console.error("GitHub Connection Test Error:", err);
    return false;
  }
}

async function syncWithGitHub(mode = 'sync') {
  const settings = state.githubSettings;
  if (!settings.username || !settings.repo || !settings.token) return false;

  const path = 'data.json';
  const url = `https://api.github.com/repos/${settings.username}/${settings.repo}/contents/${path}`;

  try {
    // 1. Fetch file content from GitHub to get current SHA and remote state
    let remoteState = null;
    let sha = null;
    
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${settings.token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (res.ok) {
      const data = await res.json();
      sha = data.sha;
      // Decode Base64 string safely supporting UTF-8 (Thai characters/emojis)
      const decodedStr = decodeURIComponent(escape(atob(data.content)));
      remoteState = JSON.parse(decodedStr);
    } else if (res.status !== 404) {
      // API error (not 404 not found)
      return false;
    }

    // 2. Perform actions depending on mode
    let stateToUpload = null;

    if (mode === 'upload') {
      // Overwrite GitHub with local state
      stateToUpload = state;
    } else if (mode === 'download') {
      // Overwrite local with GitHub state
      if (!remoteState) return false;
      state = remoteState;
      saveState();
      return true;
    } else if (mode === 'sync') {
      // Merge local and remote state
      if (remoteState) {
        state = mergeStates(state, remoteState);
        saveState();
      }
      stateToUpload = state;
    }

    // 3. Upload merged state back to GitHub
    const commitMsg = `sync: update aura coin data vault ${getTodayString()}`;
    const cleanState = { ...stateToUpload };
    // Omit GitHub settings token for security so they don't commit it to their repository!
    cleanState.githubSettings = { ...stateToUpload.githubSettings, token: '' };

    const bodyContent = btoa(unescape(encodeURIComponent(JSON.stringify(cleanState))));

    const putRes = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${settings.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: commitMsg,
        content: bodyContent,
        sha: sha || undefined
      })
    });

    return putRes.ok;
  } catch (err) {
    console.error("GitHub Sync Error:", err);
    return false;
  }
}

// Conflict-free Union Merge of two states
function mergeStates(local, remote) {
  const merged = { ...local };

  // Sync workouts, meals, transactions, and cashTransactions by unique IDs (union)
  merged.workouts = unionById(local.workouts, remote.workouts);
  merged.meals = unionById(local.meals, remote.meals);
  merged.transactions = unionById(local.transactions, remote.transactions);
  merged.cashTransactions = unionById(local.cashTransactions, remote.cashTransactions);

  // Take whichever coins count is higher or remote if local is default
  merged.coins = Math.max(local.coins || 100, remote.coins || 100);

  // Streaks
  merged.fitStreak = Math.max(local.fitStreak || 0, remote.fitStreak || 0);
  merged.foodStreak = Math.max(local.foodStreak || 0, remote.foodStreak || 0);

  // Treats: union custom treats
  merged.treats = unionById(local.treats, remote.treats);

  // Preserve the local GitHub Settings (so their local Token is not cleared)
  merged.githubSettings = local.githubSettings;

  return merged;
}

function unionById(arr1, arr2) {
  if (!Array.isArray(arr1)) arr1 = [];
  if (!Array.isArray(arr2)) arr2 = [];
  
  const map = new Map();
  arr1.forEach(item => map.set(item.id, item));
  arr2.forEach(item => map.set(item.id, item));
  
  return Array.from(map.values());
}

// ----------------------------------------------------
// Pull to Refresh Touch Interactions Logic
// ----------------------------------------------------

function initPullToRefresh() {
  const mainContent = document.querySelector('.app-content');
  const indicator = document.getElementById('pull-refresh-indicator');
  const textEl = document.getElementById('txt-pull-refresh');

  if (!mainContent || !indicator) return;

  let startY = 0;
  let currentY = 0;
  let pulling = false;
  const threshold = 65; // drag threshold to trigger refresh (px)

  mainContent.addEventListener('touchstart', (e) => {
    // Only trigger if scrollable area is at the top
    if (mainContent.scrollTop === 0) {
      startY = e.touches[0].pageY;
      pulling = true;
      mainContent.style.transition = 'none';
      indicator.style.transition = 'none';
    }
  }, { passive: true });

  mainContent.addEventListener('touchmove', (e) => {
    if (!pulling) return;

    if (mainContent.scrollTop > 0) {
      pulling = false;
      resetPullToRefresh();
      return;
    }

    currentY = e.touches[0].pageY;
    const diff = currentY - startY;

    if (diff > 0) {
      // Apply drag resistance (logarithmic ease)
      const dragDist = Math.min(threshold * 1.5, diff * 0.45);
      
      mainContent.style.transform = `translateY(${dragDist}px)`;
      indicator.style.opacity = Math.min(1, dragDist / threshold);
      
      if (dragDist >= threshold) {
        textEl.textContent = state.currentLanguage === 'th' ? 'ปล่อยเพื่อซิงค์ข้อมูล...' : 'Release to sync...';
      } else {
        textEl.textContent = state.currentLanguage === 'th' ? 'ดึงลงเพื่อซิงค์ข้อมูล...' : 'Pull to sync...';
      }
    }
  }, { passive: true });

  mainContent.addEventListener('touchend', async (e) => {
    if (!pulling) return;
    pulling = false;

    const diff = currentY - startY;
    const dragDist = Math.min(threshold * 1.5, diff * 0.45);

    if (dragDist >= threshold && state.githubSettings && state.githubSettings.token) {
      // Trigger sync
      mainContent.style.transition = 'transform 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.15)';
      mainContent.style.transform = 'translateY(50px)';
      
      indicator.style.transition = 'opacity 0.2s ease';
      indicator.style.opacity = '1';
      textEl.textContent = state.currentLanguage === 'th' ? 'กำลังซิงค์...' : 'Syncing...';

      const success = await syncWithGitHub('sync');

      if (success) {
        textEl.textContent = state.currentLanguage === 'th' ? 'ซิงค์ข้อมูลสำเร็จ! ✅' : 'Sync completed! ✅';
        
        // Refresh UI
        initStateAndUI();
        renderTreatShop();
        renderFoodUI();
        renderFitUI();
        populateCashCategories();
        renderFinanceUI();
      } else {
        textEl.textContent = state.currentLanguage === 'th' ? 'ซิงค์ล้มเหลว ❌' : 'Sync failed ❌';
      }

      // Hide pull refresh after brief delay
      setTimeout(resetPullToRefresh, 1300);
    } else {
      resetPullToRefresh();
    }
  });

  function resetPullToRefresh() {
    mainContent.style.transition = 'transform 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.15)';
    mainContent.style.transform = 'translateY(0)';
    indicator.style.transition = 'opacity 0.2s ease';
    indicator.style.opacity = '0';
  }
}
