// YANAGIBA（チームのアプリ）とのやりとり
//   ・アプリの「まだ施設が取れていない日」（東京の練習）を読む
//   ・その日の練習の時間に空いている部屋を、アプリに送る（アプリの画面に出て、スタッフにお知らせが届く）
// 合言葉（GitHub の Secrets「YANAGIBA_SECRET」）がないときは何もしない
import holidayJp from '@holiday-jp/holiday_jp';
import * as L from './lib.mjs';

const URL = 'https://jskulzunyckseeokgzax.supabase.co';
// アプリにも入っている公開用の鍵（これだけでは何も読み書きできない。合言葉とセットで使う）
const KEY = 'sb_publishable_ntwO028pVspqA_RiGkYhXg_8Y4d0D9U';
const SECRET = process.env.YANAGIBA_SECRET;

async function rpc(fn, body) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_secret: SECRET, ...body }),
  });
  if (!r.ok) throw new Error(`YANAGIBA ${fn} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// 土日祝か
export const isRestDay = (d) => ['土', '日'].includes(L.weekday(d)) || Boolean(holidayJp.holidays[d]);

// まだ取れていない日に見る部屋の広さ: 土日祝は150㎡以上、平日は100㎡以上（広さ不明の部屋は各区のいつもの条件で）
export const bigEnough = (area, date) => area != null && area >= (isRestDay(date) ? 150 : 100);

// アプリの「まだ施設が取れていない日」を読む。watch は各区の config.watch（何ヶ月先まで見るか）
//   → { teams, gaps: [{ team, date, time, title }], dates: Set, rules }。読めなかったら gaps は null
export async function load(watch, today) {
  const empty = { teams: [], gaps: null, dates: new Set(), rules: [] };
  if (!SECRET) return empty;
  try {
    const [y, m] = today.split('-').map(Number);
    const t = new Date(Date.UTC(y, m + (watch.monthsAhead ?? 2), 0));
    const end = L.ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
    const list = await rpc('facility_watch_gaps', {});
    const gaps = list.flatMap((x) =>
      (x.gaps || [])
        .filter((g) => !g.outdoor && g.date > today && g.date <= end && (!g.base || /東京/.test(g.base)))
        .map((g) => ({ team: x.team_id, date: g.date, time: g.time || null, title: g.title || g.label || '練習' })),
    );
    const dates = new Set(gaps.map((g) => g.date));
    console.log(`YANAGIBAのまだ取れていない日: ${[...dates].sort().map(L.label).join(' ') || 'なし'}`);
    const rules = list.flatMap((x) => (x.rules || []).map((r) => ({ ...r, team: x.team_id })));
    return { teams: list.map((x) => x.team_id), gaps, dates, rules };
  } catch (e) {
    console.warn(`⚠ YANAGIBAのまだ取れていない日を読めません: ${e.message}`);
    return empty;
  }
}

// アプリの「区・施設の予約のきまり」の施設の書き方から、その部屋が当てはまるか（アプリの側と同じ考え方）
const nf = (x) => (x || '').normalize('NFKC').replace(/\s+/g, '');
function ruleHits(r, ward, place) {
  if (nf(r.ward) !== nf(ward)) return false;
  const p = nf(place);
  return (r.facility || '').split(/[\n、,，]/).map(nf).filter(Boolean).some((n) => {
    if (/以外|じゃない|他の/.test(n)) return false;
    if (/全施設|全部/.test(n)) return true;
    if (/体育/.test(n)) return /体育館|スポーツ|武道場|競技場|体育/.test(p);
    const core = n.replace(/(系|など|等|\d+か所)$/, '');
    return core.length >= 2 && p.includes(core);
  });
}
// 休日用の施設は平日に、平日用の施設は土日祝に使わない
export function hidden(G, team, ward, place, date) {
  const rest = isRestDay(date);
  return (G.rules || []).some((r) => r.team === team && ((r.days === 'rest' && !rest) || (r.days === 'weekday' && rest)) && ruleHits(r, ward, place));
}

const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = (n) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
// 「18:00〜21:30」「19:30-21:30」→ [分, 分]
const range = (s) => {
  const m = (s || '').normalize('NFKC').match(/(\d{1,2}:\d{2})\D{1,3}(\d{1,2}:\d{2})/);
  return m ? [toMin(m[1]), toMin(m[2])] : null;
};

// 空き（{ date, place, time, area, cap }）と、まだ取れていない日（の練習の時間）を突き合わせる
//   続きのコマはつなげて考える。練習の時間をまるごと含めば「全部」、一部だけ重なれば「一部」
export function match(slots, G, ward) {
  const rows = [];
  if (!G.gaps?.length) return rows;
  const groups = new Map();
  for (const s of slots) {
    if (!G.dates.has(s.date)) continue;
    const k = `${s.date}|${s.place}`;
    if (!groups.has(k)) groups.set(k, { ...s, times: [] });
    groups.get(k).times.push(s.time);
  }
  for (const g of G.gaps) {
    const gr = range(g.time);
    for (const p of groups.values()) {
      if (p.date !== g.date || hidden(G, g.team, ward, p.place, p.date)) continue;
      const rs = p.times.map(range).filter(Boolean).sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const r of rs) {
        const last = merged.at(-1);
        if (last && r[0] - last[1] <= 15) last[1] = Math.max(last[1], r[1]);
        else merged.push([...r]);
      }
      let full = false;
      let time;
      if (!gr) {
        full = true;
        time = merged.length ? merged.map(([a, b]) => `${fromMin(a)}〜${fromMin(b)}`).join(' / ') : [...new Set(p.times)].join(' / ');
      } else {
        const cover = merged.find(([a, b]) => a <= gr[0] && b >= gr[1]);
        const over = merged.filter(([a, b]) => a < gr[1] && b > gr[0]);
        if (cover) { full = true; time = `${fromMin(cover[0])}〜${fromMin(cover[1])}`; }
        else if (over.length) time = over.map(([a, b]) => `${fromMin(a)}〜${fromMin(b)}`).join(' / ');
        else if (!rs.length) time = [...new Set(p.times)].join(' / '); // 時間が読めないコマ
        else continue;
      }
      rows.push({
        team: g.team, date: g.date, place: p.place, area: p.area ?? null, cap: p.cap ?? null, time,
        gap_time: g.time, gap_title: g.title, partial: !full,
      });
    }
  }
  return rows;
}

// そのコマが、まだ取れていない日の練習の時間に重なるか（LINEにも送るため）
//   ward と s.place があれば、休日用・平日用のきまりで外れる部屋は除く
export function hitsGap(s, G, ward) {
  return (G.gaps || []).some((g) => {
    if (g.date !== s.date) return false;
    if (ward && s.place && hidden(G, g.team, ward, s.place, s.date)) return false;
    const gr = range(g.time);
    const sr = range(s.time);
    return !gr || !sr || (sr[0] < gr[1] && sr[1] > gr[0]);
  });
}

// アプリに送る（その区の分をまるごと。なくなった空きはアプリ側で消える）
export async function report(G, { site, ward, url }, slots) {
  if (!SECRET || G.gaps == null) return;
  const rows = match(slots, G, ward);
  for (const team of G.teams) {
    const mine = rows
      .filter((r) => r.team === team)
      .map(({ team: _, ...r }) => ({ ...r, key: `${site}|${r.date}|${r.place}|${r.gap_time || ''}`, url }));
    try {
      const r = await rpc('facility_watch_report', { p_team: team, p_site: site, p_ward: ward, p_rows: mine });
      console.log(`YANAGIBAへ送信: ${mine.length}件（新しい空き ${r.new}件・なくなった空き ${r.removed}件）`);
    } catch (e) {
      console.warn(`⚠ YANAGIBAへ送れません: ${e.message}`);
    }
  }
}
