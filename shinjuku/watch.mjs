// 新宿区「しせつよやく」空き監視 → LINE通知
//   node shinjuku/watch.mjs                  … 監視して、新しい空きがあればLINEに送る
//   DEBUG=1 node shinjuku/watch.mjs          … 読み取った中身をログに出し、画面を debug-shinjuku/ に保存
//   TEST_NOTIFY=1 node shinjuku/watch.mjs    … LINEにテスト送信だけする
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import * as L from '../lib.mjs';
import * as S from './scrape.mjs';
import * as Y from '../yanagiba.mjs';

// SITE=chiiki で地域センター版（config-chiiki.json）。指定なしは「しせつよやく」（config.json）
const SITE = process.env.SITE || '';
const config = JSON.parse(await fs.readFile(new URL(SITE ? `./config-${SITE}.json` : './config.json', import.meta.url), 'utf8'));
const ROOMS = JSON.parse(await fs.readFile(new URL(`./${config.roomsFile || 'rooms.json'}`, import.meta.url), 'utf8'));
const NAME = config.name || '新宿区';
// 区の名前（YANAGIBAとのやりとり用）と、アプリに送るときのサイト名
const WARD = config.ward || '新宿区';
const SITE_KEY = config.site || (SITE ? `shinjuku-${SITE}` : 'shinjuku');
const TOP = config.url || S.TOP;
const STATE_DIR = SITE ? `state-shinjuku-${SITE}` : 'state-shinjuku';
const STATE_FILE = `${STATE_DIR}/state.json`;
const DEBUG = process.env.DEBUG === '1';

async function line(text) {
  // 長い通知は吹き出しを分ける（1回の送信に最大5つ。LINEの通数は1回分）
  const parts = [];
  let cur = '';
  for (const ln of text.split('\n')) {
    if (cur && cur.length + ln.length + 1 > 4800) { parts.push(cur); cur = ''; }
    cur = cur ? `${cur}\n${ln}` : ln;
  }
  if (cur) parts.push(cur);
  if (parts.length > 5) parts.splice(4, Infinity, `${parts[4].slice(0, 4700)}\n…（長いので省略しました。サイトで確認してください）`);
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const to = process.env.LINE_USER_ID;
  if (!token || !to) { console.log(`[LINE未設定のため表示のみ]\n${text}`); return; }
  const r = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages: parts.map((t) => ({ type: 'text', text: t.slice(0, 4990) })) }),
  });
  if (!r.ok) throw new Error(`LINE送信に失敗 ${r.status}: ${await r.text()}`);
}

async function loadState() {
  try { return JSON.parse(await fs.readFile(STATE_FILE, 'utf8')); } catch { return { notified: [], first: true }; }
}
async function saveState(s) {
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(s, null, 2));
}

// 部屋の広さ(㎡)を rooms.json から探す（全角・半角や空白の違いは無視）。わからなければ null
export function areaOf(building, room) {
  const t = ROOMS[Object.keys(ROOMS).find((k) => L.norm(k) === L.norm(building))] || {};
  const k = Object.keys(t).find((k) => L.norm(k) === L.norm(room));
  return k ? t[k] : null;
}

// 表の区分（午前・午後・夜間）の時刻。午後1・午後2がある部屋は labelTimes4。館ごとに違うところは labelTimesBy
function labelTimes(building, cells) {
  const four = cells.some((c) => /午後(1|2|I|II)$/.test(L.norm(c.label)));
  const by = (config.labelTimesBy || []).find((x) => new RegExp(x.building).test(L.norm(building)));
  return (four ? by?.times4 || config.labelTimes4 : by?.times) || config.labelTimes || {};
}

// 部屋の条件: 150㎡以上 or 広さ不明
//   広さ不明でも、部屋名に「（２４）」のような定員があり minCapacityIfUnknown 未満なら小部屋として外す
function roomOk(area, f = {}, room = '') {
  if (area == null) {
    const cap = L.norm(room).match(/\((\d+)\)$/);
    if (cap && f.minCapacityIfUnknown && Number(cap[1]) < f.minCapacityIfUnknown) return false;
    return f.includeUnlabeled !== false;
  }
  return !f.minArea || area >= f.minArea;
}

// 表のアイコン（画像の説明文）: 「空き」「予約あり」など
export function markOf(raw) {
  const t = L.norm(raw);
  if (/予約あり|空きなし|[×✕]/.test(t)) return '×';
  if (/一部|△/.test(t)) return '△';
  if (/空き|[○◯〇]/.test(t)) return '○';
  return t || '?';
}

// 「9:00〜9:55」「10:00〜10:55」のような続きのコマは「9:00〜10:55」にまとめる
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
function mergeTimes(times) {
  const rs = times.map((t) => t.match(/(\d{1,2}:\d{2})〜(\d{1,2}:\d{2})/)).filter(Boolean).map((m) => [m[1], m[2]])
    .sort((a, b) => toMin(a[0]) - toMin(b[0]));
  if (rs.length !== times.length) return times;
  const out = [];
  for (const r of rs) {
    const p = out.at(-1);
    if (p && toMin(r[0]) - toMin(p[1]) <= 15) { if (toMin(r[1]) > toMin(p[1])) p[1] = r[1]; } else out.push([...r]);
  }
  return out.map(([a, b]) => `${a}〜${b}`);
}

function buildMessage(slots, title = `🎉 ${NAME}に空きが出ました`) {
  const byDate = new Map();
  for (const s of slots) {
    const k = `${s.building} ${s.room.replace(/\s+/g, ' ')}${s.area ? `（${Math.round(s.area)}㎡）` : ''}`;
    if (!byDate.has(s.date)) byDate.set(s.date, new Map());
    const m = byDate.get(s.date);
    if (!m.has(k)) m.set(k, []);
    if (!m.get(k).includes(s.time)) m.get(k).push(s.time);
  }
  const lines = [title];
  for (const date of [...byDate.keys()].sort()) {
    lines.push('', `📅 ${L.label(date)}`);
    for (const [room, times] of byDate.get(date)) lines.push(`・${room}`, `  ${mergeTimes(times).join(' / ')}`);
  }
  lines.push('', `予約: ${TOP}`);
  return lines.join('\n');
}

async function scan(browser, targets, G) {
  const ctx = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', async (d) => { console.warn(`ダイアログ: ${d.message()}`); await d.accept().catch(() => {}); });
  const weekdays = [...new Set(targets.map(L.weekday))];
  const tset = new Set(targets);
  const done = new Set(); // 同じ部屋・同じ表示期間を2回読まない（目的が2つあるため）
  const marks = new Map();
  const open = [];
  try {
    // どこで: config.area（1つ）か config.areas（"all" で「〜(すべて)」を全部）
    const areas = config.areas === 'all' ? await S.areaOptions(page, TOP) : config.areas || [config.area];
    for (const area of areas)
    for (const purpose of config.purposes) {
      let i = 0;
      while (i < targets.length) {
        const start = targets[i];
        const { buildings, viewDays } = await S.search(page, { top: TOP, area, purpose, start, weekdays });
        console.log(`【${area}・${purpose}】${start}〜 表示: ${viewDays.map(L.label).join(' ')} / 館 ${buildings.length}`);
        for (const b of buildings) {
          // 外す館（品川区の児童センター・学校など）
          if ((config.excludeBuildingWords || []).some((w) => L.norm(b.name).includes(L.norm(w)))) continue;
          const rooms = await S.selectBuilding(page, b.value);
          for (const r of rooms) {
            if ((config.excludeRoomWords || []).some((w) => L.norm(r.name).includes(L.norm(w)))) continue;
            const area = areaOf(b.name, r.name);
            // いつもの条件。YANAGIBAのまだ取れていない平日は100㎡以上も
            const usual = roomOk(area, config.roomFilter, r.name);
            // 空き検索の日は、その広さの部屋も
            const srch = (G.sdates?.size || 0) > 0 && [...G.sdates].some((d) => Y.searchHit(G, d, area));
            if (!usual && !srch && !(G.dates.size && area != null && area >= 100)) continue;
            const key = `${start}|${b.value}|${r.value}`;
            if (done.has(key)) continue;
            done.add(key);
            const cells = await S.readRoom(page, r.value);
            const isUsual = (c) => usual || (G.dates.has(c.date) && Y.bigEnough(area, c.date));
            const hits = cells.filter((c) => tset.has(c.date) && config.notifyMarks.includes(markOf(c.sym)) &&
              (isUsual(c) || Y.searchHit(G, c.date, area)));
            for (const c of cells) marks.set(c.sym, (marks.get(c.sym) || 0) + 1);
            console.log(`  ${b.name} ${r.name}（${area ?? '広さ不明'}${area ? '㎡' : ''}）: ${cells.length}コマ中 空き${hits.length}`);
            const lt = labelTimes(b.name, cells);
            for (const c of hits) {
              open.push({ building: b.name, room: r.name, area, date: c.date, time: L.fmtTime(c.time) || lt[L.norm(c.label)] || L.norm(c.label), usual: isUsual(c) });
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
  if (process.env.TEST_NOTIFY === '1') { await line(`✅ ${NAME} 空き監視のテスト通知です`); return; }

  const hour = L.jstHour();
  const q = config.quietHours;
  if (q && hour >= q.from && hour < q.to && process.env.FORCE !== '1') { console.log('深夜のためお休み'); return; }

  const today = L.jstToday();
  const G = await Y.load(config.watch, today, WARD);
  // 見張るのは、YANAGIBAのまだ取れていない日と、空き検索の日だけ（LINEもアプリと同じ範囲）
  const dates = [...new Set([...G.dates, ...G.sdates])].sort();
  if (!dates.length) { console.log('見張る日付がありません'); return; }
  console.log(`見張る日付: ${dates.map(L.label).join(' ')}`);

  const state = await loadState();
  const browser = await chromium.launch();
  let open;
  try {
    open = await scan(browser, dates, G);
  } catch (e) {
    console.error(`❌ ${e.message}\n${(e.stack || '').split('\n').slice(1, 4).join('\n')}`);
    const last = state.lastErrorAt ? Date.parse(state.lastErrorAt) : 0;
    if (Date.now() - last > 12 * 3600e3) {
      await line(`⚠️ ${NAME} 空き監視でエラー\n${e.message.slice(0, 300)}\n（12時間に1回だけお知らせします）`).catch(() => {});
      await saveState({ ...state, lastErrorAt: new Date().toISOString() });
    }
    process.exitCode = 1;
    return;
  } finally {
    await browser.close();
  }

  const placed = open.map((s) => ({ ...s, place: `${s.building} ${s.room.replace(/\s+/g, ' ')}` }));
  await Y.report(G, { site: SITE_KEY, ward: WARD, url: TOP }, placed);
  // LINE: アプリのお知らせと同じ範囲（まだ取れていない日の練習の時間に重なる空き・空き検索に当てはまる空き）
  // 予約サイトで○でも、先着予約がまだ始まっていない空きは送らない（始まったら送る）
  open = placed.filter((s) => Y.lineOk(s, G, WARD));
  const key = (s) => `${s.date}|${s.building}|${s.room}|${s.time}`;
  // 初めて動いたとき（通知記録がないとき）は、今ある空きを記録するだけ（全部が一度にLINEに届くのを防ぐ）
  if (state.first) console.log('初回のため、今ある空きは記録だけします（全部見たいときは notify_all で実行）');
  const seen = new Set(state.first ? open.map(key) : state.notified);
  const fresh = open.filter((s) => !seen.has(key(s)));
  console.log(`空き ${open.length}コマ（新しく見つかった分 ${fresh.length}コマ）`);
  if (DEBUG && open.length) console.log(`--- 通知文のプレビュー ---\n${buildMessage(open)}`);
  if (process.env.NOTIFY_ALL === '1') await line(open.length ? buildMessage(open, `📋 ${NAME}の今の空き状況（大きい部屋）`) : `📋 ${NAME}: 今は条件に合う空きがありません`);
  else if (fresh.length) await line(buildMessage(fresh));
  await saveState({ notified: open.map(key), lastErrorAt: state.lastErrorAt });
}

await main();
