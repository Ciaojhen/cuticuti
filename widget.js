'use strict';
/* iPhone 桌面倒數小工具（透過免費的 Scriptable App）
 * PWA 不能直接做 iOS 桌面小工具，所以產生一段 Scriptable 腳本，讓使用者貼到 Scriptable 裡。
 * 腳本裡只有旅程名稱、表情符號、日期和顏色，不含任何登入資訊。 */

// 這個函式不會在 CutiCuti 裡執行，而是被轉成文字、貼到 Scriptable 裡跑
// （ListWidget、Color、Font、config、Script 都是 Scriptable 提供的）
function scriptableWidget() {
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = (a, b) => Math.round((b - a) / 86400000);
  const md = (s) => { const d = parse(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const status = (t) => {
    const n = days(today, parse(t.start));
    if (n > 0) return { big: String(n), unit: '天後出發', short: `${n} 天` };
    if (n === 0) return { big: '今天', unit: '出發！', short: '今天出發' };
    const k = days(parse(t.start), today) + 1;
    return { big: `第 ${k} 天`, unit: '旅行中', short: `旅行中・第 ${k} 天` };
  };
  const trips = TRIPS.filter((t) => days(today, parse(t.end)) >= 0).sort((a, b) => a.start.localeCompare(b.start));
  const family = config.widgetFamily || 'small';
  const text = Color.dynamic(new Color('#1f2328'), new Color('#eceff1'));
  const muted = Color.dynamic(new Color('#6b7280'), new Color('#9aa3ab'));

  const w = new ListWidget();
  w.url = APP_URL;
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  w.refreshAfterDate = tomorrow; // 過了午夜就更新倒數

  if (family.startsWith('accessory')) {
    // 鎖定畫面小工具
    const t = trips[0];
    if (family === 'accessoryCircular') {
      const s = t ? status(t) : null;
      const a = w.addText(t ? (t.emoji || '✈️') : '✈️');
      a.centerAlignText();
      const b = w.addText(s ? (days(today, parse(t.start)) > 0 ? s.big : '🎉') : '—');
      b.font = Font.boldRoundedSystemFont(18);
      b.centerAlignText();
    } else if (family === 'accessoryInline') {
      w.addText(t ? `${t.emoji || '✈️'} ${t.name}・${status(t).short}` : '沒有接下來的旅程');
    } else {
      const a = w.addText(t ? `${t.emoji || '✈️'} ${t.name}` : 'cuticuti');
      a.font = Font.boldSystemFont(14);
      a.lineLimit = 1;
      const b = w.addText(t ? status(t).short : '沒有接下來的旅程');
      b.font = Font.boldRoundedSystemFont(20);
      if (t) w.addText(`${md(t.start)} – ${md(t.end)}`).font = Font.systemFont(12);
    }
  } else {
    // 桌面小工具
    w.backgroundColor = Color.dynamic(new Color('#f7f4ef'), new Color('#1b1e21'));
    w.setPadding(14, 14, 14, 14);
    const head = w.addText('cuticuti');
    head.font = Font.boldRoundedSystemFont(11);
    head.textColor = muted;
    w.addSpacer(6);
    const t = trips[0];
    if (!t) {
      const e = w.addText('還沒有接下來的旅程');
      e.font = Font.semiboldSystemFont(14);
      e.textColor = text;
      w.addSpacer();
    } else {
      const s = status(t);
      const name = w.addText(`${t.emoji || '✈️'} ${t.name}`);
      name.font = Font.boldSystemFont(family === 'small' ? 14 : 16);
      name.textColor = text;
      name.lineLimit = 2;
      w.addSpacer();
      const row = w.addStack();
      row.bottomAlignContent();
      const big = row.addText(s.big);
      big.font = Font.heavyRoundedSystemFont(s.big.length > 3 ? 26 : 40);
      big.textColor = new Color(t.color || '#ff6b4a');
      row.addSpacer(4);
      const unit = row.addText(s.unit);
      unit.font = Font.semiboldSystemFont(12);
      unit.textColor = muted;
      const date = w.addText(`${md(t.start)} – ${md(t.end)}`);
      date.font = Font.systemFont(11);
      date.textColor = muted;
      // 中、大尺寸：列出後面幾趟
      const more = trips.slice(1, family === 'large' ? 6 : 3);
      if (family !== 'small' && more.length) {
        w.addSpacer(8);
        for (const m of more) {
          const line = w.addText(`${m.emoji || '✈️'} ${m.name}・${status(m).short}`);
          line.font = Font.systemFont(12);
          line.textColor = muted;
          line.lineLimit = 1;
        }
      }
    }
  }

  if (config.runsInWidget) Script.setWidget(w);
  else w.presentSmall();
  Script.complete();
}

// 產生要貼到 Scriptable 的完整腳本
function widgetScript(tripList, appURL) {
  const data = tripList
    .filter((t) => t.start)
    .map((t) => ({ name: t.name, emoji: t.emoji || '', start: t.start, end: t.end || t.start, color: t.color || '#ff6b4a' }));
  return [
    '// cuticuti 旅程倒數小工具',
    `// 由 cuticuti 產生於 ${todayISO()}。旅程有變動時，到 cuticuti「設定」重新產生，貼上覆蓋這段程式即可。`,
    `const TRIPS = ${JSON.stringify(data, null, 2)};`,
    `const APP_URL = ${JSON.stringify(appURL)};`,
    '',
    `(${scriptableWidget.toString()})();`,
    '',
  ].join('\n');
}
