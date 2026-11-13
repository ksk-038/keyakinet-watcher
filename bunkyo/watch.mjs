// 文の京 施設予約ねっと（文京区）空き監視 → LINE通知
//   node bunkyo/watch.mjs                  … 監視して、新しい空きがあればLINEに送る
//   DEBUG=1 node bunkyo/watch.mjs          … 各画面のスクショ/HTMLを debug-bunkyo/ に保存
//   TEST_NOTIFY=1 node bunkyo/watch.mjs    … LINEにテスト送信だけする
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import * as L from '../lib.mjs';
import * as S from './scrape.mjs';

const config = JSON.parse(await fs.readFile(new URL('./config.json', import.meta.url), 'utf8'));
const ROOMS = JSON.parse(await fs.readFile(new URL('./rooms.json', import.meta.url), 'utf8'));
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

// 部屋の広さ(㎡)。rooms.json にあれば使う。わからなければ null
const areaOf = (facility, room) => L.areaOf(facility, room.replace(/[≪«《].*$/, ''), ROOMS);

// 部屋の条件: 広さがわかれば150㎡以上。わからなければ 定員80以上 or 定員が書いていない（「学生」などの部屋は除く）
export function roomOk(c, f) {
  if ((f.excludeRoomWords || []).some((w) => L.norm(c.room).includes(w))) return false;
  // 特例: 広さや定員に関係なく必ず見張る部屋（「施設名+部屋名」の一部）
  if ((f.includeRoomWords || []).some((w) => L.norm(c.facility + c.room).includes(L.norm(w)))) return true;
  const area = areaOf(c.facility, c.room);
  if (area != null && f.minArea) return area >= f.minArea;
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
    const area = areaOf(s.facility, s.room);
    const k = `${s.facility} ${s.room.replace(/[«≪《].*$/, '').trim()}${area ? `（${Math.round(area)}㎡）` : s.cap ? `（定員${s.cap}）` : ''}`;
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

// 1ヶ月分の表を読み、○△のコマのうち最大 maxCheckPerWindow 件を時間帯画面で確認する
//   前回から記号が変わったコマ → 確認してから時間が経ったコマ の順。確認しなかったコマは前回の結果を使う
async function scanWindow(browser, start, until, targets, cache) {
  const { ctx, page } = await newPage(browser);
  try {
    const cells = await loadGrid(page, start);
    const picks = cells.filter(
      (c) => c.date >= start && (!until || c.date < until) && targets.has(c.date) &&
        config.notifyMarks.includes(markOf(c.sym)) && roomOk(c, config.roomFilter),
    );
    const prio = (c) => { const h = cache[c.key]; return !h || h.sym !== c.sym ? 0 : Date.parse(h.at); };
    picks.sort((a, b) => prio(a) - prio(b));
    const check = picks.slice(0, config.maxCheckPerWindow || MAX_SELECT);
    console.log(`${start}〜: 対象の空き候補 ${picks.length}コマ（今回確認 ${check.length}コマ）`);
    for (const c of picks) console.log(`  ${c.date} ${c.facility} ${c.room.slice(0, 20)} ${areaOf(c.facility, c.room) ?? '広さ不明'}㎡ 定員${c.cap ?? '表記なし'} ${markOf(c.sym)}${check.includes(c) ? ' ←確認' : ''}`);

    const out = [];
    for (const c of picks.filter((c) => !check.includes(c))) out.push(...(cache[c.key]?.slots || []));
    if (check.length) {
      await S.selectCells(page, check.map((c) => c.id));
      const raw = await S.readSlots(page, config.facilities);
      console.log(`  時間帯 ${raw.length}コマ`);
      if (process.env.DEBUG === '1') for (const r of raw) console.log(`    ${r.dateText} ${r.facility} ${r.room.slice(0, 12)} ${r.time} [${r.sym}]`);
      const now = new Date().toISOString();
      for (const c of check) cache[c.key] = { sym: c.sym, at: now, slots: [] };
      for (const r of raw) {
        const date = L.parseJpDate(r.dateText);
        if (!date || !targets.has(date) || !(config.slotMarks || ['○']).includes(markOf(r.sym))) continue;
        const slot = { facility: r.facility, room: r.room, cap: r.cap, date, time: L.fmtTime(r.time) || '時間帯不明' };
        out.push(slot);
        // 部屋名の表記が表と時間帯画面で違うので、施設・日付・部屋名の先頭で対応づける
        const c = check.find((c) => c.facility === r.facility && c.date === date && L.norm(r.room).startsWith(L.norm(c.room).replace(/[≪«《].*$/, '')));
        if (c) cache[c.key].slots.push(slot);
      }
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
  const cache = state.cells || {};
  try {
    const starts = L.windows(dates).slice(0, Number(process.env.MAX_WINDOWS) || undefined);
    for (let i = 0; i < starts.length; i++) open.push(...(await scanWindow(browser, starts[i], starts[i + 1], targets, cache)));
    for (const s of open) console.log(`  空き: ${L.label(s.date)} ${s.facility} ${s.room} ${s.time}`);
  } catch (e) {
    console.error(`❌ ${e.message}\n${(e.stack || '').split('\n').slice(1, 4).join('\n')}`);
    const last = state.lastErrorAt ? Date.parse(state.lastErrorAt) : 0;
    if (Date.now() - last > 12 * 3600e3) {
      await line(`⚠️ 文京区 空き監視でエラー\n${e.message.slice(0, 300)}\n（12時間に1回だけお知らせします）`).catch(() => {});
      await saveState({ ...state, cells: cache, lastErrorAt: new Date().toISOString() });
    }
    if (Date.now() - last <= 12 * 3600e3) await saveState({ ...state, cells: cache });
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
  const cells = Object.fromEntries(Object.entries(cache).filter(([k]) => k.split('|').at(-1) > today));
  await saveState({ notified: open.map(L.slotKey), cells, lastErrorAt: state.lastErrorAt });
}

await main();
