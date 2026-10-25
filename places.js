'use strict';
/* 地點、營業時間與排序建議
 * 全部使用 OpenStreetMap 的免費服務，不需要 API 金鑰：
 *   搜尋地點：Nominatim（使用規範：每秒最多 1 次、不能邊打字邊搜尋）
 *   移動時間：routing.openstreetmap.de（OSRM，步行／開車），用來計算建議順序 */

const MODES = {
  walk:    { label: '步行', icon: '🚶', profile: 'routed-foot' },
  transit: { label: '大眾運輸（估算）', icon: '🚃', profile: null }, // OpenStreetMap 沒有電車時刻，用距離估算
  drive:   { label: '開車', icon: '🚗', profile: 'routed-car' },
};
// 沒有填停留時間時，依類別預設（分鐘）
const STAY_DEFAULT = { sight: 90, food: 60, transport: 0, stay: 0, shop: 60, other: 60 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const fmtMin = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
const fmtShort = (m) => fmtMin(m).replace(/^0(\d)/, '$1'); // 營業時間顯示用：9:00 而不是 09:00
const fmtDuration = (m) => (m < 60 ? `${Math.round(m)} 分` : `${Math.floor(m / 60)} 小時${Math.round(m % 60) ? ` ${Math.round(m % 60)} 分` : ''}`);
const stayOf = (i) => (i.stay !== '' && i.stay != null ? Number(i.stay) : STAY_DEFAULT[i.cat] ?? 60);

/* ---------- 搜尋地點 ---------- */
let lastSearch = 0;
async function nominatim(params) {
  const wait = 1100 - (Date.now() - lastSearch);
  if (wait > 0) await sleep(wait);
  lastSearch = Date.now();
  const p = new URLSearchParams({ format: 'jsonv2', 'accept-language': 'zh-Hant,zh-TW', ...params });
  const res = await fetch('https://nominatim.openstreetmap.org/search?' + p);
  if (!res.ok) throw new Error(`搜尋失敗（${res.status}）`);
  return res.json();
}

async function searchPlaces(q, near) {
  // 有旅程地點時，優先找附近的結果（不是硬性限制）
  const viewbox = near ? { viewbox: [near.lon - 0.6, near.lat + 0.6, near.lon + 0.6, near.lat - 0.6].join(',') } : {};
  const results = await nominatim({ q, limit: '6', extratags: '1', namedetails: '1', ...viewbox });
  const seen = new Set();
  return results.filter((r) => {
    const key = `${r.name}|${r.display_name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((r) => {
    const parts = r.display_name.split(',').map((s) => s.trim());
    const nd = r.namedetails || {};
    return {
      // 地名：繁體中文 → 當地原名（不用 name:zh，因為常常是簡體字）
      name: nd['name:zh-Hant'] || nd['name:zh-TW'] || nd.name || r.name || parts[0],
      address: parts.slice(1, 5).join(', '),
      lat: Number(r.lat),
      lon: Number(r.lon),
      hours: r.extratags?.opening_hours || '',
    };
  });
}

/* ---------- 用地址定位 ----------
 * OpenStreetMap 找不到日本、台灣的完整門牌，所以把 Google 地圖複製來的地址逐步縮短
 * （去掉郵遞區號、大樓名稱、門牌），找到「町、丁目、路」這一層，誤差大約幾百公尺 */
const PREFECTURE = /^(東京都|北海道|京都府|大阪府|[^\s、,]{2,3}県)/;
const looksLikeAddress = (s) => {
  const t = s.normalize('NFKC').replace(/^(日本|台灣|臺灣)[、,\s]*/, '').replace(/〒?\s*\d{3}-?\d{4}\s*/, '');
  return /〒|\d+丁目|\d+[-－]\d+|\d+[號号]/.test(s) // 郵遞區號、丁目、門牌
    || /(東京都|北海道|京都府|大阪府|[^\s、,]{2,3}県).*[市区町村郡]/.test(t) // 日本：都道府縣＋市區町村
    || /^[^\s]{1,4}市.{1,6}[区區]/.test(t) // ○○市○○区
    || /[市縣].{1,4}[區鄉鎮].*[路街段道]/.test(t); // 台灣：市＋區＋路
};

function addressCandidates(raw) {
  const s = raw.normalize('NFKC')
    .replace(/^(日本|台灣|臺灣|Japan|Taiwan)[、,\s]*/i, '')
    .replace(/〒?\s*\d{3}-?\d{4}\s*/, '') // 日本郵遞區號
    .replace(/^\d{3,6}\s*/, '') // 台灣郵遞區號
    .replace(/\s+.*$/, '') // 空白後面通常是大樓名稱
    .trim();
  const out = [];
  const add = (x) => { x = x.trim(); if (x.length >= 3 && !out.includes(x)) out.push(x); };
  add(s);
  add(s.replace(/(\d+丁目).*$/, '$1')); // 保留到「丁目」
  add(s.replace(/[\d\-－−ー番地號号之樓F]+$/, '')); // 去掉門牌
  add(s.replace(/\d.*$/, '')); // 從第一個數字開始都去掉
  add(s.replace(/\d.*$/, '').replace(/[^区區]*?通.*?[上下東西]る/, '')); // 京都的「○○通○○上る」
  add(s.replace(PREFECTURE, '').replace(/\d.*$/, '').replace(/[^区區]*?通.*?[上下東西]る/, '')); // 去掉都道府縣
  add(s.replace(/(段|路|街).*$/, '$1')); // 台灣：保留到路／街／段
  return out;
}

// 回傳 { lat, lon, matched }（matched 是實際找到的那一段地址），找不到回傳 null
async function geocodeAddress(raw) {
  for (const q of addressCandidates(raw)) {
    const r = await nominatim({ q, limit: '1' });
    if (r[0]) return { lat: Number(r[0].lat), lon: Number(r[0].lon), matched: q };
  }
  return null;
}

/* ---------- 營業時間（OpenStreetMap opening_hours 常見寫法） ----------
 * 支援：24/7、Mo-Fr 09:00-18:00; Sa,Su 10:00-17:00、Tu-Su 11:00-14:00,17:00-22:00; Mo off、18:00-02:00（跨夜）、10:00+
 * 遇到不支援的寫法（月份、週次、日出日落等）回傳 null，畫面上會顯示原文 */
const OSM_DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
function expandDays(spec) {
  const out = new Set();
  for (const tok of spec.split(',').map((s) => s.trim())) {
    if (tok === 'PH' || tok === 'SH') continue; // 國定假日、學校假期：略過
    const [a, b] = tok.split('-').map((s) => OSM_DAYS.indexOf(s.trim()));
    if (a < 0 || (tok.includes('-') && b < 0)) return null;
    if (!tok.includes('-')) { out.add(a); continue; }
    for (let d = a; ; d = (d + 1) % 7) { out.add(d); if (d === b) break; }
  }
  return [...out];
}
function parseHours(raw) {
  if (!raw) return null;
  const s = raw.replace(/"[^"]*"/g, '').trim();
  if (s === '24/7') return Array.from({ length: 7 }, () => [[0, 1440]]);
  const week = Array(7).fill(null);
  for (let rule of s.split(/;|\|\|/)) {
    rule = rule.trim();
    if (!rule) continue;
    let days = [0, 1, 2, 3, 4, 5, 6];
    const dm = rule.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:\s*,\s*(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)\b\s*(.*)$/);
    if (dm) {
      days = expandDays(dm[1].replace(/\s/g, ''));
      if (!days) return null;
      if (!days.length) continue; // 只寫假日的規則
      rule = dm[2].trim();
    }
    if (/^(off|closed)$/i.test(rule)) { days.forEach((d) => { week[d] = []; }); continue; }
    const ranges = [];
    for (const part of rule.split(',').map((x) => x.trim())) {
      let m = part.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\+?$/);
      if (m) {
        const o = +m[1] * 60 + +m[2];
        let c = +m[3] * 60 + +m[4];
        if (c <= o) c += 1440; // 跨夜
        ranges.push([o, c]);
        continue;
      }
      m = part.match(/^(\d{1,2}):(\d{2})\+$/); // 只寫開門時間
      if (m) { ranges.push([+m[1] * 60 + +m[2], 1440]); continue; }
      return null;
    }
    if (!ranges.length) return null;
    days.forEach((d) => { week[d] = ranges; });
  }
  // 有寫到的規則以外的日子視為公休
  return week.some((x) => x) ? week.map((x) => x || []) : null;
}

// 一個行程一週七天的營業時間：week[星期] = [[開, 關], ...]（分鐘），[] = 公休，null = 不知道
// 自己填的（開門／關門、公休日）優先，沒填的部分用 OpenStreetMap 的資料
function weekOf(item) {
  const osm = parseHours(item.osmHours);
  const closed = item.closedDays || [];
  let manual = null;
  if (item.open && item.close) {
    const o = toMin(item.open);
    let c = toMin(item.close);
    if (c <= o) c += 1440;
    manual = [[o, c]];
  }
  if (!manual && !closed.length) return osm;
  return [0, 1, 2, 3, 4, 5, 6].map((d) => (closed.includes(d) ? [] : manual || (osm ? osm[d] : null)));
}

// 某個行程在某天的營業時間；沒有日期（口袋名單）時，只有每天都一樣才回傳
function hoursFor(item, date) {
  const week = weekOf(item);
  if (!week) return null;
  if (!date) {
    const same = week.every((d) => JSON.stringify(d) === JSON.stringify(week[0]));
    return same ? week[0] : null;
  }
  return week[parseDate(date).getDay()];
}
const fmtRanges = (ranges) => (!ranges ? '時間未填' : ranges.length ? ranges.map(([o, c]) => `${fmtShort(o)}–${c === 1440 ? '24:00' : fmtShort(c)}`).join('、') : '公休');

// 行程卡片上要顯示的營業時間文字與提醒
function hoursBadge(item) {
  const h = hoursFor(item, item.date);
  if (h === null) {
    const week = weekOf(item);
    if (week && !item.date) return { text: describeWeek(week), bad: false }; // 口袋名單：顯示整週
    if (week) return null; // 這天有開但沒填時間
    return item.osmHours ? { text: item.osmHours, bad: false } : null;
  }
  if (!h.length) return { text: '公休', bad: true };
  const t = item.time ? toMin(item.time) : null;
  if (t !== null && !h.some(([o, c]) => t >= o && t < c)) return { text: `${fmtRanges(h)}・未營業`, bad: true };
  return { text: fmtRanges(h), bad: false };
}

/* ---------- 距離與移動時間 ---------- */
function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
// 大眾運輸估算：1 公里內走路，其餘以平均 22 km/h 加上候車轉乘 10 分鐘
function estimateMinutes(km, mode) {
  if (mode === 'walk') return (km * 1.3) / 4.5 * 60;
  if (mode === 'drive') return 5 + (km * 1.3) / 30 * 60;
  return km < 1 ? (km * 1.3) / 4.5 * 60 : 10 + (km * 1.3) / 22 * 60;
}
const coordStr = (pts) => pts.map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
const routeCache = new Map();

// 兩兩之間的移動時間（分鐘）矩陣
async function travelMatrix(pts, mode) {
  const est = () => pts.map((a) => pts.map((b) => (a === b ? 0 : estimateMinutes(haversineKm(a, b), mode))));
  const profile = MODES[mode]?.profile;
  if (!profile || pts.length < 2 || pts.length > 25) return est();
  const key = `table|${profile}|${coordStr(pts)}`;
  if (routeCache.has(key)) return routeCache.get(key);
  try {
    const res = await fetch(`https://routing.openstreetmap.de/${profile}/table/v1/driving/${coordStr(pts)}?annotations=duration`);
    const data = await res.json();
    if (data.code !== 'Ok') throw new Error(data.code);
    const m = data.durations.map((row, i) => row.map((s, j) => (s == null ? est()[i][j] : s / 60)));
    routeCache.set(key, m);
    return m;
  } catch {
    return est(); // 路線服務連不上時，用直線距離估算
  }
}

/* ---------- 排序建議 ----------
 * 依序模擬一天：移動 → 太早到就等開門 → 停留 → 下一站
 * 分數 = 移動時間 + 等待時間的一半 + 抵達時沒開／停留中關門的懲罰，分數越低越好 */
function simulate(order, items, matrix, startMin, date) {
  let t = startMin;
  let travel = 0;
  let wait = 0;
  let penalty = 0;
  const stops = order.map((idx, k) => {
    const it = items[idx];
    if (k > 0) {
      const m = matrix[order[k - 1]][idx];
      travel += m;
      t += m;
    }
    const h = hoursFor(it, date);
    let warn = '';
    if (h) {
      if (!h.length) { penalty += 1000; warn = '這天公休'; }
      else {
        const slot = h.find(([, c]) => t < c);
        if (!slot) { penalty += 500; warn = '抵達時已打烊'; }
        else {
          if (t < slot[0]) { wait += slot[0] - t; t = slot[0]; }
          if (t + stayOf(it) > slot[1]) { penalty += 100 + (t + stayOf(it) - slot[1]); warn = `${fmtMin(slot[1])} 就關門，待不滿 ${stayOf(it)} 分`; }
        }
      }
    }
    const arrive = t;
    t += stayOf(it);
    return { item: it, arrive, warn };
  });
  return { order, stops, travel, wait, cost: travel + wait / 2 + penalty, end: t };
}

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]));
}

// items：要排序的行程（都有座標）；第一個若是住宿就固定當起點
function suggestOrder(items, matrix, startMin, date, fixFirst) {
  const n = items.length;
  const rest = [...Array(n).keys()].filter((i) => !(fixFirst && i === 0));
  const head = fixFirst ? [0] : [];
  const run = (order) => simulate(order, items, matrix, startMin, date);
  let best;
  if (rest.length <= 7) {
    for (const p of permutations(rest)) {
      const r = run([...head, ...p]);
      if (!best || r.cost < best.cost) best = r;
    }
    return best;
  }
  // 地點太多時：最近鄰居法 + 2-opt 改善
  const order = [...head];
  const left = new Set(rest);
  if (!order.length) { order.push(rest[0]); left.delete(rest[0]); }
  while (left.size) {
    const last = order[order.length - 1];
    let next = null;
    for (const j of left) if (next === null || matrix[last][j] < matrix[last][next]) next = j;
    order.push(next);
    left.delete(next);
  }
  best = run(order);
  for (let improved = true; improved;) {
    improved = false;
    for (let i = head.length; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        const cand = [...best.order.slice(0, i), ...best.order.slice(i, k + 1).reverse(), ...best.order.slice(k + 1)];
        const r = run(cand);
        if (r.cost < best.cost - 0.01) { best = r; improved = true; }
      }
    }
  }
  return best;
}

// 把營業時間整理成好讀的文字，例如「週一至週五 09:00–18:00；週六、週日 10:00–17:00」
function describeHours(raw) {
  const week = parseHours(raw);
  return week ? describeWeek(week) : raw;
}
function describeWeek(week) {
  // 精簡寫法：「10:00–18:00・週五休」；每天時間不同時「一至五 9:00–18:00／六日 10:00–17:00」
  const order = [1, 2, 3, 4, 5, 6, 0];
  const closed = order.filter((d) => week[d] && !week[d].length);
  const groups = [];
  for (const d of order) {
    if (!week[d] || !week[d].length) continue;
    const txt = fmtRanges(week[d]);
    const g = groups[groups.length - 1];
    if (g && g.txt === txt && g.last === order.indexOf(d) - 1) { g.days.push(d); g.last++; } else groups.push({ txt, days: [d], last: order.indexOf(d) });
  }
  const label = (days) => (days.length >= 3 ? `${WEEK[days[0]]}至${WEEK[days[days.length - 1]]}` : days.map((d) => WEEK[d]).join(''));
  const sameTime = new Set(groups.map((g) => g.txt)).size <= 1;
  const open = sameTime ? (groups[0]?.txt || '') : groups.map((g) => `${label(g.days)} ${g.txt}`).join('／');
  const off = closed.length ? `週${closed.map((d) => WEEK[d]).join('、')}休` : '';
  return [open, off].filter(Boolean).join('・') || '時間未填';
}
