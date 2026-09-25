'use strict';

/* ============ 設定 ============ */
const CATS = {
  sight:     { label: '景點', icon: '📍' },
  food:      { label: '餐廳', icon: '🍜' },
  transport: { label: '交通', icon: '🚆' },
  stay:      { label: '住宿', icon: '🏨' },
  shop:      { label: '購物', icon: '🛍️' },
  other:     { label: '其他', icon: '✨' },
};
const EMOJIS = ['✈️', '🏝️', '🏔️', '🗼', '🏯', '🌸', '🍜', '🚗', '🏕️', '🎡', '🌊', '🗺️'];
const COLORS = ['#ff6b4a', '#f59e0b', '#10b981', '#0ea5e9', '#6366f1', '#ec4899'];
const MOODS = ['😆', '😊', '😌', '😴', '🥲'];
const PACK_DEFAULTS = ['護照', '手機充電器', '行動電源', '轉接頭', '換洗衣物', '盥洗用品', '常備藥品', '雨傘', '現金 / 信用卡', '網卡 / eSIM'];
const TABS = [['plan', '行程'], ['journal', '日記'], ['pack', '清單'], ['budget', '花費']];
const WEEK = '日一二三四五六';

/* ============ 小工具 ============ */
const $ = (s, el = document) => el.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeURL = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
const mapURL = (q) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);

const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayISO = () => iso(new Date());
const diffDays = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
const fmtDay = (s) => { const d = parseDate(s); return `${d.getMonth() + 1}/${d.getDate()} (${WEEK[d.getDay()]})`; };
const fmtNum = (n) => Number(n || 0).toLocaleString('zh-TW', { maximumFractionDigits: 2 });

function tripDays(t) {
  if (!t.start) return [];
  const end = t.end && t.end >= t.start ? t.end : t.start;
  const out = [];
  for (let d = parseDate(t.start); iso(d) <= end && out.length < 90; d.setDate(d.getDate() + 1)) out.push(iso(d));
  return out;
}
function fmtRange(t) {
  if (!t.start) return '日期未定';
  const n = tripDays(t).length;
  const s = parseDate(t.start);
  const head = `${s.getFullYear()}/${s.getMonth() + 1}/${s.getDate()}`;
  if (n <= 1) return head;
  const e = parseDate(t.end);
  return `${head} – ${e.getMonth() + 1}/${e.getDate()}・${n} 天`;
}
function tripStatus(t) {
  const today = todayISO();
  if (!t.start) return { label: '還在計畫中', kind: 'idea' };
  const end = t.end || t.start;
  if (today < t.start) {
    const n = diffDays(today, t.start);
    return { label: n === 1 ? '明天出發！' : `還有 ${n} 天`, kind: 'upcoming' };
  }
  if (today <= end) return { label: `旅行中・第 ${diffDays(t.start, today) + 1} 天`, kind: 'now' };
  return { label: '已結束', kind: 'past' };
}
const byTime = (a, b) => (a.time || '99:99').localeCompare(b.time || '99:99');

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ============ 資料：本機優先 + Supabase 雲端同步 ============
 * 所有修改先存進手機（IndexedDB），再在背景上傳到 Supabase。
 * 沒網路時也能新增、修改，連上網路後會自動把「待上傳」的變更送出。
 * 雲端：資料表 cuti_trips（每趟旅程一列）、照片空間 trip-photos/{user id}/{photo id}.jpg */
const CFG = window.CUTI_CONFIG || {};
const configured = Boolean(CFG.SUPABASE_URL && CFG.SUPABASE_KEY);
const sb = configured
  ? supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
      // 和 FooooooD 在同一個網域，登入狀態用不同名稱存，兩個 App 才不會互相登出
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'cuticuti-auth' },
    })
  : null;
const BUCKET = 'trip-photos';

const store = {
  get(k) { try { return localStorage.getItem('cuticuti-' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('cuticuti-' + k, v); } catch { /* 無痕模式等 */ } },
};

// 本機快取
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('cuticuti', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('trips', { keyPath: 'id' });
        r.result.createObjectStore('photos', { keyPath: 'id' });
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  run(names, mode, fn) {
    return new Promise((res, rej) => {
      const tx = this.db.transaction(names, mode);
      const req = fn(tx);
      tx.oncomplete = () => res(req && req.result);
      tx.onerror = () => rej(tx.error);
    });
  },
  all: (s) => DB.run(s, 'readonly', (tx) => tx.objectStore(s).getAll()),
  keys: (s) => DB.run(s, 'readonly', (tx) => tx.objectStore(s).getAllKeys()),
  get: (s, id) => DB.run(s, 'readonly', (tx) => tx.objectStore(s).get(id)),
  put: (s, v) => DB.run(s, 'readwrite', (tx) => tx.objectStore(s).put(v)),
  del: (s, id) => DB.run(s, 'readwrite', (tx) => tx.objectStore(s).delete(id)),
  replaceTrips: (list) => DB.run('trips', 'readwrite', (tx) => {
    const o = tx.objectStore('trips');
    o.clear();
    list.forEach((t) => o.put(t));
  }),
  clear: () => DB.run(['trips', 'photos'], 'readwrite', (tx) => {
    tx.objectStore('trips').clear();
    tx.objectStore('photos').clear();
  }),
};

// 還沒上傳到雲端的變更
const pending = {
  empty: () => ({ trips: [], delTrips: [], photos: [], delPhotos: [] }),
  load() { try { return { ...pending.empty(), ...JSON.parse(store.get('pending')) }; } catch { return pending.empty(); } },
  save(p) { store.set('pending', JSON.stringify(p)); },
  add(kind, id) { const p = pending.load(); if (!p[kind].includes(id)) p[kind].push(id); pending.save(p); },
  drop(kind, ids) { const p = pending.load(); p[kind] = p[kind].filter((x) => !ids.includes(x)); pending.save(p); },
  count() { const p = pending.load(); return p.trips.length + p.delTrips.length + p.photos.length + p.delPhotos.length; },
  clear() { pending.save(pending.empty()); },
};

const cloud = {
  path: (id) => `${user.id}/${id}.jpg`,
  async listTrips() {
    const { data, error } = await sb.from('cuti_trips').select('data');
    if (error) throw error;
    return data.map((r) => r.data);
  },
  async saveTrip(t) {
    const { error } = await sb.from('cuti_trips').upsert({ user_id: user.id, id: t.id, data: t, updated_at: new Date(t.updatedAt || Date.now()).toISOString() });
    if (error) throw error;
  },
  async deleteTrip(id) {
    const { error } = await sb.from('cuti_trips').delete().eq('user_id', user.id).eq('id', id);
    if (error) throw error;
  },
  async uploadPhoto(id, blob) {
    const { error } = await sb.storage.from(BUCKET).upload(cloud.path(id), blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: true });
    if (error) throw error;
  },
  async downloadPhoto(id) {
    const { data, error } = await sb.storage.from(BUCKET).download(cloud.path(id));
    if (error) throw error;
    return data;
  },
  async removePhotos(ids) {
    if (!ids.length) return;
    const { error } = await sb.storage.from(BUCKET).remove(ids.map(cloud.path));
    if (error) throw error;
  },
};

let user = null;
let trips = [];
let current = null; // 目前開啟的旅程
let ui = { tab: 'plan', day: null };
const photoURLs = new Map(); // photoId -> objectURL

function friendly(err) {
  const msg = err?.message || String(err);
  if (!navigator.onLine || /fetch|Load failed|network/i.test(msg)) return '沒有網路';
  return msg;
}
const isEditing = () => $('#sheet').classList.contains('open');

async function saveTrip(t) {
  t.updatedAt = Date.now();
  const i = trips.findIndex((x) => x.id === t.id);
  if (i >= 0) trips[i] = t; else trips.push(t);
  await DB.put('trips', t);
  pending.add('trips', t.id);
  scheduleSync();
}
async function deleteTripData(t) {
  const photoIds = tripPhotoIds(t);
  for (const id of photoIds) { await DB.del('photos', id); forgetPhoto(id); pending.add('delPhotos', id); }
  pending.drop('photos', photoIds);
  await DB.del('trips', t.id);
  pending.drop('trips', [t.id]);
  pending.add('delTrips', t.id);
  trips = trips.filter((x) => x.id !== t.id);
  scheduleSync();
}
function tripPhotoIds(t) {
  return Object.values(t.journal || {}).flatMap((j) => j.photos || []);
}
async function savePhoto(id, tripId, blob) {
  await DB.put('photos', { id, tripId, blob });
  pending.add('photos', id);
  scheduleSync();
}
function forgetPhoto(id) {
  if (photoURLs.has(id)) { URL.revokeObjectURL(photoURLs.get(id)); photoURLs.delete(id); }
}
async function deletePhoto(id) {
  await DB.del('photos', id);
  forgetPhoto(id);
  pending.drop('photos', [id]);
  pending.add('delPhotos', id);
  scheduleSync();
}
async function photoBlob(id) {
  const p = await DB.get('photos', id);
  if (p) return p.blob;
  const blob = await cloud.downloadPhoto(id); // 其他裝置拍的照片，第一次看時下載並存到本機
  await DB.put('photos', { id, blob });
  return blob;
}
async function photoURL(id) {
  if (photoURLs.has(id)) return photoURLs.get(id);
  try {
    const u = URL.createObjectURL(await photoBlob(id));
    photoURLs.set(id, u);
    return u;
  } catch { return null; } // 離線且這支手機還沒下載過這張照片
}

// ---- 同步 ----
let syncing = null;
let syncTimer = null;
let lastSync = 0;
function sync() {
  if (!syncing) syncing = doSync().finally(() => { syncing = null; });
  return syncing;
}
function scheduleSync(delay = 800) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    sync().then((changed) => { if (changed && !isEditing()) route(); }).catch(() => {});
  }, delay);
}
async function doSync() {
  if (!user || user.offline) throw new Error('尚未連線');
  // 1. 先把這支手機上的變更送上去
  const p = pending.load();
  for (const id of p.photos) {
    const ph = await DB.get('photos', id);
    if (ph) await cloud.uploadPhoto(id, ph.blob);
  }
  pending.drop('photos', p.photos);
  await cloud.removePhotos(p.delPhotos);
  pending.drop('delPhotos', p.delPhotos);
  for (const id of p.trips) {
    const t = trips.find((x) => x.id === id) || (await DB.get('trips', id));
    if (t) await cloud.saveTrip(t);
  }
  pending.drop('trips', p.trips);
  for (const id of p.delTrips) await cloud.deleteTrip(id);
  pending.drop('delTrips', p.delTrips);

  // 2. 再抓雲端最新資料（同步途中又有新修改的，保留手機上的版本）
  const remote = await cloud.listTrips();
  const still = pending.load();
  const map = new Map(remote.map((t) => [t.id, t]));
  trips.filter((t) => still.trips.includes(t.id)).forEach((t) => map.set(t.id, t));
  still.delTrips.forEach((id) => map.delete(id));
  const merged = [...map.values()];
  const key = (list) => JSON.stringify([...list].sort((a, b) => a.id.localeCompare(b.id)));
  const changed = key(merged) !== key(trips);
  if (changed) {
    await DB.replaceTrips(merged);
    trips = merged;
  }
  lastSync = Date.now();
  return changed;
}

/* ============ 畫面 ============ */
const app = $('#app');

// Logo：小車的排氣管噴出「cuticuti」字樣的煙，字母一路往上飄、慢慢變淡
const CAR_SVG = `<svg class="logo-car" viewBox="0 0 66 36" aria-hidden="true">
  <path class="car-body" d="M4 26V18q0-4 4-4h6l6-8q1-1 3-1h15q2 0 3 1l6 8h3q4 0 4 4v8z"/>
  <path class="car-win" d="M17.5 14l4.7-6.2H29V14zM31 7.8h6.2l4.8 6.2H31z"/>
  <rect class="car-pipe" x="51" y="23" width="12" height="3.4" rx="1.3"/>
  <circle class="car-wheel" cx="15" cy="27" r="5.6"/><circle class="car-hub" cx="15" cy="27" r="2"/>
  <circle class="car-wheel" cx="43" cy="27" r="5.6"/><circle class="car-hub" cx="43" cy="27" r="2"/>
</svg>`;
function logo() {
  const letters = [...'cuticuti'].map((c, i) => `<b style="--i:${i}">${c}</b>`).join('');
  return `<span class="logo" role="img" aria-label="cuticuti">${CAR_SVG}<span class="puffs" aria-hidden="true"><i></i><i></i><i></i></span><span class="smoke" aria-hidden="true">${letters}</span></span>`;
}

function renderLogin() {
  document.title = 'CutiCuti';
  app.innerHTML = `
    <main class="login">
      <img src="icons/icon-192.png" alt="" class="login-icon">
      <h1 class="login-title">${logo()}</h1>
      <p>記錄與安排你的每一趟旅行</p>
      <button class="google-btn" data-act="login">
        <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        使用 Google 帳號登入
      </button>
      <p class="hint">登入後，行程、日記和照片會存在你的 Google 帳號底下，換手機或用電腦開都看得到。</p>
    </main>`;
}

function renderLoading(msg = '載入中…') {
  app.innerHTML = `<div class="empty"><div class="big">🧳</div>${msg}</div>`;
}

function route() {
  if (!user) return renderLogin();
  const m = location.hash.match(/^#\/trip\/([\w-]+)/);
  current = m ? trips.find((t) => t.id === m[1]) || null : null;
  if (current) renderTrip();
  else renderHome();
}

function renderHome() {
  document.title = 'CutiCuti';
  const sorted = [...trips].sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999'));
  const active = sorted.filter((t) => tripStatus(t).kind !== 'past');
  const past = sorted.filter((t) => tripStatus(t).kind === 'past').reverse();
  const card = (t) => {
    const st = tripStatus(t);
    return `<a class="trip-card" href="#/trip/${t.id}" style="--c:${esc(t.color)}">
      <div class="em">${esc(t.emoji)}</div>
      <div class="info">
        <h3>${esc(t.name)}</h3>
        <p>${t.dest ? esc(t.dest) + '・' : ''}${fmtRange(t)}</p>
        <span class="pill ${st.kind}">${st.label}</span><span class="count">${t.items.length} 個行程</span>
      </div>
    </a>`;
  };
  app.innerHTML = `
    <header class="topbar"><div class="bar">
      <h1 class="brand">${logo()}</h1>
      <button class="icon-btn" data-act="settings" aria-label="設定與備份">⚙️</button>
    </div></header>
    <main class="page">
      ${trips.length ? '' : `<div class="empty"><div class="big">🧳</div><b>還沒有旅程</b>按右下角新增第一趟旅行吧！</div>`}
      ${active.length ? `<h2 class="section">接下來的旅程</h2>${active.map(card).join('')}` : ''}
      ${past.length ? `<h2 class="section">旅行回憶</h2>${past.map(card).join('')}` : ''}
    </main>
    <button class="fab" data-act="new-trip">＋ 新旅程</button>`;
}

function renderTrip() {
  const t = current;
  const ds = tripDays(t);
  if (ui.day === null || (ui.day !== 'none' && !ds.includes(ui.day))) {
    ui.day = ds.includes(todayISO()) ? todayISO() : ds[0] || 'none';
  }
  document.title = `${t.name} - CutiCuti`;
  const views = { plan: planView, journal: journalView, pack: packView, budget: budgetView };
  const fab = { plan: '＋ 新增行程', journal: '' , pack: '', budget: '' }[ui.tab];
  app.innerHTML = `
    <header class="topbar">
      <div class="bar">
        <a class="icon-btn" href="#/" aria-label="返回">‹</a>
        <div class="title"><b>${esc(t.emoji)} ${esc(t.name)}</b><small>${t.dest ? esc(t.dest) + '・' : ''}${fmtRange(t)}</small></div>
        <button class="icon-btn" data-act="edit-trip" aria-label="編輯旅程">✏️</button>
      </div>
      <nav class="tabs">${TABS.map(([k, l]) => `<button class="tab ${ui.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}">${l}</button>`).join('')}</nav>
    </header>
    <main class="page">${views[ui.tab](t)}</main>
    ${fab ? `<button class="fab" data-act="new-item">${fab}</button>` : ''}`;

  const on = $('.chip.on');
  if (on) on.parentElement.scrollLeft = on.offsetLeft - (on.parentElement.clientWidth - on.offsetWidth) / 2;
  hydratePhotos(app);
  const pf = $('#pack-form');
  if (pf) pf.onsubmit = async (e) => {
    e.preventDefault();
    const text = pf.text.value.trim();
    if (!text) return;
    t.packing.push({ id: uid(), text, done: false });
    await saveTrip(t);
    renderTrip();
    $('#pack-form').text.focus();
  };
}

/* ---- 行程 ---- */
function planView(t) {
  const ds = tripDays(t);
  const unsched = t.items.filter((i) => !ds.includes(i.date));
  const today = todayISO();
  const chips = ds.map((d, n) => {
    const cnt = t.items.filter((i) => i.date === d).length;
    return `<button class="chip ${ui.day === d ? 'on' : ''} ${d === today ? 'today' : ''}" data-act="day" data-day="${d}">
      <b>Day ${n + 1}${d === today ? '・今天' : ''}</b><small>${fmtDay(d)}${cnt ? `・${cnt}` : ''}</small></button>`;
  }).join('') + `<button class="chip ${ui.day === 'none' ? 'on' : ''}" data-act="day" data-day="none"><b>💡 口袋名單</b><small>還沒排進哪天・${unsched.length}</small></button>`;

  const list = (ui.day === 'none' ? unsched : t.items.filter((i) => i.date === ui.day)).slice().sort(byTime);
  const row = (i) => {
    const c = CATS[i.cat] || CATS.other;
    const url = safeURL(i.url);
    const meta = [
      i.cost !== '' && i.cost != null ? `💰 ${esc(t.currency)} ${fmtNum(i.cost)}` : '',
      url ? `<a href="${esc(url)}" target="_blank" rel="noopener">🔗 連結</a>` : '',
    ].filter(Boolean).join('');
    return `<li class="item ${i.done ? 'done' : ''}" data-act="edit-item" data-id="${i.id}">
      <div class="time ${i.time ? '' : 'none'}">${i.time || '—'}</div>
      <div class="dot">${c.icon}</div>
      <div class="body">
        <div class="t">${esc(i.title)}</div>
        ${i.place ? `<a class="place" href="${mapURL(i.place)}" target="_blank" rel="noopener">📍 ${esc(i.place)}</a>` : ''}
        ${i.note ? `<p class="note">${esc(i.note)}</p>` : ''}
        ${meta ? `<div class="meta">${meta}</div>` : ''}
      </div>
      <button class="check" data-act="toggle-item" data-id="${i.id}" aria-label="${i.done ? '標記未完成' : '標記完成'}">${i.done ? '✓' : ''}</button>
    </li>`;
  };
  const empty = ui.day === 'none'
    ? `<div class="empty"><div class="big">💡</div><b>口袋名單是空的</b>想去但還沒決定哪天的地方，可以先放這裡</div>`
    : `<div class="empty"><div class="big">🗓️</div><b>這天還沒有安排</b>點「新增行程」開始排吧</div>`;
  return `<div class="chips">${chips}</div>${list.length ? `<ol class="timeline">${list.map(row).join('')}</ol>` : empty}`;
}

/* ---- 日記 ---- */
function journalView(t) {
  const ds = tripDays(t);
  if (!ds.length) return `<div class="empty"><div class="big">📔</div><b>先設定旅行日期</b>點右上角 ✏️ 設定日期後，就能每天寫日記</div>`;
  return ds.map((d, n) => {
    const j = t.journal[d] || {};
    const photos = j.photos || [];
    return `<div class="jcard" data-act="edit-journal" data-day="${d}">
      <div class="jh"><b>Day ${n + 1}<small>${fmtDay(d)}</small></b><span class="m">${j.mood || ''}</span></div>
      ${j.text ? `<p>${esc(j.text)}</p>` : `<p class="placeholder">點這裡寫下今天的回憶…</p>`}
      ${photos.length ? `<div class="ph-row">${photos.map((id) => `<img data-photo="${id}" data-act="view-photo" alt="">`).join('')}</div>` : ''}
    </div>`;
  }).join('');
}

/* ---- 清單 ---- */
function packView(t) {
  const done = t.packing.filter((p) => p.done).length;
  const pct = t.packing.length ? Math.round((done / t.packing.length) * 100) : 0;
  return `
    <h2 class="section">行李與待辦　${done} / ${t.packing.length}</h2>
    <div class="progress"><i style="width:${pct}%"></i></div>
    <form class="add-row" id="pack-form" autocomplete="off">
      <input class="input" name="text" placeholder="新增項目，例如：訂機場接送" enterkeyhint="done">
      <button type="submit">加入</button>
    </form>
    ${t.packing.length ? `<div class="list">${t.packing.map((p) => `
      <div class="li ${p.done ? 'done' : ''}" data-act="toggle-pack" data-id="${p.id}">
        <button class="check" tabindex="-1" aria-hidden="true">${p.done ? '✓' : ''}</button>
        <span class="txt">${esc(p.text)}</span>
        <button class="x" data-act="del-pack" data-id="${p.id}" aria-label="刪除">×</button>
      </div>`).join('')}</div>` : ''}
    ${t.packing.length ? '' : `<button class="btn ghost" data-act="pack-defaults">📋 加入常用行李清單</button>`}`;
}

/* ---- 花費 ---- */
function budgetView(t) {
  const ds = tripDays(t);
  const cost = (i) => Number(i.cost) || 0;
  const items = t.items.filter((i) => cost(i) > 0);
  const total = items.reduce((s, i) => s + cost(i), 0);
  if (!items.length) return `<div class="empty"><div class="big">💰</div><b>還沒有花費紀錄</b>在行程裡填上「花費」，這裡就會自動幫你加總</div>`;
  const byCat = Object.entries(CATS).map(([k, c]) => [c, items.filter((i) => (i.cat || 'other') === k).reduce((s, i) => s + cost(i), 0)]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const byDay = ds.map((d, n) => [`Day ${n + 1}`, items.filter((i) => i.date === d).reduce((s, i) => s + cost(i), 0)]);
  const un = items.filter((i) => !ds.includes(i.date)).reduce((s, i) => s + cost(i), 0);
  if (un) byDay.push(['未排定', un]);
  const max = Math.max(...byCat.map((x) => x[1]), ...byDay.map((x) => x[1]), 1);
  const bars = (rows) => rows.map(([l, v]) => `<div class="bar-row"><span>${l}</span><div class="meter"><i style="width:${(v / max) * 100}%"></i></div><span class="v">${fmtNum(v)}</span></div>`).join('');
  return `
    <div class="total"><small>總花費（${esc(t.currency)}）</small><b>${fmtNum(total)}</b><small>${ds.length > 1 ? `平均每天 ${fmtNum(total / ds.length)}` : ''}</small></div>
    <h2 class="section">依類別</h2><div class="list">${bars(byCat.map(([c, v]) => [`${c.icon} ${c.label}`, v]))}</div>
    <h2 class="section">依日期</h2><div class="list">${bars(byDay)}</div>`;
}

/* ============ 底部表單 ============ */
let sheetOnClose = null;
function openSheet(html, onMount, onClose) {
  const root = $('#sheet');
  root.innerHTML = `<div class="backdrop" data-act="close-sheet"></div><div class="panel" role="dialog" aria-modal="true">${html}</div>`;
  sheetOnClose = onClose || null;
  document.body.classList.add('noscroll');
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('open')));
  if (onMount) onMount($('.panel', root));
}
async function closeSheet() {
  const root = $('#sheet');
  if (sheetOnClose) { const fn = sheetOnClose; sheetOnClose = null; await fn(); }
  root.classList.remove('open');
  document.body.classList.remove('noscroll');
  setTimeout(() => { if (!root.classList.contains('open')) root.innerHTML = ''; }, 300);
}
const head = (title, submitLabel = '儲存') =>
  `<div class="sheet-head"><button type="button" class="link" data-act="close-sheet">取消</button><b>${title}</b><button class="link strong" type="submit">${submitLabel}</button></div>`;

function tripForm(t) {
  const isNew = !t;
  const d = t || { emoji: EMOJIS[0], color: COLORS[0], currency: 'TWD' };
  openSheet(`<form id="f" autocomplete="off">
    ${head(isNew ? '新旅程' : '編輯旅程')}
    <div class="pick">${EMOJIS.map((e) => `<label><input type="radio" name="emoji" value="${e}" ${d.emoji === e ? 'checked' : ''}><span>${e}</span></label>`).join('')}</div>
    <label class="field"><span>旅程名稱</span><input name="name" required value="${esc(d.name)}" placeholder="例如：京都賞楓之旅"></label>
    <label class="field"><span>目的地</span><input name="dest" value="${esc(d.dest)}" placeholder="例如：日本 京都"></label>
    <div class="row">
      <label class="field"><span>出發日</span><input type="date" name="start" value="${esc(d.start)}"></label>
      <label class="field"><span>回程日</span><input type="date" name="end" value="${esc(d.end)}"></label>
    </div>
    <div class="row">
      <label class="field"><span>幣別</span><input name="currency" value="${esc(d.currency)}" placeholder="TWD / JPY"></label>
      <div class="field"><span>顏色</span><div class="pick colors" style="margin:0">${COLORS.map((c) => `<label><input type="radio" name="color" value="${c}" ${d.color === c ? 'checked' : ''}><span style="--sw:${c}"></span></label>`).join('')}</div></div>
    </div>
    <p class="hint">日期還沒決定也沒關係，可以先建立旅程，把想去的地方放進「口袋名單」。</p>
    ${isNew ? '' : `<button type="button" class="btn ghost" data-act="share-trip">📤 分享行程（文字）</button>
    <button type="button" class="danger" data-act="del-trip">刪除這趟旅程</button>`}
  </form>`, (panel) => {
    $('#f', panel).onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const v = Object.fromEntries(fd);
      if (v.start && v.end && v.end < v.start) return toast('回程日不能早於出發日');
      if (!v.start) v.end = '';
      const trip = t || { id: uid(), items: [], journal: {}, packing: [], createdAt: Date.now() };
      Object.assign(trip, {
        name: v.name.trim(), dest: v.dest.trim(), start: v.start, end: v.end || v.start,
        emoji: v.emoji, color: v.color, currency: v.currency.trim() || 'TWD',
      });
      await saveTrip(trip);
      await closeSheet();
      if (isNew) { ui = { tab: 'plan', day: null }; location.hash = `#/trip/${trip.id}`; }
      else route();
    };
  });
}

function itemForm(t, item) {
  const isNew = !item;
  const ds = tripDays(t);
  const d = item || { cat: 'sight', date: ui.day === 'none' ? '' : ui.day };
  openSheet(`<form id="f" autocomplete="off">
    ${head(isNew ? '新增行程' : '編輯行程')}
    <div class="pick cats">${Object.entries(CATS).map(([k, c]) => `<label><input type="radio" name="cat" value="${k}" ${d.cat === k ? 'checked' : ''}><span>${c.icon}<small>${c.label}</small></span></label>`).join('')}</div>
    <label class="field"><span>要做什麼</span><input name="title" required value="${esc(d.title)}" placeholder="例如：清水寺、一蘭拉麵、新幹線"></label>
    <div class="row">
      <label class="field"><span>哪一天</span><select name="date">
        <option value="">💡 口袋名單</option>
        ${ds.map((x, n) => `<option value="${x}" ${d.date === x ? 'selected' : ''}>Day ${n + 1}・${fmtDay(x)}</option>`).join('')}
      </select></label>
      <label class="field"><span>時間</span><input type="time" name="time" value="${esc(d.time)}"></label>
    </div>
    <label class="field"><span>地點（可直接開 Google 地圖）</span><input name="place" value="${esc(d.place)}" placeholder="地名或地址"></label>
    <div class="row">
      <label class="field"><span>花費（${esc(t.currency)}）</span><input type="number" name="cost" inputmode="decimal" step="any" min="0" value="${esc(d.cost)}" placeholder="0"></label>
      <label class="field"><span>相關連結</span><input type="url" name="url" value="${esc(d.url)}" placeholder="訂位 / 票券網址"></label>
    </div>
    <label class="field"><span>備註</span><textarea name="note" rows="3" placeholder="訂位代號、營業時間、必點…">${esc(d.note)}</textarea></label>
    ${isNew ? '' : `<button type="button" class="danger" data-act="del-item" data-id="${item.id}">刪除這個行程</button>`}
  </form>`, (panel) => {
    $('#f', panel).onsubmit = async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(e.target));
      const it = item || { id: uid(), done: false };
      Object.assign(it, {
        cat: v.cat, title: v.title.trim(), date: v.date, time: v.time, place: v.place.trim(),
        cost: v.cost === '' ? '' : Number(v.cost), url: v.url.trim(), note: v.note.trim(),
      });
      if (isNew) t.items.push(it);
      await saveTrip(t);
      ui.day = it.date || 'none';
      await closeSheet();
      renderTrip();
    };
  });
}

function journalSheet(t, date) {
  const n = tripDays(t).indexOf(date) + 1;
  const j = t.journal[date] || { text: '', mood: '', photos: [] };
  t.journal[date] = j;
  openSheet(`<div>
    <div class="sheet-head"><span style="min-width:48px"></span><b>Day ${n}・${fmtDay(date)}</b><button class="link strong" data-act="close-sheet">完成</button></div>
    <div class="moods">${MOODS.map((m) => `<button type="button" class="mood ${j.mood === m ? 'on' : ''}" data-mood="${m}">${m}</button>`).join('')}</div>
    <textarea class="input" id="jt" rows="8" placeholder="今天去了哪裡、吃了什麼、有什麼好玩的事？">${esc(j.text)}</textarea>
    <div class="photos" id="jp"></div>
    <label class="btn ghost file-btn">📷 加入照片<input type="file" accept="image/*" multiple id="jf"></label>
    <p class="hint">照片會自動壓縮後存在這支手機裡。</p>
  </div>`, (panel) => {
    const drawPhotos = () => {
      $('#jp', panel).innerHTML = j.photos.map((id) => `<div class="ph"><img data-photo="${id}" data-act="view-photo" alt=""><button type="button" data-pdel="${id}" aria-label="刪除照片">×</button></div>`).join('');
      hydratePhotos(panel);
    };
    drawPhotos();
    panel.addEventListener('click', async (e) => {
      const m = e.target.closest('[data-mood]');
      if (m) {
        j.mood = j.mood === m.dataset.mood ? '' : m.dataset.mood;
        panel.querySelectorAll('.mood').forEach((b) => b.classList.toggle('on', b.dataset.mood === j.mood));
      }
      const del = e.target.closest('[data-pdel]');
      if (del && confirm('刪除這張照片？')) {
        const id = del.dataset.pdel;
        j.photos = j.photos.filter((x) => x !== id);
        deletePhoto(id);
        await saveTrip(t);
        drawPhotos();
      }
    });
    $('#jf', panel).onchange = async (e) => {
      const files = [...e.target.files];
      e.target.value = '';
      if (!files.length) return;
      toast(`處理 ${files.length} 張照片中…`);
      for (const f of files) {
        try {
          const id = uid();
          await savePhoto(id, t.id, await photoForCloud(f));
          j.photos.push(id);
        } catch (err) { toast(err.message); }
      }
      await saveTrip(t);
      drawPhotos();
      toast('照片已加入');
    };
  }, async () => {
    j.text = $('#jt').value.trim();
    await saveTrip(t);
    renderTrip();
  });
}

function settingsSheet() {
  openSheet(`<div>
    <div class="sheet-head"><span style="min-width:48px"></span><b>設定與備份</b><button class="link strong" data-act="close-sheet">完成</button></div>
    <div class="account">
      <img src="${esc(user.user_metadata?.avatar_url || 'icons/icon-192.png')}" alt="" referrerpolicy="no-referrer">
      <div><b>${esc(user.user_metadata?.full_name || 'Google 帳號')}</b><small>${esc(user.email || '離線中')}</small></div>
    </div>
    <p class="hint">資料存在你的 Google 帳號底下，用同一個帳號登入的手機或電腦都會自動同步。沒網路時也能新增、修改，連上網路後會自動上傳。</p>
    <p class="hint">共 ${trips.length} 趟旅程・${pending.count() ? `⏳ 有 ${pending.count()} 項變更等待上傳` : '✅ 已全部同步'}${lastSync ? `（上次同步 ${new Date(lastSync).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}）` : ''}</p>
    <button class="btn" data-act="sync-now">🔄 立即同步</button>
    <button class="btn ghost" data-act="logout">登出</button>
    <h2 class="section">備份</h2>
    <p class="hint">可以另外匯出一份檔案自己保存（包含照片）。</p>
    <button class="btn ghost" data-act="export">⬇️ 匯出備份檔</button>
    <label class="btn ghost file-btn">⬆️ 從備份檔還原<input type="file" accept="application/json,.json" id="imp"></label>
    <h2 class="section">安裝到手機主畫面</h2>
    <p class="hint">
      <b>iPhone：</b>用 Safari 開啟 → 點下方「分享」按鈕 → 「加入主畫面」。<br>
      <b>Android：</b>用 Chrome 開啟 → 右上角 ⋮ → 「安裝應用程式」或「加到主畫面」。
    </p>
  </div>`, (panel) => {
    $('#imp', panel).onchange = async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) importData(f);
    };
  });
}

/* ============ 照片 ============ */
function compressImage(file, max = 1600, quality = 0.82) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s);
      c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? res(b) : rej(new Error('照片壓縮失敗'))), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error(`無法讀取 ${file.name}`)); };
    img.src = url;
  });
}
// 照片壓縮到約 700 KB 以下，省雲端空間也上傳得快
async function photoForCloud(file) {
  let blob = await compressImage(file, 1280, 0.75);
  if (blob.size > 700_000) blob = await compressImage(file, 1024, 0.6);
  return blob;
}
async function hydratePhotos(root) {
  await Promise.all([...root.querySelectorAll('img[data-photo]')].map(async (img) => {
    const u = await photoURL(img.dataset.photo);
    if (u) img.src = u;
  }));
}
function viewPhoto(src) {
  const v = document.createElement('div');
  v.className = 'viewer';
  v.innerHTML = `<img src="${src}" alt="">`;
  v.onclick = () => v.remove();
  document.body.appendChild(v);
}

/* ============ 備份 / 分享 ============ */
const blobToDataURL = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });

async function shareFile(file, title) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return; }
    catch (err) { if (err.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function exportData() {
  toast('準備備份中…');
  const photos = [];
  for (const t of trips) {
    for (const id of tripPhotoIds(t)) {
      try { photos.push({ id, tripId: t.id, data: await blobToDataURL(await photoBlob(id)) }); }
      catch { /* 離線且沒下載過的照片略過 */ }
    }
  }
  const data = { app: 'cuticuti', version: 1, exportedAt: new Date().toISOString(), trips, photos };
  const file = new File([JSON.stringify(data)], `cuticuti-備份-${todayISO()}.json`, { type: 'application/json' });
  await shareFile(file, 'CutiCuti 備份');
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'cuticuti' || !Array.isArray(data.trips)) throw new Error('這不是 CutiCuti 的備份檔');
    if (!confirm(`備份內有 ${data.trips.length} 趟旅程。\n相同的旅程會被備份內容覆蓋，確定還原？`)) return;
    await importTrips(data.trips, data.photos || []);
    await closeSheet();
    route();
    toast('還原完成 🎉');
  } catch (err) {
    toast('還原失敗：' + err.message);
  }
}

async function shareTrip(t) {
  const ds = tripDays(t);
  const line = (i) => `${i.time ? i.time + ' ' : ''}${(CATS[i.cat] || CATS.other).icon} ${i.title}${i.place ? `（${i.place}）` : ''}`;
  let text = `${t.emoji} ${t.name}\n${t.dest ? t.dest + '・' : ''}${fmtRange(t)}\n`;
  ds.forEach((d, n) => {
    const list = t.items.filter((i) => i.date === d).sort(byTime);
    text += `\n【Day ${n + 1}・${fmtDay(d)}】\n${list.length ? list.map(line).join('\n') : '（自由活動）'}\n`;
  });
  const un = t.items.filter((i) => !ds.includes(i.date));
  if (un.length) text += `\n【口袋名單】\n${un.map(line).join('\n')}\n`;
  if (navigator.share) {
    try { await navigator.share({ title: t.name, text }); return; } catch (err) { if (err.name === 'AbortError') return; }
  }
  await navigator.clipboard.writeText(text);
  toast('行程已複製，可以貼到 LINE 給旅伴');
}

/* ============ 點擊事件 ============ */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  const link = e.target.closest('a[href]');
  if (link && (!el || el.contains(link))) return; // 讓連結（地圖、網址、返回）正常開啟
  if (!el) return;
  const t = current;
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case 'close-sheet': return closeSheet();
    case 'login': return login(el);
    case 'logout': return logout();
    case 'sync-now':
      try {
        toast('同步中…');
        await sync();
        await closeSheet();
        route();
        toast('已同步 ✅');
      } catch (err) { toast('同步失敗：' + friendly(err)); }
      return;
    case 'settings': return settingsSheet();
    case 'export': return exportData();
    case 'new-trip': return tripForm();
    case 'edit-trip': return tripForm(t);
    case 'share-trip': return shareTrip(t);
    case 'del-trip':
      if (!confirm(`確定刪除「${t.name}」？\n行程、日記和照片都會一起刪除，無法復原。`)) return;
      await deleteTripData(t);
      await closeSheet();
      location.hash = '#/';
      return;
    case 'tab': ui.tab = el.dataset.tab; window.scrollTo(0, 0); return renderTrip();
    case 'day': ui.day = el.dataset.day; return renderTrip();
    case 'new-item': return itemForm(t);
    case 'edit-item': return itemForm(t, t.items.find((i) => i.id === id));
    case 'toggle-item': {
      e.stopPropagation();
      const it = t.items.find((i) => i.id === id);
      it.done = !it.done;
      await saveTrip(t);
      return renderTrip();
    }
    case 'del-item':
      if (!confirm('刪除這個行程？')) return;
      t.items = t.items.filter((i) => i.id !== id);
      await saveTrip(t);
      await closeSheet();
      return renderTrip();
    case 'edit-journal': return journalSheet(t, el.dataset.day);
    case 'view-photo': e.stopPropagation(); if (el.src) viewPhoto(el.src); return;
    case 'toggle-pack': {
      const p = t.packing.find((x) => x.id === id);
      p.done = !p.done;
      await saveTrip(t);
      return renderTrip();
    }
    case 'del-pack':
      t.packing = t.packing.filter((x) => x.id !== id);
      await saveTrip(t);
      return renderTrip();
    case 'pack-defaults':
      t.packing.push(...PACK_DEFAULTS.map((text) => ({ id: uid(), text, done: false })));
      await saveTrip(t);
      return renderTrip();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if ($('.viewer')) $('.viewer').remove();
    else if ($('#sheet').classList.contains('open')) closeSheet();
  }
});

window.addEventListener('hashchange', () => { ui = { tab: 'plan', day: null }; route(); });

/* ============ 登入 / 啟動 ============ */
async function login(btn) {
  btn.disabled = true;
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } },
  });
  if (error) { toast('登入失敗：' + friendly(error)); btn.disabled = false; }
}

async function logout() {
  const n = pending.count();
  const msg = n
    ? `還有 ${n} 項變更沒上傳到雲端，登出會遺失這些變更！\n確定要登出嗎？`
    : '確定要登出嗎？\n這支手機上的快取會被清除，雲端的資料不受影響，下次登入就會回來。';
  if (!confirm(msg)) return;
  await closeSheet();
  await sb.auth.signOut({ scope: 'local' }); // 只登出這支手機
  // 清掉本機快取，避免下一個使用這台裝置的人看到
  trips = [];
  photoURLs.forEach((u) => URL.revokeObjectURL(u));
  photoURLs.clear();
  pending.clear();
  store.set('cache-user', '');
  await DB.clear().catch(() => {});
}

// 自己保存的備份檔、或舊版（登入功能之前）存在手機裡的資料，都用這個寫進帳號
async function importTrips(tripList, photoList) {
  for (const p of photoList) {
    const blob = p.blob || (await (await fetch(p.data)).blob());
    await savePhoto(p.id, p.tripId || '', blob);
  }
  for (const t of tripList) await saveTrip(t);
}

async function boot() {
  if (!user) return route();
  const cacheUser = store.get('cache-user');
  if (cacheUser !== user.id) {
    const local = await DB.all('trips');
    if (!cacheUser && local.length && confirm(`這支手機上有 ${local.length} 趟之前存的旅程，要上傳到你的 Google 帳號嗎？`)) {
      // 舊版只存在手機裡的資料：全部標記為待上傳
      local.forEach((t) => pending.add('trips', t.id));
      (await DB.keys('photos')).forEach((id) => pending.add('photos', id));
    } else {
      await DB.clear();
      pending.clear();
    }
    store.set('cache-user', user.id);
  }
  trips = await DB.all('trips');
  if (trips.length) route(); else renderLoading('同步中…');
  try {
    await sync();
    if (!isEditing()) route();
  } catch (err) {
    if (!trips.length) route();
    toast(user.offline ? '目前離線，顯示的是上次同步的資料' : '同步失敗：' + friendly(err));
  }
}

// 從背景切回來、或網路恢復時，自動同步
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && user && Date.now() - lastSync > 30000) scheduleSync(0);
});
window.addEventListener('online', async () => {
  if (user?.offline) {
    const { data } = await sb.auth.getSession();
    if (data.session) user = data.session.user;
  }
  if (user) scheduleSync(0);
});

window.addEventListener('hashchange', () => { ui = { tab: 'plan', day: null }; route(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

(async () => {
  if (!configured) {
    app.innerHTML = '<div class="empty"><div class="big">🔧</div><b>還沒連上雲端資料庫</b>請在 config.js 填入 Supabase 的 Project URL 和 Publishable key</div>';
    return;
  }
  renderLoading();
  await DB.open();
  const { data } = await sb.auth.getSession(); // 會順便處理 Google 登入完跳回來的網址
  const params = new URLSearchParams(location.search);
  if (params.has('code') || params.has('error')) {
    const err = params.get('error_description');
    if (err) toast('登入失敗：' + err);
    history.replaceState(null, '', location.pathname + location.hash);
  }
  user = data.session?.user ?? null;
  // 離線打開時登入憑證可能無法更新：先用上次同步的資料，網路恢復後再重新連線
  if (!user && !navigator.onLine && store.get('cache-user')) user = { id: store.get('cache-user'), offline: true };
  sb.auth.onAuthStateChange((_event, session) => {
    const u = session?.user ?? null;
    if ((u?.id ?? null) === (user?.id ?? null)) { if (u) user = u; return; } // 同一個人（例如憑證更新）
    if (!u && user?.offline) return;
    user = u;
    boot();
  });
  boot();
})().catch((err) => {
  app.innerHTML = `<div class="empty"><div class="big">⚠️</div><b>啟動失敗</b>${esc(friendly(err))}<br>若是無痕模式，請改用一般模式開啟。</div>`;
});
