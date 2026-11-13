// けやきネット（世田谷区）キャンセル待ち監視 → LINE通知
//   node watch.mjs                  … 監視して、新しい空きがあればLINEに送る
//   DEBUG=1 node watch.mjs          … 各画面のスクショ/HTMLを debug/ に保存
//   TEST_NOTIFY=1 node watch.mjs    … LINEにテスト送信だけする
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import * as L from './lib.mjs';
import * as S from './scrape.mjs';
import * as Y from './yanagiba.mjs';

const config = JSON.parse(await fs.readFile(new URL('./config.json', import.meta.url), 'utf8'));
const rooms = JSON.parse(await fs.readFile(new URL('./rooms.json', import.meta.url), 'utf8'));
const STATE_FILE = 'state/state.json';

async function line(text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const to = process.env.LINE_USER_ID;
  if (!token || !to) { console.log(`[LINE未設定のため表示のみ]\n${text}`); return; }
  const r = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
  });
  if (!r.ok) throw new Error(`LINE送信に失敗 ${r.status}: ${await r.text()}`);
}

async function loadState() {
  try { return JSON.parse(await fs.readFile(STATE_FILE, 'utf8')); } catch { return { notified: [] }; }
}
async function saveState(s) {
  await fs.mkdir('state', { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(s, null, 2));
}

// 1ヶ月分の表示ぶん: 候補セルを選んで時間帯の空きを返す（選べるのは1回10件まで）
const MAX_SELECT = 10;

// YANAGIBAのまだ取れていない平日がある期間だけ、平日用の施設（weekdayFacilities）も見る
//   施設が多いと表の表示が重くて止まるので、平日用の施設は15施設ずつに分けて見る
const WD_ONLY = new Set((config.weekdayFacilities || []).filter((f) => !config.facilities.includes(f)));
function facilityGroups(start, until, G) {
  const inWin = (d) => d >= start && (!until || d < until);
  const wd = [...G.dates].some((d) => inWin(d) && !Y.isRestDay(d)) || [...G.sdates].some(inWin);
  const groups = [config.facilities];
  const extra = [...WD_ONLY];
  if (wd) for (let i = 0; i < extra.length; i += 15) groups.push(extra.slice(i, i + 15));
  return groups;
}
// 平日用だけの施設は、まだ取れていない平日だけ
const facilityOk = (c, G) => !WD_ONLY.has(c.facility) || (G.dates.has(c.date) && !Y.isRestDay(c.date));
// いつもの条件（土曜はいつもの施設・部屋。YANAGIBAのまだ取れていない平日は平日用の施設の100㎡以上も）
const usualOk = (c, G) => facilityOk(c, G) && (L.roomOk(c.room, config.roomFilter) || (G.dates.has(c.date) && Y.bigEnough(L.areaOf(c.facility, c.room, rooms), c.date)));
// 空き検索の日は、いつもの施設と平日用の施設の、その広さの部屋
const searchOk = (c, G) => Y.searchHit(G, c.date, L.areaOf(c.facility, c.room, rooms));

async function loadGrid(page, start, cfg = config) {
  await S.openFacilityGrid(page, cfg);
  await S.showMonthFrom(page, start);
  const { tables, cells } = await S.readGrid(page, cfg.facilities);
  if (!tables.length) throw new Error('施設別空き状況の表が読み取れません');
  const tdates = tables.map((t) => L.datesFromDays(t.monthLabel, t.days, start));
  if (!tdates[0].includes(start)) console.warn(`⚠ 表示開始日 ${start} が表に出ていません（${tdates[0][0]}〜）`);
  return cells.map((c) => ({ ...c, date: tdates[c.table][c.col], key: `${c.facility}|${c.room}|${tdates[c.table][c.col]}` }));
}

async function newPage(browser) {
  const ctx = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', async (d) => { console.warn(`ダイアログ: ${d.message()}`); await d.accept().catch(() => {}); });
  return { ctx, page };
}

async function scanWindow(browser, start, until, targets, G, facilities = config.facilities) {
  const cfg = { ...config, facilities };
  let { ctx, page } = await newPage(browser);
  try {
    let cells = await loadGrid(page, start, cfg);
    const picks = cells.filter(
      (c) => c.date >= start && (!until || c.date < until) && targets.has(c.date) &&
        config.notifyMarks.includes(L.markOf(c.sym)) && (usualOk(c, G) || searchOk(c, G)),
    );
    console.log(`${start}〜: 対象の空き候補 ${picks.length}コマ`);
    for (const c of picks) console.log(`  ${c.date} ${c.facility} ${c.room} ${L.markOf(c.sym)}`);

    const out = [];
    for (let i = 0; i < picks.length; i += MAX_SELECT) {
      const keys = new Set(picks.slice(i, i + MAX_SELECT).map((c) => c.key));
      if (i > 0) {
        // 2組目以降は新しいブラウザ画面で最初からやり直す（途中から戻ると弾かれるため）
        await ctx.close();
        ({ ctx, page } = await newPage(browser));
        cells = await loadGrid(page, start, cfg);
      }
      const ids = cells.filter((c) => keys.has(c.key)).map((c) => c.id);
      await S.selectCells(page, ids);
      const raw = await S.readSlots(page, cfg.facilities);
      const slots = raw
        .filter((s) => L.markOf(s.sym) === '○')
        .map((s) => ({ facility: s.facility, room: s.room, date: L.parseJpDate(s.dateText), time: L.fmtTime(s.time), area: L.areaOf(s.facility, s.room, rooms) }))
        .filter((s) => s.date && targets.has(s.date))
        .map((s) => ({ ...s, usual: usualOk(s, G) }))
        .filter((s) => s.usual || searchOk(s, G));
      console.log(`  時間帯の表 ${raw.length}マス / 空き ${slots.length}コマ`);
      if (!raw.length) console.log('  時間帯画面の文字: ' + (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 1500));
      out.push(...slots);
    }
    return out;
  } catch (e) {
    await S.snap(page, 'error', true);
    throw e;
  } finally {
    await ctx.close();
  }
}

async function main() {
  if (process.env.TEST_NOTIFY === '1') { await line('✅ けやきネット監視のテスト通知です'); return; }

  const hour = L.jstHour();
  const q = config.quietHours;
  if (q && hour >= q.from && hour < q.to && process.env.FORCE !== '1') { console.log('深夜のためお休み'); return; }

  const today = L.jstToday();
  const G = await Y.load(config.watch, today, '世田谷区');
  const cfgDates = new Set(L.targetDates(config.watch, today));
  const dates = [...new Set([...cfgDates, ...G.dates, ...G.sdates])].sort();
  if (!dates.length) { console.log('見張る日付がありません'); return; }
  console.log(`見張る日付: ${dates.map(L.label).join(' ')}`);
  const targets = new Set(dates);

  const state = await loadState();
  const browser = await chromium.launch();
  let open = [];
  try {
    const starts = L.windows(dates);
    for (let i = 0; i < starts.length; i++) for (const f of facilityGroups(starts[i], starts[i + 1], G)) open.push(...(await scanWindow(browser, starts[i], starts[i + 1], targets, G, f)));
    for (const s of open) console.log(`  空き: ${L.label(s.date)} ${s.facility} ${s.room} ${s.time}`);
  } catch (e) {
    console.error(`❌ ${e.message}\n${(e.stack || '').split('\n').slice(1, 4).join('\n')}`);
    const last = state.lastErrorAt ? Date.parse(state.lastErrorAt) : 0;
    if (Date.now() - last > 12 * 3600e3) {
      await line(`⚠️ けやきネット監視でエラー\n${e.message.slice(0, 300)}\n（12時間に1回だけお知らせします）`).catch(() => {});
      await saveState({ ...state, lastErrorAt: new Date().toISOString() });
    }
    process.exitCode = 1;
    return;
  } finally {
    await browser.close();
  }

  const placed = open.map((s) => ({ ...s, place: `${s.facility} ${s.room.replace(/[(（]定員\d+[)）]/, '').trim()}` }));
  await Y.report(G, { site: 'setagaya', ward: '世田谷区', url: 'https://setagaya.keyakinet.net/Web/Home/WgR_ModeSelect' }, placed);
  // LINE: いつもの日（土曜）の空きと、YANAGIBAのまだ取れていない日の練習の時間に重なる空き
  // 予約サイトで○でも、先着予約がまだ始まっていない空きは送らない（始まったら送る）
  open = placed.filter((s) => s.usual !== false && (cfgDates.has(s.date) || Y.hitsGap(s, G, '世田谷区')) && Y.bookable(G, '世田谷区', s.place, s.date));
  const seen = new Set(state.notified);
  const fresh = open.filter((s) => !seen.has(L.slotKey(s)));
  console.log(`空き ${open.length}コマ（新しく見つかった分 ${fresh.length}コマ）`);
  if (process.env.DEBUG === '1' && open.length) console.log(`--- 通知文のプレビュー ---\n${L.buildMessage(open)}`);
  if (fresh.length) await line(L.buildMessage(fresh));
  // いま空いているコマだけ記録 → 埋まってまた空いたら再通知される
  await saveState({ notified: open.map(L.slotKey), lastErrorAt: state.lastErrorAt });
}

await main();
