"use strict";

/* ═══════════════════════════════════════════════════════
   AURA Coffee & Kitchen — app.js
   Tüm uygulama mantığı
═══════════════════════════════════════════════════════ */

/* ── STATE ─────────────────────────────────────────── */
let currentUser    = null;
let cart           = [];
let orderType      = "dinein";   // "dinein" | "takeaway"
let selectedTable  = null;
let paymentMethod  = "cash";
let appliedCoupon  = null;
let editingProductId = null;
let activeCat      = "Tümü";
let cpCurrentFilter = "all";
let currentMenuCat  = "";
let selectedUserId  = null;
let tableDetailPayment = "cash"; // masa kapatma modalındaki ödeme seçimi
let currentView    = "pos";      // o anda ekranda gösterilen view (bulut güncellemesi için)

/* ── PARA FORMATLAMA (TR) ──────────────────────────── */
function formatMoney(n) {
  return (Number(n) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";
}
function paymentMethodLabel(o) {
  if (!o.paid) return "Ödenmedi";
  return o.paymentMethod === "cash" ? "Nakit" : o.paymentMethod === "card" ? "Kart" : "Bölüşüm";
}

/* ── BOOT ──────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  // Bulut verisi (varsa) gelene kadar bekle, sonra başlat.
  // Böylece bu cihazda eski/varsayılan veri yerine diğer
  // cihazlardaki güncel veriler gösterilir.
  DB.ready().then(() => {
    seedIfEmpty();
    applyBizBranding();
    updateClock();
    setInterval(updateClock, 1000);

    // Modal dışı tıkla kapat
    document.querySelectorAll(".modal-overlay").forEach(el => {
      el.addEventListener("click", e => {
        if (e.target === el) closeModal(el.id);
      });
    });

    // Önceki oturum
    const saved = SessionDB.getUser();
    if (saved) {
      loginUser(saved);
    } else {
      showLockScreen();
    }

    // Bulut bağlantı durumunu göster (DevTools'a girmeden anlamak için)
    setTimeout(() => {
      if (window.AURA_CLOUD_STATUS === "connected") {
        showToast("Bulut bağlantısı aktif ✓ — veriler tüm cihazlarda senkron", "green");
      } else if (window.AURA_CLOUD_STATUS === "offline") {
        showToast("Bulut bağlı değil — sadece bu cihazda çalışıyor (" + (window.AURA_CLOUD_STATUS_DETAIL||"") + ")", "red");
      } else if (window.AURA_CLOUD_STATUS === "error") {
        showToast("Bulut bağlantı hatası: " + (window.AURA_CLOUD_STATUS_DETAIL||"bilinmeyen hata"), "red");
      }
    }, 600);
  });
});

// Bir veri buluta yazılamadığında kullanıcıyı uyar
window.onCloudWriteResult = function(success, errorCode) {
  if (!success) {
    showToast("⚠️ Değişiklik buluta kaydedilemedi (" + errorCode + "). Sadece bu cihazda kaydedildi.", "red");
  }
};

/* ── BULUTTAN CANLI GÜNCELLEME ───────────────────────
   Başka bir cihaz veri değiştirdiğinde (örn. yeni sipariş,
   menü güncellemesi) buradaki fonksiyon tetiklenir ve o anda
   ekranda görünen view yeniden çizilir. */
function refreshCurrentViewFromCloud() {
  const shell = document.getElementById("appShell");
  if (!shell || shell.style.display === "none") return; // henüz giriş yapılmadı
  if (currentView === "pos")      renderPos();
  if (currentView === "tables")   renderTables();
  if (currentView === "barista")  renderBarista();
  if (currentView === "reports")  renderReports();
  if (currentView === "menu")     renderMenuManage();
  if (currentView === "coupons")  renderCoupons();
  if (currentView === "settings") renderSettings();
}
window.onCloudDataChanged = refreshCurrentViewFromCloud;

/* ── CLOCK ─────────────────────────────────────────── */
function updateClock() {
  const now = new Date();
  const ts  = now.toLocaleTimeString("tr-TR", { hour:"2-digit", minute:"2-digit" });
  const ds  = now.toLocaleDateString("tr-TR", { weekday:"long", day:"numeric", month:"long" });
  document.querySelectorAll(".clock-time").forEach(el => el.textContent = ts);
  document.querySelectorAll(".clock-date").forEach(el => el.textContent = ds);
}

/* ══════════════════════════════════════════════════════
   LOCK / AUTH
══════════════════════════════════════════════════════ */
function showLockScreen() {
  document.getElementById("lockScreen").style.display = "flex";
  document.getElementById("pinScreen").style.display  = "none";
  document.getElementById("appShell").style.display   = "none";
  renderStaffButtons();
}

function renderStaffButtons() {
  const grid = document.getElementById("staffGrid");
  if (!grid) return;
  const users = UserDB.getAll().filter(u => u.active !== false);
  grid.innerHTML = users.map(u => `
    <button class="staff-btn" onclick="selectStaff('${u.id}')">
      <div class="staff-avatar" style="background:${u.color || "#C8A96E"}">${u.avatar}</div>
      <span class="staff-name">${u.name}</span>
      <span class="staff-role">${roleLabel(u.role)}</span>
    </button>
  `).join("");
}

function selectStaff(userId) {
  selectedUserId = userId;
  const u = UserDB.getById(userId);
  if (!u) return;
  // PIN ekranına geç
  document.getElementById("lockScreen").style.display = "none";
  document.getElementById("pinScreen").style.display  = "flex";
  document.getElementById("pinUserAvatar").textContent = u.avatar;
  document.getElementById("pinUserAvatar").style.background = u.color || "#C8A96E";
  document.getElementById("pinUserName").textContent  = u.name;
  document.getElementById("pinUserRole").textContent  = roleLabel(u.role);
  clearPin();
}

let pinValue = "";
function pressPin(val) {
  if (pinValue.length >= 4) return;
  pinValue += val;
  updatePinDots();
  if (pinValue.length === 4) {
    setTimeout(checkPin, 180);
  }
}
function deletePin() {
  pinValue = pinValue.slice(0, -1);
  updatePinDots();
}
function clearPin() {
  pinValue = "";
  updatePinDots();
  const err = document.getElementById("pinError");
  if (err) err.textContent = "";
}
function updatePinDots() {
  document.querySelectorAll(".pin-dot").forEach((dot, i) => {
    dot.classList.toggle("filled", i < pinValue.length);
  });
}
function checkPin() {
  const u = UserDB.authenticate(selectedUserId, pinValue);
  if (u) {
    loginUser(u);
  } else {
    const err = document.getElementById("pinError");
    if (err) err.textContent = "Hatalı PIN, tekrar deneyin.";
    const card = document.getElementById("pinCard");
    if (card) { card.style.animation = "shake .4s ease"; setTimeout(() => card.style.animation = "", 400); }
    setTimeout(clearPin, 600);
  }
}
function backToStaffSelect() {
  document.getElementById("pinScreen").style.display  = "none";
  document.getElementById("lockScreen").style.display = "flex";
  clearPin();
}

function roleLabel(role) {
  if (role === "admin")   return "Müdür";
  if (role === "barista") return "Barista";
  if (role === "waiter")  return "Garson";
  return role;
}

function loginUser(u) {
  currentUser = u;
  SessionDB.set(u);
  document.getElementById("lockScreen").style.display = "none";
  document.getElementById("pinScreen").style.display  = "none";
  document.getElementById("appShell").style.display   = "flex";

  // Sidebar profil
  document.getElementById("staffPillAvatar").textContent        = u.avatar;
  document.getElementById("staffPillAvatar").style.background   = u.color || "";
  document.getElementById("staffPillAvatar").style.color        = "#0a0a0a";
  document.getElementById("staffPillName").textContent          = u.name;
  document.getElementById("staffPillRole").textContent          = roleLabel(u.role);

  // Nav görünürlüğü — 3 rol:
  // admin:   hepsi
  // barista: pos, tables, barista
  // waiter:  pos, tables
  const navBarista  = document.getElementById("nav-barista");
  const navReports  = document.getElementById("nav-reports");
  const navMenu     = document.getElementById("nav-menu");
  const navCoupons  = document.getElementById("nav-coupons");
  const navSettings = document.getElementById("nav-settings");

  if (u.role === "admin") {
    [navBarista, navReports, navMenu, navCoupons, navSettings].forEach(el => el && (el.style.display = "flex"));
  } else if (u.role === "barista") {
    navBarista  && (navBarista.style.display  = "flex");
    navReports  && (navReports.style.display  = "none");
    navMenu     && (navMenu.style.display     = "none");
    navCoupons  && (navCoupons.style.display  = "none");
    navSettings && (navSettings.style.display = "none");
  } else {
    // waiter
    [navBarista, navReports, navMenu, navCoupons, navSettings].forEach(el => el && (el.style.display = "none"));
  }

  switchView("pos");
}

function logout() {
  SessionDB.clear();
  currentUser = null;
  cart = [];
  orderType = "dinein";
  selectedTable = null;
  appliedCoupon = null;
  showLockScreen();
}

/* ══════════════════════════════════════════════════════
   VIEW SWITCHING
══════════════════════════════════════════════════════ */
const VIEWS = ["pos","tables","barista","reports","menu","coupons","settings"];

function switchView(v) {
  // Erişim kontrolü
  const role = currentUser ? currentUser.role : "waiter";
  const allowed = {
    admin:   ["pos","tables","barista","reports","menu","coupons","settings"],
    barista: ["pos","tables","barista"],
    waiter:  ["pos","tables"],
  };
  if (!(allowed[role] || []).includes(v)) {
    showToast("Bu alana erişim yetkiniz yok.", "red");
    return;
  }
  VIEWS.forEach(name => {
    const el = document.getElementById("view-" + name);
    if (el) el.style.display = name === v ? "flex" : "none";
    const nb = document.getElementById("nav-" + name);
    if (nb) nb.classList.toggle("active", name === v);
  });
  currentView = v;

  if (v === "pos")      { renderPos(); }
  if (v === "tables")   { renderTables(); }
  if (v === "barista")  { renderBarista(); }
  if (v === "reports")  { renderReports(); }
  if (v === "menu")     { currentMenuCat = ""; renderMenuManage(); }
  if (v === "coupons")  { renderCoupons(); }
  if (v === "settings") { renderSettings(); }
}

/* ══════════════════════════════════════════════════════
   POS VIEW
══════════════════════════════════════════════════════ */
function renderPos() {
  applyOrderTypeUI();
  renderCatTabs();
  renderProductGrid();
  renderOrderPanel();
}

function renderCatTabs() {
  const cats = ["Tümü", ...MenuDB.getCategories()];
  const container = document.getElementById("catTabs");
  if (!container) return;
  container.innerHTML = cats.map(c => {
    const count = c === "Tümü" ? MenuDB.getAll().length : MenuDB.getByCategory(c).length;
    return `<button class="cat-tab ${c === activeCat ? "active" : ""}" onclick="setCat('${c}')">
      ${c} <span class="cat-count">${count}</span>
    </button>`;
  }).join("");
}

function setCat(cat) {
  activeCat = cat;
  renderCatTabs();
  renderProductGrid();
}

function filterProducts() {
  renderProductGrid();
}

function renderProductGrid() {
  const search = (document.getElementById("posSearch")?.value || "").toLowerCase();
  let items = activeCat === "Tümü" ? MenuDB.getAll() : MenuDB.getByCategory(activeCat);
  if (search) items = items.filter(p => p.name.toLowerCase().includes(search) || p.desc.toLowerCase().includes(search));
  const grid = document.getElementById("productGrid");
  if (!grid) return;
  if (items.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text3);font-size:13px;">
      <div style="font-size:32px;margin-bottom:8px;">🔍</div>Ürün bulunamadı</div>`;
    return;
  }
  grid.innerHTML = items.map(p => `
    <div class="product-card ${p.available === false ? "unavailable" : ""}" onclick="addToCart(${p.id})">
      <div class="card-top-row">
        <span class="product-emoji">${p.emoji}</span>
        ${p.popular ? '<span class="popular-badge">⭐ Popüler</span>' : ""}
      </div>
      <div class="product-name">${p.name}</div>
      <div class="product-desc">${p.desc}</div>
      <div class="card-footer">
        <span class="product-price">${formatMoney(p.price)}</span>
        <button class="add-btn" onclick="event.stopPropagation();addToCart(${p.id})">+</button>
      </div>
    </div>
  `).join("");
}

function addToCart(productId) {
  const p = MenuDB.getById(productId);
  if (!p) return;
  const existing = cart.find(i => i.id === productId);
  if (existing) {
    existing.qty++;
  } else {
    cart.push({ id: p.id, name: p.name, emoji: p.emoji, price: p.price, qty: 1 });
  }
  renderOrderPanel();
  showToast(`${p.emoji} ${p.name} eklendi`);
}

function changeQty(productId, delta) {
  const idx = cart.findIndex(i => i.id === productId);
  if (idx < 0) return;
  cart[idx].qty += delta;
  if (cart[idx].qty <= 0) cart.splice(idx, 1);
  renderOrderPanel();
}

function clearOrder() {
  cart = [];
  appliedCoupon = null;
  renderOrderPanel();
}

/* ── Sipariş Tipi: Masada / Paket ───────────────────── */
function setOrderType(type) {
  orderType = type;
  if (type === "takeaway") selectedTable = null;
  applyOrderTypeUI();
  renderOrderPanel();
}

function applyOrderTypeUI() {
  document.getElementById("ot-dinein")?.classList.toggle("active", orderType === "dinein");
  document.getElementById("ot-takeaway")?.classList.toggle("active", orderType === "takeaway");
  const tableBtn = document.getElementById("tableSelectBtn");
  const paymentSection = document.getElementById("paymentSection");
  const dineinNote = document.getElementById("dineinNote");
  if (tableBtn) tableBtn.style.display = orderType === "dinein" ? "flex" : "none";
  if (paymentSection) paymentSection.style.display = orderType === "takeaway" ? "block" : "none";
  if (dineinNote) dineinNote.style.display = orderType === "dinein" ? "flex" : "none";
}

function renderOrderPanel() {
  // Sipariş no
  const settings = DB.get(DB_KEYS.SETTINGS) || { orderCounter:40 };
  document.getElementById("orderBadge").textContent = "#" + (settings.orderCounter + 1);

  // Seçili masa
  const tableLabel = document.getElementById("selectedTableLabel");
  if (tableLabel) {
    tableLabel.textContent = selectedTable
      ? `Masa ${selectedTable.num} — ${selectedTable.zone}`
      : "Masa Seç";
  }
  const tableBtn = document.getElementById("tableSelectBtn");
  if (tableBtn) tableBtn.classList.toggle("warn", orderType === "dinein" && !selectedTable);

  // Liste
  const list = document.getElementById("orderList");
  if (!list) return;
  if (cart.length === 0) {
    list.innerHTML = `<div class="order-empty"><div class="order-empty-icon">🛒</div><p>Sepet boş</p></div>`;
  } else {
    list.innerHTML = cart.map(item => `
      <div class="order-item">
        <span class="oi-emoji">${item.emoji}</span>
        <div class="oi-info">
          <div class="oi-name">${item.name}</div>
          <div class="oi-price">${formatMoney(item.price * item.qty)}</div>
        </div>
        <div class="oi-qty">
          <button class="qty-btn minus" onclick="changeQty(${item.id},-1)">−</button>
          <span class="qty-num">${item.qty}</span>
          <button class="qty-btn" onclick="changeQty(${item.id},1)">+</button>
        </div>
      </div>
    `).join("");
  }

  // Toplamlar
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  let discount = 0;
  if (appliedCoupon) {
    if (appliedCoupon.type === "percent") {
      discount = subtotal * appliedCoupon.value / 100;
    } else {
      discount = Math.min(appliedCoupon.value, subtotal);
    }
  }
  const total = Math.max(0, subtotal - discount);

  document.getElementById("subtotalDisplay").textContent = formatMoney(subtotal);
  document.getElementById("totalDisplay").textContent    = formatMoney(total);
  document.getElementById("confirmTotal").textContent    = formatMoney(total);

  const discountRow = document.getElementById("discountRow");
  if (discountRow) {
    discountRow.style.display = discount > 0 ? "flex" : "none";
    document.getElementById("discountDisplay").textContent = "- " + formatMoney(discount);
  }

  // Onay butonu: sepet boşsa VEYA masada sipariş için masa seçilmemişse pasif
  const needsTable = orderType === "dinein" && !selectedTable;
  document.getElementById("confirmBtn").disabled = cart.length === 0 || needsTable;

  const btnLabel = document.getElementById("confirmBtnLabel");
  if (btnLabel) {
    btnLabel.textContent = orderType === "takeaway" ? "Siparişi Tamamla ve Öde" : "Siparişi Mutfağa Gönder";
  }
}

/* ── Ödeme yöntemi ─────────────────────────────────── */
function selectPayment(method) {
  paymentMethod = method;
  ["cash","card","split"].forEach(m => {
    document.getElementById("pm-" + m)?.classList.toggle("active", m === method);
  });
}

/* ── İndirim / Kupon ───────────────────────────────── */
function toggleDiscount() {
  const box = document.getElementById("discountBox");
  if (box) box.style.display = box.style.display === "none" ? "block" : "none";
}

function applyCoupon() {
  const code = document.getElementById("couponInput")?.value.trim().toUpperCase();
  const msg  = document.getElementById("couponMsg");
  if (!code) return;

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const c = CouponDB.getByCode(code);

  if (!c) {
    if (msg) { msg.textContent = "❌ Geçersiz veya pasif kupon."; msg.style.color = "var(--red)"; }
    return;
  }
  if (c.min && subtotal < c.min) {
    if (msg) { msg.textContent = `⚠️ Min. ${formatMoney(c.min)} sepet gerekli.`; msg.style.color = "var(--orange)"; }
    return;
  }
  if (c.limit && c.usedCount >= c.limit) {
    if (msg) { msg.textContent = "❌ Kupon kullanım limitine ulaşıldı."; msg.style.color = "var(--red)"; }
    return;
  }

  appliedCoupon = c;
  if (msg) {
    const disc = c.type === "percent" ? `%${c.value} indirim` : `${formatMoney(c.value)} indirim`;
    msg.textContent = `✅ ${disc} uygulandı!`;
    msg.style.color = "var(--green)";
  }
  const removeBtn = document.getElementById("removeDiscount");
  if (removeBtn) removeBtn.style.display = "inline-block";
  renderOrderPanel();
}

function removeDiscount() {
  appliedCoupon = null;
  const inp = document.getElementById("couponInput");
  const msg = document.getElementById("couponMsg");
  const btn = document.getElementById("removeDiscount");
  if (inp) inp.value = "";
  if (msg) msg.textContent = "";
  if (btn) btn.style.display = "none";
  renderOrderPanel();
}

/* ── Siparişi Onayla ──────────────────────────────── */
function confirmOrder() {
  if (cart.length === 0) return;
  if (orderType === "dinein" && !selectedTable) {
    showToast("Lütfen önce bir masa seçin.", "red");
    return;
  }

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  let discount = 0;
  if (appliedCoupon) {
    discount = appliedCoupon.type === "percent"
      ? subtotal * appliedCoupon.value / 100
      : Math.min(appliedCoupon.value, subtotal);
  }
  const total = Math.max(0, subtotal - discount);
  const orderNum = OrderDB.nextCounter();
  const note = document.getElementById("orderNote")?.value || "";
  const isTakeaway = orderType === "takeaway";

  const order = {
    id: "ord_" + Date.now(),
    num: orderNum,
    orderType,
    tableId: isTakeaway ? null : selectedTable.id,
    tableLabel: isTakeaway ? "Paket" : `Masa ${selectedTable.num}`,
    items: cart.map(i => ({ ...i })),
    subtotal,
    discount,
    total,
    paymentMethod: isTakeaway ? paymentMethod : null,
    paid: isTakeaway,   // Paket: peşin ödenir. Masada: ödeme masa kapanırken alınır.
    couponCode: appliedCoupon?.code || null,
    note,
    status: "pending",
    createdAt: new Date().toISOString(),
    userId: currentUser?.id || null,
  };

  OrderDB.add(order);

  // Masa durumunu güncelle (dolu)
  if (!isTakeaway) {
    TableDB.update(selectedTable.id, { status:"occupied" });
  }

  // Kupon kullanım sayısını artır
  if (appliedCoupon) CouponDB.use(appliedCoupon.code);

  // Başarı modalı
  document.getElementById("successOrderNum").textContent = "#" + orderNum;
  document.getElementById("successDetails").innerHTML = isTakeaway
    ? `${order.tableLabel} &nbsp;|&nbsp; ${cart.reduce((s,i)=>s+i.qty,0)} ürün<br>
       <strong style="color:var(--accent);font-family:'Syne',sans-serif;font-size:18px">${formatMoney(total)}</strong>
       &nbsp;(${paymentMethod === "cash" ? "Nakit" : paymentMethod === "card" ? "Kart" : "Bölüşüm"})`
    : `${order.tableLabel} &nbsp;|&nbsp; ${cart.reduce((s,i)=>s+i.qty,0)} ürün<br>
       <strong style="color:var(--accent);font-family:'Syne',sans-serif;font-size:18px">${formatMoney(total)}</strong>
       <br><span style="color:var(--text3);font-size:11px">Ödeme, masa kapanırken alınacak</span>`;
  // Fiş yazdırma için son siparişi sakla
  window._lastPrintOrder = order;
  openModal("successModal");

  // Sepeti temizle
  cart = [];
  appliedCoupon = null;
  if (isTakeaway) selectedTable = null;   // Masada sipariş için masa seçimi korunur (yeni tur eklenebilir)
  if (document.getElementById("orderNote")) document.getElementById("orderNote").value = "";
  renderOrderPanel();
  updateCouponNavBadge();
}

/* ══════════════════════════════════════════════════════
   TABLES VIEW
══════════════════════════════════════════════════════ */
function renderTables() {
  const body = document.getElementById("tablesBody");
  if (!body) return;
  const tables = TableDB.getAll();
  const zones  = [...new Set(tables.map(t => t.zone))];

  body.innerHTML = zones.map(zone => {
    const zoneTables = tables.filter(t => t.zone === zone);
    return `
      <div class="zone-section">
        <div class="zone-title"><i class="fa-solid fa-location-dot"></i> ${zone}</div>
        <div class="tables-grid">
          ${zoneTables.map(t => tableCardHTML(t)).join("")}
        </div>
      </div>
    `;
  }).join("");
}

function tableCardHTML(t) {
  let statusLabel = "Boş";
  let statusClass = "free";
  let totalText   = "";

  const openOrders = OrderDB.getOpenByTable(t.id);
  if (openOrders.length > 0) {
    statusLabel = "Dolu"; statusClass = "occupied";
    const runningTotal = openOrders.reduce((s, o) => s + o.total, 0);
    totalText = `<div class="table-total">${formatMoney(runningTotal)}</div>`;
  } else if (t.status === "waiting") {
    statusLabel = "Bekliyor"; statusClass = "waiting";
  }

  return `
    <div class="table-card ${statusClass}" onclick="onTableClick('${t.id}')">
      <div class="table-capacity"><i class="fa-solid fa-user"></i>${t.cap}</div>
      <div class="table-num">${t.num}</div>
      <div class="table-status ${statusClass}">${statusLabel}</div>
      ${totalText}
    </div>
  `;
}

function onTableClick(tableId) {
  const t = TableDB.getById(tableId);
  if (!t) return;

  // POS'tan masa seçme modunda mı?
  const fromPOS = window._selectingTable;
  if (fromPOS) {
    selectedTable = t;
    orderType = "dinein";
    window._selectingTable = false;
    switchView("pos");
    showToast(`Masa ${t.num} seçildi (${t.zone})`);
    return;
  }

  // Açık hesabı olan masaya tıklandığında hesap detayını göster
  const openOrders = OrderDB.getOpenByTable(t.id);
  if (openOrders.length > 0) {
    showTableDetail(t);
  } else {
    // Boş masayı POS'ta seç
    selectedTable = t;
    orderType = "dinein";
    switchView("pos");
    showToast(`Masa ${t.num} seçildi`);
  }
}

function showTableDetail(t) {
  const openOrders = OrderDB.getOpenByTable(t.id);
  if (openOrders.length === 0) return;

  tableDetailPayment = "cash";
  const body = document.getElementById("tableDetailBody");
  const titleEl = document.getElementById("tableDetailTitle");
  if (titleEl) titleEl.textContent = `Masa ${t.num} — ${t.zone}`;

  const subtotal = openOrders.reduce((s, o) => s + o.subtotal, 0);
  const discount = openOrders.reduce((s, o) => s + o.discount, 0);
  const total    = openOrders.reduce((s, o) => s + o.total, 0);

  if (body) {
    body.innerHTML = `
      <div style="padding:16px 24px 4px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:11px;background:var(--orange-bg);color:var(--orange);padding:2px 8px;border-radius:6px;font-weight:600;">Açık Hesap</span>
        <span style="font-size:11px;color:var(--text3);">${openOrders.length} sipariş</span>
      </div>
      <div style="padding:8px 24px;flex:1;overflow-y:auto;">
        ${openOrders.map(order => `
          <div style="margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--bg4);">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <span style="font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:var(--accent);">#${order.num}</span>
              <span style="font-size:11px;color:var(--text3);">${new Date(order.createdAt).toLocaleTimeString("tr-TR",{hour:"2-digit",minute:"2-digit"})}</span>
            </div>
            ${order.items.map(i => `
              <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:13px;color:var(--text2);">
                <span>${i.emoji} ${i.name} <span style="color:var(--text3)">×${i.qty}</span></span>
                <span style="color:var(--text)">${formatMoney(i.price * i.qty)}</span>
              </div>
            `).join("")}
            ${order.note ? `<div style="background:var(--orange-bg);color:var(--orange);font-size:12px;padding:7px 10px;border-radius:8px;margin-top:6px;font-style:italic;">📝 ${order.note}</div>` : ""}
          </div>
        `).join("")}
      </div>
      <div style="padding:12px 24px;border-top:var(--border);">
        <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text2);margin-bottom:4px;">
          <span>Ara Toplam</span><span>${formatMoney(subtotal)}</span>
        </div>
        ${discount > 0 ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:var(--green);margin-bottom:4px;"><span>İndirim</span><span>- ${formatMoney(discount)}</span></div>` : ""}
        <div style="display:flex;justify-content:space-between;font-family:'Syne',sans-serif;font-size:16px;font-weight:700;color:var(--text);padding-top:8px;border-top:1px solid var(--bg5);">
          <span>Toplam</span><span style="color:var(--accent)">${formatMoney(total)}</span>
        </div>
      </div>
      <div style="padding:4px 24px 12px;border-top:var(--border);">
        <div style="font-size:10px;color:var(--text3);letter-spacing:1px;text-transform:uppercase;margin:10px 0 8px;">Ödeme Yöntemi</div>
        <div class="payment-methods">
          <button class="pay-method active" id="td-pm-cash" onclick="selectTableDetailPayment('cash')">
            <i class="fa-solid fa-money-bill-wave"></i> Nakit
          </button>
          <button class="pay-method" id="td-pm-card" onclick="selectTableDetailPayment('card')">
            <i class="fa-solid fa-credit-card"></i> Kart
          </button>
          <button class="pay-method" id="td-pm-split" onclick="selectTableDetailPayment('split')">
            <i class="fa-solid fa-divide"></i> Bölüşüm
          </button>
        </div>
      </div>
      <div style="padding:0 24px 20px;display:flex;gap:10px;">
        <button class="modal-btn secondary" style="flex:1" onclick="addOrderToTable('${t.id}')">
          <i class="fa-solid fa-plus"></i> Sipariş Ekle
        </button>
        <button class="modal-btn accent" style="flex:1" onclick="closeTableAndClear('${t.id}')">
          <i class="fa-solid fa-check"></i> Öde ve Kapat
        </button>
      </div>
    `;
  }
  openModal("tableDetailModal");
}

function selectTableDetailPayment(method) {
  tableDetailPayment = method;
  ["cash","card","split"].forEach(m => {
    document.getElementById("td-pm-" + m)?.classList.toggle("active", m === method);
  });
}

function addOrderToTable(tableId) {
  const t = TableDB.getById(tableId);
  if (!t) return;
  selectedTable = t;
  orderType = "dinein";
  closeModal("tableDetailModal");
  switchView("pos");
  showToast(`Masa ${t.num} için yeni sipariş ekleniyor`);
}

function closeTableAndClear(tableId) {
  const openOrders = OrderDB.getOpenByTable(tableId);
  if (openOrders.length === 0) return;

  const closedAt = new Date().toISOString();
  openOrders.forEach(o => {
    OrderDB.update(o.id, { paid:true, paymentMethod: tableDetailPayment, closedAt });
  });
  TableDB.update(tableId, { status:"free" });
  closeModal("tableDetailModal");
  renderTables();
  showToast("Masa kapatıldı, ödeme alındı ✓");

  // Masa hesabı fişi yazdır
  printTableReceipt(tableId, openOrders, closedAt);
}

function printTableReceipt(tableId, openOrders, closedAt) {
  const s       = SettingsDB.get();
  const bizName = s.bizName || "AURA Coffee & Kitchen";
  const taxRate = s.taxRate || 8;
  const t       = TableDB.getById(tableId);
  const tableLabel = t ? `Masa ${t.num} — ${t.zone}` : "Masa";

  const now     = new Date(closedAt);
  const dateStr = now.toLocaleDateString("tr-TR", { day:"2-digit", month:"2-digit", year:"numeric" });
  const timeStr = now.toLocaleTimeString("tr-TR", { hour:"2-digit", minute:"2-digit" });

  const payLabel = { cash:"Nakit", card:"Kredi Kartı", split:"Bölüşüm" }[tableDetailPayment] || "Nakit";

  // Tüm siparişlerin ürünlerini birleştir (aynı ürünleri topla)
  const itemMap = {};
  openOrders.forEach(order => {
    order.items.forEach(i => {
      const key = i.id;
      if (itemMap[key]) {
        itemMap[key].qty   += i.qty;
        itemMap[key].total += i.price * i.qty;
      } else {
        itemMap[key] = { ...i, total: i.price * i.qty };
      }
    });
  });
  const allItems = Object.values(itemMap);

  const subtotal   = openOrders.reduce((s, o) => s + o.subtotal, 0);
  const discount   = openOrders.reduce((s, o) => s + o.discount, 0);
  const total      = openOrders.reduce((s, o) => s + o.total, 0);
  const totalQty   = allItems.reduce((s, i) => s + i.qty, 0);
  const taxAmt     = total * taxRate / (100 + taxRate);
  const netAmt     = total - taxAmt;

  // Birden fazla sipariş varsa hepsini listele
  const orderNums  = openOrders.map(o => "#" + o.num).join(", ");
  const allNotes   = openOrders.filter(o => o.note).map(o => `#${o.num}: ${o.note}`).join(" | ");
  const staffNames = [...new Set(openOrders.map(o => o.userId ? (UserDB.getById(o.userId)?.name || "—") : "—"))].join(", ");

  const itemRows = allItems.map(i => {
    const name = `${i.emoji || ""} ${i.name}`.trim();
    const nameShort = name.length > 22 ? name.slice(0,21) + "…" : name;
    return `<tr>
      <td style="padding:2px 0;vertical-align:top">${nameShort}</td>
      <td style="text-align:center;vertical-align:top;white-space:nowrap">${i.qty}×</td>
      <td style="text-align:right;vertical-align:top;white-space:nowrap">${formatMoney(i.price)}</td>
      <td style="text-align:right;vertical-align:top;white-space:nowrap;font-weight:600">${formatMoney(i.total)}</td>
    </tr>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>Masa Fişi — ${tableLabel}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;600;700;800&display=swap');
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'DM Mono','Courier New',monospace;font-size:12px;background:#fff;color:#111;display:flex;justify-content:center;padding:20px 0}
    .receipt{width:80mm;padding:0 4mm}
    .header{text-align:center;padding-bottom:10px;margin-bottom:10px;border-bottom:1px dashed #aaa}
    .logo-box{width:44px;height:44px;background:#111;border-radius:10px;display:flex;align-items:center;justify-content:center;margin:0 auto 8px;font-family:'DM Sans',sans-serif;font-weight:800;font-size:20px;color:#fff}
    .biz-name{font-family:'DM Sans',sans-serif;font-size:16px;font-weight:700;margin-bottom:2px}
    .biz-sub{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:1.5px}
    .table-badge{display:inline-block;background:#111;color:#fff;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:700;padding:5px 16px;border-radius:20px;margin:10px 0 4px}
    .meta{font-size:11px;margin-bottom:10px}
    .meta-row{display:flex;justify-content:space-between;padding:2px 0}
    .meta-key{color:#666}
    .meta-val{font-weight:500}
    .order-nums{font-family:'DM Sans',sans-serif;font-size:11px;color:#888;text-align:center;margin-bottom:6px}
    .divider{border:none;border-top:1px dashed #aaa;margin:8px 0}
    .divider-solid{border:none;border-top:1px solid #111;margin:8px 0}
    .items-table{width:100%;border-collapse:collapse;font-size:11.5px;margin-bottom:2px}
    .items-table thead th{font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:#888;padding:0 0 4px 0;font-weight:500}
    .items-table thead th:nth-child(2),.items-table thead th:nth-child(3),.items-table thead th:nth-child(4){text-align:right}
    .items-table thead th:nth-child(2){text-align:center}
    .totals{margin-top:6px}
    .total-row{display:flex;justify-content:space-between;font-size:11px;padding:2px 0;color:#444}
    .total-row.discount{color:#1a8c4e}
    .total-grand{display:flex;justify-content:space-between;font-family:'DM Sans',sans-serif;font-size:17px;font-weight:800;padding:6px 0 4px}
    .payment-badge{display:inline-block;background:#111;color:#fff;font-family:'DM Sans',sans-serif;font-size:11px;font-weight:700;padding:4px 14px;border-radius:20px;letter-spacing:.3px;margin:4px 0}
    .tax-block{font-size:10px;color:#999;border-top:1px dashed #ccc;margin-top:6px;padding-top:6px}
    .tax-row{display:flex;justify-content:space-between;padding:1px 0}
    .note-block{background:#f5f5f5;border-left:3px solid #111;padding:6px 8px;font-size:11px;color:#333;margin-top:6px;border-radius:0 4px 4px 0}
    .note-label{font-size:9px;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px}
    .footer{text-align:center;margin-top:12px;padding-top:10px;border-top:1px dashed #aaa;font-size:10px;color:#aaa;line-height:1.8}
    .footer strong{color:#555;font-size:11px}
    .barcode{font-family:monospace;font-size:28px;letter-spacing:-2px;color:#111;margin:6px 0 2px;line-height:1}
    .barcode-num{font-size:9px;color:#aaa;letter-spacing:3px}
    @media print{body{padding:0}@page{margin:4mm;size:80mm auto}}
  </style>
</head>
<body>
<div class="receipt">

  <div class="header">
    <div class="logo-box">${bizName[0]?.toUpperCase()||"A"}</div>
    <div class="biz-name">${bizName}</div>
    <div class="biz-sub">Masa Hesabı</div>
  </div>

  <div style="text-align:center">
    <div class="table-badge">🪑 ${tableLabel}</div>
    <div class="order-nums">Siparişler: ${orderNums}</div>
  </div>

  <div class="meta">
    <div class="meta-row"><span class="meta-key">Tarih</span><span class="meta-val">${dateStr}</span></div>
    <div class="meta-row"><span class="meta-key">Kapanış Saati</span><span class="meta-val">${timeStr}</span></div>
    <div class="meta-row"><span class="meta-key">Personel</span><span class="meta-val">${staffNames}</span></div>
    <div class="meta-row"><span class="meta-key">Toplam Sipariş</span><span class="meta-val">${openOrders.length} sipariş · ${totalQty} ürün</span></div>
  </div>

  <hr class="divider">

  <table class="items-table">
    <thead>
      <tr>
        <th style="text-align:left">Ürün</th>
        <th>Adet</th>
        <th style="text-align:right">Fiyat</th>
        <th style="text-align:right">Tutar</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="totals">
    <hr class="divider">
    <div class="total-row"><span>Ara Toplam (${totalQty} ürün)</span><span>${formatMoney(subtotal)}</span></div>
    ${discount > 0 ? `<div class="total-row discount"><span>İndirim</span><span>-${formatMoney(discount)}</span></div>` : ""}
    <hr class="divider-solid">
    <div class="total-grand"><span>TOPLAM</span><span>${formatMoney(total)}</span></div>
    <div style="text-align:center;margin:4px 0 6px">
      <span class="payment-badge">✓ ${payLabel}</span>
    </div>
    <div class="tax-block">
      <div class="tax-row"><span>KDV Matrahı (%${taxRate})</span><span>${formatMoney(netAmt)}</span></div>
      <div class="tax-row"><span>KDV Tutarı</span><span>${formatMoney(taxAmt)}</span></div>
    </div>
  </div>

  ${allNotes ? `<div class="note-block"><div class="note-label">📝 Notlar</div>${allNotes}</div>` : ""}

  <div class="footer">
    <div class="barcode">|||||||||||||||||||||||</div>
    <div class="barcode-num">MASA-${tableId}-${Date.now().toString().slice(-6)}</div>
    <br>
    <strong>${bizName}</strong><br>
    ${dateStr} — ${timeStr}<br>
    Teşekkür ederiz, iyi günler! ☕
  </div>

</div>
<script>window.onload=function(){setTimeout(function(){window.print();},300)};<\/script>
</body></html>`;

  const w = window.open("", "_blank", "width=380,height=700,scrollbars=yes");
  if (!w) { showToast("Pop-up engellendi! Tarayıcıda izin verin.", "red"); return; }
  w.document.write(html);
  w.document.close();
}

/* ══════════════════════════════════════════════════════
   BARISTA VIEW (Kanban)
══════════════════════════════════════════════════════ */
function renderBarista() {
  const statuses = ["pending","preparing","ready","delivered"];
  const labels   = { pending:"Bekliyor", preparing:"Hazırlanıyor", ready:"Hazır", delivered:"Teslim Edildi" };
  const icons    = { pending:"fa-clock", preparing:"fa-fire", ready:"fa-check-circle", delivered:"fa-circle-check" };

  // Bugünün siparişleri
  const orders = OrderDB.getToday();

  statuses.forEach(status => {
    const col     = document.getElementById("queue-" + status);
    const countEl = document.getElementById("count-" + status);
    if (!col) return;

    const filtered = orders.filter(o => o.status === status);
    if (countEl) countEl.textContent = filtered.length;

    if (filtered.length === 0) {
      col.innerHTML = `<div class="barista-empty">Sipariş yok</div>`;
      return;
    }

    col.innerHTML = filtered.map(o => {
      const time = new Date(o.createdAt).toLocaleTimeString("tr-TR", {hour:"2-digit",minute:"2-digit"});
      const itemsHTML = o.items.map(i =>
        `<div class="ticket-item"><span>${i.emoji} ${i.name}</span><span>×${i.qty}</span></div>`
      ).join("");
      const actions = baristaActions(o);
      return `
        <div class="barista-ticket">
          <div class="ticket-top">
            <span class="ticket-order">#${o.num}</span>
            <span class="ticket-table">${o.tableLabel}</span>
          </div>
          <div class="ticket-time"><i class="fa-regular fa-clock"></i>${time}</div>
          ${itemsHTML}
          ${o.note ? `<div class="ticket-note">📝 ${o.note}</div>` : ""}
          <div class="ticket-action">${actions}</div>
        </div>
      `;
    }).join("");
  });
}

function baristaActions(o) {
  switch (o.status) {
    case "pending":
      return `<button class="ticket-btn primary" onclick="updateOrderStatus('${o.id}','preparing');renderBarista()">Hazırlamaya Başla</button>`;
    case "preparing":
      return `<button class="ticket-btn primary" onclick="updateOrderStatus('${o.id}','ready');renderBarista()">Hazır İşaretle</button>`;
    case "ready":
      return `<button class="ticket-btn primary" onclick="updateOrderStatus('${o.id}','delivered');renderBarista()">Teslim Edildi</button>`;
    default:
      return "";
  }
}

function updateOrderStatus(orderId, status) {
  OrderDB.update(orderId, { status });
  // Not: Masa, sipariş teslim edildiğinde değil; ödeme alınıp "Öde ve Kapat" ile kapanır.
}

/* ══════════════════════════════════════════════════════
   REPORTS VIEW
══════════════════════════════════════════════════════ */
let currentReportTab = "daily";

function switchReportTab(tab) {
  currentReportTab = tab;
  document.getElementById("rtab-daily")?.classList.toggle("active", tab === "daily");
  document.getElementById("rtab-monthly")?.classList.toggle("active", tab === "monthly");
  document.getElementById("report-daily").style.display   = tab === "daily"   ? "flex" : "none";
  document.getElementById("report-monthly").style.display = tab === "monthly" ? "flex" : "none";
  if (tab === "daily")   renderDailyReport();
  if (tab === "monthly") renderMonthlyReport();
}

function renderReports() {
  switchReportTab(currentReportTab);
}

/* ── GÜNLÜK RAPOR ────────────────────────────────── */
function renderDailyReport() {
  const allToday  = OrderDB.getToday().filter(o => o.status !== "cancelled");
  const paidToday = allToday.filter(o => o.paid);

  const total     = paidToday.reduce((s, o) => s + (o.total || 0), 0);
  const count     = paidToday.length;
  const avg       = count ? total / count : 0;
  const items     = paidToday.reduce((s, o) => s + o.items.reduce((ss, i) => ss + i.qty, 0), 0);
  const openCount = allToday.length - paidToday.length;
  const cashTotal = paidToday.filter(o=>o.paymentMethod==="cash").reduce((s,o)=>s+o.total,0);
  const cardTotal = paidToday.filter(o=>o.paymentMethod==="card").reduce((s,o)=>s+o.total,0);

  const statCards = document.getElementById("reportStats");
  if (statCards) {
    statCards.innerHTML = `
      <div class="stat-card">
        <div class="stat-icon" style="background:var(--accent-bg);color:var(--accent)"><i class="fa-solid fa-turkish-lira-sign"></i></div>
        <div class="stat-info"><div class="stat-label">Günlük Ciro</div><div class="stat-val">${formatMoney(total)}</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:var(--blue-bg);color:var(--blue)"><i class="fa-solid fa-receipt"></i></div>
        <div class="stat-info"><div class="stat-label">Ödenen Sipariş</div><div class="stat-val">${count}</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:var(--green-bg);color:var(--green)"><i class="fa-solid fa-chart-bar"></i></div>
        <div class="stat-info"><div class="stat-label">Ort. Sepet</div><div class="stat-val">${formatMoney(avg)}</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:var(--orange-bg);color:var(--orange)"><i class="fa-solid fa-clock"></i></div>
        <div class="stat-info"><div class="stat-label">Açık Hesap</div><div class="stat-val">${openCount}</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:var(--green-bg);color:var(--green)"><i class="fa-solid fa-money-bill-wave"></i></div>
        <div class="stat-info"><div class="stat-label">Nakit</div><div class="stat-val">${formatMoney(cashTotal)}</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:var(--purple-bg);color:var(--purple)"><i class="fa-solid fa-credit-card"></i></div>
        <div class="stat-info"><div class="stat-label">Kart</div><div class="stat-val">${formatMoney(cardTotal)}</div></div>
      </div>
    `;
  }
  renderBarChart(paidToday);
  renderDonut(paidToday);
  renderOrderHistory(allToday);
}

/* ── AYLIK RAPOR ─────────────────────────────────── */
function getMonthOrders() {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return OrderDB.getAll().filter(o => new Date(o.createdAt) >= start && o.status !== "cancelled");
}

function renderMonthlyReport() {
  const now        = new Date();
  const monthName  = now.toLocaleDateString("tr-TR", { month:"long", year:"numeric" });
  const allMonth   = getMonthOrders();
  const paidMonth  = allMonth.filter(o => o.paid);

  const total     = paidMonth.reduce((s, o) => s + (o.total || 0), 0);
  const count     = paidMonth.length;
  const avg       = count ? total / count : 0;
  const openCount = allMonth.length - paidMonth.length;
  const cashTotal = paidMonth.filter(o=>o.paymentMethod==="cash").reduce((s,o)=>s+o.total,0);
  const cardTotal = paidMonth.filter(o=>o.paymentMethod==="card").reduce((s,o)=>s+o.total,0);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
  const activeDays  = new Set(paidMonth.map(o => new Date(o.createdAt).getDate())).size;

  const sub = document.getElementById("monthlyChartSub");
  if (sub) sub.textContent = monthName;

  const statCards = document.getElementById("monthlyStats");
  if (statCards) {
    statCards.innerHTML = `
      <div class="stat-card">
        <div class="stat-icon" style="background:var(--accent-bg);color:var(--accent)"><i class="fa-solid fa-turkish-lira-sign"></i></div>
        <div class="stat-info"><div class="stat-label">Aylık Ciro</div><div class="stat-val">${formatMoney(total)}</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:var(--blue-bg);color:var(--blue)"><i class="fa-solid fa-receipt"></i></div>
        <div class="stat-info"><div class="stat-label">Toplam Sipariş</div><div class="stat-val">${count}</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:var(--green-bg);color:var(--green)"><i class="fa-solid fa-chart-bar"></i></div>
        <div class="stat-info"><div class="stat-label">Ort. Sepet</div><div class="stat-val">${formatMoney(avg)}</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:var(--orange-bg);color:var(--orange)"><i class="fa-solid fa-calendar-check"></i></div>
        <div class="stat-info"><div class="stat-label">Aktif Gün</div><div class="stat-val">${activeDays} / ${daysInMonth}</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:var(--green-bg);color:var(--green)"><i class="fa-solid fa-money-bill-wave"></i></div>
        <div class="stat-info"><div class="stat-label">Nakit</div><div class="stat-val">${formatMoney(cashTotal)}</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:var(--purple-bg);color:var(--purple)"><i class="fa-solid fa-credit-card"></i></div>
        <div class="stat-info"><div class="stat-label">Kart</div><div class="stat-val">${formatMoney(cardTotal)}</div></div>
      </div>
    `;
  }

  // Günlük bar chart (ay içindeki her gün)
  renderMonthlyBarChart(paidMonth, now);
  renderDonutInto(paidMonth, "monthlyDonutWrap");
  renderTopProducts(paidMonth);
}

function renderMonthlyBarChart(orders, now) {
  const container = document.getElementById("monthlyBarChart");
  if (!container) return;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
  const data = Array.from({length: daysInMonth}, (_, i) => {
    const day = i + 1;
    return orders.filter(o => new Date(o.createdAt).getDate() === day)
      .reduce((s, o) => s + o.total, 0);
  });
  const max = Math.max(...data, 1);
  container.innerHTML = data.map((val, i) => {
    const day   = i + 1;
    const pct   = (val / max * 100).toFixed(1);
    const isPeak = val === Math.max(...data) && val > 0;
    // Show every 5th day label to avoid crowding
    const showLabel = day === 1 || day % 5 === 0 || day === daysInMonth;
    return `
      <div class="bar-col">
        <div class="bar-val">${val > 0 ? Math.round(val).toLocaleString("tr-TR") : ""}</div>
        <div class="bar-fill ${isPeak ? "peak" : ""}" style="height:${pct}%"></div>
        <div class="bar-label">${showLabel ? day : ""}</div>
      </div>
    `;
  }).join("");
}

function renderDonutInto(orders, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const catRevenue = {};
  orders.forEach(o => {
    o.items.forEach(item => {
      const product = MenuDB.getById(item.id);
      const cat = product?.cat || "Diğer";
      catRevenue[cat] = (catRevenue[cat] || 0) + item.price * item.qty;
    });
  });
  const total  = Object.values(catRevenue).reduce((s, v) => s + v, 0) || 1;
  const sorted = Object.entries(catRevenue).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const colors = ["#C8A96E","#4CAF7A","#9B8FE0","#E89843","#5B9CF6"];
  if (sorted.length === 0) {
    container.innerHTML = `<div style="color:var(--text3);font-size:13px;text-align:center;padding:20px;">Henüz veri yok</div>`;
    return;
  }
  let offset = 0;
  const circumference = 2 * Math.PI * 40;
  const segments = sorted.map(([cat, rev], i) => {
    const pct  = rev / total;
    const dash = pct * circumference;
    const gap  = circumference - dash;
    const seg  = `<circle cx="50" cy="50" r="40" fill="none" stroke="${colors[i]}" stroke-width="14"
      stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}"
      stroke-dashoffset="${(-offset * circumference).toFixed(2)}"
      transform="rotate(-90 50 50)" opacity="0.85"/>`;
    offset += pct;
    return seg;
  });
  const svg = `<svg viewBox="0 0 100 100" style="width:120px;height:120px;flex-shrink:0">
    <circle cx="50" cy="50" r="40" fill="none" stroke="var(--bg4)" stroke-width="14"/>
    ${segments.join("")}
  </svg>`;
  const legend = `<div class="donut-legend">
    ${sorted.map(([cat, rev], i) => `
      <div class="legend-item">
        <span class="legend-color" style="background:${colors[i]}"></span>
        <span class="legend-name">${cat}</span>
        <span class="legend-pct">${(rev/total*100).toFixed(0)}%</span>
      </div>
    `).join("")}
  </div>`;
  container.innerHTML = svg + legend;
}

function renderTopProducts(orders) {
  const container = document.getElementById("monthlyTopProducts");
  if (!container) return;
  const productMap = {};
  orders.forEach(o => {
    o.items.forEach(item => {
      if (!productMap[item.id]) productMap[item.id] = { name: item.name, emoji: item.emoji, qty: 0, revenue: 0 };
      productMap[item.id].qty     += item.qty;
      productMap[item.id].revenue += item.price * item.qty;
    });
  });
  const sorted = Object.values(productMap).sort((a, b) => b.qty - a.qty).slice(0, 10);
  if (sorted.length === 0) {
    container.innerHTML = `<div style="text-align:center;color:var(--text3);font-size:13px;padding:24px;">Bu ay sipariş yok</div>`;
    return;
  }
  container.innerHTML = sorted.map((p, i) => `
    <div class="history-item">
      <span class="history-num" style="min-width:28px;text-align:center;font-size:14px;">${i+1}.</span>
      <div class="history-info">
        <div class="history-table">${p.emoji} ${p.name}</div>
      </div>
      <div class="history-right">
        <div class="history-total">${formatMoney(p.revenue)}</div>
        <div class="history-method">${p.qty} adet</div>
      </div>
    </div>
  `).join("");
}

/* ── PDF EXPORT ──────────────────────────────────── */
function exportReportPDF() {
  const isMonthly = currentReportTab === "monthly";
  const now = new Date();
  const dateStr  = now.toLocaleDateString("tr-TR", { day:"2-digit", month:"long", year:"numeric" });
  const monthStr = now.toLocaleDateString("tr-TR", { month:"long", year:"numeric" });

  let reportData, title, subtitle;

  if (!isMonthly) {
    // GÜNLÜK
    const allToday  = OrderDB.getToday().filter(o => o.status !== "cancelled");
    const paid      = allToday.filter(o => o.paid);
    const total     = paid.reduce((s, o) => s + o.total, 0);
    const count     = paid.length;
    const avg       = count ? total / count : 0;
    const cash      = paid.filter(o=>o.paymentMethod==="cash").reduce((s,o)=>s+o.total,0);
    const card      = paid.filter(o=>o.paymentMethod==="card").reduce((s,o)=>s+o.total,0);
    const openCount = allToday.length - paid.length;
    title    = "AURA Coffee &amp; Kitchen — Günlük Rapor";
    subtitle = dateStr;

    // En çok satanlar
    const pm = {};
    paid.forEach(o => o.items.forEach(i => {
      if (!pm[i.name]) pm[i.name] = { emoji:i.emoji, qty:0, rev:0 };
      pm[i.name].qty += i.qty; pm[i.name].rev += i.price*i.qty;
    }));
    const top = Object.entries(pm).sort((a,b)=>b[1].qty-a[1].qty).slice(0,10);

    // Saatlik ciro
    const hours = Array.from({length:12},(_,i)=>i+8);
    const hourData = hours.map(h => ({
      h, rev: paid.filter(o=>new Date(o.createdAt).getHours()===h).reduce((s,o)=>s+o.total,0)
    }));

    reportData = buildDailyPDFHtml({ title, subtitle, total, count, avg, cash, card, openCount, paid, top, hourData, dateStr, allToday });
  } else {
    // AYLIK
    const allMonth  = getMonthOrders();
    const paid      = allMonth.filter(o => o.paid);
    const total     = paid.reduce((s, o) => s + o.total, 0);
    const count     = paid.length;
    const avg       = count ? total / count : 0;
    const cash      = paid.filter(o=>o.paymentMethod==="cash").reduce((s,o)=>s+o.total,0);
    const card      = paid.filter(o=>o.paymentMethod==="card").reduce((s,o)=>s+o.total,0);
    const openCount = allMonth.length - paid.length;
    const daysInMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
    const activeDays  = new Set(paid.map(o => new Date(o.createdAt).getDate())).size;

    const pm = {};
    paid.forEach(o => o.items.forEach(i => {
      if (!pm[i.name]) pm[i.name] = { emoji:i.emoji, qty:0, rev:0 };
      pm[i.name].qty += i.qty; pm[i.name].rev += i.price*i.qty;
    }));
    const top = Object.entries(pm).sort((a,b)=>b[1].qty-a[1].qty).slice(0,10);

    // Günlük ciro dizisi
    const dayData = Array.from({length: daysInMonth}, (_,i) => {
      const day = i+1;
      return { day, rev: paid.filter(o=>new Date(o.createdAt).getDate()===day).reduce((s,o)=>s+o.total,0) };
    });

    reportData = buildMonthlyPDFHtml({ total, count, avg, cash, card, openCount, activeDays, daysInMonth, top, dayData, monthStr });
  }

  const w = window.open("","_blank");
  if (!w) { showToast("Pop-up engellendi, lütfen izin verin.", "red"); return; }
  w.document.write(reportData);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 600);
}

function pdfStyles() {
  return `
    <style>
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Syne:wght@700;800&display=swap');
      *{margin:0;padding:0;box-sizing:border-box;}
      body{font-family:'DM Sans',sans-serif;font-size:13px;color:#1a1a1a;background:#fff;padding:32px 40px;}
      .pdf-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:28px;padding-bottom:18px;border-bottom:2px solid #1a1a1a;}
      .pdf-logo{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;letter-spacing:-1px;}
      .pdf-logo span{color:#8B6B3D;}
      .pdf-meta{text-align:right;font-size:11px;color:#666;line-height:1.7;}
      .pdf-title{font-family:'Syne',sans-serif;font-size:17px;font-weight:800;margin-bottom:2px;}
      .section-title{font-family:'Syne',sans-serif;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#8B6B3D;margin:22px 0 10px;}
      .stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:8px;}
      .stat-box{border:1.5px solid #e5e5e5;border-radius:8px;padding:12px 14px;}
      .stat-box .label{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;}
      .stat-box .value{font-family:'Syne',sans-serif;font-size:18px;font-weight:800;color:#1a1a1a;}
      .stat-box.accent{border-color:#C8A96E;background:#fffaf3;}
      .stat-box.accent .value{color:#8B6B3D;}
      table{width:100%;border-collapse:collapse;margin-top:2px;}
      thead tr{border-bottom:2px solid #1a1a1a;}
      thead th{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#888;padding:6px 10px;text-align:left;}
      tbody tr{border-bottom:1px solid #f0f0f0;}
      tbody tr:last-child{border-bottom:none;}
      tbody td{padding:8px 10px;font-size:12px;color:#333;}
      tbody tr:nth-child(even){background:#fafafa;}
      .badge-cash{display:inline-block;padding:2px 8px;border-radius:100px;background:#e8f5ee;color:#2e7d52;font-size:10px;font-weight:600;}
      .badge-card{display:inline-block;padding:2px 8px;border-radius:100px;background:#ede9fb;color:#5b21b6;font-size:10px;font-weight:600;}
      .badge-open{display:inline-block;padding:2px 8px;border-radius:100px;background:#fff3e0;color:#e65100;font-size:10px;font-weight:600;}
      .hour-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-top:2px;}
      .hour-box{border:1px solid #eee;border-radius:6px;padding:8px 6px;text-align:center;}
      .hour-box .h{font-size:10px;color:#aaa;margin-bottom:4px;}
      .hour-box .v{font-size:12px;font-weight:700;color:#1a1a1a;}
      .hour-box.peak{border-color:#C8A96E;background:#fffaf3;}
      .hour-box.peak .v{color:#8B6B3D;}
      .pay-row{display:flex;gap:16px;margin-top:2px;}
      .pay-box{flex:1;border:1.5px solid #e5e5e5;border-radius:8px;padding:12px 14px;}
      .pay-box .label{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;}
      .pay-box .value{font-family:'Syne',sans-serif;font-size:16px;font-weight:800;}
      .day-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-top:2px;}
      .day-box{border:1px solid #eee;border-radius:6px;padding:6px 4px;text-align:center;}
      .day-box .d{font-size:9px;color:#bbb;margin-bottom:3px;}
      .day-box .v{font-size:10px;font-weight:700;color:#1a1a1a;}
      .day-box.has-data{border-color:#C8A96E;background:#fffaf3;}
      .day-box.has-data .v{color:#8B6B3D;}
      .pdf-footer{margin-top:28px;padding-top:12px;border-top:1px solid #e5e5e5;font-size:10px;color:#aaa;display:flex;justify-content:space-between;}
      @media print{
        body{padding:20px 28px;}
        @page{margin:1.5cm;size:A4;}
      }
    </style>
  `;
}

function buildDailyPDFHtml({ title, subtitle, total, count, avg, cash, card, openCount, paid, top, hourData, dateStr, allToday }) {
  const now = new Date();
  const printTime = now.toLocaleTimeString("tr-TR",{hour:"2-digit",minute:"2-digit"});
  const maxHour = Math.max(...hourData.map(h=>h.rev), 1);

  const hourBoxes = hourData.map(({h,rev}) => `
    <div class="hour-box ${rev===maxHour&&rev>0?'peak':''}">
      <div class="h">${h}:00</div>
      <div class="v">${rev>0?Math.round(rev).toLocaleString("tr-TR"):"—"}</div>
    </div>`).join("");

  const topRows = top.map(([name,{emoji,qty,rev}],i) => `
    <tr>
      <td>${i+1}</td>
      <td>${emoji} ${name}</td>
      <td style="text-align:center">${qty}</td>
      <td style="text-align:right;font-weight:600">${formatMoney(rev)}</td>
    </tr>`).join("");

  const orderRows = [...allToday].reverse().slice(0,20).map(o => `
    <tr>
      <td>#${o.num}</td>
      <td>${o.tableLabel}</td>
      <td>${o.items.map(i=>`${i.emoji}${i.name}×${i.qty}`).join(", ")}</td>
      <td style="text-align:right;font-weight:600">${formatMoney(o.total)}</td>
      <td style="text-align:center">${!o.paid?'<span class="badge-open">Açık</span>':o.paymentMethod==="cash"?'<span class="badge-cash">Nakit</span>':'<span class="badge-card">Kart</span>'}</td>
    </tr>`).join("");

  return `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><title>AURA — Günlük Rapor ${dateStr}</title>${pdfStyles()}</head><body>
  <div class="pdf-header">
    <div>
      <div class="pdf-logo">AURA <span>Coffee &amp; Kitchen</span></div>
      <div style="font-size:12px;color:#888;margin-top:4px;">POS Sistemi</div>
    </div>
    <div class="pdf-meta">
      <div class="pdf-title">Günlük Satış Raporu</div>
      <div>${dateStr}</div>
      <div>Yazdırma: ${printTime}</div>
      ${currentUser ? `<div>Hazırlayan: ${currentUser.name}</div>` : ""}
    </div>
  </div>

  <div class="section-title">Özet</div>
  <div class="stat-grid">
    <div class="stat-box accent"><div class="label">Günlük Ciro</div><div class="value">${formatMoney(total)}</div></div>
    <div class="stat-box"><div class="label">Ödenen Sipariş</div><div class="value">${count}</div></div>
    <div class="stat-box"><div class="label">Ortalama Sepet</div><div class="value">${formatMoney(avg)}</div></div>
  </div>

  <div class="section-title">Ödeme Yöntemi</div>
  <div class="pay-row">
    <div class="pay-box"><div class="label">Nakit</div><div class="value" style="color:#2e7d52">${formatMoney(cash)}</div></div>
    <div class="pay-box"><div class="label">Kart</div><div class="value" style="color:#5b21b6">${formatMoney(card)}</div></div>
    <div class="pay-box"><div class="label">Açık Hesap</div><div class="value" style="color:#e65100">${openCount} masa</div></div>
  </div>

  <div class="section-title">Saatlik Ciro (₺)</div>
  <div class="hour-grid">${hourBoxes}</div>

  ${top.length > 0 ? `
  <div class="section-title">En Çok Satan Ürünler</div>
  <table>
    <thead><tr><th>#</th><th>Ürün</th><th style="text-align:center">Adet</th><th style="text-align:right">Ciro</th></tr></thead>
    <tbody>${topRows}</tbody>
  </table>` : ""}

  <div class="section-title">Sipariş Detayları</div>
  <table>
    <thead><tr><th>No</th><th>Masa</th><th>Ürünler</th><th style="text-align:right">Tutar</th><th style="text-align:center">Durum</th></tr></thead>
    <tbody>${orderRows}</tbody>
  </table>

  <div class="pdf-footer">
    <span>AURA Coffee &amp; Kitchen — POS Raporu</span>
    <span>${dateStr} • ${printTime}</span>
  </div>
</body></html>`;
}

function buildMonthlyPDFHtml({ total, count, avg, cash, card, openCount, activeDays, daysInMonth, top, dayData, monthStr }) {
  const now = new Date();
  const printTime = now.toLocaleTimeString("tr-TR",{hour:"2-digit",minute:"2-digit"});
  const dateStr   = now.toLocaleDateString("tr-TR",{day:"2-digit",month:"long",year:"numeric"});
  const maxDay    = Math.max(...dayData.map(d=>d.rev), 1);

  const dayBoxes = dayData.map(({day,rev}) => `
    <div class="day-box ${rev>0?'has-data':''}">
      <div class="d">${day}</div>
      <div class="v">${rev>0?Math.round(rev/1000).toLocaleString("tr-TR")+"K":"—"}</div>
    </div>`).join("");

  const topRows = top.map(([name,{emoji,qty,rev}],i) => `
    <tr>
      <td>${i+1}</td>
      <td>${emoji} ${name}</td>
      <td style="text-align:center">${qty}</td>
      <td style="text-align:right;font-weight:600">${formatMoney(rev)}</td>
    </tr>`).join("");

  return `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><title>AURA — Aylık Rapor ${monthStr}</title>${pdfStyles()}</head><body>
  <div class="pdf-header">
    <div>
      <div class="pdf-logo">AURA <span>Coffee &amp; Kitchen</span></div>
      <div style="font-size:12px;color:#888;margin-top:4px;">POS Sistemi</div>
    </div>
    <div class="pdf-meta">
      <div class="pdf-title">Aylık Satış Raporu</div>
      <div>${monthStr}</div>
      <div>Yazdırma: ${dateStr} ${printTime}</div>
      ${currentUser ? `<div>Hazırlayan: ${currentUser.name}</div>` : ""}
    </div>
  </div>

  <div class="section-title">Aylık Özet</div>
  <div class="stat-grid">
    <div class="stat-box accent"><div class="label">Aylık Ciro</div><div class="value">${formatMoney(total)}</div></div>
    <div class="stat-box"><div class="label">Toplam Sipariş</div><div class="value">${count}</div></div>
    <div class="stat-box"><div class="label">Ortalama Sepet</div><div class="value">${formatMoney(avg)}</div></div>
    <div class="stat-box"><div class="label">Aktif Gün</div><div class="value">${activeDays} / ${daysInMonth}</div></div>
    <div class="stat-box"><div class="label">Günlük Ort. Ciro</div><div class="value">${formatMoney(activeDays?total/activeDays:0)}</div></div>
    <div class="stat-box"><div class="label">Açık Hesap</div><div class="value">${openCount}</div></div>
  </div>

  <div class="section-title">Ödeme Yöntemi</div>
  <div class="pay-row">
    <div class="pay-box"><div class="label">Nakit</div><div class="value" style="color:#2e7d52">${formatMoney(cash)}</div></div>
    <div class="pay-box"><div class="label">Kart</div><div class="value" style="color:#5b21b6">${formatMoney(card)}</div></div>
  </div>

  <div class="section-title">Günlük Ciro Dağılımı (${monthStr})</div>
  <div class="day-grid">${dayBoxes}</div>
  <div style="font-size:10px;color:#aaa;margin-top:6px;">Değerler bin ₺ (K) cinsinden gösterilmiştir</div>

  ${top.length > 0 ? `
  <div class="section-title">En Çok Satan Ürünler (Bu Ay)</div>
  <table>
    <thead><tr><th>#</th><th>Ürün</th><th style="text-align:center">Adet</th><th style="text-align:right">Ciro</th></tr></thead>
    <tbody>${topRows}</tbody>
  </table>` : ""}

  <div class="pdf-footer">
    <span>AURA Coffee &amp; Kitchen — POS Raporu</span>
    <span>${monthStr} • ${printTime}</span>
  </div>
</body></html>`;
}


function renderBarChart(orders) {
  const container = document.getElementById("barChart");
  if (!container) return;
  const hours = Array.from({length:12}, (_,i) => i + 8); // 08-19
  const data = hours.map(h => {
    return orders.filter(o => new Date(o.createdAt).getHours() === h)
      .reduce((s, o) => s + o.total, 0);
  });
  const max = Math.max(...data, 1);
  container.innerHTML = hours.map((h, i) => {
    const pct = (data[i] / max * 100).toFixed(1);
    const isPeak = data[i] === Math.max(...data) && data[i] > 0;
    return `
      <div class="bar-col">
        <div class="bar-val">${data[i] > 0 ? data[i].toLocaleString("tr-TR",{maximumFractionDigits:0}) : ""}</div>
        <div class="bar-fill ${isPeak ? "peak" : ""}" style="height:${pct}%"></div>
        <div class="bar-label">${h}:00</div>
      </div>
    `;
  }).join("");
}

function renderDonut(orders) {
  renderDonutInto(orders, "donutWrap");
}

function renderOrderHistory(orders) {
  const container = document.getElementById("orderHistory");
  if (!container) return;
  const recent = [...orders].reverse().slice(0, 8);
  if (recent.length === 0) {
    container.innerHTML = `<div style="text-align:center;color:var(--text3);font-size:13px;padding:24px;">Bugün sipariş yok</div>`;
    return;
  }
  container.innerHTML = recent.map(o => `
    <div class="history-item">
      <span class="history-num">#${o.num}</span>
      <div class="history-info">
        <div class="history-table">${o.tableLabel}</div>
        <div class="history-items">${o.items.map(i => `${i.emoji}×${i.qty}`).join(" ")}</div>
      </div>
      <div class="history-right">
        <div class="history-total">${formatMoney(o.total)}</div>
        <div class="history-method" style="${!o.paid ? "color:var(--orange)" : ""}">${paymentMethodLabel(o)}</div>
      </div>
    </div>
  `).join("");
}

/* ══════════════════════════════════════════════════════
   MENU MANAGE VIEW
══════════════════════════════════════════════════════ */
function renderMenuManage() {
  const cats   = MenuDB.getCategories();
  const catList = document.getElementById("mmCatList");
  if (catList) {
    catList.innerHTML = cats.map(c => `
      <button class="mm-cat-btn ${currentMenuCat === c ? "active" : ""}" onclick="setMenuCat('${c}')">
        ${c}
        <span class="mm-cat-count">${MenuDB.getByCategory(c).length}</span>
      </button>
    `).join("");
  }

  const items = currentMenuCat ? MenuDB.getByCategory(currentMenuCat) : MenuDB.getAll();
  const list  = document.getElementById("mmProductList");
  if (!list) return;
  list.innerHTML = items.map(p => `
    <div class="mm-product-row">
      <span class="mm-emoji">${p.emoji}</span>
      <div class="mm-info">
        <div class="mm-name">${p.name} ${p.popular ? "⭐" : ""}</div>
        <div class="mm-desc">${p.desc} — <em>${p.cat}</em></div>
      </div>
      <span class="mm-price">${formatMoney(p.price)}</span>
      <div class="mm-actions">
        <label class="toggle-switch" title="${p.available !== false ? "Aktif" : "Pasif"}">
          <input type="checkbox" ${p.available !== false ? "checked" : ""} onchange="toggleProductAvail(${p.id},this.checked)">
          <span class="toggle-slider"></span>
        </label>
        <button class="mm-edit-btn" onclick="openEditProduct(${p.id})" title="Düzenle"><i class="fa-solid fa-pen"></i></button>
        <button class="mm-edit-btn mm-del-btn" onclick="deleteProduct(${p.id})" title="Sil"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>
  `).join("");
}

function setMenuCat(cat) {
  currentMenuCat = cat;
  renderMenuManage();
}

function toggleProductAvail(id, val) {
  MenuDB.update(id, { available: val });
  showToast(val ? "Ürün aktif edildi ✓" : "Ürün pasife alındı");
}

function deleteProduct(id) {
  const p = MenuDB.getById(id);
  if (!p) return;
  if (!confirm(`"${p.name}" silinsin mi?`)) return;
  MenuDB.delete(id);
  renderMenuManage();
  showToast("Ürün silindi");
}

function openAddProduct() {
  editingProductId = null;
  document.getElementById("productModalTitle").textContent = "Yeni Ürün Ekle";
  document.getElementById("editEmoji").value   = "";
  document.getElementById("editName").value    = "";
  document.getElementById("editDesc").value    = "";
  document.getElementById("editPrice").value   = "";
  document.getElementById("editPopular").checked = false;
  populateEditCatSelect();
  openModal("addProductModal");
}

function openEditProduct(id) {
  const p = MenuDB.getById(id);
  if (!p) return;
  editingProductId = id;
  document.getElementById("productModalTitle").textContent = "Ürünü Düzenle";
  document.getElementById("editEmoji").value    = p.emoji;
  document.getElementById("editName").value     = p.name;
  document.getElementById("editDesc").value     = p.desc;
  document.getElementById("editPrice").value    = p.price;
  document.getElementById("editPopular").checked = p.popular;
  populateEditCatSelect(p.cat);
  openModal("addProductModal");
}

function populateEditCatSelect(selectedCat = "") {
  const sel = document.getElementById("editCat");
  if (!sel) return;
  const cats = MenuDB.getCategories();
  sel.innerHTML = cats.map(c =>
    `<option value="${c}" ${c === selectedCat ? "selected" : ""}>${c}</option>`
  ).join("") + `<option value="__new__">+ Yeni Kategori...</option>`;
}

function saveProduct() {
  const emoji   = document.getElementById("editEmoji").value.trim() || "☕";
  const name    = document.getElementById("editName").value.trim();
  const desc    = document.getElementById("editDesc").value.trim();
  const price   = parseFloat(document.getElementById("editPrice").value);
  const popular = document.getElementById("editPopular").checked;
  let   cat     = document.getElementById("editCat").value;

  if (!name || isNaN(price)) { showToast("Ad ve fiyat zorunludur!", "red"); return; }

  if (cat === "__new__") {
    cat = prompt("Yeni kategori adı:");
    if (!cat) return;
  }

  if (editingProductId) {
    MenuDB.update(editingProductId, { emoji, name, desc, price, popular, cat, available:true });
    showToast("Ürün güncellendi ✓");
  } else {
    MenuDB.add({ emoji, name, desc, price, popular, cat, available:true });
    showToast("Ürün eklendi ✓");
  }
  closeModal("addProductModal");
  renderMenuManage();
}

/* ══════════════════════════════════════════════════════
   COUPON VIEW
══════════════════════════════════════════════════════ */
function renderCoupons() {
  renderCouponStats();
  renderCouponList();
}

function renderCouponStats() {
  const all    = CouponDB.getAll();
  const active = all.filter(c => c.active).length;
  const total  = all.length;
  const used   = all.reduce((s, c) => s + (c.usedCount || 0), 0);

  const container = document.getElementById("cpStats");
  if (!container) return;
  container.innerHTML = `
    <div class="cp-stat">
      <div class="cp-stat-icon" style="background:var(--accent-bg);color:var(--accent)"><i class="fa-solid fa-ticket"></i></div>
      <div><div class="cp-stat-val">${total}</div><div class="cp-stat-label">Toplam Kupon</div></div>
    </div>
    <div class="cp-stat">
      <div class="cp-stat-icon" style="background:var(--green-bg);color:var(--green)"><i class="fa-solid fa-check-circle"></i></div>
      <div><div class="cp-stat-val">${active}</div><div class="cp-stat-label">Aktif</div></div>
    </div>
    <div class="cp-stat">
      <div class="cp-stat-icon" style="background:var(--orange-bg);color:var(--orange)"><i class="fa-solid fa-ban"></i></div>
      <div><div class="cp-stat-val">${total - active}</div><div class="cp-stat-label">Pasif</div></div>
    </div>
    <div class="cp-stat">
      <div class="cp-stat-icon" style="background:var(--blue-bg);color:var(--blue)"><i class="fa-solid fa-fire"></i></div>
      <div><div class="cp-stat-val">${used}</div><div class="cp-stat-label">Toplam Kullanım</div></div>
    </div>
  `;
}

function setCpType(type) {
  document.getElementById("cpType").value = type;
  document.getElementById("cpTypePct").classList.toggle("active", type === "percent");
  document.getElementById("cpTypeFixed").classList.toggle("active", type === "fixed");
  updateCpPreview();
}

function updateCpPreview() {
  const code  = document.getElementById("cpCode")?.value || "";
  const type  = document.getElementById("cpType")?.value || "percent";
  const value = parseFloat(document.getElementById("cpValue")?.value) || 0;
  const badge = document.getElementById("cpPreviewBadge");
  const info  = document.getElementById("cpPreviewInfo");
  if (!badge || !info) return;

  if (code && value > 0) {
    badge.textContent = type === "percent" ? `%${value}` : formatMoney(value);
    info.innerHTML = `<b style="color:var(--text2)">${code}</b> kodu ile <b style="color:var(--text2)">${type === "percent" ? `%${value} indirim` : `${formatMoney(value)} indirim`}</b>`;
  } else {
    badge.textContent = "—";
    info.textContent  = "Kod ve değer girerek önizleme görün.";
  }
}

function addCoupon() {
  const code   = document.getElementById("cpCode")?.value.trim().toUpperCase();
  const type   = document.getElementById("cpType")?.value || "percent";
  const value  = parseFloat(document.getElementById("cpValue")?.value);
  const min    = parseFloat(document.getElementById("cpMin")?.value) || 0;
  const limit  = parseInt(document.getElementById("cpLimit")?.value) || null;
  const desc   = document.getElementById("cpDesc")?.value.trim();
  const expiry = document.getElementById("cpExpiry")?.value;

  if (!code)              { showToast("Kupon kodu zorunludur!", "red"); return; }
  if (!value || value<=0) { showToast("Geçerli bir indirim değeri girin!", "red"); return; }
  if (CouponDB.getAll().find(c => c.code === code)) { showToast("Bu kod zaten mevcut!", "red"); return; }

  CouponDB.add({ code, type, value, min, limit, desc, expiry });
  ["cpCode","cpValue","cpMin","cpLimit","cpDesc","cpExpiry"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  updateCpPreview();
  renderCoupons();
  updateCouponNavBadge();
  showToast("Kupon eklendi ✓");
}

function setCpFilter(f) {
  cpCurrentFilter = f;
  ["all","active","inactive"].forEach(id => {
    document.getElementById("filter-" + id)?.classList.toggle("active", id === f);
  });
  renderCouponList();
}

function renderCouponList() {
  const list = document.getElementById("couponListBody");
  if (!list) return;

  let all = CouponDB.getAll();
  if (cpCurrentFilter === "active")   all = all.filter(c => c.active);
  if (cpCurrentFilter === "inactive") all = all.filter(c => !c.active);

  const badge = document.getElementById("cpCountBadge");
  if (badge) badge.textContent = CouponDB.getAll().length + " kupon";

  if (all.length === 0) {
    list.innerHTML = `<div class="cp-empty"><div class="cp-empty-icon">🎟️</div><p>Kupon bulunamadı</p></div>`;
    return;
  }

  const today = new Date().toISOString().slice(0,10);
  list.innerHTML = all.map(c => {
    const isExpired = c.expiry && c.expiry < today;
    const typeClass = c.type === "percent" ? "pct" : "fixed";
    const valLabel  = c.type === "percent" ? `%${c.value}` : formatMoney(c.value);
    const statusText = !c.active ? "Pasif" : isExpired ? "Süresi Dolmuş" : "Aktif";
    const statusClass = !c.active ? "status-inactive" : isExpired ? "status-expired" : "status-active";

    return `
      <div class="cp-card ${!c.active ? "inactive" : ""}">
        <div class="cp-card-main">
          <div class="cp-card-band ${c.active ? typeClass : "inactive"}"></div>
          <div class="cp-card-code">
            <div class="cp-card-code-text">${c.code}</div>
            <div class="cp-card-code-sub">${c.type === "percent" ? "Yüzde" : "Sabit"}</div>
          </div>
          <div class="cp-card-details">
            <div class="cp-card-row1">
              <span class="cp-badge type-${typeClass}">${c.type === "percent" ? "%" : "₺"} indirim</span>
              <span class="cp-badge ${statusClass}">${statusText}</span>
            </div>
            <div class="cp-card-desc">${c.desc || "Açıklama yok"}</div>
            <div class="cp-card-meta">
              ${c.min > 0 ? `<span><i class="fa-solid fa-cart-shopping"></i>Min. ${formatMoney(c.min)}</span>` : ""}
              <span><i class="fa-solid fa-fire"></i>${c.usedCount || 0}${c.limit ? "/" + c.limit : ""} kullanım</span>
              ${c.expiry ? `<span><i class="fa-regular fa-calendar"></i>${c.expiry}</span>` : ""}
            </div>
          </div>
          <div class="cp-card-value">
            <div class="cp-card-value-num ${typeClass}">${valLabel}</div>
            <div class="cp-card-value-label">indirim</div>
          </div>
          <div class="cp-card-actions">
            <button class="cp-action-btn ${c.active ? "toggle-on" : "toggle-off"}" onclick="toggleCoupon('${c.id}')" title="${c.active ? "Pasife Al" : "Aktif Et"}">
              <i class="fa-solid ${c.active ? "fa-eye" : "fa-eye-slash"}"></i>
            </button>
            <button class="cp-action-btn delete" onclick="deleteCoupon('${c.id}')" title="Sil">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function toggleCoupon(id) {
  CouponDB.toggle(id);
  renderCoupons();
  updateCouponNavBadge();
}
function deleteCoupon(id) {
  if (!confirm("Bu kuponu silmek istediğinize emin misiniz?")) return;
  CouponDB.delete(id);
  renderCoupons();
  updateCouponNavBadge();
  showToast("Kupon silindi");
}

function updateCouponNavBadge() {
  const badge = document.getElementById("couponNavBadge");
  if (!badge) return;
  const count = CouponDB.getAll().filter(c => c.active).length;
  badge.textContent = count;
  badge.style.display = count > 0 ? "flex" : "none";
}


/* ══════════════════════════════════════════════════════
   SETTINGS VIEW
══════════════════════════════════════════════════════ */

let _editingStaffId = null;
let _selectedStaffColor = "#C8A96E";

function renderSettings() {
  renderSettingsStaffList();
  renderBizDisplay();
}

function renderBizDisplay() {
  const s = SettingsDB.get();
  const bizName = s.bizName || "AURA Coffee & Kitchen";
  const taxRate = s.taxRate || 8;
  const nameEl = document.getElementById("bizNameDisplay");
  const taxEl  = document.getElementById("taxRateDisplay");
  if (nameEl) nameEl.textContent = bizName;
  if (taxEl)  taxEl.textContent  = "%" + taxRate;
}

function applyBizBranding() {
  const s = SettingsDB.get();
  const bizName = s.bizName || "AURA Coffee & Kitchen";

  // Sayfa başlığı
  document.title = bizName + " — POS";

  // Sidebar logo (ilk harf)
  const logoEl = document.querySelector(".sidebar-logo");
  if (logoEl) logoEl.textContent = bizName[0]?.toUpperCase() || "A";

  // Lock screen başlık
  const lockTitleEl = document.querySelector(".lock-title");
  if (lockTitleEl) lockTitleEl.textContent = bizName;

  // Settings gösterim alanları
  renderBizDisplay();
}

function renderSettingsStaffList() {
  const container = document.getElementById("staffList");
  if (!container) return;
  const users = UserDB.getAll();
  if (users.length === 0) {
    container.innerHTML = `<div style="text-align:center;color:var(--text3);padding:24px 0;">Henüz personel yok</div>`;
    return;
  }
  container.innerHTML = users.map(u => `
    <div class="staff-settings-row ${u.active === false ? 'staff-inactive' : ''}">
      <div class="staff-avatar-sm" style="background:${u.color || '#C8A96E'};color:#0a0a0a;">${u.avatar}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:14px;color:${u.active===false?'var(--text3)':'var(--text)'};">${u.name}</div>
        <div style="font-size:12px;color:var(--text2);margin-top:2px;">
          <span class="staff-role-badge ${u.role==='admin'?'admin':u.role==='barista'?'barista':'waiter'}">${roleLabel(u.role)}</span>
          <span style="margin-left:8px;opacity:.6;">PIN: ${u.pin}</span>
          ${u.active===false ? '<span style="margin-left:8px;color:var(--red);opacity:.8;">● Pasif</span>' : ''}
        </div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        <button class="staff-action-btn" onclick="openStaffModal('${u.id}')" title="Düzenle">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="staff-action-btn ${u.active===false?'activate':'deactivate'}" onclick="toggleStaffActive('${u.id}')" title="${u.active===false?'Aktif Et':'Pasife Al'}">
          <i class="fa-solid ${u.active===false?'fa-user-check':'fa-user-slash'}"></i>
        </button>
        ${u.id !== (currentUser && currentUser.id) && u.role !== 'admin' ? `
        <button class="staff-action-btn delete" onclick="deleteStaff('${u.id}')" title="Sil">
          <i class="fa-solid fa-trash"></i>
        </button>` : `<button class="staff-action-btn" style="opacity:.2;cursor:not-allowed;" disabled title="Kendinizi veya müdürü silemezsiniz"><i class="fa-solid fa-lock"></i></button>`}
      </div>
    </div>
  `).join("");
}

function openStaffModal(userId = null) {
  _editingStaffId = userId;
  _selectedStaffColor = "#C8A96E";

  document.getElementById("staffModalTitle").textContent = userId ? "Personel Düzenle" : "Personel Ekle";
  document.getElementById("editStaffId").value   = userId || "";
  document.getElementById("staffPinConflict").style.display = "none";

  if (userId) {
    const u = UserDB.getById(userId);
    if (!u) return;
    document.getElementById("editStaffName").value   = u.name;
    document.getElementById("editStaffAvatar").value = u.avatar;
    document.getElementById("editStaffRole").value   = u.role;
    document.getElementById("editStaffPin").value    = u.pin;
    document.getElementById("editStaffColor").value  = u.color || "#C8A96E";
    _selectedStaffColor = u.color || "#C8A96E";
  } else {
    document.getElementById("editStaffName").value   = "";
    document.getElementById("editStaffAvatar").value = "";
    document.getElementById("editStaffRole").value   = "barista";
    document.getElementById("editStaffPin").value    = "";
    document.getElementById("editStaffColor").value  = "#C8A96E";
  }

  // Color chips
  document.querySelectorAll(".color-chip").forEach(chip => {
    chip.classList.toggle("selected", chip.style.background === _selectedStaffColor ||
      chip.style.backgroundColor === _selectedStaffColor);
  });

  openModal("staffModal");
}

function autoFillAvatar() {
  const nameVal = document.getElementById("editStaffName").value.trim();
  const avatarEl = document.getElementById("editStaffAvatar");
  if (!avatarEl.value || avatarEl.dataset.auto === "1") {
    // Pick first letter of last word (like "Efe" from "Barista Efe")
    const parts = nameVal.split(" ").filter(Boolean);
    avatarEl.value = parts.length ? parts[parts.length-1][0].toUpperCase() : "";
    avatarEl.dataset.auto = "1";
  }
}

function selectStaffColor(color, el) {
  _selectedStaffColor = color;
  document.getElementById("editStaffColor").value = color;
  document.querySelectorAll(".color-chip").forEach(c => c.classList.remove("selected"));
  el.classList.add("selected");
}

function saveStaff() {
  const name   = document.getElementById("editStaffName").value.trim();
  const avatar = document.getElementById("editStaffAvatar").value.trim().toUpperCase() || name[0]?.toUpperCase() || "?";
  const role   = document.getElementById("editStaffRole").value;
  const pin    = document.getElementById("editStaffPin").value.trim();
  const color  = document.getElementById("editStaffColor").value || "#C8A96E";
  const editId = document.getElementById("editStaffId").value;

  if (!name)        { showToast("İsim zorunludur!", "red"); return; }
  if (!/^\d{4}$/.test(pin)) { showToast("PIN tam 4 rakam olmalı!", "red"); return; }

  // Check PIN conflict
  const conflict = UserDB.getAll().find(u => u.pin === pin && u.id !== editId);
  if (conflict) {
    document.getElementById("staffPinConflict").style.display = "block";
    showToast("Bu PIN zaten kullanılıyor!", "red");
    return;
  }
  document.getElementById("staffPinConflict").style.display = "none";

  const all = UserDB.getAll();
  if (editId) {
    const idx = all.findIndex(u => u.id === editId);
    if (idx >= 0) {
      all[idx] = { ...all[idx], name, avatar, role, pin, color };
      UserDB.save(all);
      // If editing current user, update sidebar
      if (currentUser && currentUser.id === editId) {
        currentUser = { ...currentUser, name, avatar, role, pin, color };
        SessionDB.set(currentUser);
        document.getElementById("staffPillAvatar").textContent = avatar;
        document.getElementById("staffPillAvatar").style.background = color;
        document.getElementById("staffPillName").textContent = name;
        document.getElementById("staffPillRole").textContent = roleLabel(role);
      }
      showToast("Personel güncellendi ✓");
    }
  } else {
    const newUser = {
      id: "u" + Date.now(),
      name, avatar, role, pin, color,
      active: true
    };
    all.push(newUser);
    UserDB.save(all);
    showToast("Personel eklendi ✓");
  }

  closeModal("staffModal");
  renderSettingsStaffList();
}

function toggleStaffActive(userId) {
  if (currentUser && currentUser.id === userId) {
    showToast("Kendi hesabınızı pasife alamazsınız!", "red");
    return;
  }
  const all = UserDB.getAll();
  const idx = all.findIndex(u => u.id === userId);
  if (idx < 0) return;
  const wasActive = all[idx].active !== false;
  all[idx].active = !wasActive;
  UserDB.save(all);
  showToast(wasActive ? "Personel pasife alındı" : "Personel aktif edildi", wasActive ? "orange" : "green");
  renderSettingsStaffList();
}

function deleteStaff(userId) {
  const u = UserDB.getById(userId);
  if (!u) return;
  if (currentUser && currentUser.id === userId) {
    showToast("Kendi hesabınızı silemezsiniz!", "red");
    return;
  }
  if (u.role === "admin") {
    showToast("Müdür hesabı silinemez!", "red");
    return;
  }
  if (!confirm(`"${u.name}" adlı personeli silmek istiyor musunuz?`)) return;
  const all = UserDB.getAll().filter(u2 => u2.id !== userId);
  UserDB.save(all);
  showToast("Personel silindi");
  renderSettingsStaffList();
}

function openBizModal() {
  const s = SettingsDB.get();
  document.getElementById("editBizName").value  = s.bizName || "AURA Coffee & Kitchen";
  document.getElementById("editTaxRate").value  = s.taxRate || 8;
  openModal("bizModal");
}

function saveBizSettings() {
  const name = document.getElementById("editBizName").value.trim();
  const tax  = parseFloat(document.getElementById("editTaxRate").value);
  if (!name)        { showToast("İşletme adı zorunludur!", "red"); return; }
  if (isNaN(tax) || tax < 0 || tax > 100) { showToast("Geçerli bir KDV oranı girin (0-100)!", "red"); return; }

  const s = SettingsDB.get();
  s.bizName = name;
  s.taxRate = tax;
  SettingsDB.save(s);

  // Tüm arayüz elemanlarını anında güncelle
  applyBizBranding();

  closeModal("bizModal");
  showToast("İşletme bilgileri güncellendi ✓");
}


function openModal(id)  { document.getElementById(id)?.classList.add("open"); }
function closeModal(id) { document.getElementById(id)?.classList.remove("open"); }

/* ══════════════════════════════════════════════════════
   TOAST
══════════════════════════════════════════════════════ */
let _toastTimer = null;
function showToast(msg, color = "green") {
  const toast = document.getElementById("toast");
  const dot   = document.getElementById("toastDot");
  const span  = document.getElementById("toastMsg");
  if (!toast) return;
  if (span) span.textContent = msg;
  if (dot)  dot.style.background = color === "red" ? "var(--red)" : color === "orange" ? "var(--orange)" : "var(--green)";
  toast.classList.add("show");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.remove("show"), 2500);
}

/* ══════════════════════════════════════════════════════
   RECEIPT
══════════════════════════════════════════════════════ */
function printReceipt() {
  const o = window._lastPrintOrder;
  if (!o) { showToast("Fiş verisi bulunamadı!", "red"); return; }

  const s        = SettingsDB.get();
  const bizName  = s.bizName  || "AURA Coffee & Kitchen";
  const taxRate  = s.taxRate  || 8;
  const now      = new Date(o.createdAt);
  const dateStr  = now.toLocaleDateString("tr-TR", { day:"2-digit", month:"2-digit", year:"numeric" });
  const timeStr  = now.toLocaleTimeString("tr-TR", { hour:"2-digit", minute:"2-digit" });
  const staff    = o.userId ? (UserDB.getById(o.userId)?.name || "—") : "—";
  const totalQty = o.items.reduce((s, i) => s + i.qty, 0);
  const taxAmt   = o.total * taxRate / (100 + taxRate);
  const netAmt   = o.total - taxAmt;

  const payLabel = {
    cash:  "Nakit",
    card:  "Kredi Kartı",
    split: "Bölüşüm"
  }[o.paymentMethod] || (o.paid ? "Ödendi" : "Masa Hesabı");

  const itemRows = o.items.map(i => {
    const lineTotal = i.price * i.qty;
    const name = `${i.emoji || ""} ${i.name}`.trim();
    const nameShort = name.length > 22 ? name.slice(0, 21) + "…" : name;
    return `
      <tr>
        <td style="padding:2px 0;vertical-align:top">${nameShort}</td>
        <td style="text-align:center;vertical-align:top;white-space:nowrap">${i.qty}×</td>
        <td style="text-align:right;vertical-align:top;white-space:nowrap">${formatMoney(i.price)}</td>
        <td style="text-align:right;vertical-align:top;white-space:nowrap;font-weight:600">${formatMoney(lineTotal)}</td>
      </tr>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>Fiş #${o.num}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;600;700&display=swap');

    * { margin:0; padding:0; box-sizing:border-box; }

    body {
      font-family: 'DM Mono', 'Courier New', monospace;
      font-size: 12px;
      background: #fff;
      color: #111;
      display: flex;
      justify-content: center;
      padding: 20px 0;
    }

    .receipt {
      width: 80mm;
      padding: 0 4mm;
    }

    /* ── HEADER ── */
    .header {
      text-align: center;
      padding-bottom: 10px;
      margin-bottom: 10px;
      border-bottom: 1px dashed #aaa;
    }
    .logo-box {
      width: 44px; height: 44px;
      background: #111;
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 8px;
      font-family: 'DM Sans', sans-serif;
      font-weight: 800; font-size: 20px; color: #fff;
      letter-spacing: -1px;
    }
    .biz-name {
      font-family: 'DM Sans', sans-serif;
      font-size: 16px; font-weight: 700;
      letter-spacing: -.3px;
      margin-bottom: 2px;
    }
    .biz-sub {
      font-size: 10px;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 1.5px;
    }

    /* ── META ── */
    .meta {
      font-size: 11px;
      margin-bottom: 10px;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      padding: 2px 0;
    }
    .meta-key { color: #666; }
    .meta-val { font-weight: 500; }
    .order-num-big {
      font-family: 'DM Sans', sans-serif;
      font-size: 26px; font-weight: 800;
      text-align: center;
      letter-spacing: -1px;
      margin: 8px 0 4px;
    }

    /* ── DIVIDER ── */
    .divider { border: none; border-top: 1px dashed #aaa; margin: 8px 0; }
    .divider-solid { border: none; border-top: 1px solid #111; margin: 8px 0; }

    /* ── ITEMS TABLE ── */
    .items-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11.5px;
      margin-bottom: 2px;
    }
    .items-table thead th {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: .8px;
      color: #888;
      padding: 0 0 4px 0;
      font-weight: 500;
    }
    .items-table thead th:nth-child(2),
    .items-table thead th:nth-child(3),
    .items-table thead th:nth-child(4) { text-align: right; }
    .items-table thead th:nth-child(2) { text-align: center; }

    /* ── TOTALS ── */
    .totals { margin-top: 6px; }
    .total-row {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      padding: 2px 0;
      color: #444;
    }
    .total-row.discount { color: #1a8c4e; }
    .total-grand {
      display: flex;
      justify-content: space-between;
      font-family: 'DM Sans', sans-serif;
      font-size: 17px;
      font-weight: 800;
      padding: 6px 0 4px;
    }
    .total-grand span:last-child { letter-spacing: -.5px; }

    /* ── PAYMENT ── */
    .payment-badge {
      display: inline-block;
      background: #111;
      color: #fff;
      font-family: 'DM Sans', sans-serif;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 12px;
      border-radius: 20px;
      letter-spacing: .3px;
      margin: 4px 0;
    }
    .pending-badge {
      display: inline-block;
      border: 1.5px dashed #aaa;
      color: #888;
      font-family: 'DM Sans', sans-serif;
      font-size: 10px;
      font-weight: 600;
      padding: 4px 12px;
      border-radius: 20px;
      letter-spacing: .3px;
      margin: 4px 0;
    }

    /* ── TAX ── */
    .tax-block {
      font-size: 10px;
      color: #999;
      border-top: 1px dashed #ccc;
      margin-top: 6px;
      padding-top: 6px;
    }
    .tax-row { display: flex; justify-content: space-between; padding: 1px 0; }

    /* ── NOTE ── */
    .note-block {
      background: #f5f5f5;
      border-left: 3px solid #111;
      padding: 6px 8px;
      font-size: 11px;
      color: #333;
      margin-top: 6px;
      border-radius: 0 4px 4px 0;
    }
    .note-label { font-size: 9px; color: #999; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 2px; }

    /* ── FOOTER ── */
    .footer {
      text-align: center;
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px dashed #aaa;
      font-size: 10px;
      color: #aaa;
      line-height: 1.8;
    }
    .footer strong { color: #555; font-size: 11px; }

    /* Barcode placeholder */
    .barcode {
      font-family: monospace;
      font-size: 28px;
      letter-spacing: -2px;
      color: #111;
      margin: 6px 0 2px;
      line-height: 1;
    }
    .barcode-num { font-size: 9px; color: #aaa; letter-spacing: 3px; }

    @media print {
      body { padding: 0; background: white; }
      .receipt { padding: 0 2mm; }
      @page { margin: 4mm; size: 80mm auto; }
    }
  </style>
</head>
<body>
<div class="receipt">

  <!-- HEADER -->
  <div class="header">
    <div class="logo-box">${bizName[0]?.toUpperCase() || "A"}</div>
    <div class="biz-name">${bizName}</div>
    <div class="biz-sub">Satış Fişi</div>
  </div>

  <!-- SIPARIŞ NO -->
  <div class="order-num-big">#${o.num}</div>

  <!-- META -->
  <div class="meta">
    <div class="meta-row"><span class="meta-key">Tarih</span><span class="meta-val">${dateStr}</span></div>
    <div class="meta-row"><span class="meta-key">Saat</span><span class="meta-val">${timeStr}</span></div>
    <div class="meta-row"><span class="meta-key">Masa / Tür</span><span class="meta-val">${o.tableLabel}</span></div>
    <div class="meta-row"><span class="meta-key">Personel</span><span class="meta-val">${staff}</span></div>
    ${o.couponCode ? `<div class="meta-row"><span class="meta-key">Kupon</span><span class="meta-val">${o.couponCode}</span></div>` : ""}
  </div>

  <hr class="divider">

  <!-- ÜRÜNLER -->
  <table class="items-table">
    <thead>
      <tr>
        <th style="text-align:left">Ürün</th>
        <th>Adet</th>
        <th style="text-align:right">Fiyat</th>
        <th style="text-align:right">Tutar</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  <!-- TOPLAMLAR -->
  <div class="totals">
    <hr class="divider">
    <div class="total-row">
      <span>Ara Toplam (${totalQty} ürün)</span>
      <span>${formatMoney(o.subtotal)}</span>
    </div>
    ${o.discount > 0 ? `
    <div class="total-row discount">
      <span>İndirim ${o.couponCode ? "("+o.couponCode+")" : ""}</span>
      <span>-${formatMoney(o.discount)}</span>
    </div>` : ""}
    <hr class="divider-solid">
    <div class="total-grand">
      <span>TOPLAM</span>
      <span>${formatMoney(o.total)}</span>
    </div>

    <!-- ÖDEME -->
    <div style="text-align:center;margin:4px 0 6px">
      ${o.paid
        ? `<span class="payment-badge">✓ ${payLabel}</span>`
        : `<span class="pending-badge">⏳ Ödeme Bekleniyor</span>`
      }
    </div>

    <!-- VERGİ DETAYI -->
    <div class="tax-block">
      <div class="tax-row"><span>KDV Matrahı (%${taxRate})</span><span>${formatMoney(netAmt)}</span></div>
      <div class="tax-row"><span>KDV Tutarı</span><span>${formatMoney(taxAmt)}</span></div>
    </div>
  </div>

  ${o.note ? `
  <!-- NOT -->
  <div class="note-block">
    <div class="note-label">📝 Not</div>
    ${o.note}
  </div>` : ""}

  <!-- FOOTER -->
  <div class="footer">
    <div class="barcode">|||||||||||||||||||||||</div>
    <div class="barcode-num">#${String(o.num).padStart(6,"0")}-${o.id.slice(-6).toUpperCase()}</div>
    <br>
    <strong>${bizName}</strong><br>
    ${dateStr} — ${timeStr}<br>
    Teşekkür ederiz, iyi günler! ☕
  </div>

</div>
<script>
  window.onload = function() {
    setTimeout(function() { window.print(); }, 300);
  };
<\/script>
</body>
</html>`;

  const w = window.open("", "_blank", "width=380,height=700,scrollbars=yes");
  if (!w) { showToast("Pop-up engellendi! Tarayıcıda pop-up'a izin verin.", "red"); return; }
  w.document.write(html);
  w.document.close();
  closeModal("successModal");
  showToast("Fiş yazdırılıyor... 🖨️");
}
