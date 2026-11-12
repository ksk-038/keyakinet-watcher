// 文の京 施設予約ねっと（文京区）空き監視 → LINE通知
//   node bunkyo/watch.mjs                  … 監視して、新しい空きがあればLINEに送る
//   DEBUG=1 node bunkyo/watch.mjs          … 各画面のスクショ/HTMLを debug-bunkyo/ に保存
//   TEST_NOTIFY=1 node bunkyo/watch.mjs    … LINEにテスト送信だけする
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import * as L from '../lib.mjs';
import * as S from './scrape.mjs';

const config = JSON.parse(await fs.readFile(new URL('./config.json', import.meta.url), 'utf8'));
const STATE_FILE = 'state-bunkyo/state.json';
const MAX_SELECT = 10;

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
  await fs.mkdir('state-bunkyo', { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(s, null, 2));
}

// 記号: 画面上は ○△ だが、読み取ると「空き」「一部空き」などの文字になる
export function markOf(raw) {
  const t = L.norm(raw);
  if (/空きなし|[×✕]/.test(t)) return '×';
  if (/一部空き|問合せ|△/.test(t)) return '△';
  if (/空き|[○◯〇]/.test(t)) return '○';
  return t || '?';
}

// 部屋の条件: 定員80以上 or 定員が書いていない（「学生」などの部屋は除く）
export function roomOk(c, f) {
  if ((f.excludeRoomWords || []).some((w) => L.norm(c.room).includes(w))) return false;
  if (c.cap == null) return f.includeUnlabeled !== false;
  return c.cap >= f.minCapacity;
}

// 「11/15」→ 年を補って 2026-11-15（年またぎ対応）
function mdToDate([m, d], start) {
  const [y0, m0] = start.split('-').map(Number);
  return L.ymd(m < m0 ? y0 + 1 : y0, m, d);
}

function buildMessage(slots) {
  const byDate = new Map();
  for (const s of slots) {
    const k = `${s.facility} ${s.room.replace(/[«≪《].*$/, '').trim()}${s.cap ? `（定員${s.cap}）` : ''}`;
    if (!byDate.has(s.date)) byDate.set(s.date, new Map());
    const m = byDate.get(s.date);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(s.time);
  }
  const lines = ['🎉 文京区の施設に空きが出ました'];
  for (const date of [...byDate.keys()].sort()) {
    lines.push('', `📅 ${L.label(date)}`);
    for (const [room, times] of byDate.get(date)) lines.push(`・${room}`, `  ${times.join(' / ')}`);
  }
  lines.push('', `予約: ${S.TOP}`);
  return lines.join('\n');
}

async function newPage(browser) {
  const ctx = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', async (d) => { console.warn(`ダイアログ: ${d.message()}`); await d.accept().catch(() => {}); });
  return { ctx, page };
}

async function loadGrid(page, start) {
  await S.openFacilityGrid(page, config);
  await S.showMonthFrom(page, start);
  const { tables, cells } = await S.readGrid(page, config.facilities);
  if (!tables.length) throw new Error('施設別空き状況の表が読み取れません');
  const tdates = tables.map((t) => t.mds.map((md) => mdToDate(md, start)));
  console.log(`表 ${tables.length}個（${tdates[0][0]}〜${tdates[0].at(-1)}）`);
  return cells.map((c) => ({ ...c, date: tdates[c.table][c.col], key: `${c.facility}|${c.room}|${tdates[c.table][c.col]}` }));
}

async function scanWindow(browser, start, until, targets) {
  let { ctx, page } = await newPage(browser);
  try {
    let cells = await loadGrid(page, start);
    const picks = cells.filter(
      (c) => c.date >= start && (!until || c.date < until) && targets.has(c.date) &&
        config.notifyMarks.includes(markOf(c.sym)) && roomOk(c, config.roomFilter),
    );
    if (process.env.DEBUG === '1') {
      const tg = cells.filter((c) => targets.has(c.date) && c.date >= start && (!until || c.date < until));
      const cnt = {};
      for (const c of tg) cnt[c.sym || '(空)'] = (cnt[c.sym || '(空)'] || 0) + 1;
      console.log(`  見張る日の記号の内訳: ${JSON.stringify(cnt)}`);
      const any = cells.filter((c) => ['○', '△'].includes(markOf(c.sym))).slice(0, 5);
      console.log(`  ○△の例: ${any.map((c) => `${c.date} ${c.facility} ${c.room.slice(0, 15)} ${c.sym}`).join(' / ')}`);
    }
    console.log(`${start}〜: 対象の空き候補 ${picks.length}コマ`);
    for (const c of picks) console.log(`  ${c.date} ${c.facility} ${c.room} 定員${c.cap ?? '表記なし'} ${markOf(c.sym)}`);

    const out = [];
    for (let i = 0; i < picks.length; i += MAX_SELECT) {
      const group = picks.slice(i, i + MAX_SELECT);
      const keys = new Set(group.map((c) => c.key));
      if (i > 0) {
        await ctx.close();
        ({ ctx, page } = await newPage(browser));
        cells = await loadGrid(page, start);
      }
      const ids = cells.filter((c) => keys.has(c.key)).map((c) => c.id);
      await S.selectCells(page, ids);
      const raw = await S.readSlots(page, config.facilities);
      const capOf = new Map(group.map((c) => [`${c.facility}|${L.norm(c.room)}`, c.cap]));
      const slots = raw
        .filter((s) => (config.slotMarks || ['○']).includes(markOf(s.sym)))
        .map((s) => ({
          facility: s.facility,
          room: s.room,
          cap: capOf.get(`${s.facility}|${L.norm(s.room)}`) ?? (L.norm(s.room).match(/定員(\d+)/) || [])[1],
          date: L.parseJpDate(s.dateText),
          time: L.fmtTime(s.time) || '時間帯不明',
        }))
        .filter((s) => s.date && targets.has(s.date));
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
  if (process.env.TEST_NOTIFY === '1') { await line('✅ 文京区 空き監視のテスト通知です'); return; }

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
  const open = [];
  try {
    const starts = L.windows(dates);
    for (let i = 0; i < starts.length; i++) open.push(...(await scanWindow(browser, starts[i], starts[i + 1], targets)));
    for (const s of open) console.log(`  空き: ${L.label(s.date)} ${s.facility} ${s.room} ${s.time}`);
  } catch (e) {
    console.error(`❌ ${e.message}\n${(e.stack || '').split('\n').slice(1, 4).join('\n')}`);
    const last = state.lastErrorAt ? Date.parse(state.lastErrorAt) : 0;
    if (Date.now() - last > 12 * 3600e3) {
      await line(`⚠️ 文京区 空き監視でエラー\n${e.message.slice(0, 300)}\n（12時間に1回だけお知らせします）`).catch(() => {});
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
  if (process.env.DEBUG === '1' && open.length) console.log(`--- 通知文のプレビュー ---\n${buildMessage(open)}`);
  if (fresh.length) await line(buildMessage(fresh));
  await saveState({ notified: open.map(L.slotKey), lastErrorAt: state.lastErrorAt });
}

await main();
