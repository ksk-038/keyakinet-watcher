// 国立オリンピック記念青少年総合センター（オリセン）の空き → YANAGIBA
//   ブラウザは使わない。空き状況のページ（スポーツ棟・カルチャー棟）を1回ずつ読むだけ（13か月分が1ページに入っている）
//   LINE のお知らせは、今まで通り Google Apps Script の方で送る（ここからは送らない）
//   node olympic/watch.mjs        … 読んで YANAGIBA に送る
//   DEBUG=1 node olympic/watch.mjs … 読み取った中身をログに出す
import fs from 'node:fs/promises';
import * as L from '../lib.mjs';
import * as Y from '../yanagiba.mjs';

const NAME = 'オリンピックセンター';
const SITE = 'https://yoyaku.nyc.niye.go.jp/users/';
const STATE_DIR = 'state-olympic';
const DEBUG = process.env.DEBUG === '1';
// 区分の時間（ページの上に書いてある）
const TIMES = { 午前: '8:30〜12:00', 午後: '13:00〜17:00', 夜間: '18:00〜22:00' };
// 見る部屋と広さ（施設使用料金表より）。テニスコート・プール・ホール（客席がある）・工芸室・美術室・和室は見ない
//   中体育室は第1〜3体育室（約816〜851㎡）、小体育室は第4・5体育室（約270㎡）のどれか1室
//   中練習室は 約180㎡が2室・約120㎡が1室。「△（残りわずか）」のときはどれが空いているかわからないので小さい方で考える
const BLDG = [
  { page: 'sports', name: 'スポーツ棟', rooms: [{ m: /^中体育室/, room: '中体育室', area: 816 }, { m: /^小体育室/, room: '小体育室', area: 270 }] },
  {
    page: 'culture', name: 'カルチャー棟', rooms: [
      { m: /^大練習室/, room: '大練習室（リハーサル室）', area: 300 },
      { m: /^中練習室/, room: '中練習室', area: 180, few: 120 },
      { m: /^小練習室/, room: '小練習室', area: 60 },
    ],
  },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (h) => h.replace(/<BR>/gi, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();

async function get(page) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${SITE}${page}_R.html`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`${page} が ${r.status}`);
      return new TextDecoder('utf-8').decode(await r.arrayBuffer());
    } catch (e) {
      if (i === 2) throw e;
      await sleep(10000 * (i + 1));
    }
  }
}

// ページ → [{ room, kubun, date, sym }]
function parse(html) {
  const out = [];
  for (const t of html.split(/<A NAME=/i).slice(1)) {
    const ym = t.match(/^(\d{4})年(\d{1,2})月/);
    if (!ym) continue;
    const head = t.match(/<TR[^>]*>([\s\S]*?)<\/TR>/i)?.[1] || '';
    const days = [...head.matchAll(/<TH ALIGN=CENTER>([\s\S]*?)<\/TH>/gi)].map((m) => Number(text(m[1])));
    let room = null;
    for (const tr of t.matchAll(/<TR BGCOLOR=[^>]*>([\s\S]*?)<\/TR>/gi)) {
      const tds = [...tr[1].matchAll(/<TD([^>]*)>([\s\S]*?)<\/TD>/gi)];
      if (/ROWSPAN/i.test(tds[0]?.[1] || '')) room = text(tds.shift()[2]);
      const kubun = text(tds.shift()?.[2] || '');
      tds.forEach((td, i) => {
        if (!days[i]) return;
        out.push({ room, kubun, date: `${ym[1]}-${ym[2].padStart(2, '0')}-${String(days[i]).padStart(2, '0')}`, sym: text(td[2]) });
      });
    }
  }
  return out;
}

async function scan(dates) {
  const want = new Set(dates);
  const slots = [];
  for (const b of BLDG) {
    const cells = parse(await get(b.page));
    if (!cells.length) throw new Error(`${b.name}の空き状況が読めません`);
    const seen = new Set(cells.map((c) => c.date));
    const miss = dates.filter((d) => !seen.has(d));
    if (miss.length && DEBUG) console.log(`  ${b.name}: ページにない日 ${miss.join(' ')}`);
    for (const c of cells) {
      if (!want.has(c.date) || !TIMES[c.kubun] || !['○', '△'].includes(c.sym)) continue;
      const r = b.rooms.find((x) => x.m.test(c.room));
      if (!r) continue;
      const area = c.sym === '△' && r.few ? r.few : r.area;
      slots.push({ place: `${b.name} ${r.room}`, room: r.room, area, cap: null, date: c.date, time: TIMES[c.kubun], sym: c.sym, url: `${SITE}${b.page}.html` });
    }
    console.log(`${b.name}: ${cells.length}マス読みました`);
  }
  return slots;
}

async function main() {
  const today = L.jstToday();
  const G = await Y.load({ monthsAhead: 13 }, today, NAME);
  const dates = [...new Set([...G.dates, ...G.sdates])].sort();
  if (!dates.length) { console.log('見張る日付がありません'); return; }
  console.log(`見張る日付: ${dates.map(L.label).join(' ')}`);
  let slots;
  try {
    slots = await scan(dates);
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exitCode = 1;
    return;
  }
  // いつもの条件（まだ取れていない日）は広さで、空き検索はその広さで（Y.match が見る）
  const placed = slots
    .map((s) => ({ ...s, usual: G.dates.has(s.date) && Y.bigEnough(s.area, s.date) }))
    .filter((s) => s.usual || Y.searchHit(G, s.date, s.area));
  if (DEBUG) for (const s of placed) console.log(`  空き: ${L.label(s.date)} ${s.place} ${s.time} ${s.sym}（${s.area}㎡${s.usual ? '' : '・空き検索だけ'}）`);
  console.log(`空き ${placed.length}コマ`);
  await fs.mkdir(STATE_DIR, { recursive: true });
  await Y.report(G, { site: 'olympic', ward: NAME, url: `${SITE}sports.html`, stateDir: STATE_DIR }, placed);
}

await main();
