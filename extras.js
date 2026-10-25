'use strict';
/* 匯率換算與天氣預報（都是免費服務，不需要金鑰）
 *   匯率：fawazahmed0/currency-api（透過 jsDelivr），連不上時改用 open.er-api.com；每天更新
 *   天氣：Open-Meteo，可以抓到今天起 16 天內的預報
 * 抓到的資料會存在手機裡，沒網路時顯示上次的結果 */

const cacheGet = (k) => { try { return JSON.parse(localStorage.getItem('cuticuti-' + k)); } catch { return null; } };
const cacheSet = (k, v) => { try { localStorage.setItem('cuticuti-' + k, JSON.stringify(v)); } catch { /* 無痕模式等 */ } };

/* ---------- 匯率 ---------- */
const HOME_CURRENCY = 'TWD';
const CURRENCY_ALIASES = {
  日圓: 'JPY', 日幣: 'JPY', 日元: 'JPY', 円: 'JPY', 韓元: 'KRW', 韓幣: 'KRW', 美金: 'USD', 美元: 'USD',
  台幣: 'TWD', 新台幣: 'TWD', 臺幣: 'TWD', 歐元: 'EUR', 泰銖: 'THB', 港幣: 'HKD', 港元: 'HKD',
  人民幣: 'CNY', 新幣: 'SGD', 新加坡幣: 'SGD', 馬幣: 'MYR', 越南盾: 'VND', 英鎊: 'GBP', 澳幣: 'AUD',
};
function currencyCode(s) {
  const t = String(s || '').trim();
  if (CURRENCY_ALIASES[t]) return CURRENCY_ALIASES[t];
  return /^[a-z]{3}$/i.test(t) ? t.toUpperCase() : null;
}

const rates = {}; // 'JPY' -> { rate, date }（1 單位換多少台幣）
let rateLoading = {};
// 回傳 true 代表這次拿到新的匯率（畫面要重畫）
async function ensureRate(code) {
  if (!code || code === HOME_CURRENCY) return false;
  const cached = rates[code] || cacheGet('rate-' + code);
  if (cached) rates[code] = cached;
  if (cached && Date.now() - cached.fetchedAt < 12 * 3600e3) return false;
  if (rateLoading[code]) return false;
  rateLoading[code] = true;
  try {
    const c = code.toLowerCase();
    let rate = null;
    let date = '';
    try {
      const j = await (await fetch(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${c}.json`)).json();
      rate = j[c]?.[HOME_CURRENCY.toLowerCase()];
      date = j.date;
    } catch {
      const j = await (await fetch(`https://open.er-api.com/v6/latest/${code}`)).json();
      rate = j.rates?.[HOME_CURRENCY];
      date = new Date(j.time_last_update_unix * 1000).toISOString().slice(0, 10);
    }
    if (!rate) return false;
    rates[code] = { rate, date, fetchedAt: Date.now() };
    cacheSet('rate-' + code, rates[code]);
    return !cached || cached.rate !== rate;
  } catch {
    return false; // 沒網路：用上次的匯率
  } finally {
    delete rateLoading[code];
  }
}
// 換算成台幣的文字，例如「≈ NT$245」；不知道匯率或本來就是台幣時回傳空字串
function toHome(amount, currency) {
  const code = currencyCode(currency);
  const r = code && rates[code];
  if (!r || !amount) return '';
  return `≈ NT$${Math.round(amount * r.rate).toLocaleString('zh-TW')}`;
}

/* ---------- 天氣 ---------- */
const WMO = [
  [[0], '☀️', '晴'], [[1], '🌤️', '大致晴'], [[2], '⛅', '多雲'], [[3], '☁️', '陰'], [[45, 48], '🌫️', '霧'],
  [[51, 53, 55, 56, 57], '🌦️', '毛毛雨'], [[61, 80], '🌦️', '小雨'], [[63, 81], '🌧️', '雨'], [[65, 66, 67, 82], '🌧️', '大雨'],
  [[71, 73, 75, 77, 85, 86], '🌨️', '雪'], [[95, 96, 99], '⛈️', '雷雨'],
];
const weatherInfo = (code) => { const w = WMO.find(([codes]) => codes.includes(code)); return w ? { icon: w[1], label: w[2] } : { icon: '🌡️', label: '' }; };

const forecasts = {}; // 'lat,lon' -> { fetchedAt, days: { '2026-11-20': { code, max, min, rain } } }
let weatherLoading = {};
const placeKey = (p) => `${p.lat.toFixed(1)},${p.lon.toFixed(1)}`; // 約 10 公里內共用同一份預報

async function fetchForecast(p) {
  const key = placeKey(p);
  const cached = forecasts[key] || cacheGet('wx-' + key);
  if (cached) forecasts[key] = cached;
  if (cached && Date.now() - cached.fetchedAt < 3 * 3600e3) return false;
  if (weatherLoading[key]) return false;
  weatherLoading[key] = true;
  try {
    const q = new URLSearchParams({
      latitude: p.lat.toFixed(3), longitude: p.lon.toFixed(3), timezone: 'auto', forecast_days: '16',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    });
    const j = await (await fetch('https://api.open-meteo.com/v1/forecast?' + q)).json();
    const days = {};
    j.daily.time.forEach((d, k) => {
      days[d] = { code: j.daily.weather_code[k], max: j.daily.temperature_2m_max[k], min: j.daily.temperature_2m_min[k], rain: j.daily.precipitation_probability_max[k] };
    });
    forecasts[key] = { fetchedAt: Date.now(), days };
    cacheSet('wx-' + key, forecasts[key]);
    return true;
  } catch {
    return false;
  } finally {
    delete weatherLoading[key];
  }
}

// 某一天的天氣要看哪裡：那天已定位行程的中心 → 整趟旅程的中心 → 目的地
function weatherPlace(t, day) {
  const pts = t.items.filter((i) => i.date === day && i.geo).map((i) => i.geo);
  if (pts.length) return { lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length, lon: pts.reduce((a, p) => a + p.lon, 0) / pts.length };
  return nearPoint(t);
}
function dayWeather(t, day) {
  const p = weatherPlace(t, day);
  const d = p && forecasts[placeKey(p)]?.days[day];
  return d ? { ...d, ...weatherInfo(d.code) } : null;
}
// 抓這趟旅程 16 天內每一天的天氣；回傳 true 代表有新資料
async function ensureWeather(t) {
  const today = todayISO();
  const last = new Date();
  last.setDate(last.getDate() + 15);
  const days = tripDays(t).filter((d) => d >= today && d <= iso(last));
  if (!days.length) return false;
  if (!nearPoint(t) && t.dest && !t.destGeo) {
    try {
      const r = await searchPlaces(t.dest);
      if (r[0]) { t.destGeo = { lat: r[0].lat, lon: r[0].lon }; saveTrip(t); }
    } catch { return false; }
  }
  const places = new Map();
  days.forEach((d) => { const p = weatherPlace(t, d); if (p) places.set(placeKey(p), p); });
  const results = await Promise.all([...places.values()].map(fetchForecast));
  return results.some(Boolean);
}
