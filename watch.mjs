// けやきネット（世田谷区）キャンセル待ち監視 → LINE通知
//   node watch.mjs                  … 監視して、新しい空きがあればLINEに送る
//   DEBUG=1 node watch.mjs          … 各画面のスクショ/HTMLを debug/ に保存
//   TEST_NOTIFY=1 node watch.mjs    … LINEにテスト送信だけする
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import * as L from './lib.mjs';
import * as S from './scrape.mjs';

const config = JSON.parse(await fs.readFile(new URL('./config.json', import.meta.url), 'utf8'));
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

// 1ヶ月分の表示1回ぶん: 候補セルを選んで時間帯の空きを返す
async function scanWindow(browser, start, targets) {
  const ctx = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', async (d) => { console.warn(`ダイアログ: ${d.message()}`); await d.accept().catch(() => {}); });
  try {
    await S.openFacilityGrid(page, config);
    await S.showMonthFrom(page, start);
    const { tables, cells } = await S.readGrid(page, config.facilities);
    if (!tables.length) throw new Error('施設別空き状況の表が読み取れません');

    const tdates = tables.map((t) => L.datesFromDays(t.monthLabel, t.days, start));
    if (!tdates[0].includes(start)) console.warn(`⚠ 表示開始日 ${start} が表に出ていません（${tdates[0][0]}〜）`);

    const picks = cells.filter((c) => {
      const date = tdates[c.table][c.col];
      return targets.has(date) && config.notifyMarks.includes(L.markOf(c.sym)) && L.roomOk(c.room, config.roomFilter);
    });
    console.log(`${start}〜: 表${tables.length}個 / 対象の空き候補 ${picks.length}コマ`);
    for (const c of picks) console.log(`  ${tdates[c.table][c.col]} ${c.facility} ${c.room} ${L.markOf(c.sym)}`);
    if (!picks.length) return [];

    await S.selectCells(page, picks.map((c) => c.id));
    const raw = await S.readSlots(page, config.facilities);
    return raw
      .filter((s) => L.markOf(s.sym) === '○')
      .map((s) => ({ facility: s.facility, room: s.room, date: L.parseJpDate(s.dateText), time: L.fmtTime(s.time) }))
      .filter((s) => s.date && targets.has(s.date));
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
  const dates = L.targetDates(config.watch, today);
  if (!dates.length) { console.log('見張る日付がありません'); return; }
  console.log(`見張る日付: ${dates.map(L.label).join(' ')}`);
  const targets = new Set(dates);

  const state = await loadState();
  const browser = await chromium.launch();
  let open = [];
  try {
    for (const start of L.windows(dates)) open.push(...(await scanWindow(browser, start, targets)));
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

  const seen = new Set(state.notified);
  const fresh = open.filter((s) => !seen.has(L.slotKey(s)));
  console.log(`空き ${open.length}コマ（新しく見つかった分 ${fresh.length}コマ）`);
  if (fresh.length) await line(L.buildMessage(fresh));
  // いま空いているコマだけ記録 → 埋まってまた空いたら再通知される
  await saveState({ notified: open.map(L.slotKey), lastErrorAt: state.lastErrorAt });
}

await main();
