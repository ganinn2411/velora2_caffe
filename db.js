"use strict";

/* ═══════════════════════════════════════════════
   AURA Coffee & Kitchen — db.js
   Firebase Firestore ile gerçek zamanlı senkron veri katmanı.

   Nasıl çalışır?
   - USERS / MENU / TABLES / SETTINGS / COUPONS tek bir ana
     dokümanda ("aura_pos/shared_state") alan olarak saklanır.
   - ORDERS (siparişler) ise AYRI dokümanlar olarak bir
     alt koleksiyonda tutulur: "aura_pos/shared_state/orders/{id}".
     Böylece iki cihaz aynı anda farklı sipariş eklerse birbirinin
     verisini EZMEZ — eskiden tüm sipariş listesi tek bir dizi
     alanı olarak baştan yazıldığı için bu mümkündü.
   - Her cihaz açıldığında bu verilere "canlı dinleyici" (onSnapshot)
     bağlar. Herhangi bir cihaz veri değiştirdiğinde, TÜM cihazlar
     anında günceller.
   - script.js eskisi gibi senkron (await'siz) DB.get()/DB.set()
     çağırabilsin diye, bulut verisi bellek içi bir "_cache"
     nesnesinde tutulur. localStorage artık sadece "ilk açılışta
     hızlı yükleme + internet yokken yedek" amacıyla kullanılır.
   - SESSION (kim giriş yapmış) bilgisi bilerek cihaza özel
     bırakıldı; her cihazda kendi oturumu olmalı.

   YAZMA GÜVENİLİRLİĞİ (önemli):
   - Her yazma önce localStorage'daki kalıcı "bekleyen yazmalar"
     kuyruğuna kaydedilir, SONRA buluta gönderilir. Yazma başarılı
     olunca kuyruktan silinir. Böylece: internet anlık kesilirse,
     sekme/uygulama kapanırsa ya da cihaz uyku moduna geçerse,
     kaydedilememiş hiçbir değişiklik sessizce kaybolmaz — kuyrukta
     kalır ve bağlantı geri geldiğinde otomatik tekrar denenir
     (periyodik olarak + "online" olayında + sayfa yeniden
     açıldığında).
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

// Ana dokümanda tek bir alan olarak senkronlanacak alanlar
// (ORDERS artık burada değil — kendi alt koleksiyonunda yönetiliyor,
// SESSION ise hiç buluta gitmiyor).
const SYNCED_KEYS = [
  DB_KEYS.USERS, DB_KEYS.MENU, DB_KEYS.TABLES, DB_KEYS.SETTINGS, DB_KEYS.COUPONS,
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
if (!Array.isArray(_cache[DB_KEYS.ORDERS])) _cache[DB_KEYS.ORDERS] = _cache[DB_KEYS.ORDERS] || [];

/* ── BEKLEYEN YAZMALAR KUYRUĞU (kalıcı) ────────────────
   Buluta gönderilemeyen her değişiklik burada tutulur ve
   sayfa kapatılıp açılsa bile kaybolmaz (localStorage'da). */
const PENDING_KEY = "aura_pending_writes_v1";
let _pending = { fields: {}, orders: {} };
(function _loadPending() {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      _pending.fields = (parsed && parsed.fields) || {};
      _pending.orders = (parsed && parsed.orders) || {};
    }
  } catch {}
})();
function _persistPending() {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(_pending)); } catch {}
}
window.AURA_PENDING_COUNT = () =>
  Object.keys(_pending.fields).length + Object.keys(_pending.orders).length;

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
let _mainDocReady = false;
let _ordersColReady = false;
function _markReady() {
  if (_ready) return;
  _ready = true;
  _readyWaiters.forEach(fn => fn());
  _readyWaiters = [];
}
function _checkFullyReady() {
  if (_mainDocReady && _ordersColReady) _markReady();
}

/* ── Firestore bağlantısı ──────────────────────────────
   firebase-config.js içindeki FIREBASE_CONFIG kullanılır.
   index.html sırası: firebase SDK -> firebase-config.js -> db.js  */
let _cloudDoc = null;
let _ordersCol = null;
let _cloudEnabled = false;
let _migrationAttempted = false;

(function initCloud() {
  if (typeof firebase === "undefined" || typeof FIREBASE_CONFIG === "undefined") {
    console.warn("Firebase bulunamadı, sadece bu cihazda (localStorage) çalışılıyor.");
    window.AURA_CLOUD_STATUS = "offline";
    window.AURA_CLOUD_STATUS_DETAIL = "Firebase SDK veya config dosyası yüklenmedi.";
    _mainDocReady = true; _ordersColReady = true;
    _markReady();
    return;
  }
  try {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    const fdb = firebase.firestore();
    _cloudDoc  = fdb.collection("aura_pos").doc("shared_state");
    _ordersCol = _cloudDoc.collection("orders");
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
        _mainDocReady = true;
        _checkFullyReady();
        if (!_migrationAttempted) {
          _migrationAttempted = true;
          _migrateOldOrdersIfNeeded(data);
        }
        _retryPending();
        if (changed && typeof window.onCloudDataChanged === "function") {
          window.onCloudDataChanged();
        }
      },
      err => {
        console.error("Firestore bağlantı hatası, localStorage ile devam ediliyor:", err);
        _cloudEnabled = false;
        window.AURA_CLOUD_STATUS = "error";
        window.AURA_CLOUD_STATUS_DETAIL = (err && err.code) ? err.code : String(err);
        _mainDocReady = true; _ordersColReady = true;
        _markReady();
      }
    );

    _initOrdersSync();
  } catch (e) {
    console.error("Firebase başlatılamadı, localStorage ile devam ediliyor:", e);
    window.AURA_CLOUD_STATUS = "error";
    window.AURA_CLOUD_STATUS_DETAIL = (e && e.message) ? e.message : String(e);
    _mainDocReady = true; _ordersColReady = true;
    _markReady();
  }
})();

/* ── SİPARİŞ ALT KOLEKSİYONU CANLI SENKRONU ────────────
   Her sipariş "aura_pos/shared_state/orders/{orderId}" adında
   kendi dokümanında tutulur. Bu sayede iki cihaz aynı anda farklı
   sipariş eklese bile birbirinin verisini silmez (eskiden tüm
   dizi tek seferde baştan yazılıyordu, bu bir yarış durumuydu). */
function _initOrdersSync() {
  if (!_ordersCol) return;
  _ordersCol.onSnapshot(
    snap => {
      // Mevcut önbellekten haritaya al, sadece değişenleri güncelle.
      const map = {};
      (_cache[DB_KEYS.ORDERS] || []).forEach(o => { if (o && o.id) map[o.id] = o; });
      snap.docChanges().forEach(change => {
        const id = change.doc.id;
        if (change.type === "removed") delete map[id];
        else map[id] = change.doc.data();
      });
      // Henüz buluta ulaşmamış (kuyrukta bekleyen) yerel siparişler
      // ekrandan kaybolmasın diye haritaya geri eklenir.
      Object.keys(_pending.orders).forEach(id => {
        if (_pending.orders[id] && !map[id]) map[id] = _pending.orders[id];
      });
      const arr = Object.values(map).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      _cache[DB_KEYS.ORDERS] = arr;
      _saveToLocalStorage(DB_KEYS.ORDERS, arr);
      window.AURA_CLOUD_STATUS = "connected";
      _ordersColReady = true;
      _checkFullyReady();
      _retryPending();
      if (typeof window.onCloudDataChanged === "function") window.onCloudDataChanged();
    },
    err => {
      console.error("Sipariş senkron hatası, localStorage ile devam ediliyor:", err);
      _ordersColReady = true;
      _checkFullyReady();
    }
  );
}

/* ── ESKİ FORMATTAN TEK SEFERLİK TAŞIMA ────────────────
   Önceki sürümde tüm siparişler "aura_orders" adlı TEK bir dizi
   alanında tutuluyordu. O veriler kaybolmasın diye, ana dokümanda
   hâlâ böyle bir dizi varsa (ve daha önce taşınmadıysa) her bir
   siparişi kendi dokümanına kopyalıyoruz. Doküman id'si sipariş
   id'siyle aynı olduğu için bu işlem güvenle birden fazla kez
   çalışsa bile veri çoğaltmaz (idempotent). */
function _migrateOldOrdersIfNeeded(mainDocData) {
  if (!_cloudEnabled || !_ordersCol || !_cloudDoc) return;
  if (mainDocData && mainDocData.ordersMigratedV2) return;
  const oldArr = mainDocData ? mainDocData[DB_KEYS.ORDERS] : null;
  if (!Array.isArray(oldArr) || oldArr.length === 0) {
    _cloudDoc.set({ ordersMigratedV2: true }, { merge: true }).catch(() => {});
    return;
  }
  console.log(`Eski format ${oldArr.length} sipariş bulundu, ayrı dokümanlara taşınıyor…`);
  const chunkSize = 400; // Firestore batch limiti 500
  const chunks = [];
  for (let i = 0; i < oldArr.length; i += chunkSize) chunks.push(oldArr.slice(i, i + chunkSize));

  const fdb = firebase.firestore();
  const commits = chunks.map(chunk => {
    const batch = fdb.batch();
    chunk.forEach(o => {
      if (o && o.id) batch.set(_ordersCol.doc(String(o.id)), o);
    });
    return batch.commit();
  });

  Promise.all(commits)
    .then(() => {
      console.log("Sipariş taşıma tamamlandı ✓");
      return _cloudDoc.set({ ordersMigratedV2: true }, { merge: true });
    })
    .catch(e => console.error("Eski sipariş taşıma hatası (tekrar denenecek):", e));
}

/* ── ALAN (USERS/MENU/TABLES/SETTINGS/COUPONS) YAZMA ───
   Kuyruğa kaydedip hemen (kısa bir debounce ile) buluta gönderir.
   Başarısız olursa kuyrukta kalır, retry döngüsü tekrar dener. */
let _writeTimers = {};
function _scheduleCloudWrite(key, value) {
  if (!SYNCED_KEYS.includes(key)) return;
  _pending.fields[key] = value;
  _persistPending();
  if (!_cloudEnabled || !_cloudDoc) return; // bağlantı gelince retry döngüsü yakalar
  clearTimeout(_writeTimers[key]);
  _writeTimers[key] = setTimeout(() => _flushField(key), 250);
}
function _flushField(key) {
  if (!_cloudEnabled || !_cloudDoc) return;
  if (!Object.prototype.hasOwnProperty.call(_pending.fields, key)) return;
  const value = _pending.fields[key];
  _cloudDoc.set({ [key]: value }, { merge: true })
    .then(() => {
      // Yazma sırasında değer tekrar değişmediyse kuyruktan çıkar.
      if (_pending.fields[key] === value) {
        delete _pending.fields[key];
        _persistPending();
      }
      window.AURA_LAST_WRITE_OK = true;
      if (typeof window.onCloudWriteResult === "function") window.onCloudWriteResult(true, null);
    })
    .catch(e => {
      console.error("Buluta yazma hatası:", e);
      window.AURA_LAST_WRITE_OK = false;
      window.AURA_LAST_WRITE_ERROR = (e && e.code) ? e.code : String(e);
      if (typeof window.onCloudWriteResult === "function") window.onCloudWriteResult(false, window.AURA_LAST_WRITE_ERROR);
      // _pending.fields[key] kasıtlı olarak silinmiyor — retry döngüsü tekrar dener.
    });
}

/* ── SİPARİŞ YAZMA (kendi dokümanı) ─────────────────────
   Her sipariş kendi id'siyle ayrı bir dokümana yazılır; asla
   tüm sipariş listesi baştan yazılmaz. */
function _writeOrderToCloud(order) {
  if (!order || !order.id) return;
  _pending.orders[order.id] = order;
  _persistPending();
  if (!_cloudEnabled || !_ordersCol) return;
  _ordersCol.doc(String(order.id)).set(order)
    .then(() => {
      if (_pending.orders[order.id] === order) {
        delete _pending.orders[order.id];
        _persistPending();
      }
      window.AURA_LAST_WRITE_OK = true;
      if (typeof window.onCloudWriteResult === "function") window.onCloudWriteResult(true, null);
    })
    .catch(e => {
      console.error("Sipariş buluta yazılamadı:", e);
      window.AURA_LAST_WRITE_OK = false;
      window.AURA_LAST_WRITE_ERROR = (e && e.code) ? e.code : String(e);
      if (typeof window.onCloudWriteResult === "function") window.onCloudWriteResult(false, window.AURA_LAST_WRITE_ERROR);
      // _pending.orders[order.id] kasıtlı olarak silinmiyor — retry döngüsü tekrar dener.
    });
}

/* ── KUYRUĞU BOŞALTMA (retry) ───────────────────────────
   Periyodik olarak + internet geri geldiğinde + sayfa açılışında
   bekleyen tüm yazmaları tekrar dener. set() işlemleri "son hâl"
   yazdığı için tekrar göndermek güvenlidir (idempotent). */
function _retryPending() {
  if (!_cloudEnabled) return;
  Object.keys(_pending.fields).forEach(_flushField);
  Object.keys(_pending.orders).forEach(id => {
    const o = _pending.orders[id];
    if (o) _writeOrderToCloud(o);
  });
}
setInterval(_retryPending, 4000);
window.addEventListener("online", _retryPending);
// Not: tarayıcılar "beforeunload" sırasında ağ isteklerinin bitmesini
// GARANTİ ETMEZ — bu yalnızca en iyi çaba (best-effort) bir denemedir.
// Asıl güvence yukarıdaki kalıcı kuyruk + periyodik retry'dır.
window.addEventListener("beforeunload", _retryPending);
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") _retryPending();
});

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

  if (!Array.isArray(DB.get(DB_KEYS.ORDERS))) _cache[DB_KEYS.ORDERS] = [];
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

/* ── ORDER DB ─────────────────────────────────────────
   ÖNEMLİ: Siparişler artık tek bir dizi alanı olarak DEĞİL,
   her biri kendi Firestore dokümanı olarak saklanır (bkz.
   _writeOrderToCloud). Bu sayede:
     - Bir sipariş yazılamazsa (offline/hata) sadece o sipariş
       kuyrukta bekler ve tekrar denenir; ekrandan/kaydınızdan
       ASLA sessizce silinmez.
     - İki cihaz aynı anda farklı sipariş eklerse birbirini
       ezmez (eskiden tüm liste baştan yazıldığı için mümkündü).
   Aşağıdaki API script.js için birebir aynı kalır — hiçbir
   şeyi değiştirmenize gerek yok. ─────────────────────────── */
const OrderDB = {
  getAll()    { return _cache[DB_KEYS.ORDERS] || []; },
  getById(id) { return this.getAll().find(o => o.id === id); },
  getToday() {
    const today = new Date(); today.setHours(0,0,0,0);
    return this.getAll().filter(o => new Date(o.createdAt) >= today);
  },
  add(order) {
    const all = this.getAll().slice();
    all.push(order);
    _cache[DB_KEYS.ORDERS] = all;
    _saveToLocalStorage(DB_KEYS.ORDERS, all);
    _writeOrderToCloud(order);
  },
  update(id, changes) {
    const all = this.getAll().slice();
    const idx = all.findIndex(o => o.id === id);
    if (idx < 0) return;
    const updated = { ...all[idx], ...changes };
    all[idx] = updated;
    _cache[DB_KEYS.ORDERS] = all;
    _saveToLocalStorage(DB_KEYS.ORDERS, all);
    _writeOrderToCloud(updated);
  },
  /* Eski API ile uyumluluk için tutuldu (script.js kullanmıyor,
     ama başka bir yerden çağrılırsa diye): her siparişi tek tek
     buluta yazar, tüm koleksiyonu silip baştan yazmaz. */
  save(arr) {
    _cache[DB_KEYS.ORDERS] = arr;
    _saveToLocalStorage(DB_KEYS.ORDERS, arr);
    arr.forEach(o => _writeOrderToCloud(o));
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
