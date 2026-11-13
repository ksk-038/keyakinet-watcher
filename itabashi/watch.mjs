// 板橋区「ITAリザーブ」空き監視 → LINE通知
//   node itabashi/watch.mjs                  … 監視して、新しい空きがあればLINEに送る
//   DEBUG=1 node itabashi/watch.mjs          … 読み取った中身をログに出し、画面を debug-itabashi/ に保存
//   TEST_NOTIFY=1 node itabashi/watch.mjs    … LINEにテスト送信だけする
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import * as L from '../lib.mjs';
import * as S from './scrape.mjs';

const config = JSON.parse(await fs.readFile(new URL('./config.json', import.meta.url), 'utf8'));
const ROOMS = JSON.parse(await fs.readFile(new URL('./rooms.json', import.meta.url), 'utf8'));
const NAME = '板橋区';
const STATE_DIR = 'state-itabashi';
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
  try { return JSON.parse(await fs.readFile(STATE_FILE, 'utf8')); } catch { return { notified: [] }; }
}
async function saveState(s) {
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(s, null, 2));
}

// 部屋名「仲宿地域センターレクホール（１４０名）」「仲町地域センター第１レクホール　１７０名」→ 名前と定員
export function splitRoom(raw) {
  const t = (raw || '').normalize('NFKC').trim();
  const m = t.match(/[\s(（【]*(\d+)名[)）】]?\s*$/);
  return { name: (m ? t.slice(0, m.index) : t).trim(), cap: m ? Number(m[1]) : null };
}

// 施設の見出し（地域センター・集会所など）と部屋名から、通知で見せる名前
function display(building, name) {
  if (['地域センター', '集会所'].includes(building) || L.norm(name).includes(L.norm(building))) return name;
  return `${building} ${name}`;
}

// 部屋の広さ(㎡)を rooms.json から（通知に出る部屋名で探す）。わからなければ null
export function areaOf(label) {
  const k = Object.keys(ROOMS).find((k) => k !== '_説明' && L.norm(k) === L.norm(label));
  return k ? ROOMS[k] : null;
}

// 部屋の条件: 広さが分かれば150㎡以上。広さ不明なら対象
//   ただし広さ不明でも、定員が minCapacityIfUnknown（100名）未満なら小部屋として外す
export function roomOk({ cap, area }, f = {}) {
  if (area != null) return area >= (f.minArea ?? 150);
  if (cap != null && f.minCapacityIfUnknown && cap < f.minCapacityIfUnknown) return false;
  return f.includeUnlabeled !== false;
}

export function markOf(raw) {
  const t = L.norm(raw);
  if (/予約済|休館|利用できません|[×✕]/.test(t)) return '×';
  if (/一部|△/.test(t)) return '△';
  if (/空いて|空き|[○◯〇]/.test(t)) return '○';
  return t || '?';
}

function buildMessage(slots, title = `🎉 ${NAME}に空きが出ました`) {
  const byDate = new Map();
  for (const s of slots) {
    const info = [s.area ? `${Math.round(s.area)}㎡` : '広さ不明', s.cap ? `${s.cap}名` : ''].filter(Boolean).join('・');
    const k = `${s.label}（${info}）`;
    if (!byDate.has(s.date)) byDate.set(s.date, new Map());
    const m = byDate.get(s.date);
    if (!m.has(k)) m.set(k, []);
    if (!m.get(k).includes(s.time)) m.get(k).push(s.time);
  }
  const lines = [title];
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
  const weekdays = [...new Set([...targets.map(L.weekday), '祝'])];
  const tset = new Set(targets);
  const seenCell = new Set(); // 2つの検索で同じ部屋が出ても1回だけ数える
  const marks = new Map();
  const open = [];
  const roomLog = new Map();
  try {
    for (const s of config.searches) {
      const n = await S.open(page, s);
      let start = targets[0];
      let pages = 0;
      while (start && pages++ < 10) {
        await S.show(page, start, weekdays);
        const cells = await S.read(page, start);
        const dates = [...new Set(cells.map((c) => c.date).filter(Boolean))].sort();
        console.log(`【${s.category} → ${s.genre}】${n}部屋を選択 / ${start}〜 表示: ${dates.map(L.label).join(' ')}`);
        if (!dates.length) break;
        for (const c of cells) {
          const { name, cap } = splitRoom(c.room);
          const label = display(c.building, name);
          if ((config.excludeRoomWords || []).some((w) => L.norm(label).includes(L.norm(w)))) continue;
          const area = areaOf(label);
          const ok = roomOk({ cap, area }, config.roomFilter);
          if (!roomLog.has(label)) roomLog.set(label, `${ok ? '◎' : '　'} ${label}（${cap ?? '定員不明'}${cap ? '名' : ''}${area ? ` ${area}㎡` : ''}）`);
          if (!ok || !tset.has(c.date)) continue;
          const time = L.fmtTime(c.time);
          const k = `${c.date}|${label}|${time}`;
          if (seenCell.has(k)) continue;
          seenCell.add(k);
          const mk = markOf(c.sym);
          marks.set(c.sym, (marks.get(c.sym) || 0) + 1);
          if (config.notifyMarks.includes(mk)) open.push({ label, cap, area, date: c.date, time });
        }
        const last = dates.at(-1);
        start = targets.find((d) => d > last);
      }
    }
  } catch (e) {
    await S.snap(page, 'error', true);
    throw e;
  } finally {
    await ctx.close();
  }
  if (DEBUG) console.log(`--- 部屋の一覧（◎が監視対象）---\n${[...roomLog.values()].join('\n')}`);
  console.log(`監視対象の部屋: ${[...roomLog.values()].filter((v) => v.startsWith('◎')).length} / 表のアイコン: ${[...marks].map(([k, v]) => `${k || '(空)'}×${v}`).join(' ')}`);
  return open;
}

async function main() {
  if (process.env.TEST_NOTIFY === '1') { await line(`✅ ${NAME} 空き監視のテスト通知です`); return; }

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
      await line(`⚠️ ${NAME} 空き監視でエラー\n${e.message.slice(0, 300)}\n（12時間に1回だけお知らせします）`).catch(() => {});
      await saveState({ ...state, lastErrorAt: new Date().toISOString() });
    }
    process.exitCode = 1;
    return;
  } finally {
    await browser.close();
  }

  const key = (s) => `${s.date}|${s.label}|${s.time}`;
  // 初めて動いたとき（通知記録がないとき）は、今ある空きを記録するだけにする（全部が一度に届くのを防ぐ）
  const first = !state.notified.length && !state.lastErrorAt && !state.started;
  const seen = new Set(first ? open.map(key) : state.notified);
  if (first) console.log('初回のため、今ある空きは記録だけします（全部見たいときは notify_all で実行）');
  const fresh = open.filter((s) => !seen.has(key(s)));
  console.log(`空き ${open.length}コマ（新しく見つかった分 ${fresh.length}コマ）`);
  if (DEBUG && open.length) console.log(`--- 通知文のプレビュー ---\n${buildMessage(open)}`);
  if (process.env.NOTIFY_ALL === '1') await line(open.length ? buildMessage(open, `📋 ${NAME}の今の空き状況（大きい部屋）`) : `📋 ${NAME}: 今は条件に合う空きがありません`);
  else if (fresh.length) await line(buildMessage(fresh));
  await saveState({ notified: open.map(key), lastErrorAt: state.lastErrorAt, started: true });
}

await main();
