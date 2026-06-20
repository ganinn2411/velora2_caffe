"use strict";

/* ═══════════════════════════════════════════════
   AURA Coffee & Kitchen — db.js
   Firebase Firestore ile gerçek zamanlı senkron veri katmanı.

   Nasıl çalışır?
   - Tüm veriler (kullanıcılar, menü, masalar, siparişler, kuponlar,
     ayarlar) Firestore'da TEK bir dokümanda saklanır.
   - Her cihaz açıldığında o dokümana "canlı dinleyici" (onSnapshot)
     bağlar. Herhangi bir cihaz veri değiştirdiğinde, TÜM cihazlar
     anında günceller.
   - script.js eskisi gibi senkron (await'siz) DB.get()/DB.set()
     çağırabilsin diye, bulut verisi bellek içi bir "_cache"
     nesnesinde tutulur. localStorage artık sadece "ilk açılışta
     hızlı yükleme + internet yokken yedek" amacıyla kullanılır.
   - SESSION (kim giriş yapmış) bilgisi bilerek cihaza özel
     bırakıldı; her cihazda kendi oturumu olmalı.
═══════════════════════════════════════════════ */

const DB_KEYS = {
  USERS:    "aura_users",
  MENU:     "aura_menu",
  TABLES:   "aura_tables",
  ORDERS:   "aura_orders",
  SETTINGS: "aura_settings",
  SESSION:  "aura_session",   // cihaza özel — buluta senkron edilmez
  COUPONS:  "aura_coupons",
};

// Bulutla senkronlanacak alanlar (SESSION hariç)
const SYNCED_KEYS = [
  DB_KEYS.USERS, DB_KEYS.MENU, DB_KEYS.TABLES,
  DB_KEYS.ORDERS, DB_KEYS.SETTINGS, DB_KEYS.COUPONS,
];

/* ── Bellek içi önbellek (senkron okuma için) ─────────── */
const _cache = {};

function _loadFromLocalStorage(key) {
  try {
    const r = localStorage.getItem(key);
    return r ? JSON.parse(r) : null;
  } catch { return null; }
}
function _saveToLocalStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

Object.values(DB_KEYS).forEach(k => { _cache[k] = _loadFromLocalStorage(k); });

/* ── Hazır olma durumu ─────────────────────────────────
   İlk bulut verisi gelene kadar (ya da bağlantı hatası
   alınana kadar) bekletmek için kullanılır. */
/* ── Bağlantı durumu (DevTools'suz teşhis için) ────────
   window.AURA_CLOUD_STATUS her zaman güncel tutulur:
   "connecting" | "connected" | "offline" | "error"      */
window.AURA_CLOUD_STATUS = "connecting";
window.AURA_CLOUD_STATUS_DETAIL = "";

let _ready = false;
let _readyWaiters = [];
function _markReady() {
  if (_ready) return;
  _ready = true;
  _readyWaiters.forEach(fn => fn());
  _readyWaiters = [];
}

/* ── Firestore bağlantısı ──────────────────────────────
   firebase-config.js içindeki FIREBASE_CONFIG kullanılır.
   index.html sırası: firebase SDK -> firebase-config.js -> db.js  */
let _cloudDoc = null;
let _cloudEnabled = false;

(function initCloud() {
  if (typeof firebase === "undefined" || typeof FIREBASE_CONFIG === "undefined") {
    console.warn("Firebase bulunamadı, sadece bu cihazda (localStorage) çalışılıyor.");
    window.AURA_CLOUD_STATUS = "offline";
    window.AURA_CLOUD_STATUS_DETAIL = "Firebase SDK veya config dosyası yüklenmedi.";
    _markReady();
    return;
  }
  try {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    const fdb = firebase.firestore();
    _cloudDoc = fdb.collection("aura_pos").doc("shared_state");
    _cloudEnabled = true;

    _cloudDoc.onSnapshot(
      snap => {
        const data = snap.exists ? (snap.data() || {}) : {};
        let changed = false;
        SYNCED_KEYS.forEach(k => {
          const incoming = Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null;
          if (JSON.stringify(_cache[k]) !== JSON.stringify(incoming)) {
            _cache[k] = incoming;
            _saveToLocalStorage(k, incoming);
            changed = true;
          }
        });
        window.AURA_CLOUD_STATUS = "connected";
        window.AURA_CLOUD_STATUS_DETAIL = "";
        _markReady();
        if (changed && typeof window.onCloudDataChanged === "function") {
          window.onCloudDataChanged();
        }
      },
      err => {
        console.error("Firestore bağlantı hatası, localStorage ile devam ediliyor:", err);
        _cloudEnabled = false;
        window.AURA_CLOUD_STATUS = "error";
        window.AURA_CLOUD_STATUS_DETAIL = (err && err.code) ? err.code : String(err);
        _markReady();
      }
    );
  } catch (e) {
    console.error("Firebase başlatılamadı, localStorage ile devam ediliyor:", e);
    window.AURA_CLOUD_STATUS = "error";
    window.AURA_CLOUD_STATUS_DETAIL = (e && e.message) ? e.message : String(e);
    _markReady();
  }
})();

/* Buluta yazma — hızlı ardışık değişiklikleri (örn. sepete art arda
   ürün ekleme) tek bir ağ isteğinde birleştirmek için kısa bir
   gecikmeyle (debounce) yazılır. */
let _writeTimers = {};
function _scheduleCloudWrite(key, value) {
  if (!_cloudEnabled || !_cloudDoc) return;
  clearTimeout(_writeTimers[key]);
  _writeTimers[key] = setTimeout(() => {
    _cloudDoc.set({ [key]: value }, { merge: true })
      .then(() => {
        window.AURA_LAST_WRITE_OK = true;
        if (typeof window.onCloudWriteResult === "function") window.onCloudWriteResult(true, null);
      })
      .catch(e => {
        console.error("Buluta yazma hatası:", e);
        window.AURA_LAST_WRITE_OK = false;
        window.AURA_LAST_WRITE_ERROR = (e && e.code) ? e.code : String(e);
        if (typeof window.onCloudWriteResult === "function") window.onCloudWriteResult(false, window.AURA_LAST_WRITE_ERROR);
      });
  }, 250);
}

const DB = {
  get(key) { return _cache[key] !== undefined ? _cache[key] : null; },
  set(key, value) {
    _cache[key] = value;
    _saveToLocalStorage(key, value);
    if (SYNCED_KEYS.includes(key)) _scheduleCloudWrite(key, value);
    return true;
  },
  remove(key) {
    _cache[key] = null;
    localStorage.removeItem(key);
    if (SYNCED_KEYS.includes(key)) _scheduleCloudWrite(key, null);
  },
  /* İlk bulut senkronu tamamlanana kadar beklemek için.
     script.js boot sırasında bunu kullanır. */
  ready() {
    return new Promise(resolve => {
      if (_ready) resolve();
      else _readyWaiters.push(resolve);
    });
  },
};

function seedIfEmpty() {
  if (!DB.get(DB_KEYS.USERS)) {
    DB.set(DB_KEYS.USERS, [
      { id:"u1", name:"Müdür Kerem",   role:"admin",   pin:"1234", avatar:"K", color:"#4CAF7A", active:true },
      { id:"u2", name:"Barista Efe",   role:"barista", pin:"2222", avatar:"E", color:"#C8A96E", active:true },
      { id:"u3", name:"Garson Selin",  role:"waiter",  pin:"3333", avatar:"S", color:"#9B8FE0", active:true },
      { id:"u4", name:"Barista Ayşe",  role:"barista", pin:"4444", avatar:"A", color:"#E05575", active:true },
    ]);
  }

  if (!DB.get(DB_KEYS.MENU)) {
    DB.set(DB_KEYS.MENU, [
      { id:1,  cat:"Espresso Bazlı",   emoji:"☕", name:"Espresso",        price:65,  desc:"Yoğun, saf espresso",           popular:false, available:true },
      { id:2,  cat:"Espresso Bazlı",   emoji:"🖤", name:"Americano",       price:75,  desc:"Espresso + sıcak su",            popular:true,  available:true },
      { id:3,  cat:"Espresso Bazlı",   emoji:"🤍", name:"Cappuccino",      price:95,  desc:"Espresso + köpüklü süt",         popular:true,  available:true },
      { id:4,  cat:"Espresso Bazlı",   emoji:"🥛", name:"Latte",           price:100, desc:"Espresso + buharlanmış süt",     popular:false, available:true },
      { id:5,  cat:"Espresso Bazlı",   emoji:"⬜", name:"Flat White",      price:108, desc:"Yoğun espresso + microfoam",     popular:true,  available:true },
      { id:6,  cat:"Espresso Bazlı",   emoji:"🟤", name:"Cortado",         price:85,  desc:"Espresso + az süt",              popular:false, available:true },
      { id:7,  cat:"Espresso Bazlı",   emoji:"💛", name:"Macchiato",       price:90,  desc:"Espresso + süt köpüğü",          popular:false, available:true },
      { id:10, cat:"Soğuk Kahve",      emoji:"🧊", name:"Cold Brew",       price:115, desc:"18 saat demleme, yumuşak",       popular:true,  available:true },
      { id:11, cat:"Soğuk Kahve",      emoji:"🥤", name:"Iced Latte",      price:110, desc:"Espresso + soğuk süt + buz",     popular:true,  available:true },
      { id:12, cat:"Soğuk Kahve",      emoji:"🌊", name:"Nitro Cold Brew", price:135, desc:"Azotlu, kadifemsi doku",          popular:true,  available:true },
      { id:13, cat:"Soğuk Kahve",      emoji:"❄️", name:"Iced Americano",  price:85,  desc:"Çift espresso + buz + su",        popular:false, available:true },
      { id:15, cat:"Soğuk Kahve",      emoji:"🍵", name:"Cold Matcha",     price:125, desc:"Matcha + oat milk + buz",         popular:true,  available:true },
      { id:17, cat:"Özel Tatlar",      emoji:"🧡", name:"Caramel Latte",   price:120, desc:"Tatlı karamel soslu latte",       popular:true,  available:true },
      { id:18, cat:"Özel Tatlar",      emoji:"🟫", name:"Hazelnut Mocha",  price:125, desc:"Fındık + çikolata + espresso",    popular:false, available:true },
      { id:20, cat:"Özel Tatlar",      emoji:"🤎", name:"Brown Sugar Oat", price:130, desc:"Kahverengi şeker + yulaf sütü",   popular:true,  available:true },
      { id:21, cat:"Özel Tatlar",      emoji:"💜", name:"Lavender Latte",  price:138, desc:"Lavanta şurubu + espresso",       popular:true,  available:true },
      { id:24, cat:"Çay & Alternatif", emoji:"🍵", name:"Matcha Latte",    price:110, desc:"Seremoni matcha + süt",           popular:true,  available:true },
      { id:25, cat:"Çay & Alternatif", emoji:"🟠", name:"Chai Latte",      price:105, desc:"Baharatlı masala çayı",           popular:false, available:true },
      { id:27, cat:"Çay & Alternatif", emoji:"🫖", name:"Earl Grey",       price:85,  desc:"Bergamot aromatlı siyah çay",     popular:false, available:true },
      { id:28, cat:"Çay & Alternatif", emoji:"🦋", name:"Butterfly Pea",   price:125, desc:"Renk değiştiren büyülü çay",      popular:true,  available:true },
      { id:31, cat:"Atıştırmalık",     emoji:"🥐", name:"Croissant",       price:90,  desc:"Tereyağlı, çıtır Fransız",        popular:true,  available:true },
      { id:32, cat:"Atıştırmalık",     emoji:"🥑", name:"Avokado Toast",   price:168, desc:"Ekşi maya + avokado + yumurta",   popular:true,  available:true },
      { id:33, cat:"Atıştırmalık",     emoji:"🍌", name:"Banana Bread",    price:95,  desc:"Ev yapımı, nemli dilim",           popular:false, available:true },
      { id:35, cat:"Atıştırmalık",     emoji:"🍰", name:"Cheesecake",      price:148, desc:"New York tarzı dilim",             popular:true,  available:true },
      { id:36, cat:"Atıştırmalık",     emoji:"🍪", name:"Cookie",          price:55,  desc:"Çikolata parçacıklı",              popular:false, available:true },
      { id:39, cat:"Serinletici",      emoji:"🍋", name:"Limonata",        price:80,  desc:"Taze sıkım + nane",               popular:false, available:true },
      { id:40, cat:"Serinletici",      emoji:"💧", name:"Su (Gazlı)",      price:50,  desc:"San Pellegrino 500ml",             popular:false, available:true },
      { id:41, cat:"Serinletici",      emoji:"🫐", name:"Smoothie",        price:138, desc:"Karışık meyve + yoğurt",          popular:true,  available:true },
      { id:42, cat:"Serinletici",      emoji:"🌺", name:"Hibiscus Cooler", price:108, desc:"Hibiskus + limon + buz",           popular:true,  available:true },
    ]);
  }

  if (!DB.get(DB_KEYS.TABLES)) {
    const tables = [];
    for (let i = 1; i <= 8; i++)
      tables.push({ id:`I${i}`, num:i, zone:"İç Alan", cap:i%3===0?6:i%2===0?4:2, status:"free" });
    for (let i = 1; i <= 5; i++)
      tables.push({ id:`T${i}`, num:`T${i}`, zone:"Teras", cap:4, status:"free" });
    for (let i = 1; i <= 3; i++)
      tables.push({ id:`L${i}`, num:`L${i}`, zone:"Lounge", cap:i===2?8:6, status:"free" });
    DB.set(DB_KEYS.TABLES, tables);
  }

  if (!DB.get(DB_KEYS.ORDERS))   DB.set(DB_KEYS.ORDERS, []);
  if (!DB.get(DB_KEYS.COUPONS))  DB.set(DB_KEYS.COUPONS, []);
  if (!DB.get(DB_KEYS.SETTINGS)) DB.set(DB_KEYS.SETTINGS, { orderCounter:0, taxRate:8 });
}

/* ── USER DB ──────────────────────────────────── */
const UserDB = {
  getAll()    { return DB.get(DB_KEYS.USERS) || []; },
  save(u)     { DB.set(DB_KEYS.USERS, u); },
  getById(id) { return this.getAll().find(u => u.id === id); },
  authenticate(id, pin) {
    const u = this.getById(id);
    return u && u.pin === pin && u.active !== false ? u : null;
  },
};

/* ── SESSION DB (cihaza özel) ─────────────────── */
const SessionDB = {
  get()     { return DB.get(DB_KEYS.SESSION); },
  set(user) { DB.set(DB_KEYS.SESSION, { userId: user.id, loginTime: Date.now() }); },
  clear()   { DB.remove(DB_KEYS.SESSION); },
  getUser() {
    const s = this.get();
    if (!s) return null;
    return UserDB.getById(s.userId);
  },
};

/* ── MENU DB ──────────────────────────────────── */
const MenuDB = {
  getAll()           { return DB.get(DB_KEYS.MENU) || []; },
  save(items)        { DB.set(DB_KEYS.MENU, items); },
  getCategories()    { return [...new Set(this.getAll().map(p => p.cat))]; },
  getByCategory(cat) { return this.getAll().filter(p => p.cat === cat); },
  getById(id)        { return this.getAll().find(p => p.id === id); },
  nextId()           { return Math.max(...this.getAll().map(p => p.id), 0) + 1; },
  add(item) {
    const all = this.getAll();
    all.push({ ...item, id: this.nextId() });
    this.save(all);
  },
  update(id, changes) {
    const all = this.getAll();
    const idx = all.findIndex(p => p.id === id);
    if (idx >= 0) { all[idx] = { ...all[idx], ...changes }; this.save(all); }
  },
  delete(id) { this.save(this.getAll().filter(p => p.id !== id)); },
};

/* ── TABLE DB ─────────────────────────────────── */
const TableDB = {
  getAll()     { return DB.get(DB_KEYS.TABLES) || []; },
  save(t)      { DB.set(DB_KEYS.TABLES, t); },
  getById(id)  { return this.getAll().find(t => t.id === id); },
  update(id, changes) {
    const all = this.getAll();
    const idx = all.findIndex(t => t.id === id);
    if (idx >= 0) { all[idx] = { ...all[idx], ...changes }; this.save(all); }
  },
};

/* ── ORDER DB ─────────────────────────────────── */
const OrderDB = {
  getAll()    { return DB.get(DB_KEYS.ORDERS) || []; },
  save(o)     { DB.set(DB_KEYS.ORDERS, o); },
  getById(id) { return this.getAll().find(o => o.id === id); },
  getToday() {
    const today = new Date(); today.setHours(0,0,0,0);
    return this.getAll().filter(o => new Date(o.createdAt) >= today);
  },
  add(order) { const all = this.getAll(); all.push(order); this.save(all); },
  update(id, changes) {
    const all = this.getAll();
    const idx = all.findIndex(o => o.id === id);
    if (idx >= 0) { all[idx] = { ...all[idx], ...changes }; this.save(all); }
  },
  /* Bir masaya ait, henüz ödenmemiş (açık hesap) siparişler */
  getOpenByTable(tableId) {
    return this.getAll().filter(o => o.tableId === tableId && !o.paid);
  },
  nextCounter() {
    const s = DB.get(DB_KEYS.SETTINGS) || { orderCounter:0 };
    s.orderCounter++;
    DB.set(DB_KEYS.SETTINGS, s);
    return s.orderCounter;
  },
};

/* ── COUPON DB ────────────────────────────────── */
const CouponDB = {
  getAll()   { return DB.get(DB_KEYS.COUPONS) || []; },
  save(c)    { DB.set(DB_KEYS.COUPONS, c); },
  getByCode(code) { return this.getAll().find(c => c.code === code && c.active); },
  add(coupon) {
    const all = this.getAll();
    all.push({ ...coupon, id:"cp_"+Date.now(), usedCount:0, active:true, createdAt:new Date().toISOString() });
    this.save(all);
  },
  toggle(id) {
    const all = this.getAll();
    const idx = all.findIndex(c => c.id === id);
    if (idx >= 0) { all[idx].active = !all[idx].active; this.save(all); }
  },
  delete(id) { this.save(this.getAll().filter(c => c.id !== id)); },
  use(code) {
    const all = this.getAll();
    const idx = all.findIndex(c => c.code === code);
    if (idx >= 0) { all[idx].usedCount = (all[idx].usedCount || 0) + 1; this.save(all); }
  },
};

/* ── SETTINGS DB ──────────────────────────────── */
const SettingsDB = {
  get()        { return DB.get(DB_KEYS.SETTINGS) || { orderCounter:0, taxRate:8 }; },
  save(s)      { DB.set(DB_KEYS.SETTINGS, s); },
  getTaxRate() { return this.get().taxRate || 8; },
};
