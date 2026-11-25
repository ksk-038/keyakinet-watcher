// YANAGIBA（チームのアプリ）とのやりとり
//   ・アプリの「まだ施設が取れていない日」（東京の練習）を読む
//   ・その日の練習の時間に空いている部屋を、アプリに送る（アプリの画面に出て、スタッフにお知らせが届く）
// 合言葉（GitHub の Secrets「YANAGIBA_SECRET」）がないときは何もしない
import holidayJp from '@holiday-jp/holiday_jp';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as L from './lib.mjs';
import { roomInfoFor, roomStatusFor } from './roominfo.mjs';

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

// 広さが書いていなくて定員だけある部屋：150㎡以上を探すときは定員80名以上、100㎡以上を探すときは定員40名以上だけ
export const capOk = (cap, minArea) => cap == null || minArea < 100 || cap >= (minArea >= 150 ? 80 : 40);
// 空き検索の広さに入るか（広さ不明の部屋もふくむ。定員だけ書いてあれば定員で判断）
const inRange = (area, q, cap = null) => area == null ? capOk(cap, q.min ?? 0) : (area >= (q.min ?? 0) && (q.max == null || area <= q.max));
// その日のどれかの空き検索に入る部屋か
export const searchHit = (G, date, area, cap = null) => (G.searches || []).some((q) => q.date === date && inRange(area, q, cap));

// まだ取れていない日に見る部屋の広さ（拠点ごと）
//   東京：土日祝 150㎡以上・平日 100〜200㎡　／　大阪：土日祝 100㎡以上・平日 50〜150㎡
//   （平日練は人数が少ないので、広すぎる部屋は出さない）。広さ不明で定員だけある部屋は、定員で判断
export const MIN_AREA = { 東京: { rest: 150, weekday: 100, weekdayMax: 200 }, 大阪: { rest: 100, weekday: 50, weekdayMax: 150 } };
const areaRule = (base) => MIN_AREA[base] || MIN_AREA.東京;
export const minAreaFor = (date, base = '東京') => areaRule(base)[isRestDay(date) ? 'rest' : 'weekday'];
export const maxAreaFor = (date, base = '東京') => (isRestDay(date) ? null : areaRule(base).weekdayMax ?? null);
// 平日に広すぎる部屋か（広さがわかる部屋だけ）
export const tooBig = (area, date, base = '東京') => { const mx = maxAreaFor(date, base || '東京'); return area != null && mx != null && area > mx; };
export const bigEnough = (area, date, cap = null, base = '東京') => area != null ? area >= minAreaFor(date, base) && !tooBig(area, date, base) : cap != null && capOk(cap, minAreaFor(date, base));

// アプリの「まだ施設が取れていない日」を読む。watch は各区の config.watch（何ヶ月先まで見るか）、ward は区の名前
//   その区を使う拠点（区・施設の予約のきまりの「どこの練習の施設か」）の練習だけ。きまりがない区は東京
//   → { teams, gaps: [{ team, date, time, title, base }], dates: Set, rules }。読めなかったら gaps は null
export async function load(watch, today, ward) {
  const empty = { teams: [], gaps: null, dates: new Set(), rules: [], searches: [], sdates: new Set(), skips: new Map() };
  if (!SECRET) return empty;
  try {
    const [y, m] = today.split('-').map(Number);
    const t = new Date(Date.UTC(y, m + (watch.monthsAhead ?? 2), 0));
    const end = L.ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
    const list = await rpc('facility_watch_gaps', {});
    const rules = list.flatMap((x) => (x.rules || []).map((r) => ({ ...r, team: x.team_id })));
    // 先着予約がもう始まっている日は、2か月より先も見る（大阪市・門真市などは半年前から先着）
    //   その区・市のきまりの先着予約の手続きから、いちばん先の「もう先着が始まっている日」まで
    let far = end;
    const firsts = rules.filter((r) => nf(r.ward) === nf(ward)).flatMap((r) => (r.steps || []).filter((st) => st.kind === 'first'));
    for (let d = addMonths(end, 0), stop = addMonths(today, 13); firsts.length && d <= stop; d = nextDay(d)) if (firsts.some((st) => firstOpen(st, d) <= today)) far = d;
    if (far > end) console.log(`先着予約が始まっている ${L.label(far)} まで見ます（${L.label(end)} より先は、先着が始まっている施設だけ）`);
    const forBase = (team, base) => {
      const rs = rules.filter((r) => r.team === team && nf(r.ward) === nf(ward));
      if (!rs.length) return !base || /東京/.test(base);
      return rs.some((r) => !r.base || !base || r.base === base);
    };
    const gaps = list.flatMap((x) =>
      (x.gaps || [])
        .filter((g) => !g.outdoor && g.date > today && g.date <= far && forBase(x.team_id, g.base || null))
        .map((g) => ({ team: x.team_id, date: g.date, time: g.time || null, title: g.title || g.label || '練習', base: g.base || null })),
    );
    const dates = new Set(gaps.map((g) => g.date));
    console.log(`YANAGIBAのまだ取れていない日: ${[...dates].sort().map(L.label).join(' ') || 'なし'}`);
    // 空き検索（アプリに載せない練習用）。日にち・時間・拠点・広さ（min〜max）
    const searches = list.flatMap((x) =>
      (x.searches || [])
        .filter((q) => q.date > today && q.date <= far && forBase(x.team_id, q.base || null))
        .map((q) => ({ team: x.team_id, id: q.id, date: q.date, time: q.time || null, title: '空き検索', min: q.min_area ?? null, max: q.max_area ?? null, line: q.line === true })),
    );
    const sdates = new Set(searches.map((q) => q.date));
    if (searches.length) console.log(`空き検索: ${searches.map((q) => `${L.label(q.date)} ${q.time || '終日'} ${q.min ?? 0}〜${q.max ?? ''}㎡`).join(' / ')}`);
    // アプリの施設予約で、左スワイプでグレーにした手続き（チームごと）。その手続きの日の空きは LINE に送らない
    const skips = new Map(list.map((x) => [x.team_id, new Set(x.skips || [])]));
    const nSkip = [...skips.values()].reduce((n, x) => n + x.size, 0);
    if (nSkip) console.log(`グレーにした手続き: ${nSkip}件`);
    return { teams: list.map((x) => x.team_id), gaps, dates, rules, searches, sdates, skips, near: end };
  } catch (e) {
    console.warn(`⚠ YANAGIBAのまだ取れていない日を読めません: ${e.message}`);
    return empty;
  }
}

// アプリの「区・施設の予約のきまり」の施設の書き方から、その部屋が当てはまるか（アプリの側と同じ考え方）
const nf = (x) => (x || '').normalize('NFKC').replace(/\s+/g, '');
const SPORT = /体育館|スポーツ|武道場|競技場|体育/;
const lines = (r) => (r.facility || '').split(/[\n、,，]/).map(nf).filter(Boolean);
const core = (n) => n.replace(/(系|など|等|\d+か所)$/, '');
function ruleHits(r, ward, place) {
  if (nf(r.ward) !== nf(ward)) return false;
  const p = nf(place);
  return lines(r).some((n) => {
    if (/以外|じゃない|他の/.test(n)) return false;
    if (/全施設|全部/.test(n)) return true;
    if (/体育/.test(n)) return SPORT.test(p);
    const c = core(n);
    return c.length >= 2 && p.includes(c);
  });
}
// 休日用の施設は平日に、平日用の施設は土日祝に使わない
export function hidden(G, team, ward, place, date) {
  const rest = isRestDay(date);
  return (G.rules || []).some((r) => r.team === team && ((r.days === 'rest' && !rest) || (r.days === 'weekday' && rest)) && ruleHits(r, ward, place));
}

// その部屋の先着予約のきまり: 施設名が書いてあるもの → 体育施設 → 「〜以外」 → 「他の施設・全施設」の順に探す
function ruleFor(G, team, ward, place, base) {
  const rs = (G.rules || []).filter((r) => r.team === team && nf(r.ward) === nf(ward) && (!r.base || !base || r.base === base));
  const p = nf(place);
  const sporty = SPORT.test(p);
  return (
    rs.find((r) => lines(r).some((n) => !/以外|じゃない|他の|全施設|全部|体育/.test(n) && core(n).length >= 2 && p.includes(core(n)))) ||
    (sporty && rs.find((r) => lines(r).some((n) => /体育/.test(n) && !/以外/.test(n)))) ||
    rs.find((r) => lines(r).some((n) => /以外/.test(n) && (/体育/.test(n) ? !sporty : true))) ||
    rs.find((r) => lines(r).some((n) => /じゃない|他の|全施設|全部/.test(n))) ||
    (rs.length === 1 ? rs[0] : null)
  );
}
const addMonths = (s, n) => {
  const [y, m, d] = s.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  const x = new Date(Date.UTC(y, m - 1 + n, Math.min(d, last)));
  return L.ymd(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
};
const nextDay = (s) => { const [y, m, d] = s.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, d + 1)); return L.ymd(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()); };
const closed = (s) => isRestDay(s) || /-01-0[123]$/.test(s);
// 先着予約が始まる日（アプリの firstOpen と同じ）。day: null＝利用日と同じ日にち、0＝第一営業日、31以上＝月末
function firstOpen(st, date) {
  if (st.day == null) return addMonths(date, -st.months);
  const m = addMonths(date.slice(0, 8) + '01', -st.months);
  const [y, mm] = m.split('-').map(Number);
  const last = new Date(Date.UTC(y, mm, 0)).getUTCDate();
  if (st.day !== 0) return L.ymd(y, mm, Math.min(st.day, last));
  let d = 1;
  while (closed(L.ymd(y, mm, d))) d++;
  return L.ymd(y, mm, d);
}
// その空きの先着予約が始まる時刻（ISO、日本時間）。きまりがなければ null（始まっているとみなす）
export function opensAt(G, team, ward, place, date, base) {
  const r = ruleFor(G, team, ward, place, base);
  const firsts = (r?.steps || []).filter((st) => st.kind === 'first');
  if (!firsts.length) return null;
  const t = firsts
    .map((st) => {
      const [h, mi] = (st.time || '9:00').split(':').map(Number);
      return `${firstOpen(st, date)}T${String(h).padStart(2, '0')}:${String(mi || 0).padStart(2, '0')}:00+09:00`;
    })
    .sort()[0];
  return t;
}
// アプリの施設予約で、その部屋・その日の先着予約の手続きをグレーにしているか（LINE用）
//   アプリの印（きまりのid|手続きの番号|手続きの日）と同じ考え方：
//   ・「いま取りかかれる、まだ取れていない日」の行（…|open）をグレー → 先着予約が始まっている日
//   ・先着予約の日の行（…|その日）をグレー → その手続きの日
//   ・抽選締切・抽選結果発表をグレーにして止めた月（month|きまりのid|年-月）
//   グレーを戻せば（印が消えれば）、また送る
export function muted(G, team, ward, place, date, base = null) {
  const sk = G.skips?.get(team);
  if (!sk?.size || !place) return false;
  const r = ruleFor(G, team, ward, place, base);
  if (!r?.id) return false;
  if (sk.has(`month|${r.id}|${date.slice(0, 7)}`)) return true;
  const today = L.jstToday();
  return (r.steps || []).some((st, si) => {
    if (st.kind !== 'first') return false;
    const day = firstOpen(st, date);
    return sk.has(`${r.id}|${si}|${day}`) || (day < today && sk.has(`${r.id}|${si}|open`));
  });
}

// 先着予約がもう始まっているか（LINE用。きまりがなければ始まっているとみなす）
export function bookable(G, ward, place, date) {
  const team = G.teams?.[0];
  if (!team || !place) return true;
  const t = opensAt(G, team, ward, place, date, null);
  return !t || Date.parse(t) <= Date.now();
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
// 公演用のホール（床をフラットにできない部屋）は出さない（stage-halls.json）
const STAGE = JSON.parse(readFileSync(new globalThis.URL('./stage-halls.json', import.meta.url), 'utf8')).rooms || [];
export function stageHall(ward, place) {
  const p = L.norm(place);
  return STAGE.some((h) => h.ward === ward && p.includes(L.norm(h.facility)) && p.endsWith(L.norm(h.room)));
}

export function match(slots, G, ward) {
  slots = slots.filter((s) => !stageHall(ward, s.place));
  const rows = [];
  const all = [...(G.gaps || []), ...(G.searches || []).map((q) => ({ ...q, search: true }))];
  if (!all.length) return rows;
  const groups = new Map();
  for (const s of slots) {
    if (!G.dates.has(s.date) && !G.sdates?.has(s.date)) continue;
    const k = `${s.date}|${s.place}`;
    if (!groups.has(k)) groups.set(k, { ...s, times: [] });
    groups.get(k).times.push(s.time);
  }
  for (const g of all) {
    const gr = range(g.time);
    for (const p of groups.values()) {
      if (p.date !== g.date || hidden(G, g.team, ward, p.place, p.date)) continue;
      // まだ取れていない日は、いつもの条件の部屋だけ。空き検索は、その広さの部屋だけ
      if (g.search ? !inRange(p.area ?? null, g, p.cap ?? null) : p.usual === false) continue;
      if (!g.search && tooBig(p.area ?? null, g.date, g.base)) continue;
      const rs = p.times.map(range).filter(Boolean).sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const r of rs) {
        const last = merged.at(-1);
        // 間が1時間以内なら続けて使える（13:00〜15:00 と 15:30〜17:30 → 13:00〜17:30 で「全部」）
        if (last && r[0] - last[1] <= L.JOIN_GAP) last[1] = Math.max(last[1], r[1]);
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
      const opens = opensAt(G, g.team, ward, p.place, g.date, g.base);
      // 2か月より先は、先着予約がもう始まっている施設だけ（きまりのない施設は出さない）
      if (G.near && g.date > G.near && (!opens || Date.parse(opens) > Date.now())) continue;
      rows.push({
        team: g.team, date: g.date, place: p.place, area: p.area ?? null, cap: p.cap ?? null, time,
        gap_time: g.time, gap_title: g.title, partial: !full,
        opens_at: opens,
        search_id: g.search ? g.id : null,
        url: p.url ?? null,
        // アプリでグレーにした手続きの日の空き：画面には出すが、お知らせはしない（グレーを戻せば、まだ空いていれば知らせる）
        muted: !g.search && muted(G, g.team, ward, p.place, g.date, g.base),
      });
    }
  }
  return rows;
}

// そのコマが、まだ取れていない日の練習の時間に重なるか（LINEにも送るため）
//   ward と s.place があれば、休日用・平日用のきまりで外れる部屋は除く
//   line: true のときは、アプリでグレーにした手続きの日（muted）も除く
export function hitsGap(s, G, ward, line = false) {
  return (G.gaps || []).some((g) => {
    if (g.date !== s.date) return false;
    if (ward && s.place && hidden(G, g.team, ward, s.place, s.date)) return false;
    if (line && ward && muted(G, g.team, ward, s.place, s.date, g.base)) return false;
    const gr = range(g.time);
    const sr = range(s.time);
    return !gr || !sr || (sr[0] < gr[1] && sr[1] > gr[0]);
  });
}

// 同じ部屋・同じ日で、間が1時間以内につながる空きをまとめた時間（そのコマが入るかたまり）
function chainSpan(s, all) {
  const sr = range(s.time);
  if (!sr || !all) return sr;
  const key = (x) => [x.date, x.place, x.facility, x.building, x.label, x.room].join('|');
  const rs = all.filter((x) => key(x) === key(s)).map((x) => range(x.time)).filter(Boolean).sort((a, b) => a[0] - b[0]);
  const has = (c) => c && c[0] <= sr[0] && c[1] >= sr[1];
  let cur = null;
  for (const r of rs) {
    if (cur && r[0] - cur[1] <= L.JOIN_GAP) cur[1] = Math.max(cur[1], r[1]);
    else { if (has(cur)) return cur; cur = [...r]; }
  }
  return has(cur) ? cur : sr;
}
// 練習（検索）の時間をまるごと使えるか：つながる空きも足して、時間全体をふくめば◯
const covers = (span, gr) => !gr || (!!span && span[0] <= gr[0] && span[1] >= gr[1]);

// LINEに送る空き：練習の時間がまるごと空いたときだけ（一部だけの空きはアプリにだけ出す。LINEの無料枠を節約）
//   ・まだ取れていない日の練習の時間をまるごと使える空き（いつもの条件の部屋・先着予約が始まっているもの・アプリでグレーにしていないもの）
//   ・空き検索の日の、その広さで、検索した時間をまるごと使える空き
//   all：同じ区の空き全部（前後のコマとつながるかを見るため）
export function lineOk(s, G, ward, all = null) {
  if (stageHall(ward, s.place)) return false;
  // 2か月より先の空きは YANAGIBA に出すだけ（LINE には送らない）
  if (G.near && s.date > G.near) return false;
  const span = chainSpan(s, all);
  const full = s.usual !== false && bookable(G, ward, s.place, s.date) && (G.gaps || []).some((g) => {
    if (g.date !== s.date) return false;
    if (ward && s.place && hidden(G, g.team, ward, s.place, s.date)) return false;
    if (ward && muted(G, g.team, ward, s.place, s.date, g.base)) return false;
    if (tooBig(s.area ?? null, s.date, g.base)) return false;
    return covers(span, range(g.time));
  });
  if (full) return true;
  // 空き検索は、LINEを受け取る人（アプリの設定の line_user）が足した検索だけ LINE に送る。ほかの人の検索はアプリの結果だけ
  return (G.searches || []).filter((q) => q.line).some((q) => {
    if (q.date !== s.date || !inRange(s.area ?? null, q, s.cap ?? null)) return false;
    if (ward && s.place && hidden(G, q.team, ward, s.place, s.date)) return false;
    return covers(span, range(q.time));
  });
}

// アプリに送る（その区の分をまるごと。なくなった空きはアプリ側で消える）
//   stateDir があれば、前回送った中身を覚えておき、変わっていないときは送らない（Supabase の通信量を節約）
//   ただし6時間に1回は、変わっていなくても送る（「調べた時刻」を新しくするため）
// シートで「使える」にしている部屋だけを残す（slots をその場で減らす。このあとの LINE の判定も同じ配列を使うため）
//   SHEET_ONLY が '1' でないときは外さず、ログに出すだけ
export async function sheetOnly(ward, slots) {
  if (!slots?.length) return;
  const st = await roomStatusFor(ward);
  const none = new Set(); const ng = new Set();
  for (const s of slots) { const v = st(s.place); if (v === null) none.add(s.place); else if (v === 'ng') ng.add(s.place); }
  if (none.size) console.log(`部屋の照合（${ward}）シートにない部屋: ${JSON.stringify([...none])}`);
  if (ng.size) console.log(`部屋の照合（${ward}）シートで利用不可の部屋: ${JSON.stringify([...ng])}`);
  if (process.env.SHEET_ONLY !== '1') return;
  const keep = slots.filter((s) => st(s.place) === 'ok');
  slots.splice(0, slots.length, ...keep);
}

export async function report(G, { site, ward, url, stateDir = null }, slots) {
  await sheetOnly(ward, slots);
  if (!SECRET || G.gaps == null) return;
  const memo = stateDir ? `${stateDir}/yanagiba-${site}.json` : null;
  let last = {};
  if (memo) { try { last = JSON.parse(await fs.readFile(memo, 'utf8')); } catch { /* はじめて */ } }
  const sent = {};
  // 部屋の広さ・鏡・利用費（スプレッドシートから。見つからない部屋はつけない）
  //   予約サイトで広さがわからない部屋は、シートの広さを使う（広さの条件にもかける）
  const info = slots.length ? await roomInfoFor(ward) : () => null;
  const sized = slots.map((s) => (s.area == null && info(s.place)?.area ? { ...s, area: info(s.place).area } : s));
  const rows = match(sized, G, ward);
  const extra = (place) => { const x = info(place); return x ? { mirror: x.mirror, mirror_note: x.mirror_note, fee: x.fee } : {}; };
  for (const team of G.teams) {
    const mine = rows
      .filter((r) => r.team === team)
      .map(({ team: _, ...r }) => ({ ...r, ...extra(r.place), key: `${site}|${r.search_id ? `s:${r.search_id}|` : ''}${r.date}|${r.place}|${r.gap_time || ''}`, url: r.url || url }));
    try {
      // 調べた日（空きが0件でも「調べた」とアプリでわかるように）
      const checked = [
        ...(G.gaps || []).filter((g) => g.team === team).map((g) => `${g.date}|${g.time || ''}|${g.base || ''}`),
        ...(G.searches || []).filter((q) => q.team === team).map((q) => `s:${q.id}`),
      ];
      const hash = createHash('sha1').update(JSON.stringify([mine, [...new Set(checked)].sort(), L.jstToday()])).digest('hex');
      const prev = last[team];
      if (prev && prev.hash === hash && Date.now() - Date.parse(prev.at) < 6 * 3600e3) {
        console.log(`YANAGIBA: 前回と同じなので送りません（${mine.length}件）`);
        sent[team] = prev;
        continue;
      }
      const r = await rpc('facility_watch_report', { p_team: team, p_site: site, p_ward: ward, p_rows: mine, p_checked: [...new Set(checked)] });
      sent[team] = { hash, at: new Date().toISOString() };
      console.log(`YANAGIBAへ送信: ${mine.length}件（新しい空き ${r.new}件・なくなった空き ${r.removed}件）`);
    } catch (e) {
      console.warn(`⚠ YANAGIBAへ送れません: ${e.message}`);
    }
  }
  if (memo) { await fs.mkdir(stateDir, { recursive: true }); await fs.writeFile(memo, JSON.stringify(sent)); }
}
