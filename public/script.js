(() => {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rupiah = n => 'Rp ' + Math.round(n).toLocaleString('id-ID');
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const normPhone = v => { const d = String(v).replace(/\D/g, ''); return d.startsWith('62') ? '0' + d.slice(2) : d; };
  const phoneOk = p => /^08\d{8,12}$/.test(p);
  const FREE_SHIP_KG = 5, SHIP_FEE = 8000;

  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  const state = {
    services: [], slots: [], waNumber: '',
    user: null,
    appliedPromo: '',
    mode: 'Pickup'
  };

  /* ---------- Boot ---------- */
  (async () => {
    try {
      const cat = await api.get('/api/catalog');
      state.services = cat.services || [];
      state.slots = cat.slots || [];
      state.waNumber = cat.waNumber || '';
    } catch { toast('Gagal memuat katalog.'); }

    try { state.user = await api.me(); } catch {}

    initWa();
    renderCards();
    renderPriceTable(3);
    fillServiceOptions();
    updateAuthUI();
    bindAuthForms();
    bindOrderForm();
    bindDrawer();
    initTestimonials();
    seedSlotOptions();
    const yr = $('#year'); if (yr) yr.textContent = new Date().getFullYear();
    $$('.msg').forEach(m => m.setAttribute('role', 'alert'));
  })();

  /* ---------- WhatsApp & katalog ---------- */
  const waLink = text => `https://wa.me/${state.waNumber}?text=${encodeURIComponent(text)}`;
  function initWa() {
    $$('[data-wa]').forEach(a => { a.href = waLink(a.dataset.wa); });
    $$('[data-wa-text]').forEach(el => { if (state.waNumber) el.textContent = '0' + state.waNumber.slice(2); });
  }

  function renderCards() {
    const el = $('#cards'); if (!el) return;
    el.innerHTML = state.services.map(s => `
      <button class="card" data-service="${s.id}" aria-label="Pesan ${esc(s.name)}">
        <span class="ci"><svg class="ico" style="width:24px;height:24px"><use href="#${s.icon}"/></svg></span>
        <h3>${esc(s.name)}</h3>
        <p>${esc(s.desc)}</p>
        <span class="price"><span><small>Mulai dari</small><b>${rupiah(s.price)}/kg</b></span><svg class="ico" style="width:18px;height:18px"><use href="#i-arrow"/></svg></span>
      </button>`).join('');
  }

  function renderPriceTable(weight = 3) {
    const el = $('#priceTable'); if (!el) return;
    const kg = Math.min(50, Math.max(1, parseFloat(weight) || 1));
    el.innerHTML =
      `<div class="prow"><span>Layanan</span><span class="d">Cocok untuk</span><span>Harga / kg</span><span>Estimasi (${kg} kg)</span></div>` +
      state.services.map(s => `
        <div class="prow">
          <b>${esc(s.name)}</b>
          <span class="d">${esc(s.note)} · ${s.days} hari</span>
          <span><b>${rupiah(s.price)}</b></span>
          <span style="color:#3d8f9b; font-weight:600;">${rupiah(s.price * kg)}</span>
        </div>`).join('');
  }

  const simInput = $('#simulasiBerat');
  if (simInput) simInput.addEventListener('input', e => renderPriceTable(e.target.value));

  /* ---------- Auth UI ---------- */
  function updateAuthUI() {
    const user = state.user;
    const isAdmin = user?.role === 'admin', isStaff = isAdmin || user?.role === 'staff';
    [['#openAdminBtn', isAdmin], ['#openAdminBtnMobile', isAdmin],
     ['#openStaffBtn', isStaff], ['#openStaffBtnMobile', isStaff]]
      .forEach(([sel, ok]) => { const el = $(sel); if (el) el.hidden = !ok; });

    const authContainer = $('#authContainer');
    const drawerAuth = $('#drawerAuth');
    if (user) {
      const initial = [...user.name][0].toUpperCase();
      authContainer.innerHTML = `
        <button type="button" class="user-pill" id="openDashboardBtn" title="Buka Dashboard">
          <div class="user-avatar">${initial}</div>
          <span class="user-name">${esc(user.name)}</span>
        </button>`;
      drawerAuth.innerHTML = `
        <p style="font-size:.85rem;text-align:center;padding:6px;color:#ccc;">Masuk sebagai <b>${esc(user.name)}</b></p>
        <button class="btn btn-outline" id="drawerDashboard" style="width:100%;justify-content:center;margin-bottom:6px;">Dashboard</button>
        <button class="btn btn-outline" id="drawerLogout" style="width:100%;justify-content:center;color:#ff6b6b;border-color:#ff6b6b;">Keluar</button>`;
      if ($('#nama') && !$('#nama').value) $('#nama').value = user.name;
    } else {
      authContainer.innerHTML = `
        <button class="btn btn-outline" data-open-auth="login">Masuk</button>
        <button class="btn btn-light" data-open-auth="register">Daftar</button>`;
      drawerAuth.innerHTML = `
        <button class="btn btn-outline" data-open-auth="login" style="width:100%;justify-content:center;">Masuk</button>
        <button class="btn btn-light" data-open-auth="register" style="width:100%;justify-content:center;">Daftar</button>`;
    }
  }

  const openDashboard = () => { location.href = 'dashboard.html'; };
  const openAdminDashboard = () => { location.href = 'dashboard.html#/semua'; };
  const openStaffDashboard = () => { location.href = 'dashboard.html#/tugas'; };

  document.addEventListener('click', async e => {
    if (e.target.closest('#openDashboardBtn, #drawerDashboard')) openDashboard();
    if (e.target.id === 'drawerLogout') {
      try { await api.post('/api/auth/logout'); } catch {}
      state.user = null; updateAuthUI(); closeDrawer(); toast('Berhasil keluar akun.');
    }
  });

  ['#openAdminBtn', '#openAdminBtnMobile'].forEach(s => { const el = $(s); if (el) el.addEventListener('click', openAdminDashboard); });
  ['#openStaffBtn', '#openStaffBtnMobile'].forEach(s => { const el = $(s); if (el) el.addEventListener('click', openStaffDashboard); });

  /* ---------- Auth modal ---------- */
  const authOverlay = $('#authOverlay');
  let authLastFocus = null;

  function openAuthModal(viewType = 'login') {
    if (!authOverlay.classList.contains('open')) authLastFocus = document.activeElement;
    authOverlay.setAttribute('aria-labelledby', viewType === 'login' ? 'authTitle' : 'regTitle');
    $('#loginView').hidden = viewType !== 'login';
    $('#registerView').hidden = viewType !== 'register';
    authOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => (viewType === 'login' ? $('#loginEmail') : $('#regName'))?.focus(), 50);
  }
  function closeAuthModal() {
    authOverlay.classList.remove('open');
    document.body.style.overflow = '';
    if (authLastFocus) authLastFocus.focus();
  }
  $('#authCloseBtn').addEventListener('click', closeAuthModal);
  authOverlay.addEventListener('mousedown', e => { if (e.target === authOverlay) closeAuthModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && authOverlay.classList.contains('open')) closeAuthModal(); });
  $('#toRegister').addEventListener('click', e => { e.preventDefault(); openAuthModal('register'); });
  $('#toLogin').addEventListener('click', e => { e.preventDefault(); openAuthModal('login'); });

  const setErr = (el, bad) => {
    if (!el) return bad;
    el.closest('.fld')?.classList.toggle('err', bad);
    el.setAttribute('aria-invalid', String(bad));
    return bad;
  };

  function bindAuthForms() {
    const regForm = $('#registerForm');
    regForm.addEventListener('submit', async e => {
      e.preventDefault();
      const name = $('#regName').value.trim();
      const email = $('#regEmail').value.trim().toLowerCase();
      const pass = $('#regPass').value;

      const errs = [
        setErr($('#regName'), name.length < 2),
        setErr($('#regEmail'), !EMAIL_RE.test(email)),
        setErr($('#regPass'), pass.length < 8)
      ];
      if (errs.some(Boolean)) return;

      const btn = regForm.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const u = await api.post('/api/auth/register', { name, email, password: pass });
        state.user = u; updateAuthUI();
        closeAuthModal(); regForm.reset();
        toast(`Registrasi berhasil! Selamat datang, ${u.name}`);
      } catch (err) {
        if (err.status === 409) {
          toast('Email sudah terdaftar. Silakan masuk.');
          openAuthModal('login'); $('#loginEmail').value = email;
        } else {
          toast(err.message || 'Registrasi gagal.');
        }
      } finally { btn.disabled = false; }
    });

    const loginForm = $('#loginForm');
    loginForm.addEventListener('submit', async e => {
      e.preventDefault();
      const email = $('#loginEmail').value.trim().toLowerCase();
      const pass = $('#loginPass').value;
      const errs = [setErr($('#loginEmail'), !email), setErr($('#loginPass'), !pass)];
      if (errs.some(Boolean)) return;

      const btn = loginForm.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const u = await api.post('/api/auth/login', { email, password: pass });
        state.user = u; updateAuthUI();
        closeAuthModal(); loginForm.reset();
        toast(`Berhasil masuk kembali, ${u.name}`);
      } catch (err) {
        toast(err.message || 'Email atau kata sandi salah.');
      } finally { btn.disabled = false; }
    });
  }

  /* ---------- Order form ---------- */
  const overlay = $('#overlay'), form = $('#orderForm');
  let lastFocus = null;

  function fillServiceOptions() {
    const sel = $('#layanan-sel'); if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">Pilih layanan</option>' +
      state.services.map(s => `<option value="${s.id}">${esc(s.name)} — ${rupiah(s.price)}/kg</option>`).join('');
    if (cur) sel.value = cur;
  }

  function iso(d) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function setMinDate() {
    const t = new Date();
    const el = $('#tanggal'); if (!el) return;
    el.min = iso(t);
    if (!el.value || el.value < el.min) el.value = iso(t);
  }

  async function refreshSlots() {
    const dateEl = $('#tanggal'), slotEl = $('#waktu');
    if (!dateEl?.value) return;
    try {
      const url = `/api/slots?date=${encodeURIComponent(dateEl.value)}&mode=${encodeURIComponent(state.mode)}`;
      const rows = await api.get(url);
      const cur = slotEl.value;
      slotEl.innerHTML = rows.map(r =>
        `<option value="${esc(r.slot)}"${r.full ? ' disabled' : ''}>${esc(r.slot)}${r.full ? ' (penuh)' : ''}</option>`
      ).join('');
      const free = [...slotEl.options].filter(o => !o.disabled);
      const keep = free.find(o => o.value === cur) || free[0];
      slotEl.selectedIndex = keep ? keep.index : -1;
    } catch { /* diamkan */ }
  }

  function seedSlotOptions() {
    const slotEl = $('#waktu'); if (!slotEl) return;
    slotEl.innerHTML = state.slots.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  }

  const slotPassed = () => {
    const t = $('#tanggal').value, w = $('#waktu').value;
    if (!w) return false;
    return t === iso(new Date()) && new Date().getHours() >= parseInt(w.split(' - ')[1], 10);
  };

  const fmtDate = s => new Date(s + 'T00:00:00').toLocaleDateString('id-ID', {weekday:'long', day:'numeric', month:'long', year:'numeric'});

  function setPromoMsg(t, cls) {
    const m = $('#promoMsg'); if (!m) return;
    m.textContent = t; m.className = 'promo-msg' + (cls ? ' ' + cls : '');
  }

  async function applyPromo() {
    const input = $('#promo');
    const code = input.value.trim().toUpperCase();
    const serviceId = $('#layanan-sel').value;
    const weight = parseFloat($('#berat').value);
    if (!code) { state.appliedPromo = ''; setPromoMsg('', ''); return true; }
    if (!serviceId || !weight) { setPromoMsg('Pilih layanan dan berat dulu.', 'bad'); return false; }
    try {
      const r = await api.post('/api/promo/validate', { code, serviceId, weight });
      state.appliedPromo = r.code;
      input.value = r.code;
      setPromoMsg(`${r.label || r.code}: hemat ${rupiah(r.amount)}`, 'ok');
      return true;
    } catch (err) {
      state.appliedPromo = '';
      setPromoMsg(err.message || 'Kode promo tidak valid.', 'bad');
      return false;
    }
  }

  function updateEstimate() {
    const s = state.services.find(x => x.id === $('#layanan-sel').value);
    const kg = Math.max(0, parseFloat($('#berat').value) || 0);
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    if (!s) {
      $('#eDiskonRow').hidden = true;
      set('#eLayanan', '—'); set('#eSelesai', '—'); set('#eOngkir', '—'); set('#eTotal', 'Rp 0');
      return;
    }
    const ship = kg >= FREE_SHIP_KG ? 0 : SHIP_FEE;
    set('#eLayanan', `${s.name} (${rupiah(s.price)}/kg × ${kg || 0})`);
    const tEl = $('#tanggal');
    if (tEl?.value) {
      const d = new Date(tEl.value + 'T00:00:00'); d.setDate(d.getDate() + s.days);
      set('#eSelesai', d.toLocaleDateString('id-ID', {weekday:'short', day:'numeric', month:'short'}));
    }
    set('#eOngkir', ship ? rupiah(ship) : 'Gratis');
    // Diskon tidak dihitung di klien — server yang menentukan saat submit.
    $('#eDiskonRow').hidden = true;
    set('#eTotal', rupiah(Math.round(s.price * kg) + ship));
  }

  function setMode(m) {
    state.mode = m;
    $$('.seg button').forEach(b => {
      const on = b.dataset.mode === m;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on);
    });
    const w = m === 'Pickup' ? 'Penjemputan' : 'Pengantaran';
    $('#lblAlamat').textContent = 'Alamat ' + w;
    $('#lblTgl').textContent = 'Tanggal ' + w;
    $('#lblWaktu').textContent = 'Waktu ' + w;
    $('#formView .sub').textContent = m === 'Pickup'
      ? 'Isi data di bawah untuk menjadwalkan pickup laundry.'
      : 'Isi data di bawah untuk menjadwalkan pengantaran pakaian bersih.';
    refreshSlots();
  }

  async function fillSavedAddresses() {
    const sel = $('#alamatTersimpan');
    const fld = $('#fldSaved');
    if (!state.user) { fld.hidden = true; return; }
    try {
      const list = await api.get('/api/addresses');
      fld.hidden = !list.length;
      sel.innerHTML = '<option value="">Ketik alamat baru di bawah</option>' +
        list.map(a => `<option value="${esc(a.id)}" data-text="${esc(a.text)}">${esc(a.label)} — ${esc(a.text.slice(0, 40))}</option>`).join('');
      const def = list.find(a => a.defaultAddr);
      if (def && !$('#alamat').value) {
        sel.value = def.id;
        $('#alamat').value = def.text;
      }
      const me = await api.me();
      if (me?.phone && !$('#telp').value) $('#telp').value = me.phone;
    } catch { fld.hidden = true; }
  }

  async function openOrder(serviceId) {
    if (!state.user) {
      toast('Silakan masuk atau daftar dulu untuk memesan.');
      openAuthModal('login');
      return;
    }
    lastFocus = document.activeElement;
    $('#formView').hidden = false; $('#doneView').hidden = true;
    setMinDate(); seedSlotOptions(); await refreshSlots();
    if (serviceId) $('#layanan-sel').value = serviceId;
    if (state.user) $('#nama').value = state.user.name;
    await fillSavedAddresses();
    updateEstimate();
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => ($('#nama').value ? $('#alamat') : $('#nama')).focus(), 50);
  }
  function closeOrder() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  }

  $('#closeBtn').addEventListener('click', closeOrder);
  $('#doneBtn').addEventListener('click', closeOrder);
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) closeOrder(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay.classList.contains('open')) closeOrder(); });
  $$('.seg button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

  document.addEventListener('click', e => {
    const openOrderBtn = e.target.closest('[data-open-order]');
    const card = e.target.closest('[data-service]');
    const authBtn = e.target.closest('[data-open-auth]');
    if (openOrderBtn) { closeDrawer(); openOrder(); }
    else if (card) openOrder(card.dataset.service);
    else if (authBtn) { closeDrawer(); openAuthModal(authBtn.dataset.openAuth); }
  });

  function bindOrderForm() {
    ['change', 'input'].forEach(ev => form.addEventListener(ev, e => {
      if (e.target.id === 'tanggal') refreshSlots();
      if (e.target.id === 'promo' && e.target.value.trim().toUpperCase() !== state.appliedPromo) {
        state.appliedPromo = ''; setPromoMsg('', '');
      }
      updateEstimate();
      e.target.closest('.fld')?.classList.remove('err');
    }));

    $('#alamatTersimpan')?.addEventListener('change', e => {
      const opt = e.target.selectedOptions[0];
      if (opt?.dataset.text) {
        $('#alamat').value = opt.dataset.text;
        $('#alamat').closest('.fld')?.classList.remove('err');
      }
    });
    $('#promoBtn')?.addEventListener('click', applyPromo);
    $('#promo')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); applyPromo(); } });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!state.user) { closeOrder(); openAuthModal('login'); return; }

      const kg = parseFloat($('#berat').value);
      const slotMsg = slotPassed() ? 'Slot hari ini sudah lewat, pilih slot lain.' : '';
      if (slotMsg) $('#waktu').closest('.fld').querySelector('.msg').textContent = slotMsg;

      const bad = [
        setErr($('#nama'), $('#nama').value.trim().length < 2),
        setErr($('#telp'), !phoneOk(normPhone($('#telp').value))),
        setErr($('#alamat'), $('#alamat').value.trim().length < 10),
        setErr($('#tanggal'), !$('#tanggal').value),
        setErr($('#waktu'), !!slotMsg || !$('#waktu').value),
        setErr($('#layanan-sel'), !$('#layanan-sel').value),
        setErr($('#berat'), !(kg >= 1 && kg <= 50))
      ];
      if (bad.some(Boolean)) {
        const first = $('.fld.err input, .fld.err select', form);
        if (first) first.focus();
        return;
      }

      const promoInput = $('#promo').value.trim().toUpperCase();
      if (promoInput && promoInput !== state.appliedPromo) {
        const ok = await applyPromo();
        if (!ok) return;
      }

      const payload = {
        serviceId: $('#layanan-sel').value,
        mode: state.mode,
        weight: kg,
        date: $('#tanggal').value,
        slot: $('#waktu').value,
        telp: normPhone($('#telp').value),
        alamat: $('#alamat').value.trim(),
        note: $('#catatan').value.trim(),
        promo: state.appliedPromo,
        payment: $('#pembayaran').value
      };

      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const o = await api.post('/api/orders', payload);
        showDone(o);
      } catch (err) {
        if (err.status === 409) { toast(err.message); refreshSlots(); }
        else { toast(err.message || 'Gagal membuat pesanan.'); }
      } finally { btn.disabled = false; }
    });
  }

  function showDone(o) {
    const rows = [
      ['Nama', $('#nama').value.trim()],
      ['Tipe', o.mode],
      ['Alamat', o.alamat],
      ['Jadwal', `${fmtDate(o.date)}, ${o.slot}`],
      ['Layanan', `${o.serviceName} · ${o.weight} kg`],
      ['Pembayaran', o.payment],
      ['Estimasi total', rupiah(o.total)]
    ];
    if (o.note) rows.splice(6, 0, ['Catatan', o.note]);
    if (o.discount) rows.splice(rows.length - 1, 0, [`Diskon${o.promo ? ' (' + o.promo + ')' : ''}`, '- ' + rupiah(o.discount)]);
    $('#sum').innerHTML = rows.map(([k, v]) => `<div><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('');
    $('#kode').textContent = o.code;
    $('#waConfirm').href = waLink(
      `Halo CleanLoop, saya ingin konfirmasi pesanan ${o.code} (${o.mode}).\n` +
      `Layanan: ${o.serviceName}, ${o.weight} kg\nJadwal: ${fmtDate(o.date)}, ${o.slot}\n` +
      `Alamat: ${o.alamat}\nEstimasi total: ${rupiah(o.total)}`
    );
    const pay = $('#payNowLink');
    pay.hidden = o.payment === 'COD';
    pay.href = 'dashboard.html#/bayar/' + o.code;

    $('#formView').hidden = true; $('#doneView').hidden = false;
    $('#overlay .modal').scrollTop = 0;
    form.reset(); state.appliedPromo = ''; setPromoMsg('', ''); setMode('Pickup');
  }

  /* ---------- Focus trap ---------- */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const modal = $('.overlay.open .modal');
    if (!modal) return;
    const items = $$('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])', modal)
      .filter(el => !el.closest('[hidden]') && el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (!modal.contains(document.activeElement) || (e.shiftKey && document.activeElement === first)) {
      e.preventDefault(); (e.shiftKey ? last : first).focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  });

  /* ---------- Drawer ---------- */
  const burger = $('#burger'), drawer = $('#drawer');
  function closeDrawer() { drawer.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); }
  burger.addEventListener('click', () => {
    const o = drawer.classList.toggle('open');
    burger.setAttribute('aria-expanded', o);
  });
  $$('#drawer a').forEach(a => a.addEventListener('click', closeDrawer));
  window.addEventListener('resize', () => { if (innerWidth > 980) closeDrawer(); });

  const links = $$('.menu a');
  const spy = new IntersectionObserver(entries => {
    entries.forEach(en => { if (en.isIntersecting) links.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + en.target.id)); });
  }, { rootMargin: '-45% 0px -50% 0px' });
  ['beranda','layanan','harga','tentang','kontak'].forEach(id => { const el = document.getElementById(id); if (el) spy.observe(el); });

  /* ---------- Testimoni ---------- */
  async function initTestimonials() {
    const sec = $('#testimoni'); if (!sec) return;
    try {
      const rows = await api.get('/api/testimonials');
      if (!rows.length) { sec.hidden = true; return; }
      sec.hidden = false;
      const short = n => { const p = String(n).trim().split(/\s+/); return p[1] ? `${p[0]} ${[...p[1]][0].toUpperCase()}.` : p[0]; };
      const avg = rows.reduce((a, r) => a + r.rating, 0) / rows.length;
      $('#testiMeta').textContent = `Rata-rata ${avg.toFixed(1).replace('.', ',')} dari 5 · ${rows.length} ulasan`;
      $('#testiList').innerHTML = rows.slice(0, 6).map(r => `
        <figure class="tcard"><span class="stars" aria-label="${r.rating} dari 5 bintang">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
          <p>${esc(r.text)}</p><figcaption><b>${esc(short(r.name))}</b><small>${esc(r.service)}</small></figcaption></figure>`).join('');
    } catch { sec.hidden = true; }
  }
})();