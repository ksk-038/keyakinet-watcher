// 大阪市「区役所附設会館予約システム」（区民センター・区民ホール・会館）の空き監視 → YANAGIBA・LINE通知
//   ブラウザは使わない（予約サイトの空き状況のデータを直接読む）
//   node osaka/watch.mjs                  … 監視して、新しい空きがあればLINEに送る
//   DEBUG=1 node osaka/watch.mjs          … 読み取った中身をログに出す
//   TEST_NOTIFY=1 node osaka/watch.mjs    … LINEにテスト送信だけする
import fs from 'node:fs/promises';
import * as L from '../lib.mjs';
import * as Y from '../yanagiba.mjs';

const NAME = '大阪市';
const BASE = '大阪';
const SITE = 'https://www.shisetsu-osaka.jp/shisetsu-nw';
export const TOP = `${SITE}/fusetsu.html`;
const STATE_DIR = 'state-osaka';
const STATE_FILE = `${STATE_DIR}/state.json`;
const DEBUG = process.env.DEBUG === '1';
const ROOMS = JSON.parse(await fs.readFile(new URL('./rooms.json', import.meta.url), 'utf8'));
// 和室・調理室・控室は練習に使わない（部屋の種類の番号）
const SKIP_KINDS = ['03', '05', '07'];

async function line(text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const to = process.env.LINE_USER_ID;
  if (!token || !to) { console.log(`[LINE未設定のため表示のみ]\n${text}`); return; }
  const parts = [];
  let cur = '';
  for (const ln of text.split('\n')) {
    if (cur && cur.length + ln.length + 1 > 4800) { parts.push(cur); cur = ''; }
    cur = cur ? `${cur}\n${ln}` : ln;
  }
  if (cur) parts.push(cur);
  const r = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages: parts.slice(0, 5).map((t) => ({ type: 'text', text: t.slice(0, 4990) })) }),
  });
  if (!r.ok) throw new Error(`LINE送信に失敗 ${r.status}: ${await r.text()}`);
}
async function loadState() {
  try { return JSON.parse(await fs.readFile(STATE_FILE, 'utf8')); } catch { return { notified: [] }; }
}
async function saveState(s) {
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(s, null, 2));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 予約サイトとのやりとり ----
let cookie = '';
let csrf = '';
const keep = (r) => {
  const set = r.headers.getSetCookie?.() || [];
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
};
// 施設の一覧（番号と名前）と、データを読むための合言葉（_csrf）
async function start() {
  const r = await fetch(`${SITE}/akijokyo.html?scd=01`, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ja' } });
  if (!r.ok) throw new Error(`予約サイトが開けません ${r.status}`);
  keep(r);
  const html = await r.text();
  csrf = (html.match(/name="_csrf"\s+content="([^"]+)"/) || html.match(/name="_csrf"\s+value="([^"]+)"/) || [])[1];
  if (!csrf) throw new Error('予約サイトの画面が変わりました（_csrf が見つかりません）');
  const facs = new Map();
  for (const [, cd, name] of html.matchAll(/akijokyo\.html\?scd=(\d+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const n = name.replace(/<[^>]+>/g, '').replace(/\s+/g, '').replace(/&amp;/g, '&');
    if (n) facs.set(cd, n);
  }
  if (!facs.size) throw new Error('予約サイトの画面が変わりました（施設の一覧が見つかりません）');
  return facs;
}
// 1施設・1週間ぶんの空き状況
async function week(scd, sdate) {
  for (let i = 0; i < 2; i++) {
    const r = await fetch(`${SITE}/restapi/akijokyo.html`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-CSRF-TOKEN': csrf, 'X-Requested-With': 'XMLHttpRequest',
        Cookie: cookie, 'User-Agent': 'Mozilla/5.0', Referer: `${SITE}/akijokyo.html?scd=${scd}`,
      },
      body: new URLSearchParams({ _csrf: csrf, scd, sdate }).toString(),
    });
    keep(r);
    if (r.ok) {
      const j = await r.json();
      if (j.status !== 0 && j.status != null) throw new Error(`空き状況を読めません（${j.globalMessage || j.status}）`);
      return j.data?.akijokyo || [];
    }
    if (i === 0 && (r.status === 403 || r.status === 419)) { await start(); continue; } // 合言葉が切れたら取り直す
    throw new Error(`空き状況を読めません ${r.status}`);
  }
  return [];
}

// ---- 広さ・部屋の名前 ----
// 施設の名前（「まるよし精肉店 都島区民センター」「株式会社ノーブデンス西区民センター（大阪市立西区民センター）」）から、調査シートの施設を探すための目印
const KU = ['東住吉', '西淀川', '東淀川', '住之江', '阿倍野', '天王寺', '此花', '東成', '生野', '城東', '鶴見', '淀川', '浪速', '中央', '平野', '西成', '住吉', '都島', '福島', '大正', '北', '西', '港', '旭', '大淀', 'すみのえ'];
const KIND = ['コミュニティセンター', '近隣センター', '区民センター', '区民ホール', '区民会館', '舞昆ホール', '会館'];
export function facKey(name) {
  const n = L.norm(name);
  const paren = n.match(/[(（]([^)）]*大阪市[^)）]*)[)）]/);
  const s = (paren ? paren[1] : n).replace(/^大阪市立|^大阪市/, '');
  for (const k of KIND) {
    const i = s.lastIndexOf(k);
    if (i < 0) continue;
    const head = s.slice(0, i);
    const ku = KU.find((x) => head.endsWith(x)) || KU.find((x) => head.includes(x));
    if (ku) return `${ku}${k}`;
  }
  return s;
}
// 見せる名前（ネーミングライツの会社名があれば、かっこの中の正式な名前を使う）
export function facLabel(name) {
  const n = L.norm(name);
  const paren = n.match(/[(（]([^)）]*大阪市[^)）]*)[)）]/);
  return (paren ? paren[1] : n).replace(/^大阪市立|^大阪市/, '');
}
const SHEET = new Map(Object.entries(ROOMS).filter(([k]) => k !== '_説明').map(([k, v]) => [facKey(k), v]));
function sheetRoom(fac, room, area = null) {
  const rooms = SHEET.get(facKey(fac));
  if (!rooms) return null;
  const r = L.norm(room);
  const ks = Object.keys(rooms);
  const digits = (x) => (L.norm(x).match(/\d{3,}/) || [])[0];
  // 名前がぴったり → 片方がもう片方をふくむ（「ホール」と「リゲッタIKUNOホール」）→ 3けたの部屋番号が同じ（「102」と「102会議室」）→ 広さが同じ
  const k = ks.find((x) => L.norm(x) === r)
    || ks.find((x) => r.length >= 2 && (L.norm(x).includes(r) || r.includes(L.norm(x))))
    || (digits(r) && ks.find((x) => digits(x) === digits(r)))
    || (area != null && ks.filter((x) => Math.abs((rooms[x][0] ?? -99) - area) <= 1).length === 1 ? ks.find((x) => Math.abs((rooms[x][0] ?? -99) - area) <= 1) : null);
  return k ? { area: rooms[k][0], cap: rooms[k][1], ok: rooms[k][2], as: k } : null;
}
const num = (s) => { const m = L.norm(s || '').match(/([\d.]+)/); return m ? Number(m[1]) : null; };

const MISSING = new Set();
// 状況の表を、空いているコマの一覧にする
export function slotsOf(facName, scd, rooms, want) {
  const out = [];
  for (const rm of rooms) {
    if (SKIP_KINDS.includes(rm.roomkindCd)) continue;
    const sh = sheetRoom(facName, rm.roomName, num(rm.hirosa));
    // ダンスができる部屋だけ：練習場所調査シート(大阪市)で「利用可」が「可」の部屋。シートにない部屋は外す（ログに出すので、シートに足せば見張る）
    if (!sh) { MISSING.add(`${facLabel(facName)} ${L.norm(rm.roomName)}（${rm.hirosa || '広さ不明'}）`); continue; }
    if (sh.ok === false || L.badRoom(rm.roomName)) continue;
    const area = num(rm.hirosa) ?? sh?.area ?? null;
    const cap = rm.tenin ?? sh?.cap ?? null;
    for (const d of rm.dateList || []) {
      if (!want.has(d.riyoDate)) continue;
      for (const t of d.availTimeList || []) {
        const open = /[○◯〇]/.test(t.statusDisp || '') && !t.disabled;
        if (!open) continue;
        out.push({
          date: d.riyoDate, facility: facLabel(facName), room: L.norm(rm.roomName), area, cap,
          time: `${t.availStartTimeDisp}〜${t.availEndTimeDisp}`, url: `${SITE}/akijokyo.html?scd=${scd}`,
        });
      }
    }
  }
  return out;
}

function buildMessage(slots, title = `🎉 ${NAME}（区民センターなど）に空きが出ました`) {
  const byDate = new Map();
  for (const s of slots) {
    const info = [s.area ? `${Math.round(s.area)}㎡` : '広さ不明', s.cap ? `${s.cap}名` : ''].filter(Boolean).join('・');
    const k = `${s.place}（${info}）`;
    if (!byDate.has(s.date)) byDate.set(s.date, new Map());
    const m = byDate.get(s.date);
    if (!m.has(k)) m.set(k, { times: [], url: s.url });
    m.get(k).times.push(s.time);
  }
  const lines = [title];
  for (const date of [...byDate.keys()].sort()) {
    lines.push('', `📅 ${L.label(date)}`);
    for (const [room, v] of byDate.get(date)) lines.push(`・${room}`, `  ${L.joinTimes(v.times)}`, `  ${v.url}`);
  }
  return lines.join('\n');
}

async function scan(dates, G) {
  const facs = await start();
  const want = new Set(dates);
  const out = [];
  const log = [];
  for (const [scd, name] of facs) {
    let from = dates[0];
    let n = 0;
    while (from && n++ < 12) {
      const rooms = await week(scd, from);
      const seen = [...new Set(rooms.flatMap((r) => (r.dateList || []).map((d) => d.riyoDate)))].sort();
      if (!seen.length) break;
      for (const s of slotsOf(name, scd, rooms, want)) {
        const usual = G.dates.has(s.date) && Y.bigEnough(s.area, s.date, s.cap, BASE);
        if (usual || Y.searchHit(G, s.date, s.area, s.cap)) out.push({ ...s, usual, place: `${s.facility} ${s.room}` });
      }
      const last = seen.at(-1);
      from = dates.find((d) => d > last);
      await sleep(300);
    }
    if (DEBUG) log.push(`${scd} ${name}（${n}週）`);
  }
  if (DEBUG) console.log(`--- 見た施設 ---\n${log.join('\n')}`);
  if (MISSING.size) console.log(`--- 調査シートにない部屋（見張っていません）${MISSING.size}室 ---\n${[...MISSING].join('\n')}`);
  console.log(`施設 ${facs.size}か所を確認`);
  return out;
}

async function main() {
  if (process.env.TEST_NOTIFY === '1') { await line(`✅ ${NAME} 空き監視のテスト通知です`); return; }
  const today = L.jstToday();
  const G = await Y.load({ monthsAhead: 2 }, today, NAME);
  const dates = [...new Set([...G.dates, ...G.sdates])].sort();
  if (!dates.length) { console.log('見張る日付がありません'); return; }
  console.log(`見張る日付: ${dates.map(L.label).join(' ')}`);
  const state = await loadState();
  let placed;
  try {
    placed = await scan(dates, G).catch(async (e) => {
      console.log(`1回目は失敗（${e.message}）。30秒後にもう一度やってみます`);
      await sleep(30000);
      return scan(dates, G);
    });
  } catch (e) {
    console.error(`❌ ${e.message}`);
    const fails = (state.fails || 0) + 1;
    const last = state.lastErrorAt ? Date.parse(state.lastErrorAt) : 0;
    if (fails >= 2 && Date.now() - last > 12 * 3600e3) {
      await line(`⚠️ ${NAME} 空き監視でエラー\n${e.message.slice(0, 300)}\n（12時間に1回だけお知らせします）`).catch(() => {});
      await saveState({ ...state, lastErrorAt: new Date().toISOString(), fails });
    } else await saveState({ ...state, fails });
    process.exitCode = 1;
    return;
  }
  await Y.report(G, { site: 'osaka', ward: NAME, url: TOP, stateDir: STATE_DIR }, placed);
  const open = placed.filter((s) => Y.lineOk(s, G, NAME, placed));
  const key = (s) => `${s.date}|${s.place}|${s.time}`;
  const first = !state.notified.length && !state.lastErrorAt && !state.started;
  const seen = new Set(first ? open.map(key) : state.notified);
  if (first) console.log('初回のため、今ある空きは記録だけします');
  const fresh = open.filter((s) => !seen.has(key(s)));
  console.log(`空き ${placed.length}コマ（LINEの対象 ${open.length}・新しい分 ${fresh.length}）`);
  if (DEBUG && placed.length) console.log(`--- 空きのプレビュー ---\n${buildMessage(placed, '（プレビュー）')}`);
  if (process.env.NOTIFY_ALL === '1') await line(open.length ? buildMessage(open, `📋 ${NAME}の今の空き状況`) : `📋 ${NAME}: 今は条件に合う空きがありません`);
  else if (fresh.length) await line(buildMessage(L.widen(fresh, placed)));
  await saveState({ notified: open.map(key), lastErrorAt: state.lastErrorAt, started: true });
}

await main();
