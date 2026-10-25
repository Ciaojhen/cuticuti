'use strict';

/* ============ 設定 ============ */
const CATS = {
  sight:     { label: '景點', icon: '📍' },
  food:      { label: '餐廳', icon: '🍜' },
  transport: { label: '交通', icon: '🚆' },
  parking:   { label: '停車', icon: '🅿️' },
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
function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
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

// 線條圖示（頂部按鈕用）
const icon = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  settings: icon('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
  edit: icon('<path d="M21.17 6.81a1 1 0 0 0-3.98-3.98L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>'),
  back: icon('<path d="m15 18-6-6 6-6"/>'),
  grip: icon('<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>'),
  clock: icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  map: icon('<path d="M14.1 5.55a2 2 0 0 0 1.8 0l3.65-1.83A1 1 0 0 1 21 4.62v12.76a1 1 0 0 1-.55.9l-4.55 2.27a2 2 0 0 1-1.8 0l-4.2-2.1a2 2 0 0 0-1.8 0l-3.65 1.83A1 1 0 0 1 3 19.38V6.62a1 1 0 0 1 .55-.9L8.1 3.45a2 2 0 0 1 1.8 0z"/><path d="M15 5.76v15"/><path d="M9 3.24v15"/>'),
  sparkle: icon('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 3v4"/><path d="M17 5h4"/>'),
  search: icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
};

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
  // 分三區：已定日期（依出發日）、還沒決定日期（新建的在前）、已結束（最近的在前）
  const dated = trips.filter((t) => t.start).sort((a, b) => a.start.localeCompare(b.start));
  const upcoming = dated.filter((t) => tripStatus(t).kind !== 'past');
  const past = dated.filter((t) => tripStatus(t).kind === 'past').reverse();
  const undated = trips.filter((t) => !t.start).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const section = (title, list) => (list.length ? `<h2 class="section">${title}</h2>${list.map(card).join('')}` : '');
  const card = (t) => {
    const st = tripStatus(t);
    return `<a class="trip-card" href="#/trip/${t.id}" style="--c:${esc(t.color)}">
      <div class="em">${esc(t.emoji)}</div>
      <div class="info">
        <h3>${esc(t.name)}</h3>
        <p>${t.start ? `${t.dest ? esc(t.dest) + '・' : ''}${fmtRange(t)}` : esc(t.dest || '還沒填目的地')}</p>
        ${t.start ? `<span class="pill ${st.kind}">${st.label}</span>` : ''}<span class="count">${t.items.length} 個行程</span>
      </div>
    </a>`;
  };
  app.innerHTML = `
    <header class="topbar"><div class="bar">
      <h1 class="brand">${logo()}</h1>
      <button class="icon-btn" data-act="settings" aria-label="設定與備份">${ICONS.settings}</button>
    </div></header>
    <main class="page">
      ${trips.length ? '' : `<div class="empty"><div class="big">🧳</div><b>還沒有旅程</b>按右下角新增第一趟旅行吧！</div>`}
      ${section('接下來的旅程', upcoming)}
      ${section('還沒決定日期', undated)}
      ${section('旅行回憶', past)}
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
        <a class="icon-btn" href="#/" aria-label="返回">${ICONS.back}</a>
        <div class="title"><b>${esc(t.emoji)} ${esc(t.name)}</b><small>${t.dest ? esc(t.dest) + '・' : ''}${fmtRange(t)}</small></div>
        <button class="icon-btn" data-act="edit-trip" aria-label="編輯旅程">${ICONS.edit}</button>
      </div>
      <nav class="tabs">${TABS.map(([k, l]) => `<button class="tab ${ui.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}">${l}</button>`).join('')}</nav>
    </header>
    <main class="page">${views[ui.tab](t)}</main>
    ${fab ? `<button class="fab" data-act="new-item">${fab}</button>` : ''}`;

  const on = $('.chip.on');
  if (on) on.parentElement.scrollLeft = on.offsetLeft - (on.parentElement.clientWidth - on.offsetWidth) / 2;
  hydratePhotos(app);
  renderDayMap(t);
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
let showMap = store.get('show-map') === '1';
let suggestion = null; // 建議順序的計算結果，等使用者按「套用」

// 某一天的交通方式：那天有自己設定就用那天的，否則用旅程的預設
function dayMode(t, day) {
  const m = t.dayModes?.[day] || t.mode;
  return MODES[m] ? m : 'walk';
}

// 目前選的那天（或口袋名單）的行程，依時間排序
function dayItems(t) {
  const ds = tripDays(t);
  return (ui.day === 'none' ? t.items.filter((i) => !ds.includes(i.date)) : t.items.filter((i) => i.date === ui.day)).slice().sort(byTime);
}
// 搜尋地點時優先找旅程附近：已定位行程的中心，沒有的話用目的地
function nearPoint(t) {
  const pts = t.items.filter((i) => i.geo).map((i) => i.geo);
  if (pts.length) return { lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length, lon: pts.reduce((a, p) => a + p.lon, 0) / pts.length };
  return t.destGeo || null;
}

function planView(t) {
  const ds = tripDays(t);
  const unsched = t.items.filter((i) => !ds.includes(i.date));
  const today = todayISO();
  const chips = ds.map((d, n) => {
    const cnt = t.items.filter((i) => i.date === d).length;
    return `<button class="chip ${ui.day === d ? 'on' : ''} ${d === today ? 'today' : ''}" data-act="day" data-day="${d}">
      <b>Day ${n + 1}${d === today ? '・今天' : ''}</b><small>${fmtDay(d)}${cnt ? `・${cnt}` : ''}${dayMode(t, d) !== dayMode(t, '') ? ` ${MODES[dayMode(t, d)].icon}` : ''}</small></button>`;
  }).join('') + `<button class="chip ${ui.day === 'none' ? 'on' : ''}" data-act="day" data-day="none"><b>💡 口袋名單</b><small>還沒排進哪天・${unsched.length}</small></button>`;

  const list = dayItems(t);
  const geoItems = list.filter((i) => i.geo);
  const mode = dayMode(t, ui.day);
  const row = (i) => {
    const c = CATS[i.cat] || CATS.other;
    const url = safeURL(i.url);
    // 地址不顯示；舊資料地點欄放的是地址的也一樣
    const addr = i.address || (i.place && looksLikeAddress(i.place) ? i.place : '');
    const showPlace = i.place && i.place !== addr && i.place !== i.title;
    const mapQuery = addr ? `${(showPlace && i.place) || i.title} ${addr}` : i.place;
    const mapHref = mapQuery ? mapURL(mapQuery) : '';
    const meta = [
      i.cost !== '' && i.cost != null ? `💰 ${esc(t.currency)} ${fmtNum(i.cost)}` : '',
      url ? `<a href="${esc(url)}" target="_blank" rel="noopener">🔗 連結</a>` : '',
      mapHref && !showPlace ? `<a href="${mapHref}" target="_blank" rel="noopener">📍 地圖</a>` : '',
    ].filter(Boolean).join('');
    const hb = hoursBadge(i);
    const seq = showMap && i.geo ? geoItems.indexOf(i) + 1 : 0;
    return `<li class="item ${i.done ? 'done' : ''}" data-act="edit-item" data-id="${i.id}">
      <div class="time ${i.time ? '' : 'none'}">${i.time || '—'}</div>
      ${seq ? `<button type="button" class="dot" data-act="focus-pin" data-seq="${seq}" aria-label="在地圖上看第 ${seq} 個地點"><span class="pin small">${seq}</span></button>` : `<div class="dot">${c.icon}</div>`}
      <div class="body">
        <div class="t">${esc(i.title)}</div>
        ${showPlace ? `<a class="place" href="${mapHref}" target="_blank" rel="noopener">📍 ${esc(i.place)}</a>` : ''}
        ${hb ? `<div class="hours ${hb.bad ? 'bad' : ''}">${ICONS.clock}<span class="hours-text">${hb.text.split('／').map((x) => `<span>${esc(x)}</span>`).join('／')}</span></div>` : ''}
        ${i.note ? `<p class="note">${esc(i.note)}</p>` : ''}
        ${meta ? `<div class="meta">${meta}</div>` : ''}
      </div>
      <button class="check" data-act="toggle-item" data-id="${i.id}" aria-label="${i.done ? '標記未完成' : '標記完成'}">${i.done ? '✓' : ''}</button>
      <span class="grip" data-act="grip" aria-label="按住拖拉改變順序">${ICONS.grip}</span>
    </li>`;
  };
  const empty = ui.day === 'none'
    ? `<div class="empty"><div class="big">💡</div><b>口袋名單是空的</b>想去但還沒決定哪天的地方，可以先放這裡</div>`
    : `<div class="empty"><div class="big">🗓️</div><b>這天還沒有安排</b>點「新增行程」開始排吧</div>`;
  const tools = list.length ? `<div class="plan-tools">
      <button class="tool ${showMap ? 'on' : ''}" data-act="toggle-map">${ICONS.map}路線圖</button>
      ${ui.day !== 'none' ? `<button class="tool" data-act="suggest-order">${ICONS.sparkle}建議順序</button>` : ''}
      ${ui.day !== 'none' ? `<button class="tool mode" data-act="cycle-mode" aria-label="切換這天的交通方式">${MODES[mode].icon} ${MODES[mode].label}</button>` : ''}
    </div>` : '';
  const mapCard = !showMap || !list.length ? ''
    : geoItems.length ? `<div class="map-card"><div id="day-map"></div><button type="button" class="map-all" data-act="map-all">全部</button><div class="map-meta" id="map-meta"></div></div>`
    : `<p class="hint map-empty">這天還沒有定位的地點。編輯行程時在「地址」貼上地址按「搜尋」（或直接用地點名稱搜尋），就會出現在地圖上。</p>`;
  return `<div class="chips">${chips}</div>${tools}${mapCard}${list.length ? `<ol class="timeline">${list.map(row).join('')}</ol>` : empty}`;
}

function renderDayMap(t) {
  const el = $('#day-map');
  if (!el) { if (dayMap) { dayMap.remove(); dayMap = null; } return; }
  const geoItems = dayItems(t).filter((i) => i.geo);
  const pts = geoItems.map((i, k) => ({ lat: i.geo.lat, lon: i.geo.lon, label: k + 1, title: i.title, done: i.done }));
  const meta = (txt) => { const m = $('#map-meta'); if (m) m.textContent = txt; };
  // 點地圖上的標記：捲到對應的行程卡片並閃一下
  const pick = (k) => {
    const li = $(`.item[data-id="${geoItems[k].id}"]`);
    if (!li) return;
    const top = li.getBoundingClientRect().top + window.scrollY - $('.topbar').offsetHeight - 12;
    window.scrollTo({ top, behavior: 'smooth' });
    li.classList.remove('flash');
    void li.offsetWidth;
    li.classList.add('flash');
  };
  drawMap(el, pts, dayMode(t, ui.day), ui.day !== 'none', meta, pick).catch((err) => meta(friendly(err)));
}

async function suggestSheet(t) {
  const list = dayItems(t);
  const located = list.filter((i) => i.geo);
  if (located.length < 2) return toast('至少要有 2 個已定位的地點才能建議順序：編輯行程 → 地址 → 搜尋', 4500);
  // 這天公休的地點不排進去，另外提醒換一天
  const closed = located.filter((i) => { const h = hoursFor(i, ui.day); return h && !h.length; });
  const geo = located.filter((i) => !closed.includes(i));
  if (!geo.length) return toast('這天的地點都公休，建議換一天', 4000);
  const mode = dayMode(t, ui.day);
  toast('計算路線中…');
  const matrix = await travelMatrix(geo.map((i) => i.geo), mode);
  const times = geo.filter((i) => i.time).map((i) => toMin(i.time));
  const start = times.length ? Math.min(...times) : 9 * 60;
  const fixFirst = geo[0].cat === 'stay';
  const now = simulate(geo.map((_, k) => k), geo, matrix, start, ui.day);
  const best = suggestOrder(geo, matrix, start, ui.day, fixFirst);
  suggestion = { trip: t, best };
  const same = best.order.every((v, k) => v === k);
  const skipped = list.filter((i) => !i.geo);
  const nowWarn = now.stops.filter((x) => x.warn).length;
  openSheet(`<div>
    <div class="sheet-head"><button class="link" data-act="close-sheet">取消</button><b>建議順序</b><button class="link strong" data-act="apply-order">套用</button></div>
    <p class="hint">${MODES[mode].icon} ${MODES[mode].label}・${fmtMin(start)} 出發${fixFirst ? '・從住宿出發' : ''}<br>
      ${same ? '目前的順序已經是最順的了 👍' : `移動時間：目前 ${fmtDuration(now.travel)} → 建議 <b>${fmtDuration(best.travel)}</b>`}
      ${nowWarn ? `<br>目前的順序有 ${nowWarn} 個地點會碰到沒開門` : ''}</p>
    <ol class="sugg">${best.stops.map((x, k) => {
      const h = hoursFor(x.item, ui.day);
      const move = k ? `<div class="leg">${MODES[mode].icon} ${fmtDuration(matrix[best.order[k - 1]][best.order[k]])}</div>` : '';
      return `${move}<li><span class="pin">${k + 1}</span><div>
        <b>${esc(x.item.title)}</b>
        <small>${fmtMin(x.arrive)} 抵達${x.waited ? `（等開門 ${fmtDuration(x.waited)}）` : ''}・停留 ${fmtDuration(stayOf(x.item))}${h ? `・營業 ${fmtRanges(h)}` : ''}</small>
        ${x.warn ? `<small class="bad">⚠️ ${x.warn}</small>` : ''}</div></li>`;
    }).join('')}</ol>
    ${closed.length ? `<p class="hint bad">⚠️ 這天公休，沒有排進去：${closed.map((i) => esc(i.title)).join('、')}（建議移到其他天）</p>` : ''}
    ${skipped.length ? `<p class="hint">沒有定位、不參與排序：${skipped.map((i) => esc(i.title)).join('、')}</p>` : ''}
    <p class="hint">時間已經依營業時間排好：太早到會等開門、盡量在打烊前離開。按「套用」會把時間改成建議的抵達時間。停留時間可以在每個行程裡調整。${mode === 'transit' ? '大眾運輸的移動時間是用距離估算的，僅供參考。' : ''}</p>
  </div>`);
}

async function applySuggestion() {
  if (!suggestion) return;
  const { trip, best } = suggestion;
  best.stops.forEach((x) => { x.item.time = fmtMin(x.arrive); });
  suggestion = null;
  await saveTrip(trip);
  await closeSheet();
  renderTrip();
  toast('已套用建議的順序 ✨');
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
  if (updateReady) location.reload();
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
      <label class="field"><span>預設交通方式</span><select name="mode">${Object.entries(MODES).map(([k, m]) => `<option value="${k}" ${(d.mode || 'walk') === k ? 'selected' : ''}>${m.icon} ${m.label}</option>`).join('')}</select></label>
    </div>
    <div class="field"><span>顏色</span><div class="pick colors" style="margin:0">${COLORS.map((c) => `<label><input type="radio" name="color" value="${c}" ${d.color === c ? 'checked' : ''}><span style="--sw:${c}"></span></label>`).join('')}</div></div>
    <p class="hint">日期還沒決定也沒關係，可以先建立旅程，把想去的地方放進「口袋名單」。<br>交通方式可以在每天的行程頁個別切換，沒切換的日子用這裡的預設。</p>
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
      if (trip.dest !== v.dest.trim()) delete trip.destGeo;
      Object.assign(trip, {
        mode: v.mode,
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

// 營業時間只能選整點或半點；關門可以選 24:00。舊資料不是整點／半點的話也保留
function halfHourOptions(value, placeholder, allow24) {
  const opts = [];
  for (let m = 0; m < 1440; m += 30) opts.push(fmtMin(m));
  if (allow24) opts.push('24:00');
  if (value && !opts.includes(value)) opts.push(value);
  return `<option value="">${placeholder}</option>` + opts.map((o) => `<option value="${o}" ${o === value ? 'selected' : ''}>${o}</option>`).join('');
}

function itemForm(t, item) {
  const isNew = !item;
  const ds = tripDays(t);
  const d = item ? { ...item } : { cat: 'sight', date: ui.day === 'none' ? '' : ui.day };
  if (!d.address && d.place && looksLikeAddress(d.place)) { d.address = d.place; d.place = ''; } // 舊資料：地址放在地點欄
  openSheet(`<form id="f" autocomplete="off">
    ${head(isNew ? '新增行程' : '編輯行程')}
    <div class="pick cats">${Object.entries(CATS).map(([k, c]) => `<label><input type="radio" name="cat" value="${k}" ${d.cat === k ? 'checked' : ''}><span>${c.icon}<small>${c.label}</small></span></label>`).join('')}</div>
    <label class="field"><span>名稱</span><input name="title" required value="${esc(d.title)}" placeholder="例如：午餐、清水寺、搭新幹線"></label>
    <div class="row">
      <label class="field"><span>哪一天</span><select name="date">
        <option value="">💡 口袋名單</option>
        ${ds.map((x, n) => `<option value="${x}" ${d.date === x ? 'selected' : ''}>Day ${n + 1}・${fmtDay(x)}</option>`).join('')}
      </select></label>
      <label class="field"><span>時間</span><input type="time" name="time" value="${esc(d.time)}"></label>
    </div>
    <label class="field"><span>地點（會顯示在行程上）</span><input name="place" value="${esc(d.place)}" placeholder="例如：一蘭 河原町店、先斗町"></label>
    <div class="field"><span>地址（不顯示，用來定位和建議順序）</span>
      <div class="search-row">
        <input name="address" value="${esc(d.address)}" placeholder="從 Google 地圖複製地址貼上" enterkeyhint="search">
        <button type="button" class="search-btn" id="place-search">${ICONS.search}搜尋</button>
      </div>
      <div class="results" id="place-results"></div>
      <p class="geo-status" id="geo-status"></p>
    </div>
    <div class="field"><span>營業時間（自己填的會優先使用）</span>
      <div class="row">
        <select name="open" aria-label="開門">${halfHourOptions(d.open, '開門', false)}</select>
        <select name="close" aria-label="關門">${halfHourOptions(d.close, '關門', true)}</select>
      </div>
      <div class="weekdays" id="weekdays">${[1, 2, 3, 4, 5, 6, 0].map((n) => `<label><input type="checkbox" name="openday" value="${n}"><span>${WEEK[n]}</span></label>`).join('')}</div>
      <p class="geo-status">點星期切換，灰色＝公休</p>
    </div>
    <label class="field"><span>預計停留</span><select name="stay">
      <option value="">自動（依類別）</option>
      ${[30, 60, 90, 120, 180, 240].map((m) => `<option value="${m}" ${Number(d.stay) === m && d.stay !== '' ? 'selected' : ''}>${fmtDuration(m)}</option>`).join('')}
    </select></label>
    <div class="row">
      <label class="field"><span>花費（${esc(t.currency)}）</span><input type="number" name="cost" inputmode="decimal" step="any" min="0" value="${esc(d.cost)}" placeholder="0"></label>
      <label class="field"><span>相關連結</span><input type="url" name="url" value="${esc(d.url)}" placeholder="訂位 / 票券網址"></label>
    </div>
    <label class="field"><span>備註</span><textarea name="note" rows="3" placeholder="訂位代號、必點、注意事項…">${esc(d.note)}</textarea></label>
    ${isNew ? '' : `<button type="button" class="danger" data-act="del-item" data-id="${item.id}">刪除這個行程</button>`}
  </form>`, (panel) => {
    const form = $('#f', panel);
    let geo = d.geo || null;
    let osmHours = d.osmHours || '';
    const results = $('#place-results', panel);
    // 營業日：有自己設定過就用自己的，否則依 OpenStreetMap 的資料（沒資料就預設每天都有開）
    let daysTouched = false;
    const dayBoxes = [...panel.querySelectorAll('[name=openday]')];
    const syncDays = () => {
      if (daysTouched) return;
      const closed = d.closedDays?.length ? d.closedDays : (parseHours(osmHours) || []).flatMap((r, n) => (r && !r.length ? [n] : []));
      dayBoxes.forEach((b) => { b.checked = !closed.includes(Number(b.value)); });
    };
    syncDays();
    $('#weekdays', panel).addEventListener('change', () => { daysTouched = true; });
    const showStatus = () => {
      const el = $('#geo-status', panel);
      if (!geo) { el.textContent = '貼上地址按「搜尋」定位；沒有地址的話，按「搜尋」會用地點名稱找'; return; }
      if (geo.approx) {
        el.innerHTML = `📍 依地址定位，大概在「${esc(geo.approx)}」附近 <button type="button" class="link small" id="geo-clear">清除</button>`;
        $('#geo-clear', panel).onclick = () => { geo = null; showStatus(); };
        return;
      }
      el.innerHTML = `📍 已定位 <button type="button" class="link small" id="geo-clear">清除</button>・${osmHours
        ? `OSM 營業時間：${esc(describeHours(osmHours))}（僅供參考）`
        : 'OSM 沒有營業時間'}`;
      $('#geo-clear', panel).onclick = () => { geo = null; osmHours = ''; showStatus(); };
    };
    showStatus();
    const doSearch = async () => {
      const addr = form.address.value.trim();
      const q = addr || form.place.value.trim() || form.title.value.trim();
      if (!q) return toast('先輸入地址或地點');
      // 有地址：用地址定位（不會有營業時間）；沒有地址：用地點名稱搜尋 OpenStreetMap
      if (addr && looksLikeAddress(addr)) {
        results.innerHTML = '<p class="hint">用地址定位中…</p>';
        try {
          const r = await geocodeAddress(q);
          results.innerHTML = r ? '' : '<p class="hint">這個地址找不到位置。可以試著只留到「町、丁目」或「路、街」再搜尋一次。</p>';
          if (r) { geo = { lat: r.lat, lon: r.lon, approx: r.matched }; osmHours = ''; syncDays(); showStatus(); }
        } catch (err) {
          results.innerHTML = `<p class="hint">定位失敗：${esc(friendly(err))}</p>`;
        }
        return;
      }
      results.innerHTML = '<p class="hint">搜尋中…</p>';
      try {
        let near = nearPoint(t);
        if (!near && t.dest) {
          const r = await searchPlaces(t.dest);
          if (r[0]) { near = t.destGeo = { lat: r[0].lat, lon: r[0].lon }; saveTrip(t); }
        }
        const list = await searchPlaces(q, near);
        results.innerHTML = list.length
          ? list.map((r, k) => `<button type="button" class="result" data-k="${k}"><b>${esc(r.name)}</b><small>${esc(r.address)}</small>${r.hours ? '<small>🕘 有營業時間</small>' : ''}</button>`).join('')
          : '<p class="hint">用名稱找不到。可以從 Google 地圖複製店家地址，貼在上面再按「搜尋」。</p>';
        results.onclick = (ev) => {
          const b = ev.target.closest('.result');
          if (!b) return;
          const r = list[b.dataset.k];
          geo = { lat: r.lat, lon: r.lon };
          osmHours = r.hours;
          syncDays();
          if (!form.place.value.trim()) form.place.value = r.name;
          if (!form.title.value.trim()) form.title.value = r.name;
          results.innerHTML = '';
          showStatus();
        };
      } catch (err) {
        results.innerHTML = `<p class="hint">搜尋失敗：${esc(friendly(err))}</p>`;
      }
    };
    $('#place-search', panel).onclick = doSearch;
    form.address.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doSearch(); } });
    form.onsubmit = async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(e.target));
      if (Boolean(v.open) !== Boolean(v.close)) return toast('開門和關門時間要一起填');
      const it = item || { id: uid(), done: false };
      Object.assign(it, {
        cat: v.cat, title: v.title.trim(), date: v.date, time: v.time, place: v.place.trim(), address: v.address.trim(),
        cost: v.cost === '' ? '' : Number(v.cost), url: v.url.trim(), note: v.note.trim(),
        geo, osmHours, open: v.open, close: v.close, stay: v.stay === '' ? '' : Number(v.stay),
        closedDays: daysTouched ? dayBoxes.filter((b) => !b.checked).map((b) => Number(b.value)).sort() : d.closedDays || [],
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
    <h2 class="section">桌面倒數小工具</h2>
    <p class="hint">用免費的 Scriptable App，在 iPhone 桌面或鎖定畫面顯示下一趟旅程的倒數。</p>
    <button class="btn ghost" data-act="widget">📱 建立桌面倒數小工具</button>
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

// 產生 Scriptable 腳本並複製，再顯示設定步驟
async function widgetSheet() {
  const code = widgetScript(trips, location.origin + location.pathname);
  let copied = false;
  try { await navigator.clipboard.writeText(code); copied = true; } catch { /* 有些瀏覽器不允許，改成手動複製 */ }
  const upcoming = trips.filter((t) => t.start && tripStatus(t).kind !== 'past').length;
  openSheet(`<div>
    <div class="sheet-head"><span style="min-width:48px"></span><b>桌面倒數小工具</b><button class="link strong" data-act="close-sheet">完成</button></div>
    <p class="hint">${copied ? '✅ 程式已經複製好了（包含 ' + upcoming + ' 趟接下來的旅程）' : '請按下面的「複製程式」'}</p>
    <ol class="steps">
      <li>打開 <b>Scriptable</b>，按右上角 <b>＋</b></li>
      <li>在空白處長按 → <b>貼上</b>，點最上面的標題改名為「<b>cuticuti 倒數</b>」，按 <b>Done</b></li>
      <li>回到 iPhone 桌面，長按空白處 → 左上角 <b>＋</b> → 搜尋 <b>Scriptable</b> → 選大小 → <b>加入小工具</b></li>
      <li>長按剛加入的小工具 → <b>編輯小工具</b> → Script 選「<b>cuticuti 倒數</b>」</li>
    </ol>
    <p class="hint">鎖定畫面也可以加：長按鎖定畫面 → 自訂 → 加入小工具 → Scriptable，一樣選「cuticuti 倒數」。<br>
      倒數天數每天會自動更新。<b>新增或修改旅程日期後</b>，再按一次「建立桌面倒數小工具」，貼上覆蓋 Scriptable 裡原本的程式。<br>
      程式裡只有旅程名稱和日期，不含任何登入資訊。</p>
    <button class="btn ${copied ? 'ghost' : ''}" id="widget-copy">📋 ${copied ? '再複製一次' : '複製程式'}</button>
    <details class="code"><summary>看程式內容</summary><textarea class="input" rows="8" readonly id="widget-code">${esc(code)}</textarea></details>
  </div>`, (panel) => {
    $('#widget-copy', panel).onclick = async () => {
      try { await navigator.clipboard.writeText(code); toast('已複製 ✅'); }
      catch {
        const ta = $('#widget-code', panel);
        ta.closest('details').open = true;
        ta.select();
        toast('請長按選取的文字 → 拷貝', 3500);
      }
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
  const line = (i) => `${i.time ? i.time + ' ' : ''}${(CATS[i.cat] || CATS.other).icon} ${i.title}${i.place && i.place !== i.title && !looksLikeAddress(i.place) ? `（${i.place}）` : ''}`;
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
    case 'widget': return widgetSheet();
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
    case 'grip': return; // 把手只用來拖拉，不要打開編輯
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
    case 'focus-pin': {
      e.stopPropagation();
      const card = $('.map-card');
      if (card) {
        const top = card.getBoundingClientRect().top + window.scrollY - $('.topbar').offsetHeight - 8;
        if (Math.abs(window.scrollY - top) > 4) window.scrollTo({ top, behavior: 'smooth' });
        card.classList.add('zoomed');
      }
      focusMarker(Number(el.dataset.seq) - 1);
      return;
    }
    case 'map-all':
      showAllMarkers();
      $('.map-card')?.classList.remove('zoomed');
      return;
    case 'toggle-map':
      showMap = !showMap;
      store.set('show-map', showMap ? '1' : '');
      return renderTrip();
    case 'cycle-mode': {
      // 只改目前這一天；改回跟預設一樣時就不另外記
      const keys = Object.keys(MODES);
      const next = keys[(keys.indexOf(dayMode(t, ui.day)) + 1) % keys.length];
      t.dayModes = { ...(t.dayModes || {}) };
      if (next === dayMode(t, '')) delete t.dayModes[ui.day]; else t.dayModes[ui.day] = next;
      await saveTrip(t);
      toast(`Day ${tripDays(t).indexOf(ui.day) + 1} 交通方式：${MODES[next].label}`);
      return renderTrip();
    }
    case 'suggest-order': return suggestSheet(t);
    case 'apply-order': return applySuggestion();
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

/* ============ 拖拉改變順序 ============
 * 按住卡片右邊的把手上下拖。行程依時間排列，所以放開後「時間跟著位置交換」：
 * 原本的時間點不變，依新的順序重新分配（沒有時間的行程排在最後）。 */
let drag = null;
document.addEventListener('pointerdown', (e) => {
  const grip = e.target.closest('.grip');
  if (!grip || !current) return;
  e.preventDefault();
  const li = grip.closest('.item');
  const items = [...li.parentElement.children];
  const from = items.indexOf(li);
  const rects = items.map((x) => { const r = x.getBoundingClientRect(); return { top: r.top + window.scrollY, h: r.height }; });
  const step = items.length > 1 ? rects[1].top - rects[0].top : rects[0].h + 10;
  drag = { li, items, from, to: from, startY: e.pageY, rects, step };
  li.classList.add('dragging');
  li.parentElement.classList.add('sorting');
  try { grip.setPointerCapture(e.pointerId); } catch { /* 部分瀏覽器不支援，拖拉一樣可以運作 */ }
});
document.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dy = e.pageY - drag.startY;
  drag.li.style.transform = `translateY(${dy}px)`;
  const center = drag.rects[drag.from].top + drag.rects[drag.from].h / 2 + dy;
  let to = drag.from;
  drag.rects.forEach((r, k) => {
    // 拖過相鄰卡片的四成就換位置，手感比較靈敏
    if (k < drag.from && center < r.top + r.h * 0.6) to = Math.min(to, k);
    if (k > drag.from && center > r.top + r.h * 0.4) to = Math.max(to, k);
  });
  drag.to = to;
  drag.items.forEach((x, k) => {
    if (x === drag.li) return;
    const shift = k > drag.from && k <= to ? -drag.step : k < drag.from && k >= to ? drag.step : 0;
    x.style.transform = shift ? `translateY(${shift}px)` : '';
  });
  // 拖到畫面上下邊緣時自動捲動
  if (e.clientY < 150) window.scrollBy(0, -12);
  else if (e.clientY > window.innerHeight - 90) window.scrollBy(0, 12);
});
const endDrag = async () => {
  if (!drag) return;
  const { from, to, items } = drag;
  drag = null;
  items.forEach((x) => { x.style.transform = ''; x.classList.remove('dragging'); });
  items[0]?.parentElement.classList.remove('sorting');
  if (from === to) return;
  const t = current;
  const list = dayItems(t);
  const slots = list.map((i) => i.time || ''); // 已依時間排好，沒有時間的在最後
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  list.forEach((it, k) => { it.time = slots[k]; });
  const ids = new Set(list.map((i) => i.id));
  t.items = [...t.items.filter((i) => !ids.has(i.id)), ...list]; // 同時間（或沒時間）的行程，依這個順序排
  await saveTrip(t);
  renderTrip();
};
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if ($('.viewer')) $('.viewer').remove();
    else if ($('#sheet').classList.contains('open')) closeSheet();
  }
});

window.addEventListener('hashchange', () => { ui = { tab: 'plan', day: null }; route(); });

/* ============ 登入 / 啟動 ============ */
// 雲端伺服器連不連得上（Supabase 免費專案太久沒用會被暫停，網址會直接消失）
async function cloudReachable() {
  try {
    const res = await fetch(CFG.SUPABASE_URL + '/auth/v1/health', { headers: { apikey: CFG.SUPABASE_KEY }, cache: 'no-store' });
    return res.ok;
  } catch { return false; }
}
const CLOUD_DOWN = '連不上雲端伺服器。如果有網路，可能是 Supabase 專案被暫停了，請到 Supabase 後台按「Restore project」恢復';

async function login(btn) {
  btn.disabled = true;
  if (!(await cloudReachable())) { toast(CLOUD_DOWN, 6000); btn.disabled = false; return; }
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
    toast(user.offline ? (navigator.onLine ? '連不上雲端伺服器，先顯示上次同步的資料' : '目前離線，顯示的是上次同步的資料') : '同步失敗：' + friendly(err));
  }
}

// 從背景切回來、或網路恢復時，自動同步
// 離線模式下，雲端恢復後重新取得登入狀態
async function reconnect() {
  if (!user?.offline) return;
  const { data } = await sb.auth.getSession();
  if (data.session) user = data.session.user;
}
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !user) return;
  await reconnect();
  if (user.offline || Date.now() - lastSync > 30000) scheduleSync(0);
});
window.addEventListener('online', async () => {
  await reconnect();
  if (user) scheduleSync(0);
});

window.addEventListener('hashchange', () => { ui = { tab: 'plan', day: null }; route(); });
// 自動更新：每次打開或切回 App 都檢查有沒有新版，新版裝好就自動重新載入（正在編輯時等關掉表單再載入）
let updateReady = false;
if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // 第一次安裝，不用重新載入
    if (isEditing()) updateReady = true;
    else location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => {});
}

(async () => {
  if (!configured) {
    app.innerHTML = '<div class="empty"><div class="big">🔧</div><b>還沒連上雲端資料庫</b>請在 config.js 填入 Supabase 的 Project URL 和 Publishable key</div>';
    return;
  }
  renderLoading();
  await DB.open();
  const { data, error: sessionError } = await sb.auth.getSession(); // 會順便處理 Google 登入完跳回來的網址
  const params = new URLSearchParams(location.search);
  if (params.has('code') || params.has('error')) {
    const err = params.get('error_description');
    if (err) toast('登入失敗：' + err);
    history.replaceState(null, '', location.pathname + location.hash);
  }
  user = data.session?.user ?? null;
  // 離線、或雲端伺服器暫時連不上時，登入憑證可能無法更新：先用上次同步的資料，恢復連線後再重新連線
  if (!user && store.get('cache-user') && (!navigator.onLine || sessionError?.name === 'AuthRetryableFetchError' || !(await cloudReachable()))) {
    user = { id: store.get('cache-user'), offline: true };
  }
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
