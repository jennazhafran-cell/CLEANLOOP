(() => {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rupiah = n => 'Rp ' + Math.round(n).toLocaleString('id-ID');
  const fmtDT = iso => iso ? new Date(iso).toLocaleString('id-ID', {dateStyle:'medium', timeStyle:'short'}) : '-';
  const NONE = 'Belum ditugaskan', CANCELLED = 'Dibatalkan';
  const STATUS = ['Menunggu Penjemputan', 'Sedang Dicuci', 'Disetrika', 'Siap Diantar', 'Selesai'];
  const normPhone = v => { const d = String(v).replace(/\D/g, ''); return d.startsWith('62') ? '0' + d.slice(2) : d; };
  const phoneOk = p => /^08\d{8,12}$/.test(p);
  const localISO = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ---------- Metode pembayaran (untuk tampilan) ---------- */
  const METHODS = [
    ['QRIS', [['qris', 'QRIS · semua e-wallet & m-banking']]],
    ['Virtual Account', ['BCA','Mandiri','BNI','BRI','Permata'].map(b => ['va:' + b, 'VA ' + b])],
    ['E-Wallet', ['GoPay','OVO','DANA','ShopeePay','LinkAja'].map(b => ['ew:' + b, b])],
    ['Kartu', [['card', 'Kartu Kredit / Debit']]],
    ['Minimarket', ['Alfamart','Indomaret'].map(b => ['mm:' + b, b])]
  ];
  const feeOf = (m, t) => m.startsWith('va') ? 4000
    : m.startsWith('ew') ? Math.round(t * .015)
    : m === 'qris' ? Math.round(t * .007)
    : m === 'card' ? Math.round(t * .029 + 2000)
    : m.startsWith('mm') ? 5000 : 0;

  const rng = str => { let x = [...str].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7); return () => (x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32; };
  const digits = (s, n) => { const r = rng(s); return Array.from({length: n}, () => Math.floor(r() * 10)).join(''); };
  function qr(seed) {
    const r = rng(seed), N = 25;
    const finder = (x, y) => (x < 8 && y < 8) || (x > N - 9 && y < 8) || (x < 8 && y > N - 9);
    let cells = '';
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!finder(x, y) && r() > .5) cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    const eye = (x, y) => `<path fill-rule="evenodd" d="M${x} ${y}h7v7h-7zM${x + 1} ${y + 1}v5h5v-5zM${x + 2} ${y + 2}h3v3h-3z"/>`;
    return `<svg viewBox="0 0 25 25" class="qr" aria-label="QR simulasi">${cells}${eye(0, 0)}${eye(N - 7, 0)}${eye(0, N - 7)}</svg>`;
  }
  function instructions(m, o) {
    const [type, name] = m.split(':');
    const code = digits(o.code + m, 12).replace(/(\d{4})(?=\d)/g, '$1 ');
    if (type === 'qris') return `${qr(o.code)}<p>Scan dengan GoPay, OVO, DANA, m-banking, atau e-wallet lain.</p>`;
    if (type === 'va') return `<p>Transfer ke Virtual Account ${esc(name)}</p><div class="vano">${code}</div><p class="sm" style="justify-content:center">Berlaku 24 jam · ATM, m-banking, atau internet banking</p>`;
    if (type === 'ew') return `<p>Permintaan bayar dikirim ke ${esc(name)} (${esc(o.telp || 'nomor Anda')}). Buka aplikasi dan setujui.</p>`;
    if (type === 'mm') return `<p>Tunjukkan kode ini ke kasir ${esc(name)}</p><div class="vano">${code}</div>`;
    return `<div class="cardf"><input id="cNum" inputmode="numeric" maxlength="19" placeholder="Nomor kartu" autocomplete="cc-number"><div class="row2"><input id="cExp" placeholder="MM/YY" maxlength="5" autocomplete="cc-exp"><input id="cCvv" type="password" placeholder="CVV" maxlength="4" inputmode="numeric" autocomplete="cc-csc"></div><p class="sm">Data kartu tidak disimpan di server.</p></div>`;
  }
  const luhn = n => { let s = 0; [...n].reverse().forEach((d, i) => { d = +d; if (i % 2) { d *= 2; if (d > 9) d -= 9; } s += d; }); return n.length >= 13 && s % 10 === 0; };
  const cardOk = () => {
    const n = $('#cNum').value.replace(/\D/g, ''), [mm, yy] = $('#cExp').value.split('/').map(Number);
    return luhn(n) && mm >= 1 && mm <= 12 && new Date(2000 + yy, mm) > new Date() && /^\d{3,4}$/.test($('#cCvv').value);
  };

  /* ---------- State ---------- */
  const state = {
    user: null,
    orders: [],
    staff: [],
    chartDays: 14,
    F: { q: '', status: '', from: '', to: '' }
  };

  /* ---------- Helper shell (fungsi, bukan top-level) ---------- */
  const TITLES = {
    home: 'Ringkasan', pesanan: 'Pesanan Saya', bayar: 'Pembayaran',
    struk: 'Struk Pesanan', tugas: 'Tugas Lapangan', semua: 'Kelola Pesanan', profil: 'Profil'
  };

  function navFor(role) {
    return ({
      customer: [['#/', 'Ringkasan'], ['#/pesanan', 'Pesanan Saya'], ['#/profil', 'Profil']],
      staff:    [['#/', 'Ringkasan'], ['#/tugas', 'Tugas Lapangan'], ['#/profil', 'Profil']],
      admin:    [['#/', 'Ringkasan'], ['#/semua', 'Kelola Pesanan'], ['#/profil', 'Profil']]
    })[role] || [];
  }
  function accessFor(role) {
    return ({
      customer: ['home','pesanan','bayar','struk','profil'],
      staff:    ['home','tugas','profil'],
      admin:    ['home','semua','struk','profil']
    })[role] || ['home'];
  }
  function setupNav() {
    $('#nav').innerHTML = navFor(state.user.role)
      .map(([h, l]) => `<a href="${h}">${l}</a>`).join('');
  }
  function paintShell() {
    $('#hello').textContent = `Halo, ${state.user.name}`;
    $('#me').innerHTML = `<div><b>${esc(state.user.name)}</b><small>${esc(state.user.email)}</small></div>
      <button class="btn btn-outline" data-logout style="padding:8px">Keluar</button>`;
  }

  /* ---------- Boot ---------- */
  (async () => {
    try { state.user = await api.me(); } catch {}
    if (!state.user) { location.replace('index.html'); return; }

    paintShell();
    setupNav();

    if (state.user.role === 'admin') {
      try {
        state.staff = (await api.get('/api/users?role=staff'))
          .map(u => ({ id: u.id, name: u.name, email: u.email }));
      } catch {}
    }

    await render();
    window.addEventListener('hashchange', render);
  })();

  async function refreshOrders() {
    try { state.orders = await api.get('/api/orders'); }
    catch (e) { if (e.status === 401) location.replace('index.html'); }
  }

  /* ---------- Komponen ---------- */
  const PAY_CLASS = { Lunas: 'ok', COD: 'info', Dikembalikan: 'info', Dibatalkan: 'off' };
  const payBadge = o => `<span class="badge ${PAY_CLASS[o.payStatus] || 'warn'}">${esc(o.payStatus || 'Belum Dibayar')}</span>`;
  const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
  const isCancelled = o => o.status === CANCELLED;

  const tracker = o => {
    if (isCancelled(o)) return `<p class="sm cancelled">Pesanan dibatalkan${o.cancelledAt ? ' pada ' + esc(fmtDT(o.cancelledAt)) : ''}.</p>`;
    const i = STATUS.indexOf(o.status);
    return `<ol class="track">${STATUS.map((s, k) =>
      `<li class="${k < i ? 'done' : k === i ? 'now' : ''}"><i></i><span>${s}</span></li>`).join('')}</ol>`;
  };

  const orderCard = (o, actions = '') => `
    <article class="d-card order">
      <div class="row">
        <div><b>${esc(o.code)}</b> <small>${esc(o.serviceName)} · ${esc(o.weight)} kg · ${esc(o.mode)}${state.user.role !== 'customer' ? ' · ' + esc(o.owner) : ''}</small></div>
        <div>${payBadge(o)} <b>${rupiah(o.grand || o.total)}</b></div>
      </div>
      ${tracker(o)}
      <div class="sm"><span>${esc(o.date)} (${esc(o.slot)})</span><span>Kurir: ${esc(o.assignedStaff || NONE)}</span></div>
      ${state.user.role !== 'customer' ? `
        <div class="sm"><span>Alamat: ${esc(o.alamat)}</span><span>Telp: ${esc(o.telp || '-')}</span></div>
        ${o.note ? `<div class="sm"><span>Catatan: ${esc(o.note)}</span></div>` : ''}
      ` : ''}
      ${actions}
    </article>`;

  const empty = msg => `<div class="d-card empty">${msg}</div>`;

  const reviewForm = o => `<div class="review" data-review-box="${esc(o.code)}">
      <b>Beri ulasan untuk pesanan ini</b>
      <div class="rate" role="radiogroup" aria-label="Penilaian bintang">
        ${[5,4,3,2,1].map(n => `
          <input type="radio" name="rate-${esc(o.code)}" id="rt-${esc(o.code)}-${n}" value="${n}">
          <label for="rt-${esc(o.code)}-${n}" title="${n} bintang"><span class="sr">${n} bintang</span>★</label>
        `).join('')}
      </div>
      <textarea rows="2" maxlength="300" placeholder="Ceritakan pengalaman Anda (opsional)" aria-label="Ulasan"></textarea>
      <div class="acts"><button type="button" class="btn btn-light" data-review="${esc(o.code)}">Kirim ulasan</button></div>
    </div>`;

  const reviewShown = (o, admin) => `<div class="review">
      <b>${admin ? 'Ulasan pelanggan' : 'Ulasan Anda'}</b>
      <span class="stars" aria-label="${o.review.rating} dari 5 bintang">${stars(o.review.rating)}</span>
      ${o.review.text ? `<p>${esc(o.review.text)}</p>` : ''}
      ${admin ? `<div class="acts">
        <span class="sm">${o.review.hidden ? 'Disembunyikan dari beranda' : 'Tampil di beranda'}</span>
        <button class="btn btn-outline" data-hide-review="${esc(o.code)}">${o.review.hidden ? 'Tampilkan' : 'Sembunyikan'}</button>
      </div>` : ''}
    </div>`;

  /* ---------- Views ---------- */
  const views = {};

  function revenueChart(days) {
    const keys = Array.from({length: days}, (_, i) => localISO(new Date(Date.now() - (days - 1 - i) * 864e5)));
    const sums = Object.fromEntries(keys.map(k => [k, 0]));
    state.orders.forEach(o => {
      if (o.payStatus === 'Lunas' && o.paidAt) {
        const k = localISO(new Date(o.paidAt));
        if (k in sums) sums[k] += (o.grand || o.total);
      }
    });
    const vals = keys.map(k => sums[k]);
    const max = Math.max(1, ...vals), total = vals.reduce((a, b) => a + b, 0);
    const W = 640, H = 230, L = 8, R = 8, T = 28, B = 30, bw = (W - L - R) / days;
    const bars = vals.map((v, i) => {
      const h = Math.round((H - T - B) * v / max), x = L + i * bw + bw * .15, y = H - B - h, [, m, d] = keys[i].split('-');
      const label = (days <= 14 || i % 5 === 0)
        ? `<text x="${(x + bw * .35).toFixed(1)}" y="${H - 10}" text-anchor="middle">${d}/${m}</text>` : '';
      return `<g><rect x="${x.toFixed(1)}" y="${y}" width="${(bw * .7).toFixed(1)}" height="${v ? Math.max(h, 2) : 0}" rx="3"><title>${d}/${m}: ${rupiah(v)}</title></rect>${label}</g>`;
    }).join('');
    return { total, svg: `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafik pendapatan harian, ${days} hari terakhir"><text x="${L}" y="14" class="ax">${rupiah(max)}</text><line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>${bars}</svg>` };
  }

  const chartCard = () => {
    const c = revenueChart(state.chartDays);
    return `<section class="d-card chart-card">
      <div class="chart-head">
        <div><h3>Pendapatan harian</h3><small>Pesanan lunas · total ${rupiah(c.total)}</small></div>
        <select data-chartdays aria-label="Rentang grafik">
          ${[7, 14, 30].map(n => `<option value="${n}" ${n === state.chartDays ? 'selected' : ''}>${n} hari terakhir</option>`).join('')}
        </select>
      </div>${c.svg}</section>`;
  };

  views.home = () => {
    const role = state.user.role;
    const list = state.orders;
    const paid = list.filter(o => o.payStatus === 'Lunas');
    const cards = [
      ['', 'Total pesanan', list.filter(o => !isCancelled(o)).length],
      ['', 'Sedang diproses', list.filter(o => o.status !== 'Selesai' && !isCancelled(o)).length],
      ['', 'Menunggu pembayaran', list.filter(o => o.payStatus === 'Belum Dibayar').length],
      ['', role === 'customer' ? 'Total belanja' : 'Pendapatan', rupiah(paid.reduce((a, o) => a + (o.grand || o.total), 0))]
    ];
    const dist = [...STATUS, CANCELLED].map(s => [s, list.filter(o => o.status === s).length]);
    const max = Math.max(1, ...dist.map(d => d[1]));
    return `<div class="stats">
        ${cards.map(([i, l, v]) => `<div class="d-card stat"><span class="ico-b">${i}</span><small>${l}</small><b>${v}</b></div>`).join('')}
      </div>
      <div class="grid2">
        <section class="d-card"><h3>Status pesanan</h3>
          ${dist.map(([s, n]) => `<div class="bar"><span>${esc(s)}</span><div><i style="width:${n / max * 100}%"></i></div><b>${n}</b></div>`).join('')}
        </section>
        <section class="d-card"><h3>Terbaru</h3>
          ${list.slice(0, 4).map(o => `<div class="mini"><span><b>${esc(o.code)}</b> ${esc(o.serviceName)}</span>${payBadge(o)}</div>`).join('') || '<p class="empty">Belum ada pesanan.</p>'}
        </section>
      </div>${role === 'admin' ? chartCard() : ''}`;
  };

  const custActions = o => {
    if (isCancelled(o)) return '';
    const a = [];
    if (o.payStatus === 'Belum Dibayar') a.push(`<a class="btn btn-light" href="#/bayar/${esc(o.code)}">Bayar sekarang</a>`);
    else if (o.payStatus === 'Lunas') a.push(`<a class="btn btn-outline" href="#/bayar/${esc(o.code)}">Lihat bukti bayar</a>`);
    a.push(`<a class="btn btn-outline" href="#/struk/${esc(o.code)}">Struk</a>`);
    if (o.status === STATUS[0]) a.push(`<button type="button" class="btn btn-outline" data-cancel="${esc(o.code)}">Batalkan pesanan</button>`);
    return `<div class="acts">${a.join('')}</div>` +
      (o.status === 'Selesai' ? (o.review ? reviewShown(o, false) : reviewForm(o)) : '');
  };

  views.pesanan = () => {
    const list = state.orders;
    if (!list.length) return empty('Belum ada pesanan. <a href="index.html#layanan" style="text-decoration:underline">Pesan laundry pertama Anda</a>');
    return `<div class="list">${list.map(o => orderCard(o, custActions(o))).join('')}</div>`;
  };

  views.bayar = (code) => {
    const o = state.orders.find(x => x.code === code);
    if (!o) return empty('Pesanan tidak ditemukan.');
    if (isCancelled(o)) return empty('Pesanan ini sudah dibatalkan.');
    if (o.payStatus === 'COD') return empty('Pesanan ini dibayar di tempat (COD). Siapkan uang pas saat kurir tiba.');
    if (o.payStatus === 'Lunas') {
      const rows = [
        ['Pesanan', o.code],
        ['Metode', o.payment || '-'],
        ['Biaya layanan', rupiah(o.fee || 0)],
        ['Total dibayar', rupiah(o.grand || o.total)]
      ];
      return `<div class="d-card receipt"><div class="okc">✓</div><h3>Pembayaran berhasil</h3>
        <p class="sm" style="justify-content:center">Ref ${esc(o.payRef || '-')}</p>
        ${rows.map(([k, v]) => `<div class="sumrow"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}
        <div class="acts" style="justify-content:center">
          <a class="btn btn-light" href="#/pesanan">Lacak pesanan</a>
          <a class="btn btn-outline" href="#/struk/${esc(o.code)}">Cetak struk</a>
        </div></div>`;
    }
    return {
      html: `<div class="pay">
        <section class="d-card"><h3>Pilih metode pembayaran</h3>
          ${METHODS.map(([g, items]) => `<div class="mgroup"><h4>${g}</h4>
            <div class="mbtns">${items.map(([id, l]) => `<button type="button" data-m="${id}">${l}</button>`).join('')}</div>
          </div>`).join('')}
        </section>
        <section class="d-card"><h3>Ringkasan ${esc(o.code)}</h3>
          <div class="sumrow"><span>${esc(o.serviceName)} · ${esc(o.weight)} kg</span><b>${rupiah(o.total)}</b></div>
          <div id="payFee"></div>
          <div class="panel" id="payPanel">Pilih metode untuk melihat instruksi pembayaran.</div>
          <button type="button" class="btn btn-light" id="payBtn" disabled style="width:100%;justify-content:center">Bayar</button>
          <p class="sm">Status "Lunas" hanya ditetapkan oleh server (webhook / admin).</p>
        </section>
      </div>`,
      after: () => bindPay(o)
    };
  };

  function bindPay(o) {
    let sel = null, fee = 0;
    $$('[data-m]').forEach(b => b.onclick = () => {
      sel = b.dataset.m;
      fee = feeOf(sel, o.total);
      $$('[data-m]').forEach(x => x.classList.toggle('on', x === b));
      $('#payPanel').innerHTML = instructions(sel, o);
      $('#payFee').innerHTML = `<div class="sumrow"><span>Biaya layanan</span><b>${rupiah(fee)}</b></div>
        <div class="sumrow tot"><span>Total</span><span>${rupiah(o.total + fee)}</span></div>`;
      $('#payBtn').disabled = false;
      $('#payBtn').textContent = 'Bayar ' + rupiah(o.total + fee);
    });
    $('#payBtn').onclick = async () => {
      if (sel === 'card' && !cardOk()) return toast('Data kartu tidak valid.');
      const btn = $('#payBtn'); btn.disabled = true; btn.textContent = 'Memproses…';
      try {
        const r = await api.post(`/api/orders/${encodeURIComponent(o.code)}/pay`, { method: sel });
        if (r.alreadyPaid) { toast('Pesanan sudah lunas.'); await refreshOrders(); render(); return; }
        if (r.simulated) {
          toast('Mode simulasi: pesanan ditandai Lunas di server.');
          await refreshOrders(); render();
          return;
        }
        if (r.token && window.snap) {
          window.snap.pay(r.token, {
            onSuccess: async () => { toast('Pembayaran berhasil.'); await refreshOrders(); render(); },
            onPending: async () => { toast('Menunggu pembayaran.'); await refreshOrders(); render(); },
            onError:   async () => { toast('Pembayaran gagal.'); await refreshOrders(); render(); },
            onClose:   async () => { toast('Jendela pembayaran ditutup.'); await refreshOrders(); render(); }
          });
        } else if (r.redirect_url) {
          location.href = r.redirect_url;
        } else {
          toast('Gagal memulai pembayaran.');
        }
      } catch (err) {
        toast(err.message || 'Gagal memproses pembayaran.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Bayar ' + rupiah(o.total + fee);
      }
    };
  }

  views.struk = (code) => {
    const o = state.orders.find(x => x.code === code);
    if (!o) return empty('Pesanan tidak ditemukan.');
    const rows = [
      [`${esc(o.serviceName)} · ${esc(o.weight)} kg`, rupiah(o.subtotal)],
      ['Ongkos antar-jemput', o.ship ? rupiah(o.ship) : 'Gratis']
    ];
    if (o.discount) rows.push([`Diskon promo${o.promo ? ' (' + esc(o.promo) + ')' : ''}`, '- ' + rupiah(o.discount)]);
    if (o.fee) rows.push(['Biaya layanan pembayaran', rupiah(o.fee)]);
    const payInfo = o.payStatus === 'Lunas'
      ? `Lunas · ${esc(o.payment || '-')} · ${esc(fmtDT(o.paidAt))}${o.payRef ? ' · Ref ' + esc(o.payRef) : ''}`
      : esc(o.payStatus || 'Belum Dibayar');
    return `<div class="d-card invoice" id="invoice" data-code="${esc(o.code)}">
        <div class="inv-head">
          <div><b class="inv-brand">CleanLoop</b><small>Laundry Pickup &amp; Delivery</small></div>
          <div class="inv-meta">
            <b>STRUK PESANAN</b>
            <small>No. ${esc(o.code)}</small>
            <small>${o.createdAt ? 'Dipesan ' + esc(fmtDT(o.createdAt)) : ''}</small>
          </div>
        </div>
        <div class="inv-cols">
          <div><small>Pelanggan</small><b>${esc(o.owner)}</b><span>${esc(o.telp || o.ownerTelp || '-')}</span><span>${esc(o.alamat)}</span></div>
          <div><small>${esc(o.mode)}</small><b>${esc(o.date)} (${esc(o.slot)})</b><small>Status pesanan</small><b>${esc(o.status)}</b></div>
        </div>
        <table class="inv-table"><thead><tr><th>Keterangan</th><th class="r">Jumlah</th></tr></thead>
          <tbody>${rows.map(([k, v]) => `<tr><td>${k}</td><td class="r">${v}</td></tr>`).join('')}</tbody>
          <tfoot><tr><th>Total</th><th class="r">${rupiah(o.grand || o.total)}</th></tr></tfoot>
        </table>
        <p class="inv-pay">Pembayaran: ${payInfo}</p>
        <p class="inv-foot">Terima kasih telah memakai CleanLoop. Simpan struk ini sebagai bukti pesanan.</p>
      </div>
      <div class="acts noprint" style="justify-content:center">
        <button type="button" class="btn btn-light" data-print>Cetak / Simpan PDF</button>
        <a class="btn btn-outline" href="${state.user.role === 'admin' ? '#/semua' : '#/pesanan'}">Kembali</a>
      </div>`;
  };

  function printInvoice() {
    const prev = document.title, code = $('#invoice')?.dataset.code || '';
    document.title = 'Struk ' + code;
    const restore = () => { document.title = prev; window.removeEventListener('afterprint', restore); };
    window.addEventListener('afterprint', restore);
    window.print();
  }

  views.tugas = () => {
    const list = state.orders.filter(o => o.status !== 'Selesai' && !isCancelled(o));
    if (!list.length) return empty('Tidak ada tugas aktif.');
    return `<div class="list">${list.map(o => {
      const mine = o.assignedStaffEmail === state.user.email;
      const btn = mine
        ? `<button class="btn btn-light" data-next="${esc(o.code)}">Lanjut: ${STATUS[STATUS.indexOf(o.status) + 1] || '-'}</button>`
        : (!o.assignedStaffEmail ? `<button class="btn btn-outline" data-take="${esc(o.code)}">Ambil tugas</button>` : '');
      return orderCard(o, `<div class="acts">${btn}</div>`);
    }).join('')}</div>`;
  };

  /* ---------- Admin ---------- */
  const dateOf = o => String(o.date || '').slice(0, 10);
  function filtered() {
    const F = state.F, q = F.q.trim().toLowerCase();
    return state.orders.filter(o => {
      if (F.status && o.status !== F.status) return false;
      const d = dateOf(o);
      if (F.from && d < F.from) return false;
      if (F.to && d > F.to) return false;
      return !q || [o.code, o.owner, o.email, o.telp, o.alamat, o.serviceName, o.assignedStaff]
        .some(v => String(v || '').toLowerCase().includes(q));
    }).sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
  }

  function adminActions(o) {
    const staff = state.staff;
    const label = s => staff.filter(x => x.name === s.name).length > 1 ? `${s.name} (${s.email})` : s.name;
    const review = o.review ? reviewShown(o, true) : '';
    if (isCancelled(o)) {
      return `<div class="acts">${o.payStatus === 'Menunggu Refund'
        ? `<button class="btn btn-outline" data-refund="${esc(o.code)}">Tandai refund selesai</button>` : ''}</div>`;
    }
    return `<div class="acts">
      <select data-status="${esc(o.code)}" aria-label="Status pesanan">
        ${STATUS.map(s => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      <select data-staff="${esc(o.code)}" aria-label="Kurir">
        <option value="">Pilih kurir</option>
        ${staff.map(s => `<option value="${s.id}" ${s.id === o.assignedStaffId ? 'selected' : ''}>${esc(label(s))}</option>`).join('')}
      </select>
      ${(o.payStatus === 'Belum Dibayar' || o.payStatus === 'COD') ? `<button class="btn btn-outline" data-paid="${esc(o.code)}">Tandai lunas</button>` : ''}
      <a class="btn btn-outline" href="#/struk/${esc(o.code)}">Struk</a>
    </div>${review}`;
  }

  const adminList = () => {
    const list = filtered();
    return list.length
      ? list.map(o => orderCard(o, adminActions(o))).join('')
      : empty('Tidak ada pesanan yang cocok dengan filter.');
  };

  function exportCsv() {
    const head = ['Kode','Pelanggan','Email','Telepon','Alamat','Layanan','Berat (kg)','Tipe','Jadwal','Slot','Status','Kurir','Subtotal','Ongkir','Diskon','Kode promo','Biaya layanan','Total dibayar','Status bayar','Metode','Ref bayar','Dibayar pada','Rating','Ulasan'];
    const cell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = filtered().map(o => [
      o.code, o.owner, o.email, o.telp, o.alamat, o.serviceName, o.weight, o.mode, o.date, o.slot,
      o.status, o.assignedStaff, o.subtotal, o.ship, o.discount, o.promo,
      o.fee || 0, o.grand || o.total, o.payStatus, o.payment, o.payRef, o.paidAt,
      o.review?.rating, o.review?.text
    ].map(cell).join(';'));
    const blob = new Blob(['\ufeff' + [head.map(cell).join(';'), ...lines].join('\r\n')], {type: 'text/csv;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `cleanloop-pesanan-${localISO(new Date())}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`${lines.length} pesanan diekspor`);
  }

  views.semua = () => {
    if (!state.orders.length) return empty('Belum ada pesanan masuk.');
    const F = state.F;
    return {
      html: `<div class="d-card filters noprint">
          <div class="fgrid">
            <label class="dfld"><span>Cari</span><input type="search" id="fQ" placeholder="Kode, nama, telepon, alamat" value="${esc(F.q)}"></label>
            <label class="dfld"><span>Status</span><select id="fStatus">
              <option value="">Semua status</option>
              ${[...STATUS, CANCELLED].map(s => `<option ${s === F.status ? 'selected' : ''}>${esc(s)}</option>`).join('')}
            </select></label>
            <label class="dfld"><span>Jadwal dari</span><input type="date" id="fFrom" value="${esc(F.from)}"></label>
            <label class="dfld"><span>Sampai</span><input type="date" id="fTo" value="${esc(F.to)}"></label>
          </div>
          <div class="acts">
            <span class="sm" id="fCount"></span>
            <button type="button" class="btn btn-outline" data-reset-filter>Reset</button>
            <button type="button" class="btn btn-light" data-export>Ekspor CSV</button>
          </div>
        </div>
        <div class="list" id="adminList" style="margin-top:14px"></div>`,
      after: () => {
        const upd = () => {
          $('#adminList').innerHTML = adminList();
          $('#fCount').textContent = `${filtered().length} dari ${state.orders.length} pesanan`;
        };
        $('#fQ').addEventListener('input', e => { F.q = e.target.value; upd(); });
        [['#fStatus','status'],['#fFrom','from'],['#fTo','to']].forEach(([sel, k]) => {
          $(sel).addEventListener('change', e => { F[k] = e.target.value; upd(); });
        });
        upd();
      }
    };
  };

  views.profil = async () => {
    const me = await api.me();
    const addrs = await api.get('/api/addresses').catch(() => []);
    const roleName = {customer: 'Pelanggan', staff: 'Karyawan', admin: 'Admin'}[state.user.role];
    return `<div class="d-card receipt" style="margin-bottom:14px">
        <div class="okc">${esc([...me.name][0].toUpperCase())}</div>
        <h3>${esc(me.name)}</h3>
        <p class="sm" style="justify-content:center">${esc(me.email)}</p>
        <p><span class="badge info">${roleName}</span></p>
        <div class="acts" style="justify-content:center">
          <button class="btn btn-outline" data-logout style="color:#ff6b6b;border-color:#ff6b6b">Keluar</button>
        </div>
      </div>
      <div class="grid2" style="grid-template-columns:1fr 1fr">
        <section class="d-card"><h3>Ubah profil</h3>
          <form class="dform" data-form="profile" novalidate>
            <label class="dfld"><span>Nama</span><input name="name" maxlength="60" value="${esc(me.name)}" autocomplete="name"></label>
            <label class="dfld"><span>Email (tidak dapat diubah)</span><input value="${esc(me.email)}" disabled></label>
            <label class="dfld"><span>Nomor WhatsApp</span><input name="telp" type="tel" maxlength="16" inputmode="tel" placeholder="08xxxxxxxxxx" value="${esc(me.phone || '')}" autocomplete="tel"></label>
            <button type="submit" class="btn btn-light">Simpan perubahan</button>
          </form>
        </section>
        <section class="d-card"><h3>Ganti kata sandi</h3>
          <form class="dform" data-form="password" novalidate>
            <label class="dfld"><span>Kata sandi saat ini</span><input name="cur" type="password" autocomplete="current-password"></label>
            <label class="dfld"><span>Kata sandi baru (min. 8 karakter)</span><input name="new" type="password" autocomplete="new-password"></label>
            <label class="dfld"><span>Ulangi kata sandi baru</span><input name="conf" type="password" autocomplete="new-password"></label>
            <button type="submit" class="btn btn-light">Ganti kata sandi</button>
          </form>
        </section>
      </div>
      ${state.user.role === 'customer' ? `<section class="d-card" style="margin-top:14px"><h3>Alamat tersimpan</h3>
        ${addrs.length ? addrs.map(a => `<div class="addr">
          <div><b>${esc(a.label)}</b>${a.defaultAddr ? ' <span class="badge info">Utama</span>' : ''}<small>${esc(a.text)}</small></div>
          <div class="acts" style="margin:0">
            ${a.defaultAddr ? '' : `<button type="button" class="btn btn-outline" data-addr-def="${esc(a.id)}">Jadikan utama</button>`}
            <button type="button" class="btn btn-outline" data-addr-del="${esc(a.id)}">Hapus</button>
          </div>
        </div>`).join('') : '<p class="sm" style="margin:0 0 12px">Belum ada alamat. Alamat yang disimpan bisa dipilih saat memesan.</p>'}
        ${addrs.length < 5 ? `<form class="dform" data-form="address" novalidate style="margin-top:14px">
          <label class="dfld"><span>Label (mis. Rumah, Kantor)</span><input name="label" maxlength="30"></label>
          <label class="dfld"><span>Alamat lengkap</span><input name="text" maxlength="200" autocomplete="street-address"></label>
          <button type="submit" class="btn btn-outline">Tambah alamat</button>
        </form>` : '<p class="sm">Maksimal 5 alamat tersimpan.</p>'}
      </section>` : ''}`;
  };

  /* ---------- Render ---------- */
  async function render() {
    if (!state.user) return;
    await refreshOrders();
    const [name, arg] = (location.hash.slice(2) || 'home').split('/');
    const ACCESS = accessFor(state.user.role);
    const key = ACCESS.includes(name) ? name : 'home';

    let res;
    try { res = await views[key](arg); }
    catch (e) {
      if (e.status === 401) { location.replace('index.html'); return; }
      res = empty('Gagal memuat data: ' + esc(e.message));
    }

    $('#pageTitle').textContent = TITLES[key] || 'Dashboard';
    $('#view').innerHTML = res.html ?? res;

    const parent = (key === 'bayar' || key === 'struk')
      ? (state.user.role === 'admin' ? '#/semua' : '#/pesanan')
      : '#/' + (key === 'home' ? '' : key);
    $$('#nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === parent));

    res.after?.();
  }

  /* ---------- Aksi klik ---------- */
  document.addEventListener('click', async e => {
    const q = sel => e.target.closest(sel);
    let t;

    if (q('[data-logout]')) {
      try { await api.post('/api/auth/logout'); } catch {}
      location.href = 'index.html';
      return;
    }
    if (q('[data-print]')) return printInvoice();
    if (q('[data-export]')) { if (state.user.role === 'admin') exportCsv(); return; }
    if (q('[data-reset-filter]')) {
      Object.assign(state.F, { q: '', status: '', from: '', to: '' });
      return render();
    }

    if ((t = q('[data-cancel]')) && state.user.role === 'customer') {
      const o = state.orders.find(x => x.code === t.dataset.cancel);
      if (!o) return;
      if (o.status !== STATUS[0]) { toast('Pesanan sudah diproses.'); return render(); }
      if (!confirm(`Batalkan pesanan ${o.code}? Tindakan ini tidak bisa dibatalkan.`)) return;
      try { await api.post(`/api/orders/${encodeURIComponent(o.code)}/cancel`); toast('Pesanan dibatalkan'); }
      catch (err) { toast(err.message); }
      return render();
    }

    if ((t = q('[data-review]')) && state.user.role === 'customer') {
      const code = t.dataset.review;
      const o = state.orders.find(x => x.code === code);
      if (!o || o.status !== 'Selesai' || o.review) return;
      const box = t.closest('.review');
      const rating = +(box.querySelector('input:checked')?.value || 0);
      if (!(rating >= 1 && rating <= 5)) return toast('Pilih jumlah bintang dulu.');
      const text = box.querySelector('textarea').value.trim().slice(0, 300);
      try {
        await api.post(`/api/orders/${encodeURIComponent(code)}/review`, { rating, text });
        toast('Terima kasih atas ulasan Anda');
      } catch (err) { toast(err.message); }
      return render();
    }

    if ((t = q('[data-addr-del],[data-addr-def]')) && state.user.role === 'customer') {
      try {
        if (t.dataset.addrDel) await api.del(`/api/addresses/${encodeURIComponent(t.dataset.addrDel)}`);
        else await api.post(`/api/addresses/${encodeURIComponent(t.dataset.addrDef)}/default`);
        toast('Alamat diperbarui');
      } catch (err) { toast(err.message); }
      return render();
    }

    t = q('[data-next],[data-take],[data-paid],[data-refund],[data-hide-review]');
    if (!t || state.user.role === 'customer') return;
    const code = t.dataset.next || t.dataset.take || t.dataset.paid || t.dataset.refund || t.dataset.hideReview;
    const o = state.orders.find(x => x.code === code);
    if (!o) return;
    try {
      if (t.dataset.next)         await api.post(`/api/orders/${encodeURIComponent(code)}/advance`);
      else if (t.dataset.take)    await api.post(`/api/orders/${encodeURIComponent(code)}/take`);
      else if (t.dataset.paid)    await api.patch(`/api/orders/${encodeURIComponent(code)}`, { markPaid: true });
      else if (t.dataset.refund)  await api.patch(`/api/orders/${encodeURIComponent(code)}`, { refund: true });
      else if (t.dataset.hideReview)
        await api.post(`/api/orders/${encodeURIComponent(code)}/review-hide`, { hidden: !o.review.hidden });
      toast('Pesanan diperbarui');
    } catch (err) { toast(err.message); }
    return render();
  });

  /* ---------- Aksi change ---------- */
  document.addEventListener('change', async e => {
    const c = e.target.closest('[data-chartdays]');
    if (c) { state.chartDays = +c.value || 14; return render(); }
    const s = e.target.closest('[data-status],[data-staff]');
    if (!s || state.user.role !== 'admin') return;
    const code = s.dataset.status ?? s.dataset.staff;
    try {
      if ('status' in s.dataset) {
        await api.patch(`/api/orders/${encodeURIComponent(code)}`, { status: s.value });
      } else {
        const v = s.value ? Number(s.value) : null;
        await api.patch(`/api/orders/${encodeURIComponent(code)}`, { staffId: v });
      }
      toast('Pesanan diperbarui');
    } catch (err) { toast(err.message); }
    return render();
  });

  /* ---------- Formulir ---------- */
  document.addEventListener('submit', async e => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const kind = form.dataset.form, v = n => form.elements[n].value;
    try {
      if (kind === 'profile') {
        const name = v('name').trim(), raw = v('telp').trim();
        const phone = raw ? normPhone(raw) : '';
        if (name.length < 2) return toast('Nama minimal 2 karakter.');
        if (phone && !phoneOk(phone)) return toast('Nomor WhatsApp tidak valid.');
        await api.patch('/api/me', { name, phone });
        state.user.name = name; paintShell();
        toast('Profil diperbarui');
        return render();
      }
      if (kind === 'password') {
        const cur = v('cur'), np = v('new');
        if (!cur) return toast('Isi kata sandi saat ini.');
        if (np.length < 8) return toast('Kata sandi baru minimal 8 karakter.');
        if (np !== v('conf')) return toast('Konfirmasi tidak sama.');
        await api.post('/api/me/password', { current: cur, next: np });
        form.reset(); toast('Kata sandi berhasil diganti');
        return;
      }
      if (kind === 'address') {
        const label = v('label').trim() || 'Alamat', text = v('text').trim();
        if (text.length < 10) return toast('Alamat minimal 10 karakter.');
        await api.post('/api/addresses', { label, text });
        toast('Alamat disimpan');
        return render();
      }
    } catch (err) { toast(err.message || 'Gagal menyimpan.'); }
  });
})();