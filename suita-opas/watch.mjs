// 吹田市「スポーツ施設情報システム（オーパス）」の空き監視（市民体育館・武道館） → YANAGIBA・LINE通知
//   ログインせず「ゲスト」で空き状況を見る。利用目的「ダンス」「健康体操」「新体操」「ヨーガ」のどれかで出てくる部屋
//   node suita-opas/watch.mjs                  … 監視して、新しい空きがあればLINEに送る
//   DEBUG=1 node suita-opas/watch.mjs          … 読み取った中身をログに出す
//   TEST_NOTIFY=1 node suita-opas/watch.mjs    … LINEにテスト送信だけする
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import * as B from '../browser.mjs';
import * as L from '../lib.mjs';
import * as Y from '../yanagiba.mjs';

const config = JSON.parse(await fs.readFile(new URL('./config.json', import.meta.url), 'utf8'));
const ROOMS = JSON.parse(await fs.readFile(new URL('./rooms.json', import.meta.url), 'utf8'));
const NAME = '吹田市';
const BASE = '大阪';
const TOP = config.top;
const STATE_DIR = 'state-suita-opas';
const STATE_FILE = `${STATE_DIR}/state.json`;
const DEBUG = process.env.DEBUG === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function line(text) {
  const parts = [];
  let cur = '';
  for (const ln of text.split('\n')) {
    if (cur && cur.length + ln.length + 1 > 4800) { parts.push(cur); cur = ''; }
    cur = cur ? `${cur}\n${ln}` : ln;
  }
  if (cur) parts.push(cur);
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const to = process.env.LINE_USER_ID;
  if (!token || !to) { console.log(`[LINE未設定のため表示のみ]\n${text}`); return; }
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
export function areaOf(label) {
  const k = Object.keys(ROOMS).find((k) => k !== '_説明' && L.norm(k) === L.norm(label));
  return k ? ROOMS[k] : null;
}

function buildMessage(slots, title = `🎉 ${NAME}に空きが出ました`) {
  const byDate = new Map();
  for (const s of slots) {
    const k = `${s.label}（${s.area ? `${Math.round(s.area)}㎡` : '広さ不明'}）`;
    if (!byDate.has(s.date)) byDate.set(s.date, new Map());
    const m = byDate.get(s.date);
    if (!m.has(k)) m.set(k, []);
    if (!m.get(k).includes(s.time)) m.get(k).push(s.time);
  }
  const lines = [title];
  for (const date of [...byDate.keys()].sort()) {
    lines.push('', `📅 ${L.label(date)}`);
    for (const [room, times] of byDate.get(date)) lines.push(`・${room}`, `  ${L.joinTimes(times)}`);
  }
  lines.push('', `予約: ${TOP}`);
  return lines.join('\n');
}

// ---- 予約サイトの画面操作（表の行を押して進む） ----
async function row(page, text) {
  const l = page.locator(`#mmaincolumn tr[onclick]:has-text("${text}")`).first();
  if (!(await l.count())) return false;
  await l.click();
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await sleep(1500);
  return true;
}
async function button(page, alt) {
  const l = page.locator(`img[alt*="${alt}"]`).first();
  if (!(await l.count())) return false;
  await l.click();
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await sleep(2000);
  return true;
}

// 空き表を読む → [{ label, date, time, free }]
async function readTable(page, today) {
  const raw = await page.evaluate(() => {
    const out = [];
    let hall = '';
    for (const el of document.querySelectorAll('#facilitiesbox h3.kaikan_title, #facilitiesbox table[summary*="空き状況"]')) {
      if (el.tagName === 'H3') { hall = el.innerText.trim(); continue; }
      // 1つの表に、同じ館の部屋が「部屋名の行 → 日付の行 → 時間の行」の順に続けて入っている
      let room = '';
      let days = [];
      for (const tr of el.querySelectorAll('tr')) {
        const nm = tr.querySelector('.shisetu_name');
        if (nm) { room = nm.innerText.trim(); continue; }
        const ds = [...tr.querySelectorAll('p.day')];
        if (ds.length) { days = ds.map((p) => p.innerText.replace(/\s+/g, '')); continue; }
        const t = tr.querySelector('td.facmdstime');
        if (!t) continue;
        const cells = [...tr.querySelectorAll('td')].slice(1);
        cells.forEach((td, i) => out.push({ hall, room, day: days[i], time: t.innerText.trim(), mark: td.querySelector('img')?.alt || td.innerText.trim() }));
      }
    }
    return out;
  });
  const [ty, tm] = today.split('-').map(Number);
  return raw.map((c) => {
    const m = (c.day || '').match(/(\d+)月(\d+)日/);
    if (!m) return null;
    const mo = Number(m[1]);
    const date = L.ymd(mo < tm ? ty + 1 : ty, mo, Number(m[2]));
    const tm2 = c.time.normalize('NFKC').match(/(\d+:\d+)\s*[~～〜-]\s*(\d+:\d+)\s*\((.+)\)/);
    if (!tm2) return null;
    return { label: `${c.hall} ${c.room}`, date, time: `${tm2[1]}〜${tm2[2]}`, slot: tm2[3], free: /空いて/.test(c.mark), mark: c.mark };
  }).filter(Boolean);
}

async function scan(browser, dates, G, today) {
  const ctx = await B.light(await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo', viewport: { width: 1280, height: 900 } }), { images: true });
  const page = await ctx.newPage();
  page.on('dialog', async (d) => { console.warn(`ダイアログ: ${d.message()}`); await d.accept().catch(() => {}); });
  const tset = new Set(dates);
  const last = dates.at(-1);
  const slots = new Set((config.slots || []).map((s) => s.normalize('NFKC'))); // 書いていなければ全部の時間の区分
  const open = [];
  const seen = new Set();
  const rooms = new Set();
  try {
    // 利用目的ごとに、入口から選び直して表を読む（同じ部屋・同じコマは1回だけ数える）
    for (const path of config.purposes) {
      await page.goto(TOP, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(1500);
      if (!(await button(page, '空き状況照会'))) throw new Error('「空き状況照会」ボタンが見つかりません');
      if (!(await row(page, '利用目的から絞り込む'))) throw new Error('「利用目的から絞り込む」が見つかりません');
      for (const p of path) {
        // 「ダンス」は「フォークダンス」「社交ダンス」より先に、ちょうど同じ名前を選ぶ
        const ok = await page.evaluate((p) => {
          const tr = [...document.querySelectorAll('#mmaincolumn tr[onclick]')].find((t) => t.innerText.trim() === p);
          if (tr) tr.click();
          return !!tr;
        }, p);
        if (!ok) throw new Error(`利用目的「${p}」が見つかりません`);
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await sleep(1500);
      }
      await button(page, '全て選択');
      if (!(await button(page, '次に進む'))) throw new Error('「次に進む」が押せません');
      console.log(`【${path.join(' → ')}】`);
      let prevEnd = null;
      for (let pageNo = 0; pageNo < 20; pageNo++) {
        const cells = await readTable(page, today);
        if (!cells.length) throw new Error('空き表が読めません');
        const ds = [...new Set(cells.map((c) => c.date))].sort();
        if (DEBUG) console.log(`${L.label(ds[0])}〜${L.label(ds.at(-1))}: ${cells.filter((c) => c.free).length}コマ空き / 時間の区分: ${[...new Set(cells.map((c) => c.slot))].join('・')}`);
        for (const c of cells) {
          // 外の施設（グラウンド）と畳の部屋は外す
          if (L.badRoom(c.label) || (config.excludeRoomWords || []).some((w) => L.norm(c.label).includes(L.norm(w)))) continue;
          rooms.add(c.label);
          if ((slots.size && !slots.has(c.slot.normalize('NFKC'))) || !c.free || !tset.has(c.date)) continue;
          const k = `${c.date}|${c.label}|${c.time}`;
          if (seen.has(k)) continue;
          seen.add(k);
          const area = areaOf(c.label);
          const usual = G.dates.has(c.date) && Y.bigEnough(area, c.date, null, BASE);
          open.push({ label: c.label, area, cap: null, date: c.date, time: c.time, usual });
        }
        // 予約サイトで見られるいちばん先まで来たら（「次の7日分」を押しても同じ7日が出る）やめる
        if (ds.at(-1) >= last || ds.at(-1) === prevEnd) break;
        prevEnd = ds.at(-1);
        if (!(await button(page, '次の7日分'))) break;
      }
    }
  } finally {
    await ctx.close();
  }
  console.log(`見た部屋: ${[...rooms].map((r) => `${r}（${areaOf(r) ?? '広さ不明'}㎡）`).join(' / ')}`);
  return open;
}

async function main() {
  if (process.env.TEST_NOTIFY === '1') { await line(`✅ ${NAME} 空き監視のテスト通知です`); return; }
  const hour = L.jstHour();
  const q = config.quietHours;
  if (q && hour >= q.from && hour < q.to && process.env.FORCE !== '1') { console.log('深夜のためお休み'); return; }

  const today = L.jstToday();
  const G = await Y.load(config.watch, today, NAME);
  const dates = [...new Set([...G.dates, ...G.sdates])].sort();
  if (!dates.length) { console.log('見張る日付がありません'); return; }
  console.log(`見張る日付: ${dates.map(L.label).join(' ')}`);

  const state = await loadState();
  const browser = await chromium.launch();
  let open;
  try {
    open = await scan(browser, dates, G, today).catch(async (e) => {
      console.log(`1回目は失敗（${e.message.split('\n')[0]}）。30秒後にもう一度やってみます`);
      await sleep(30000);
      return scan(browser, dates, G, today);
    });
  } catch (e) {
    console.error(`❌ ${e.message}`);
    const lastErr = state.lastErrorAt ? Date.parse(state.lastErrorAt) : 0;
    const fails = (state.fails || 0) + 1;
    if (fails >= 2 && Date.now() - lastErr > 12 * 3600e3) {
      await line(`⚠️ ${NAME} 空き監視でエラー\n${e.message.slice(0, 300)}\n（12時間に1回だけお知らせします）`).catch(() => {});
      await saveState({ ...state, lastErrorAt: new Date().toISOString(), fails });
    } else await saveState({ ...state, fails });
    process.exitCode = 1;
    return;
  } finally {
    await browser.close();
  }

  const placed = open.map((s) => ({ ...s, place: s.label }));
  if (DEBUG) console.log(`見張る日の空き（YANAGIBAの条件をかける前）: ${placed.length}コマ ${placed.slice(0, 15).map((s) => `${L.label(s.date)} ${s.label} ${s.time}`).join(' / ')}`);
  await Y.report(G, { site: 'suita-opas', ward: NAME, url: TOP, stateDir: STATE_DIR }, placed);
  open = placed.filter((s) => Y.lineOk(s, G, NAME, placed));
  const key = (s) => `${s.date}|${s.label}|${s.time}`;
  const first = !state.notified.length && !state.lastErrorAt && !state.started;
  const seenKeys = new Set(first ? open.map(key) : state.notified);
  if (first) console.log('初回のため、今ある空きは記録だけします（全部見たいときは notify_all で実行）');
  const fresh = open.filter((s) => !seenKeys.has(key(s)));
  console.log(`空き ${open.length}コマ（新しく見つかった分 ${fresh.length}コマ）`);
  if (DEBUG && open.length) console.log(`--- 通知文のプレビュー ---\n${buildMessage(open)}`);
  if (process.env.NOTIFY_ALL === '1') await line(open.length ? buildMessage(open, `📋 ${NAME}の今の空き状況`) : `📋 ${NAME}: 今は条件に合う空きがありません`);
  else if (fresh.length) await line(buildMessage(L.widen(fresh, placed)));
  await saveState({ notified: open.map(key), lastErrorAt: state.lastErrorAt, started: true });
}

await main();
