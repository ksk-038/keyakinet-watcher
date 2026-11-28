// 足立区「施設予約システム」（p-kashikan）の一時的な空き監視 → YANAGIBA（アプリの空き検索の結果・お知らせ）と LINE
//   config.json の dates の日だけを見る。時間と広さは、YANAGIBA の同じ日の「空き検索」の条件を使う
//   日本の外から開けないサイトなので、YANAGIBA の中継（jp-relay）を通して読む
//   DEBUG=1 で読み取った表をログに出す / NOTIFY_ALL=1 で今の空きを全部 LINE に送る / TEST_NOTIFY=1 で LINE にテストだけ
import fs from 'node:fs/promises';
import * as L from '../lib.mjs';
import * as Y from '../yanagiba.mjs';

const config = JSON.parse(await fs.readFile(new URL('./config.json', import.meta.url), 'utf8'));
const NAME = '足立区';
const SITE = 'adachi';
const RELAY = 'https://jskulzunyckseeokgzax.supabase.co/functions/v1/jp-relay';
const SECRET = process.env.YANAGIBA_SECRET;
const DEBUG = process.env.DEBUG === '1';
const STATE_DIR = 'state-adachi';
const STATE_FILE = `${STATE_DIR}/state.json`;

async function line(text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const to = process.env.LINE_USER_ID;
  if (!token || !to) { console.log(`[LINE未設定のため表示のみ]\n${text}`); return; }
  const r = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages: [{ type: 'text', text: text.slice(0, 4990) }] }),
  });
  if (!r.ok) throw new Error(`LINE送信に失敗 ${r.status}: ${await r.text()}`);
}
async function loadState() { try { return JSON.parse(await fs.readFile(STATE_FILE, 'utf8')); } catch { return { notified: [] }; } }
async function saveState(s) { await fs.mkdir(STATE_DIR, { recursive: true }); await fs.writeFile(STATE_FILE, JSON.stringify(s, null, 2)); }

async function relay(steps) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(RELAY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-region': 'ap-northeast-1' },
        body: JSON.stringify({ secret: SECRET, base: config.base, enc: 'utf8', steps }),
        signal: AbortSignal.timeout(140000),
      });
      const j = await r.json().catch(() => ({ error: `${r.status}` }));
      if (r.ok && !j.error) return j.pages;
      last = new Error(`中継でエラー（${j.error || r.status}）`);
    } catch (e) { last = e; }
    await new Promise((x) => setTimeout(x, 5000));
  }
  throw last;
}

const text = (h) => (h || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const ymd8 = (d) => d.replace(/-/g, '');
const hm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.round(min % 60)).padStart(2, '0')}`;

// 「施設の空き状況（1日）」の表 → [{ room, cells: [{ from, to, free, mark }] }]（分単位）
//   表のマスは幅で時間の長さを表す（1時間 = 見出し1つの幅）。最初の見出しの数字が始まりの時刻
export function parseDay(html) {
  const head = (html.match(/<table class="koma-table"[\s\S]*?<\/table>/) || [''])[0];
  const ths = [...head.matchAll(/<th style="width:(\d+)px;"[^>]*>\s*(\d+)\s*<\/th>/g)];
  if (!ths.length) return [];
  const unit = Number(ths[0][1]) + 1;
  const start = Number(ths[0][2]) * 60;
  const rows = [];
  for (const t of html.matchAll(/<table class="koma-table"[^>]*>\s*<tr>\s*<td[^>]*class="name"[^>]*>([\s\S]*?)<\/td>([\s\S]*?)<\/tr>\s*<\/table>/g)) {
    const room = text(t[1]);
    let m = start;
    const cells = [];
    for (const c of t[2].matchAll(/<td style="width:(\d+)px;[^"]*"[^>]*>([\s\S]*?)<\/td>/g)) {
      const mins = Math.max(30, Math.round(((Number(c[1]) + 1) / unit) * 60 / 30) * 30);
      const mark = text(c[2]);
      if (mark) cells.push({ from: m, to: m + mins, free: /[●〇○◯]/.test(mark), mark });
      m += mins;
    }
    rows.push({ room, cells });
  }
  return rows;
}

// 部屋名の「（180名）」から定員
const capOf = (room) => { const m = L.norm(room).match(/(\d+)名/); return m ? Number(m[1]) : null; };

async function scan(dates) {
  // 施設の一覧
  const list = await relay([{ get: 'Top' }, { post: 'SrchSst', data: 'op=SrchSst', cut: ['name="ShisetsuCode"', '</form>'] }]);
  const body = list.at(-1).body || '';
  const facs = [...body.matchAll(/name="ShisetsuCode" value="(\w+)"[^>]*>\s*<label[^>]*>([\s\S]*?)<\/label>/g)].map((m) => ({ code: m[1], name: text(m[2]) }));
  console.log(`施設: ${facs.length}件${DEBUG ? `（${facs.map((f) => f.name).join('、')}）` : ''}`);
  if (!facs.length) throw new Error('施設の一覧が読めません');
  const out = [];
  for (const d of dates) {
    // 1回の中継で12施設ずつ
    for (let i = 0; i < facs.length; i += 12) {
      const part = facs.slice(i, i + 12);
      const pages = await relay([
        { get: 'Top' },
        ...part.map((f) => ({ post: 'SrchSst', data: `op=SrchSst&UseYM=${ymd8(d).slice(0, 6)}&UseDay=${Number(d.slice(8))}&UseDate=${ymd8(d)}&ShisetsuCode=${f.code}`, keep: true, cut: ['<!-- Calendar -->', '<!-- /Calendar -->'] })),
      ]);
      part.forEach((f, j) => {
        const rows = parseDay(pages[j + 1]?.body || '');
        if (DEBUG) console.log(`  ${d} ${f.name}: ${rows.map((r) => `${r.room}[${r.cells.map((c) => `${hm(c.from)}${c.mark}`).join(' ')}]`).join(' / ') || '（表なし）'}`);
        for (const r of rows) {
          const place = L.norm(r.room).includes(L.norm(f.name)) ? r.room : `${f.name} ${r.room}`;
          if (L.badRoom(place) || (config.excludeRoomWords || []).some((w) => L.norm(place).includes(L.norm(w)))) continue;
          for (const c of r.cells.filter((x) => x.free)) out.push({ date: d, place, label: place, cap: capOf(r.room), area: null, time: `${hm(c.from)}〜${hm(c.to)}` });
        }
      });
    }
  }
  return out;
}

function buildMessage(slots, title = `🎉 ${NAME}に空きが出ました`) {
  const by = new Map();
  for (const s of slots) {
    const k = `${s.date}|${s.place}${s.cap ? `（${s.cap}名）` : ''}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(s.time);
  }
  const lines = [title];
  for (const [k, times] of [...by].sort()) { const [d, p] = k.split('|'); lines.push('', `📅 ${L.label(d)} ${p}`, `  ${L.joinTimes(times)}`); }
  lines.push('', `予約: ${config.base}`);
  return lines.join('\n');
}

async function main() {
  if (process.env.TEST_NOTIFY === '1') { await line(`✅ ${NAME} 空き監視のテスト通知です`); return; }
  const q = config.quietHours;
  if (q && L.jstHour() >= q.from && L.jstHour() < q.to && process.env.FORCE !== '1') { console.log('深夜のためお休み'); return; }
  const today = L.jstToday();
  const dates = (config.dates || []).filter((d) => d >= today);
  if (!dates.length) { console.log('見張る日がありません（config.json の dates）'); return; }
  const G0 = await Y.load({ monthsAhead: 3 }, today, NAME);
  // この区は、決めた日の「空き検索」だけで見る（まだ取れていない日の練習には使わない）
  const want = new Set(dates);
  const searches = (G0.searches || []).filter((s) => want.has(s.date));
  const G = { ...G0, gaps: G0.gaps == null ? null : [], dates: new Set(), searches, sdates: new Set(searches.map((s) => s.date)) };
  console.log(`見張る日: ${dates.map(L.label).join(' ')} / 空き検索: ${searches.map((s) => `${s.date} ${s.time || '時間なし'} ${s.min ?? ''}㎡〜`).join('、') || 'なし'}`);
  const state = await loadState();
  let slots;
  try {
    slots = await scan(dates);
  } catch (e) {
    console.error(`❌ ${e.message}`);
    if (Date.now() - (state.errorAt || 0) > 12 * 3600e3) { await line(`⚠️ ${NAME} 空き監視でエラー\n${e.message.slice(0, 300)}`).catch(() => {}); state.errorAt = Date.now(); await saveState(state); }
    process.exitCode = 1;
    return;
  }
  console.log(`空いているコマ: ${slots.length}`);
  // アプリへ（足立区は部屋の一覧のシートがまだないので、シートでのしぼりこみはしない）
  process.env.SHEET_ONLY = '0';
  await Y.report(G, { site: SITE, ward: NAME, url: config.base, stateDir: STATE_DIR }, slots);
  // LINE：空き検索の時間をまるごと使える空きだけ（一部だけの空きはアプリにだけ出る）
  const open = slots.filter((s) => Y.lineOk(s, G, NAME, slots));
  const key = (s) => `${s.date}|${s.place}|${s.time}`;
  const seen = new Set(state.notified || []);
  const fresh = open.filter((s) => !seen.has(key(s)));
  if (DEBUG && open.length) console.log(`--- 通知文のプレビュー ---\n${buildMessage(open)}`);
  if (process.env.NOTIFY_ALL === '1') await line(open.length ? buildMessage(open, `📋 ${NAME}の今の空き`) : `📋 ${NAME}: 今は条件に合う空きがありません`);
  else if (fresh.length) await line(buildMessage(L.widen(fresh, slots)));
  await saveState({ ...state, notified: open.map(key) });
}

await main();
