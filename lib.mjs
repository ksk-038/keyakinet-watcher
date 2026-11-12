// ブラウザを使わない計算まわり（日付・部屋の条件・記号の判定・通知文）
export const norm = (s) => (s || '').normalize('NFKC').replace(/\s+/g, '');
const WD = ['日', '月', '火', '水', '木', '金', '土'];

export const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const parts = (s) => s.split('-').map(Number);

export function jstToday(now = Date.now()) {
  const t = new Date(now + 9 * 3600e3);
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
export function jstHour(now = Date.now()) {
  return new Date(now + 9 * 3600e3).getUTCHours();
}
export function addDays(s, n) {
  const [y, m, d] = parts(s);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
export function weekday(s) {
  const [y, m, d] = parts(s);
  return WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
export function label(s) {
  const [, m, d] = parts(s);
  return `${m}/${d}(${weekday(s)})`;
}

// 見張る日付の一覧（明日以降。当日予約は電話・窓口のみなので除外）
export function targetDates(watch, today) {
  const set = new Set();
  let end;
  if (watch.monthsAhead != null) {
    // 例: 11/12 に monthsAhead=2 → 1/31 まで（2ヶ月後の月末）
    const [y, m] = parts(today);
    const t = new Date(Date.UTC(y, m + watch.monthsAhead, 0));
    end = ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  } else {
    end = addDays(today, (watch.weeksAhead ?? 8) * 7);
  }
  for (let d = addDays(today, 1); d <= end; d = addDays(d, 1)) {
    if ((watch.weekdays || []).includes(weekday(d))) set.add(d);
  }
  for (const d of watch.dates || []) if (d > today) set.add(d);
  for (const d of watch.excludeDates || []) set.delete(d);
  return [...set].sort();
}

// 「1ヶ月」表示1回で見られる範囲ごとに、表示開始日をまとめる
export function windows(dates, span = 28) {
  const out = [];
  for (const d of dates) if (!out.length || d >= addDays(out.at(-1), span)) out.push(d);
  return out;
}

// 部屋の条件: 定員100以上 or 150㎡以上 or どちらも書いていない
export function roomOk(roomText, f) {
  const t = norm(roomText);
  const cap = t.match(/定員(\d+)/);
  const area = t.match(/([\d.]+)(?:m2|平方メートル|平米)/); // ㎡ は NFKC で m2 になる
  if (!cap && !area) return f.includeUnlabeled !== false;
  if (cap && Number(cap[1]) >= f.minCapacity) return true;
  if (area && Number(area[1]) >= f.minArea) return true;
  return false;
}

export function markOf(raw) {
  const t = norm(raw);
  if (/[○◯〇]/.test(t)) return '○';
  if (t.includes('△')) return '△';
  return t || '?';
}

// 施設別空き状況の表: 「2026年11月」と日にちの並びから日付を出す（月またぎ対応）
export function datesFromDays(monthLabel, days, fallbackStart) {
  let y, m;
  const ml = norm(monthLabel).match(/(\d{4})年(\d{1,2})月/);
  if (ml) [y, m] = [Number(ml[1]), Number(ml[2])];
  else [y, m] = parts(fallbackStart);
  let prev = 0;
  return days.map((d) => {
    if (d < prev) { m++; if (m > 12) { m = 1; y++; } }
    prev = d;
    return ymd(y, m, d);
  });
}

export function parseJpDate(s) {
  const m = norm(s).match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  return m ? ymd(+m[1], +m[2], +m[3]) : null;
}

export const fmtTime = (s) => norm(s).replace(/[~～〜-]/, '〜');
export const slotKey = (s) => `${s.date}|${s.facility}|${s.room}|${s.time}`;

export function buildMessage(slots) {
  const byDate = new Map();
  for (const s of slots) {
    const k = `${s.facility} ${s.room}`;
    if (!byDate.has(s.date)) byDate.set(s.date, new Map());
    const m = byDate.get(s.date);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(s.time);
  }
  const lines = ['🎉 けやきネットに空きが出ました'];
  for (const date of [...byDate.keys()].sort()) {
    lines.push('', `📅 ${label(date)}`);
    for (const [room, times] of byDate.get(date)) lines.push(`・${room}`, `  ${times.join(' / ')}`);
  }
  lines.push('', '予約: https://setagaya.keyakinet.net/Web/Home/WgR_ModeSelect');
  return lines.join('\n');
}
