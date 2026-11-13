// 新宿区「しせつよやく」空き監視 → LINE通知
//   node shinjuku/watch.mjs                  … 監視して、新しい空きがあればLINEに送る
//   DEBUG=1 node shinjuku/watch.mjs          … 読み取った中身をログに出し、画面を debug-shinjuku/ に保存
//   TEST_NOTIFY=1 node shinjuku/watch.mjs    … LINEにテスト送信だけする
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import * as L from '../lib.mjs';
import * as S from './scrape.mjs';

const config = JSON.parse(await fs.readFile(new URL('./config.json', import.meta.url), 'utf8'));
const STATE_FILE = 'state-shinjuku/state.json';
const DEBUG = process.env.DEBUG === '1';

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
  await fs.mkdir('state-shinjuku', { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(s, null, 2));
}

// 表のアイコン（画像の説明文）: 「空き」「予約あり」など
export function markOf(raw) {
  const t = L.norm(raw);
  if (/予約あり|空きなし|[×✕]/.test(t)) return '×';
  if (/一部|△/.test(t)) return '△';
  if (/空き|[○◯〇]/.test(t)) return '○';
  return t || '?';
}

function buildMessage(slots) {
  const byDate = new Map();
  for (const s of slots) {
    const k = `${s.building} ${s.room.replace(/\s+/g, ' ')}`;
    if (!byDate.has(s.date)) byDate.set(s.date, new Map());
    const m = byDate.get(s.date);
    if (!m.has(k)) m.set(k, []);
    if (!m.get(k).includes(s.time)) m.get(k).push(s.time);
  }
  const lines = ['🎉 新宿区の施設に空きが出ました'];
  for (const date of [...byDate.keys()].sort()) {
    lines.push('', `📅 ${L.label(date)}`);
    for (const [room, times] of byDate.get(date)) lines.push(`・${room}`, `  ${times.join(' / ')}`);
  }
  lines.push('', `予約: ${S.TOP}`);
  return lines.join('\n');
}

async function scan(browser, targets) {
  const ctx = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', async (d) => { console.warn(`ダイアログ: ${d.message()}`); await d.accept().catch(() => {}); });
  const weekdays = [...new Set(targets.map(L.weekday))];
  const tset = new Set(targets);
  const done = new Set(); // 同じ部屋・同じ表示期間を2回読まない（目的が2つあるため）
  const marks = new Map();
  const open = [];
  try {
    for (const purpose of config.purposes) {
      let i = 0;
      while (i < targets.length) {
        const start = targets[i];
        const { buildings, viewDays } = await S.search(page, { area: config.area, purpose, start, weekdays });
        console.log(`【${purpose}】${start}〜 表示: ${viewDays.map(L.label).join(' ')} / 館 ${buildings.length}`);
        for (const b of buildings) {
          const rooms = await S.selectBuilding(page, b.value);
          for (const r of rooms) {
            if ((config.excludeRoomWords || []).some((w) => L.norm(r.name).includes(L.norm(w)))) continue;
            const key = `${start}|${b.value}|${r.value}`;
            if (done.has(key)) continue;
            done.add(key);
            const cells = await S.readRoom(page, r.value);
            const hits = cells.filter((c) => tset.has(c.date) && config.notifyMarks.includes(markOf(c.sym)));
            for (const c of cells) marks.set(c.sym, (marks.get(c.sym) || 0) + 1);
            console.log(`  ${b.name} ${r.name}: ${cells.length}コマ中 空き${hits.length}`);
            for (const c of hits) {
              open.push({ building: b.name, room: r.name, date: c.date, time: `${L.norm(c.label)} ${L.fmtTime(c.time)}`.trim() });
            }
          }
        }
        // 表に出た最後の日の次から続きを見る
        const last = viewDays.at(-1);
        const next = last ? targets.findIndex((d) => d > last) : -1;
        if (next <= i) break;
        i = next;
      }
    }
  } catch (e) {
    await S.snap(page, 'error', true);
    throw e;
  } finally {
    await ctx.close();
  }
  console.log(`表のアイコン: ${[...marks].map(([k, v]) => `${k || '(空)'}×${v}`).join(' ')}`);
  return open;
}

async function main() {
  if (process.env.TEST_NOTIFY === '1') { await line('✅ 新宿区 空き監視のテスト通知です'); return; }

  const hour = L.jstHour();
  const q = config.quietHours;
  if (q && hour >= q.from && hour < q.to && process.env.FORCE !== '1') { console.log('深夜のためお休み'); return; }

  const today = L.jstToday();
  const dates = L.targetDates(config.watch, today);
  if (!dates.length) { console.log('見張る日付がありません'); return; }
  console.log(`見張る日付: ${dates.map(L.label).join(' ')}`);

  const state = await loadState();
  const browser = await chromium.launch();
  let open;
  try {
    open = await scan(browser, dates);
  } catch (e) {
    console.error(`❌ ${e.message}\n${(e.stack || '').split('\n').slice(1, 4).join('\n')}`);
    const last = state.lastErrorAt ? Date.parse(state.lastErrorAt) : 0;
    if (Date.now() - last > 12 * 3600e3) {
      await line(`⚠️ 新宿区 空き監視でエラー\n${e.message.slice(0, 300)}\n（12時間に1回だけお知らせします）`).catch(() => {});
      await saveState({ ...state, lastErrorAt: new Date().toISOString() });
    }
    process.exitCode = 1;
    return;
  } finally {
    await browser.close();
  }

  const key = (s) => `${s.date}|${s.building}|${s.room}|${s.time}`;
  const seen = new Set(state.notified);
  const fresh = open.filter((s) => !seen.has(key(s)));
  console.log(`空き ${open.length}コマ（新しく見つかった分 ${fresh.length}コマ）`);
  if (DEBUG && open.length) console.log(`--- 通知文のプレビュー ---\n${buildMessage(open)}`);
  if (fresh.length) await line(buildMessage(fresh));
  await saveState({ notified: open.map(key), lastErrorAt: state.lastErrorAt });
}

await main();
