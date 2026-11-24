// けやきネット（世田谷区）キャンセル待ち監視 → LINE通知
//   node watch.mjs                  … 監視して、新しい空きがあればLINEに送る
//   DEBUG=1 node watch.mjs          … 各画面のスクショ/HTMLを debug/ に保存
//   TEST_NOTIFY=1 node watch.mjs    … LINEにテスト送信だけする
import { chromium } from 'playwright';
import * as B from './browser.mjs';
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
const facilityOk = (c, G) => !L.badRoom(c.room) && !WD_ONLY.has(c.facility) || (G.dates.has(c.date) && !Y.isRestDay(c.date));
// いつもの条件（土曜はいつもの施設・部屋。YANAGIBAのまだ取れていない平日は平日用の施設の100㎡以上も）
// 部屋名に書いてある定員（例：「（定員60）」）
const capOf = (room) => { const m = L.norm(room).match(/定員(\d+)/); return m ? Number(m[1]) : null; };
const usualOk = (c, G) => facilityOk(c, G) && (L.roomOk(c.room, config.roomFilter) || (G.dates.has(c.date) && Y.bigEnough(L.areaOf(c.facility, c.room, rooms), c.date, capOf(c.room))));
// 空き検索の日は、いつもの施設と平日用の施設の、その広さの部屋
const searchOk = (c, G) => !L.badRoom(c.room) && Y.searchHit(G, c.date, L.areaOf(c.facility, c.room, rooms), capOf(c.room));

async function loadGrid(page, start, cfg = config, span = '1ヶ月', open = true) {
  if (open) await S.openFacilityGrid(page, cfg);
  await S.showMonthFrom(page, start, span);
  const { tables, cells } = await S.readGrid(page, cfg.facilities);
  if (!tables.length) throw new Error('施設別空き状況の表が読み取れません');
  const tdates = tables.map((t) => L.datesFromDays(t.monthLabel, t.days, start));
  if (!tdates[0].includes(start)) console.warn(`⚠ 表示開始日 ${start} が表に出ていません（${tdates[0][0]}〜）`);
  return cells.map((c) => ({ ...c, date: tdates[c.table][c.col], key: `${c.facility}|${c.room}|${tdates[c.table][c.col]}` }));
}

async function newPage(browser) {
  const ctx = await B.light(await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo', viewport: { width: 1280, height: 900 } }));
  const page = await ctx.newPage();
  page.on('dialog', async (d) => { console.warn(`ダイアログ: ${d.message()}`); await d.accept().catch(() => {}); });
  return { ctx, page };
}

// 見張る日を、1週間ごとのまとまりに分ける（このサイトは「1日」の表示がない）。1ヶ月の表は重いので使わない
function spans(dates) {
  return L.windows(dates, 7).map((start, i, all) => {
    return { start, until: all[i + 1], span: '1週間' };
  });
}

// ① 1つの画面で、まとまりごとに表示を切り替えて空き状況の表だけ読む（時間帯の画面には進まない）
async function readGrids(browser, wins, facilities, targets, G) {
  const cfg = { ...config, facilities };
  const { ctx, page } = await newPage(browser);
  try {
    const out = [];
    for (let i = 0; i < wins.length; i++) {
      const w = wins[i];
      const cells = await loadGrid(page, w.start, cfg, w.span, i === 0);
      const picks = cells.filter(
        (c) => c.date >= w.start && (!w.until || c.date < w.until) && targets.has(c.date) &&
          config.notifyMarks.includes(L.markOf(c.sym)) && (usualOk(c, G) || searchOk(c, G)),
      );
      console.log(`${w.start}〜（${w.span}）: 対象の空き候補 ${picks.length}コマ`);
      out.push({ ...w, facilities, picks });
    }
    return out;
  } catch (e) {
    await S.snap(page, 'error', true);
    throw e;
  } finally {
    await ctx.close();
  }
}

// ② 記号が変わったコマ・しばらく確かめていないコマだけ、時間帯の画面で確かめる（初めて見るコマ・記号が変わったコマは全部。6時間以上前に確かめたコマも少しずつ）
//   確かめなかったコマは、前回確かめた結果を使う
async function checkSlots(browser, w, cache, targets, G) {
  const prio = (c) => { const h = cache[c.key]; return !h || h.sym !== c.sym ? 0 : Date.parse(h.at); };
  const picks = [...w.picks].sort((a, b) => prio(a) - prio(b));
  const fresh = picks.filter((c) => prio(c) === 0);
  // 記号が同じでも6時間以上確かめていないコマは、確かめ直す（合わせて MAX_SELECT コマまで）
  const stale = picks.filter((c) => prio(c) !== 0 && Date.now() - prio(c) > 6 * 3600e3);
  const check = [...fresh, ...stale.slice(0, Math.max(0, MAX_SELECT - fresh.length))];
  for (const c of picks) console.log(`  ${c.date} ${c.facility} ${c.room} ${L.markOf(c.sym)}${check.includes(c) ? ' ←確認' : ''}`);
  const out = [];
  for (const c of picks.filter((c) => !check.includes(c))) out.push(...(cache[c.key]?.slots || []));
  for (let i = 0; i < check.length; i += MAX_SELECT) out.push(...(await retry(() => checkChunk(browser, w, check.slice(i, i + MAX_SELECT), cache, targets, G))));
  return out;
}
async function checkChunk(browser, w, check, cache, targets, G) {
  const out = [];
  const cfg = { ...config, facilities: w.facilities };
  const { ctx, page } = await newPage(browser);
  try {
    const cells = await loadGrid(page, w.start, cfg, w.span);
    const keys = new Set(check.map((c) => c.key));
    await S.selectCells(page, cells.filter((c) => keys.has(c.key)).map((c) => c.id));
    const raw = await S.readSlots(page, cfg.facilities);
    const now = new Date().toISOString();
    for (const c of check) cache[c.key] = { sym: c.sym, at: now, slots: [] };
    const slots = raw
      .filter((s) => L.markOf(s.sym) === '○')
      .map((s) => ({ facility: s.facility, room: s.room, date: L.parseJpDate(s.dateText), time: L.fmtTime(s.time), area: L.areaOf(s.facility, s.room, rooms) }))
      .filter((s) => s.date && targets.has(s.date))
      .map((s) => ({ ...s, usual: usualOk(s, G) }))
      .filter((s) => s.usual || searchOk(s, G));
    console.log(`  時間帯の表 ${raw.length}マス / 空き ${slots.length}コマ`);
    if (!raw.length) console.log('  時間帯画面の文字: ' + (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 1500));
    for (const s of slots) {
      out.push(s);
      const n = L.norm(s.room);
      const c = check.find((c) => c.facility === s.facility && c.date === s.date && (n.startsWith(L.norm(c.room)) || L.norm(c.room).startsWith(n)));
      if (c) cache[c.key].slots.push(s);
      else console.log(`  ⚠ 表のコマと結びつけられない空き: ${s.facility} ${s.room}`);
    }
    return out;
  } catch (e) {
    await S.snap(page, 'error', true);
    throw e;
  } finally {
    await ctx.close();
  }
}

// サイトが一時的に重くて止まったときは、30秒待ってもう一度だけやり直す
const retry = (run) => run().catch(async (e) => {
  console.log(`1回目は失敗（${e.message.split('\n')[0]}）。30秒後にもう一度やってみます`);
  await new Promise((r) => setTimeout(r, 30000));
  return run();
});

async function main() {
  if (process.env.TEST_NOTIFY === '1') { await line('✅ けやきネット監視のテスト通知です'); return; }

  const hour = L.jstHour();
  const q = config.quietHours;
  if (q && hour >= q.from && hour < q.to && process.env.FORCE !== '1') { console.log('深夜のためお休み'); return; }

  const today = L.jstToday();
  const G = await Y.load(config.watch, today, '世田谷区');
  // 見張るのは、YANAGIBAのまだ取れていない日と、空き検索の日だけ（LINEもアプリと同じ範囲）
  const dates = [...new Set([...G.dates, ...G.sdates])].sort();
  if (!dates.length) { console.log('見張る日付がありません'); return; }
  console.log(`見張る日付: ${dates.map(L.label).join(' ')}`);
  const targets = new Set(dates);

  const state = await loadState();
  const browser = await chromium.launch();
  const cache = state.cells || {};
  let open = [];
  try {
    const wins = spans(dates);
    // 施設のまとまりごとに、見るべき週だけ（平日用の施設は、まだ取れていない平日か空き検索のある週だけ）
    const groups = new Map();
    for (const w of wins) for (const f of facilityGroups(w.start, w.until, G)) {
      const k = f.join('|');
      if (!groups.has(k)) groups.set(k, { f, wins: [] });
      groups.get(k).wins.push(w);
    }
    for (const { f, wins: ws } of groups.values()) {
      const read = await retry(() => readGrids(browser, ws, f, targets, G));
      for (const w of read) if (w.picks.length) open.push(...(await checkSlots(browser, w, cache, targets, G)));
    }
    for (const s of open) console.log(`  空き: ${L.label(s.date)} ${s.facility} ${s.room} ${s.time}`);
  } catch (e) {
    console.error(`❌ ${e.message}\n${(e.stack || '').split('\n').slice(1, 4).join('\n')}`);
    const last = state.lastErrorAt ? Date.parse(state.lastErrorAt) : 0;
    // 1回だけのエラー（サイトが一時的に重い・つながりにくいなど）はお知らせしない。2回続けて失敗したらお知らせ
    const fails = (state.fails || 0) + 1;
    if (fails >= 2 && Date.now() - last > 12 * 3600e3) {
      await line(`⚠️ けやきネット監視でエラー\n${e.message.slice(0, 300)}\n（12時間に1回だけお知らせします）`).catch(() => {});
      await saveState({ ...state, cells: cache, lastErrorAt: new Date().toISOString(), fails });
    } else await saveState({ ...state, cells: cache, fails });
    process.exitCode = 1;
    return;
  } finally {
    await browser.close();
  }

  const placed = open.map((s) => ({ ...s, place: `${s.facility} ${s.room.replace(/[(（]定員\d+[)）]/, '').trim()}` }));
  await Y.report(G, { site: 'setagaya', ward: '世田谷区', url: 'https://setagaya.keyakinet.net/Web/Home/WgR_ModeSelect', stateDir: 'state' }, placed);
  // LINE: アプリのお知らせと同じ範囲（まだ取れていない日の練習の時間に重なる空き・空き検索に当てはまる空き）
  // 予約サイトで○でも、先着予約がまだ始まっていない空きは送らない（始まったら送る）
  open = placed.filter((s) => Y.lineOk(s, G, '世田谷区', placed));
  const seen = new Set(state.notified);
  const fresh = open.filter((s) => !seen.has(L.slotKey(s)));
  console.log(`空き ${open.length}コマ（新しく見つかった分 ${fresh.length}コマ）`);
  if (process.env.DEBUG === '1' && open.length) console.log(`--- 通知文のプレビュー ---\n${L.buildMessage(open)}`);
  // 新しく空いたコマに、つながる今の空きも足して「13:00〜17:30」のように送る（練習の時間の外まで続く空きも足す。アプリの表示と同じ）
  if (fresh.length) await line(L.buildMessage(L.widen(fresh, placed)));
  // いま空いているコマだけ記録 → 埋まってまた空いたら再通知される
  const cells = Object.fromEntries(Object.entries(cache).filter(([k]) => k.split('|').at(-1) > today));
  await saveState({ notified: open.map(L.slotKey), cells, lastErrorAt: state.lastErrorAt });
}

await main();
