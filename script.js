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
  return (Number(n) || 0).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) + " ₺";
}

function paymentMethodLabel(o) {
  if (!o.paid) return "Ödenmedi";
  return o.paymentMethod === "cash"
    ? "Nakit"
    : o.paymentMethod === "card"
      ? "Kart"
      : "Bölüşüm";
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

    // Bulut bağlantı durumunu göster
    setTimeout(() => {
      if (window.AURA_CLOUD_STATUS === "connected") {
        showToast(
          "Bulut bağlantısı aktif ✓ — veriler tüm cihazlarda senkron",
          "green"
        );
      } else if (window.AURA_CLOUD_STATUS === "offline") {
        showToast(
          "Bulut bağlı değil — sadece bu cihazda çalışıyor (" +
          (window.AURA_CLOUD_STATUS_DETAIL || "") +
          ")",
          "red"
        );
      } else if (window.AURA_CLOUD_STATUS === "error") {
        showToast(
          "Bulut bağlantı hatası: " +
          (window.AURA_CLOUD_STATUS_DETAIL || "bilinmeyen hata"),
          "red"
        );
      }
    }, 600);
  });
});

// Bir veri buluta yazılamadığında kullanıcıyı uyar
window.onCloudWriteResult = function(success, errorCode) {
  if (!success) {
    showToast(
      "⚠️ Değişiklik buluta kaydedilemedi (" +
      errorCode +
      "). Sadece bu cihazda kaydedildi.",
      "red"
    );
  }
};

/* ── BULUTTAN CANLI GÜNCELLEME ───────────────────────
   Başka bir cihaz veri değiştirdiğinde buradaki fonksiyon
   tetiklenir ve o anda ekranda görünen view yeniden çizilir. */
function refreshCurrentViewFromCloud() {
  const shell = document.getElementById("appShell");

  if (!shell || shell.style.display === "none") return;

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

  const ts = now.toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit"
  });

  const ds = now.toLocaleDateString("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long"
  });

  document.querySelectorAll(".clock-time").forEach(
    el => el.textContent = ts
  );

  document.querySelectorAll(".clock-date").forEach(
    el => el.textContent = ds
  );
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

  const users = UserDB.getAll().filter(
    u => u.active !== false
  );

  grid.innerHTML = users.map(u => `
    <button class="staff-btn" onclick="selectStaff('${u.id}')">
      <div
        class="staff-avatar"
        style="background:${u.color || "#C8A96E"}"
      >
        ${u.avatar}
      </div>

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

  document.getElementById("pinUserAvatar").style.background =
    u.color || "#C8A96E";

  document.getElementById("pinUserName").textContent = u.name;

  document.getElementById("pinUserRole").textContent =
    roleLabel(u.role);

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
    dot.classList.toggle(
      "filled",
      i < pinValue.length
    );
  });
}

function checkPin() {
  const u = UserDB.authenticate(
    selectedUserId,
    pinValue
  );

  if (u) {
    loginUser(u);
  } else {
    const err = document.getElementById("pinError");

    if (err) {
      err.textContent = "Hatalı PIN, tekrar deneyin.";
    }

    const card = document.getElementById("pinCard");

    if (card) {
      card.style.animation = "shake .4s ease";

      setTimeout(
        () => card.style.animation = "",
        400
      );
    }

    setTimeout(clearPin, 600);
  }
}

function backToStaffSelect() {
  document.getElementById("pinScreen").style.display = "none";
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
  document.getElementById("staffPillAvatar").textContent =
    u.avatar;

  document.getElementById("staffPillAvatar").style.background =
    u.color || "";

  document.getElementById("staffPillAvatar").style.color =
    "#0a0a0a";

  document.getElementById("staffPillName").textContent =
    u.name;

  document.getElementById("staffPillRole").textContent =
    roleLabel(u.role);

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

    [
      navBarista,
      navReports,
      navMenu,
      navCoupons,
      navSettings
    ].forEach(
      el => el && (el.style.display = "flex")
    );

  } else if (u.role === "barista") {

    navBarista &&
      (navBarista.style.display = "flex");

    navReports &&
      (navReports.style.display = "none");

    navMenu &&
      (navMenu.style.display = "none");

    navCoupons &&
      (navCoupons.style.display = "none");

    navSettings &&
      (navSettings.style.display = "none");

  } else {

    // waiter
    [
      navBarista,
      navReports,
      navMenu,
      navCoupons,
      navSettings
    ].forEach(
      el => el && (el.style.display = "none")
    );
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

const VIEWS = [
  "pos",
  "tables",
  "barista",
  "reports",
  "menu",
  "coupons",
  "settings"
];

function switchView(v) {

  // Erişim kontrolü
  const role = currentUser
    ? currentUser.role
    : "waiter";

  const allowed = {

    admin: [
      "pos",
      "tables",
      "barista",
      "reports",
      "menu",
      "coupons",
      "settings"
    ],

    barista: [
      "pos",
      "tables",
      "barista"
    ],

    waiter: [
      "pos",
      "tables"
    ]
  };

  if (!(allowed[role] || []).includes(v)) {
    showToast(
      "Bu alana erişim yetkiniz yok.",
      "red"
    );

    return;
  }

  VIEWS.forEach(name => {

    const el = document.getElementById(
      "view-" + name
    );

    if (el) {
      el.style.display =
        name === v ? "flex" : "none";
    }

    const nb = document.getElementById(
      "nav-" + name
    );

    if (nb) {
      nb.classList.toggle(
        "active",
        name === v
      );
    }
  });

  currentView = v;

  if (v === "pos") {
    renderPos();
  }

  if (v === "tables") {
    renderTables();
  }

  if (v === "barista") {
    renderBarista();
  }

  if (v === "reports") {
    renderReports();
  }

  if (v === "menu") {
    currentMenuCat = "";
    renderMenuManage();
  }

  if (v === "coupons") {
    renderCoupons();
  }

  if (v === "settings") {
    renderSettings();
  }
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
  const cats = [
    "Tümü",
    ...MenuDB.getCategories()
  ];

  const container =
    document.getElementById("catTabs");

  if (!container) return;

  container.innerHTML = cats.map(c => {

    const count =
      c === "Tümü"
        ? MenuDB.getAll().length
        : MenuDB.getByCategory(c).length;

    return `
      <button
        class="cat-tab ${c === activeCat ? "active" : ""}"
        onclick="setCat('${c}')"
      >
        ${c}
        <span class="cat-count">${count}</span>
      </button>
    `;

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

  const search =
    (
      document.getElementById("posSearch")?.value || ""
    ).toLowerCase();

  let items =
    activeCat === "Tümü"
      ? MenuDB.getAll()
      : MenuDB.getByCategory(activeCat);

  if (search) {
    items = items.filter(
      p =>
        p.name.toLowerCase().includes(search) ||
        p.desc.toLowerCase().includes(search)
    );
  }

  const grid =
    document.getElementById("productGrid");

  if (!grid) return;

  if (items.length === 0) {

    grid.innerHTML = `
      <div
        style="
          grid-column:1/-1;
          text-align:center;
          padding:40px;
          color:var(--text3);
          font-size:13px;
        "
      >
        <div style="font-size:32px;margin-bottom:8px;">
          🔍
        </div>

        Ürün bulunamadı
      </div>
    `;

    return;
  }

  grid.innerHTML = items.map(p => `

    <div
      class="product-card ${p.available === false ? "unavailable" : ""}"
      onclick="addToCart(${p.id})"
    >

      <div class="card-top-row">

        <span class="product-emoji">
          ${p.emoji}
        </span>

        ${
          p.popular
            ? '<span class="popular-badge">⭐ Popüler</span>'
            : ""
        }

      </div>

      <div class="product-name">
        ${p.name}
      </div>

      <div class="product-desc">
        ${p.desc}
      </div>

      <div class="card-footer">

        <span class="product-price">
          ${formatMoney(p.price)}
        </span>

        <button
          class="add-btn"
          onclick="
            event.stopPropagation();
            addToCart(${p.id})
          "
        >
          +
        </button>

      </div>

    </div>

  `).join("");
}

function addToCart(productId) {

  const p = MenuDB.getById(productId);

  if (!p) return;

  const existing =
    cart.find(i => i.id === productId);

  if (existing) {

    existing.qty++;

  } else {

    cart.push({
      id: p.id,
      name: p.name,
      emoji: p.emoji,
      price: p.price,
      qty: 1
    });

  }

  renderOrderPanel();

  showToast(
    `${p.emoji} ${p.name} eklendi`
  );
}

function changeQty(productId, delta) {

  const idx =
    cart.findIndex(i => i.id === productId);

  if (idx < 0) return;

  cart[idx].qty += delta;

  if (cart[idx].qty <= 0) {
    cart.splice(idx, 1);
  }

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

  if (type === "takeaway") {
    selectedTable = null;
  }

  applyOrderTypeUI();
  renderOrderPanel();
}

function applyOrderTypeUI() {

  document
    .getElementById("ot-dinein")
    ?.classList.toggle(
      "active",
      orderType === "dinein"
    );

  document
    .getElementById("ot-takeaway")
    ?.classList.toggle(
      "active",
      orderType === "takeaway"
    );

  const tableBtn =
    document.getElementById("tableSelectBtn");

  const paymentSection =
    document.getElementById("paymentSection");

  const dineinNote =
    document.getElementById("dineinNote");

  if (tableBtn) {
    tableBtn.style.display =
      orderType === "dinein"
        ? "flex"
        : "none";
  }

  if (paymentSection) {
    paymentSection.style.display =
      orderType === "takeaway"
        ? "block"
        : "none";
  }

  if (dineinNote) {
    dineinNote.style.display =
      orderType === "dinein"
        ? "flex"
        : "none";
  }
}

function renderOrderPanel() {

  // Sipariş no
  const settings =
    DB.get(DB_KEYS.SETTINGS) || {
      orderCounter: 40
    };

  document.getElementById("orderBadge").textContent =
    "#" + (settings.orderCounter + 1);

  // Seçili masa
  const tableLabel =
    document.getElementById("selectedTableLabel");

  if (tableLabel) {

    tableLabel.textContent =
      selectedTable
        ? `Masa ${selectedTable.num} — ${selectedTable.zone}`
        : "Masa Seç";

  }

  const tableBtn =
    document.getElementById("tableSelectBtn");

  if (tableBtn) {
    tableBtn.classList.toggle(
      "warn",
      orderType === "dinein" &&
      !selectedTable
    );
  }

  // Liste
  const list =
    document.getElementById("orderList");

  if (!list) return;

  if (cart.length === 0) {

    list.innerHTML = `
      <div class="order-empty">
        <div class="order-empty-icon">
          🛒
        </div>
        <p>Sepet boş</p>
      </div>
    `;

  } else {

    list.innerHTML = cart.map(item => `

      <div class="order-item">

        <span class="oi-emoji">
          ${item.emoji}
        </span>

        <div class="oi-info">

          <div class="oi-name">
            ${item.name}
          </div>

          <div class="oi-price">
            ${formatMoney(item.price * item.qty)}
          </div>

        </div>

        <div class="oi-qty">

          <button
            class="qty-btn minus"
            onclick="changeQty(${item.id},-1)"
          >
            −
          </button>

          <span class="qty-num">
            ${item.qty}
          </span>

          <button
            class="qty-btn"
            onclick="changeQty(${item.id},1)"
          >
            +
          </button>

        </div>

      </div>

    `).join("");
  }

  // Toplamlar
  const subtotal =
    cart.reduce(
      (s, i) => s + i.price * i.qty,
      0
    );

  let discount = 0;

  if (appliedCoupon) {

    if (appliedCoupon.type === "percent") {

      discount =
        subtotal *
        appliedCoupon.value /
        100;

    } else {

      discount =
        Math.min(
          appliedCoupon.value,
          subtotal
        );

    }
  }

  const total =
    Math.max(
      0,
      subtotal - discount
    );

  document.getElementById(
    "subtotalDisplay"
  ).textContent =
    formatMoney(subtotal);

  document.getElementById(
    "totalDisplay"
  ).textContent =
    formatMoney(total);

  document.getElementById(
    "confirmTotal"
  ).textContent =
    formatMoney(total);

  const discountRow =
    document.getElementById(
      "discountRow"
    );

  if (discountRow) {

    discountRow.style.display =
      discount > 0
        ? "flex"
        : "none";

    document.getElementById(
      "discountDisplay"
    ).textContent =
      "- " + formatMoney(discount);
  }

  // Onay butonu
  const needsTable =
    orderType === "dinein" &&
    !selectedTable;

  document.getElementById(
    "confirmBtn"
  ).disabled =
    cart.length === 0 ||
    needsTable;

  const btnLabel =
    document.getElementById(
      "confirmBtnLabel"
    );

  if (btnLabel) {

    btnLabel.textContent =
      orderType === "takeaway"
        ? "Siparişi Tamamla ve Öde"
        : "Siparişi Mutfağa Gönder";
  }
}

/* ── Ödeme yöntemi ─────────────────────────────────── */

function selectPayment(method) {

  paymentMethod = method;

  [
    "cash",
    "card",
    "split"
  ].forEach(m => {

    document
      .getElementById("pm-" + m)
      ?.classList.toggle(
        "active",
        m === method
      );

  });
}

/* ── İndirim / Kupon ───────────────────────────────── */

function toggleDiscount() {

  const box =
    document.getElementById(
      "discountBox"
    );

  if (box) {

    box.style.display =
      box.style.display === "none"
        ? "block"
        : "none";

  }
}

function applyCoupon() {

  const code =
    document.getElementById(
      "couponInput"
    )?.value.trim().toUpperCase();

  const msg =
    document.getElementById(
      "couponMsg"
    );

  if (!code) return;

  const subtotal =
    cart.reduce(
      (s, i) => s + i.price * i.qty,
      0
    );

  const c =
    CouponDB.getByCode(code);

  if (!c) {

    if (msg) {

      msg.textContent =
        "❌ Geçersiz veya pasif kupon.";

      msg.style.color =
        "var(--red)";
    }

    return;
  }

  if (c.min && subtotal < c.min) {

    if (msg) {

      msg.textContent =
        `⚠️ Min. ${formatMoney(c.min)} sepet gerekli.`;

      msg.style.color =
        "var(--orange)";
    }

    return;
  }

  if (c.limit && c.usedCount >= c.limit) {

    if (msg) {

      msg.textContent =
        "❌ Kupon kullanım limitine ulaşıldı.";

      msg.style.color =
        "var(--red)";
    }

    return;
  }

  appliedCoupon = c;

  if (msg) {

    const disc =
      c.type === "percent"
        ? `%${c.value} indirim`
        : `${formatMoney(c.value)} indirim`;

    msg.textContent =
      `✅ ${disc} uygulandı!`;

    msg.style.color =
      "var(--green)";
  }

  const removeBtn =
    document.getElementById(
      "removeDiscount"
    );

  if (removeBtn) {
    removeBtn.style.display =
      "inline-block";
  }

  renderOrderPanel();
}

function removeDiscount() {

  appliedCoupon = null;

  const inp =
    document.getElementById(
      "couponInput"
    );

  const msg =
    document.getElementById(
      "couponMsg"
    );

  const btn =
    document.getElementById(
      "removeDiscount"
    );

  if (inp) inp.value = "";

  if (msg) msg.textContent = "";

  if (btn) {
    btn.style.display = "none";
  }

  renderOrderPanel();
}
