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

// 部屋の広さ(㎡)。画面に書いてあればそれを、なければ rooms.json から探す
const nf = (s) => norm(s).replace(/[(（][^)）]*階[)）]/g, '').replace(/[()（）・]/g, '');
export function areaOf(facility, room, table = {}) {
  const t = norm(room).match(/([\d.]+)m2/);
  if (t) return Number(t[1]);
  const r = nf(room).replace(/定員\d+/, '');
  const f = nf(facility);
  // 施設名がぴったり同じものを先に見る（「経堂地区会館」と「経堂地区会館別館」をまちがえないように）
  const facs = Object.entries(table).filter(([fac, rooms]) => typeof rooms === 'object' && nf(fac).startsWith(f));
  for (const list of [facs.filter(([fac]) => nf(fac) === f), facs]) {
    let best = null;
    let len = 0;
    for (const [, rooms] of list) {
      for (const [name, area] of Object.entries(rooms)) {
        const k = nf(name);
        if (r.startsWith(k) && k.length > len) { best = area; len = k.length; }
      }
    }
    if (best != null) return best;
  }
  return null;
}

export const fmtTime = (s) => norm(s).replace(/[~～〜-]/, '〜');
export const slotKey = (s) => `${s.date}|${s.facility}|${s.room}|${s.time}`;

export function buildMessage(slots) {
  const byDate = new Map();
  for (const s of slots) {
    const k = `${s.facility} ${s.room.replace(/[(（]定員\d+[)）]/, '').trim()}${s.area ? `（${Math.round(s.area)}㎡）` : ''}`;
    if (!byDate.has(s.date)) byDate.set(s.date, new Map());
    const m = byDate.get(s.date);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(s.time);
  }
  const lines = ['🎉 けやきネットに空きが出ました'];
  for (const date of [...byDate.keys()].sort()) {
    lines.push('', `📅 ${label(date)}`);
    for (const [room, times] of byDate.get(date)) lines.push(`・${room}`, `  ${joinTimes(times)}`);
  }
  lines.push('', '予約: https://setagaya.keyakinet.net/Web/Home/WgR_ModeSelect');
  return lines.join('\n');
}

// ---- 続けて使える空きをつなげる ----
// コマとコマの間が1時間以内なら、続けて使えるとみなす（例：13:00〜15:00 と 15:30〜17:30 → 13:00〜17:30）
export const JOIN_GAP = 60;
const tMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const tStr = (n) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
const spanOf = (t) => { const m = norm(t || '').match(/(\d{1,2}:\d{2})\D{1,3}(\d{1,2}:\d{2})/); return m ? [tMin(m[1]), tMin(m[2])] : null; };

// 時間の一覧を、続けて使える分ごとにまとめる（時間が読めないものはそのまま）
export function joinTimes(times) {
  const uniq = [...new Set(times)];
  const rs = uniq.map(spanOf);
  const out = [];
  for (const r of rs.filter(Boolean).sort((a, b) => a[0] - b[0])) {
    const p = out.at(-1);
    if (p && r[0] - p[1] <= JOIN_GAP) p[1] = Math.max(p[1], r[1]);
    else out.push([...r]);
  }
  return [...out.map(([a, b]) => `${tStr(a)}〜${tStr(b)}`), ...uniq.filter((_, i) => !rs[i])].join(' / ');
}

// 新しく空いたコマに、同じ部屋・同じ日でつながる今の空きを足す（open には、練習の時間の外でもつながる空きを含めて渡す）
//   （前から 13:00〜15:00 が空いていて、今回 15:30〜17:30 が空いたら、両方を送って「13:00〜17:30」と出す）
export function widen(fresh, open) {
  const key = (s) => [s.date, s.place, s.facility, s.building, s.label, s.room].join('|');
  const out = new Set(fresh);
  for (const f of fresh) {
    const same = open.filter((s) => key(s) === key(f) && spanOf(s.time)).sort((a, b) => spanOf(a.time)[0] - spanOf(b.time)[0]);
    // つながっているかたまりを作り、新しいコマが入っているかたまりを全部足す
    let chain = [];
    let end = -1;
    for (const s of same) {
      const [a, b] = spanOf(s.time);
      if (chain.length && a - end > JOIN_GAP) { if (chain.includes(f)) break; chain = []; }
      chain.push(s); end = Math.max(end, b);
    }
    if (chain.includes(f)) for (const s of chain) out.add(s);
  }
  return [...out];
}

// ダンス・よさこいの練習に明らかに使えない部屋（和室・調理室など）。どの区・市の見張りでも外す
//   練習場所シートでも、この部屋は「利用不可」にしている
export const BAD_ROOM_WORDS = ['和室', '茶室', '作法室', '調理', '料理', 'クッキング', 'キッチン', '陶芸', '木工', '視聴覚室', '図書', '託児', '児童室', '授乳', 'トレーニング', 'プール', '楽屋', 'ホワイエ', 'グラウンド', '庭球', 'テニス', '野球', '更衣', 'シャワー'];
export const badRoom = (name) => BAD_ROOM_WORDS.some((w) => norm(name).includes(norm(w)));
