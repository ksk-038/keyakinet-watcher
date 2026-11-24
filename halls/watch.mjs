// ざわめき祭の公演ホールの空き監視 → LINE通知（＋スプレッドシートへの書き込み）
//   見張る日（config.json の dates）に、取りたい枠の組み合わせ（土曜: 午前＋午後・午後＋夜間・午後だけ・夜間だけ／日曜: 午前＋午後・午後＋夜間・午後だけ）が
//   空いたら知らせる。区の練習場所の監視とは別（YANAGIBA には出さない）
//   いまの対応サイト: p-kashikan（西東京市・浦安市などの予約システム。日本の外から開けないので YANAGIBA の中継を通す）
//   node halls/watch.mjs   DEBUG=1 で読み取った表をログに出す / TEST_NOTIFY=1 で LINE にテスト送信 / NOTIFY_ALL=1 で今の空きを全部送る
import fs from 'node:fs/promises';
import * as L from '../lib.mjs';

const config = JSON.parse(await fs.readFile(new URL('./config.json', import.meta.url), 'utf8'));
const RELAY = 'https://jskulzunyckseeokgzax.supabase.co/functions/v1/jp-relay';
const SECRET = process.env.YANAGIBA_SECRET;
const DEBUG = process.env.DEBUG === '1';
const NOTIFY_ALL = process.env.NOTIFY_ALL === '1';
const STATE_DIR = 'state-halls';
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
async function loadState() { try { return JSON.parse(await fs.readFile(STATE_FILE, 'utf8')); } catch { return { notified: [], errorAt: 0 }; } }
async function saveState(s) { await fs.mkdir(STATE_DIR, { recursive: true }); await fs.writeFile(STATE_FILE, JSON.stringify(s, null, 2)); }

async function relay(base, steps) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(RELAY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-region': 'ap-northeast-1' },
        body: JSON.stringify({ secret: SECRET, base, enc: 'utf8', steps }),
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
// 始まりの時刻から枠の名前（12時より前=午前、12〜16時台=午後、17時以降=夜間）
const slotName = (h) => (h < 12 ? '午前' : h < 17 ? '午後' : '夜間');

// p-kashikan の「施設の空き状況（1日）」の表 → [{ room, slots: { 午前: { free, mark }, … } }]
//   表のマスは幅で時間の長さを表す（1時間 = 見出し1つの幅）。最初の見出しの数字が始まりの時刻
export function parseKoma(html) {
  const head = (html.match(/<table class="koma-table"[\s\S]*?<\/table>/) || [''])[0];
  const ths = [...head.matchAll(/<th style="width:(\d+)px;"[^>]*>\s*(\d+)\s*<\/th>/g)];
  if (!ths.length) return [];
  const unit = Number(ths[0][1]) + 1;
  const start = Number(ths[0][2]);
  const rows = [];
  for (const t of html.matchAll(/<table class="koma-table"[^>]*>\s*<tr>\s*<td[^>]*class="name"[^>]*>([\s\S]*?)<\/td>([\s\S]*?)<\/tr>\s*<\/table>/g)) {
    const room = text(t[1]);
    let h = start;
    const slots = {};
    for (const c of t[2].matchAll(/<td style="width:(\d+)px;[^"]*"[^>]*>([\s\S]*?)<\/td>/g)) {
      const hours = Math.max(1, Math.round((Number(c[1]) + 1) / unit));
      const mark = text(c[2]);
      if (mark) {
        const name = slotName(h);
        // 同じ時間帯にマスが2つあるときは、両方空いているときだけ空き
        const free = /[●〇○]/.test(mark);
        slots[name] = slots[name] == null ? { free, mark } : { free: slots[name].free && free, mark: `${slots[name].mark}${mark}` };
      }
      h += hours;
    }
    rows.push({ room, slots });
  }
  return rows;
}

async function readPkashikan(hall, dates) {
  // 施設の一覧から、そのホールの施設番号を探す
  const list = await relay(hall.base, [{ get: 'Top' }, { post: 'SrchSst', data: 'op=SrchSst', cut: ['name="ShisetsuCode"', '</form>'] }]);
  const body = list.at(-1).body || '';
  const re = new RegExp(hall.facility);
  const facs = [...body.matchAll(/name="ShisetsuCode" value="(\w+)"[^>]*>\s*<label[^>]*>([\s\S]*?)<\/label>/g)].map((m) => [m[0], m[1], text(m[2])]);
  if (DEBUG) console.log(`  施設一覧: ${facs.map((m) => `${m[1]}:${m[2]}`).join('、')}`);
  const fac = facs.find((m) => re.test(m[2]));
  if (!fac) throw new Error(`施設「${hall.facility}」が一覧にありません（全${facs.length}施設）`);
  const pages = await relay(hall.base, [
    { get: 'Top' },
    ...dates.map((d) => ({ post: 'SrchSst', data: `op=SrchSst&UseYM=${ymd8(d).slice(0, 6)}&UseDay=${Number(d.slice(8))}&UseDate=${ymd8(d)}&ShisetsuCode=${fac[1]}`, keep: true, cut: ['<!-- Calendar -->', '<!-- /Calendar -->'] })),
  ]);
  const out = [];
  const roomRe = new RegExp(hall.room);
  dates.forEach((d, i) => {
    const rows = parseKoma(pages[i + 1]?.body || '');
    if (DEBUG) console.log(`  ${d} ${fac[2]}: ${rows.map((r) => `${r.room}[${Object.entries(r.slots).map(([k, v]) => `${k}${v.mark}`).join(' ')}]`).join(' / ') || '（表なし）'}`);
    const row = rows.find((r) => roomRe.test(r.room));
    if (row) out.push({ date: d, slots: row.slots });
    else console.log(`  ⚠️ ${d}: 部屋「${hall.room}」が表にありません`);
  });
  return out;
}

// しせつよやく（品川区など）: 館（どこで）と目的で検索し、部屋の7日分の表を読む。ブラウザを使う
async function readEprs(hall, dates) {
  const { chromium } = await import('playwright');
  const S = await import('../shinjuku/scrape.mjs');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ locale: 'ja-JP' });
    page.on('dialog', (d) => { console.log(`  （サイトのメッセージ）${d.message()}`); d.dismiss().catch(() => {}); });
    const roomRe = new RegExp(hall.room);
    const out = [];
    // 土曜はじまりで1週間ずつ（土日が同じ表に入る）
    const starts = [...new Set(dates.map((d) => (L.weekday(d) === '日' ? L.addDays(d, -1) : d)))];
    for (const st of starts) {
      const r = await S.search(page, { top: hall.top, area: hall.area, purpose: hall.purpose, start: ymd8(st), weekdays: ['土', '日'] });
      const b = r.buildings.find((x) => x.name.includes(hall.area)) || r.buildings[0];
      if (!b) throw new Error(`「${hall.area}」が検索結果にありません`);
      const rooms = await S.selectBuilding(page, b.value);
      if (DEBUG) console.log(`  部屋: ${rooms.map((x) => x.name).join('、')}`);
      const room = rooms.filter((x) => roomRe.test(x.name)).sort((a, b2) => (b2.name.includes('全面') ? 1 : 0) - (a.name.includes('全面') ? 1 : 0))[0];
      if (!room) throw new Error(`部屋「${hall.room}」がありません（${rooms.map((x) => x.name).join('、')}）`);
      const cells = await S.readRoom(page, room.value);
      for (const d of dates.filter((x) => x === st || x === L.addDays(st, 1))) {
        const slots = {};
        for (const c of cells.filter((x) => x.date === d)) {
          const name = /午前/.test(c.label) ? '午前' : /午後/.test(c.label) ? '午後' : /夜/.test(c.label) ? '夜間' : c.label;
          const free = /[○◯〇]/.test(c.sym);
          slots[name] = slots[name] == null ? { free, mark: c.sym || '?' } : { free: slots[name].free && free, mark: slots[name].mark + (c.sym || '?') };
        }
        if (DEBUG) console.log(`  ${d} ${room.name}: ${Object.entries(slots).map(([k, v]) => `${k}${v.mark}`).join(' ') || '（表なし）'}`);
        if (Object.keys(slots).length) out.push({ date: d, slots });
      }
    }
    return out;
  } finally {
    await browser.close();
  }
}

const READERS = { 'p-kashikan': readPkashikan, eprs: readEprs };

// その日に取れる組み合わせ（例: ["午前＋午後", "午後"]）
export function okCombos(date, slots, combos) {
  return (combos[L.weekday(date)] || []).filter((c) => c.every((s) => slots[s]?.free)).map((c) => c.join('＋'));
}

async function main() {
  if (process.env.TEST_NOTIFY === '1') { await line('🎭 ホール空き監視（ざわめき祭）のテスト通知です'); return; }
  const hour = L.jstHour();
  const q = config.quietHours;
  if (q && hour >= q.from && hour < q.to && process.env.FORCE !== '1') { console.log('深夜なのでお休み'); return; }

  const today = L.jstToday();
  const dates = config.dates.filter((d) => d > today);
  const state = await loadState();
  const notified = new Set(state.notified);
  const nowFree = new Set();
  const news = [];
  const table = [];
  const errors = [];
  for (const hall of config.halls) {
    console.log(`▶ ${hall.city} ${hall.name}`);
    try {
      const res = await READERS[hall.platform](hall, dates);
      for (const r of res) {
        const combos = okCombos(r.date, r.slots, config.combos);
        table.push({ hall: `${hall.city} ${hall.name}`, date: r.date, slots: Object.fromEntries(Object.entries(r.slots).map(([k, v]) => [k, v.mark])), combos, url: hall.base });
        console.log(`  ${L.label(r.date)} ${Object.entries(r.slots).map(([k, v]) => `${k}${v.mark}`).join(' ')}${combos.length ? ` → 取れる: ${combos.join('・')}` : ''}`);
        for (const c of combos) {
          const key = `${r.date}|${hall.name}|${c}`;
          nowFree.add(key);
          if (NOTIFY_ALL || !notified.has(key)) news.push({ hall, date: r.date, combo: c });
        }
      }
    } catch (e) {
      console.log(`  ❌ ${e.message}`);
      errors.push({ hall: hall.name, msg: e.message });
    }
  }

  if (news.length) {
    const by = new Map();
    for (const n of news) {
      const k = `${n.date}|${n.hall.name}`;
      if (!by.has(k)) by.set(k, { ...n, combos: [] });
      by.get(k).combos.push(n.combo);
    }
    const lines = ['🎭 ざわめき祭のホールに空きが出ました'];
    for (const v of [...by.values()].sort((a, b) => a.date.localeCompare(b.date))) {
      lines.push('', `■ ${L.label(v.date)} ${v.hall.city} ${v.hall.name}`, `  取れる枠: ${v.combos.join('／')}`, ...(v.hall.note ? [`  ${v.hall.note}`] : []), `  ${v.hall.base}`);
    }
    await line(lines.join('\n'));
  }
  // エラーは12時間に1回まで知らせる
  if (errors.length && Date.now() - (state.errorAt || 0) > 12 * 3600e3) {
    await line(`⚠️ ホール空き監視でエラー\n${errors.map((e) => `${e.hall}: ${e.msg}`).join('\n')}`);
    state.errorAt = Date.now();
  }
  // 空きがなくなった枠は記録から外す（また空いたら知らせる）。読めなかったホールの分は残す
  const failed = new Set(errors.map((e) => e.hall));
  state.notified = [...new Set([...nowFree, ...[...notified].filter((k) => failed.has(k.split('|')[1]))])];
  await saveState(state);

  // スプレッドシート（ざわめき祭2027 ホール候補リスト）へ今の状況を送る（HALLS_SHEET_URL があるときだけ）
  if (process.env.HALLS_SHEET_URL && table.length) {
    const r = await fetch(process.env.HALLS_SHEET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ secret: process.env.HALLS_SHEET_SECRET || '', checkedAt: new Date().toISOString(), rows: table }),
      redirect: 'follow',
    }).catch((e) => ({ ok: false, status: e.message }));
    console.log(`スプレッドシートへ送信: ${r.ok ? 'OK' : `失敗 ${r.status}`}`);
  }
  console.log(`新しい空き ${news.length}件 / エラー ${errors.length}件`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
