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
      const r = await S.search(page, { top: hall.top, area: hall.area, purpose: hall.purpose, start: st, weekdays: ['土', '日'] });
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
          const free = /[○◯〇]|空き/.test(c.sym);
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

// 大田区 うぐいすネット（…/eshisetsu/）: 全施設から館を選ぶ → 部屋を選ぶ → 7日分の表（表示開始日を変えて読む）
async function readUguisu(hall, dates) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage({ locale: 'ja-JP' });
    p.on('dialog', (d) => { console.log(`  （サイトのメッセージ）${d.message()}`); d.accept().catch(() => {}); });
    await p.goto(hall.top, { waitUntil: 'networkidle' });
    if (/システム休止|受付時間外/.test(await p.evaluate(() => document.body.innerText))) throw new Error('システム休止中（午前2〜5時）');
    await p.click('text=ログインせずに空き状況を検索'); await p.waitForTimeout(800);
    await p.click('label[for=yoyakuMode_1]'); await p.waitForTimeout(800);
    await p.click('label[for=jouken1_3]'); await p.waitForTimeout(800);
    const kid = await p.evaluate((re) => [...document.querySelectorAll('input[name=catSel3]')].find((e) => new RegExp(re).test(document.querySelector(`label[for="${e.id}"]`)?.innerText || ''))?.id, hall.kaikan);
    if (!kid) throw new Error(`館「${hall.kaikan}」が一覧にありません`);
    await p.click(`label[for=${kid}]`); await p.waitForTimeout(500);
    await p.click('#submitbutton'); await p.waitForLoadState('networkidle'); await p.waitForTimeout(1000);
    const rid = await p.evaluate((name) => [...document.querySelectorAll('input[name=checkMeisaiUniqKey]')].find((e) => (e.getAttribute('aria-label') || e.title || document.querySelector(`label[for="${e.id}"]`)?.innerText || '').trim() === `${name}を選択`)?.id, hall.kaikanName + hall.room);
    if (!rid) throw new Error(`部屋「${hall.room}」が一覧にありません`);
    await p.check(`#${rid}`); await p.waitForTimeout(300);
    await p.click('#submitbutton'); await p.waitForLoadState('networkidle'); await p.waitForTimeout(1000);
    const out = [];
    const starts = [...new Set(dates.map((d) => (L.weekday(d) === '日' ? L.addDays(d, -1) : d)))];
    for (const st of starts) {
      let ok = false;
      for (let i = 0; i < 3 && !ok; i++) {
        await p.fill('#startDate', st);
        await Promise.all([p.waitForLoadState('networkidle'), p.click('button:has-text("選択した条件で表示")')]);
        ok = await p.waitForSelector('table.box_calendar', { timeout: 15000 }).then(() => true, () => false);
      }
      const t = await p.evaluate(() => {
        const tb = document.querySelector('table.box_calendar'); if (!tb) return null;
        const rows = [...tb.querySelectorAll('tr')];
        const days = [...rows[0].querySelectorAll('th')].slice(1).map((th) => th.querySelector('.day')?.innerText.replace(/\s+/g, '') || '');
        return { days, rows: rows.slice(1).map((r) => ({ time: r.querySelector('th').innerText.trim(), cells: [...r.querySelectorAll('td')].map((td) => td.querySelector('img')?.alt || td.innerText.trim()) })) };
      });
      if (!t) throw new Error('空き状況の表が出ません');
      for (const d of dates.filter((x) => x === st || x === L.addDays(st, 1))) {
        const [, m, dd] = d.match(/^\d{4}-(\d{2})-(\d{2})/);
        const col = t.days.indexOf(`${Number(m)}月${Number(dd)}日`);
        if (col < 0) { if (DEBUG) console.log(`  ${d}: 表にありません（${t.days.join(' ')}）`); continue; }
        const slots = {};
        for (const r of t.rows) {
          const h = Number(r.time.slice(0, 2));
          const name = h < 12 ? '午前' : h < 17 ? '午後' : '夜間';
          const alt = r.cells[col] || '';
          const free = /空いて/.test(alt);
          slots[name] = { free, mark: free ? '○' : /予約済/.test(alt) ? '×' : /抽選/.test(alt) ? '抽' : '-' };
        }
        out.push({ date: d, slots });
      }
    }
    return out;
  } finally {
    await browser.close();
  }
}

// ka-ruku（狛江エコルマホールなど …/month）: 月別の表。30分ごとのマス（色）で、枠の中が全部「空き(base)」なら空き
async function readKaruku(hall, dates) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage({ locale: 'ja-JP' });
    await p.goto(hall.top, { waitUntil: 'networkidle' });
    if (/メンテナンス中/.test(await p.evaluate(() => document.body.innerText))) throw new Error('メンテナンス中');
    const out = [];
    for (const ym of [...new Set(dates.map((d) => d.slice(0, 7).replace('-', '')))]) {
      await p.selectOption('#selShisetsu', hall.shisetsu);
      await p.selectOption('#selNengetu', ym);
      await p.click('#searchMonth'); await p.waitForLoadState('networkidle'); await p.waitForTimeout(1200);
      for (const d of dates.filter((x) => x.slice(0, 7).replace('-', '') === ym)) {
        const cells = await p.evaluate((id) => { const tr = document.getElementById(id); return tr ? [...tr.querySelectorAll('td.base, td.reserve, td.off, td[class]')].filter((td) => td.colSpan > 1).map((td) => [td.className, td.colSpan]) : null; }, `calendar${d.replace(/-/g, '')}`);
        if (!cells) { if (DEBUG) console.log(`  ${d}: 表にありません`); continue; }
        // 枠ごとに数える。「申込不可(off)」は枠の間の休憩時間などなので数えない
        const cnt = {};
        let min = 0;
        for (const [cls, span] of cells) {
          const name = min < 240 ? '午前' : min < 600 ? '午後' : '夜間';
          const c = (cnt[name] ||= { base: 0, reserve: 0, off: 0, other: 0 });
          c[cls in c ? cls : 'other'] += 1;
          min += span;
        }
        const slots = {};
        for (const [name, c] of Object.entries(cnt)) {
          const free = c.base > 0 && !c.reserve && !c.other;
          slots[name] = { free, mark: free ? '○' : c.reserve ? '×' : '-' };
        }
        out.push({ date: d, slots });
      }
    }
    return out;
  } finally {
    await browser.close();
  }
}

// オリンピックセンター（カルチャー棟の空き状況ページ。13か月分が1ページに入っている）
async function readOlympic(hall, dates) {
  const r = await fetch(hall.page, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`空き状況のページが ${r.status}`);
  const html = await r.text();
  const T = (h) => h.replace(/<BR>/gi, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
  const cells = [];
  for (const t of html.split(/<A NAME=/i).slice(1)) {
    const ym = t.match(/^(\d{4})年(\d{1,2})月/);
    if (!ym) continue;
    const head = t.match(/<TR[^>]*>([\s\S]*?)<\/TR>/i)?.[1] || '';
    const days = [...head.matchAll(/<TH ALIGN=CENTER>([\s\S]*?)<\/TH>/gi)].map((m) => Number(T(m[1])));
    let room = null;
    for (const tr of t.matchAll(/<TR BGCOLOR=[^>]*>([\s\S]*?)<\/TR>/gi)) {
      const tds = [...tr[1].matchAll(/<TD([^>]*)>([\s\S]*?)<\/TD>/gi)];
      if (/ROWSPAN/i.test(tds[0]?.[1] || '')) room = T(tds.shift()[2]);
      const kubun = T(tds.shift()?.[2] || '');
      tds.forEach((td, i) => { if (days[i]) cells.push({ room, kubun, date: `${ym[1]}-${ym[2].padStart(2, '0')}-${String(days[i]).padStart(2, '0')}`, sym: T(td[2]) }); });
    }
  }
  const re = new RegExp(hall.room);
  const out = [];
  for (const d of dates) {
    const mine = cells.filter((c) => c.date === d && re.test(c.room || '') && ['午前', '午後', '夜間'].includes(c.kubun));
    if (!mine.length) { if (DEBUG) console.log(`  ${d}: ページにありません`); continue; }
    out.push({ date: d, slots: Object.fromEntries(mine.map((c) => [c.kubun, { free: c.sym === '○', mark: (c.sym || '-').replace('－', '-') }])) });
  }
  return out;
}

// pf489 の携帯版（町田市など。日本の外から開けないので中継を通す。Shift_JIS）
//   使用目的で検索 → 施設 → 部屋 → 日ごとの「時間を選ぶ画面」に出る空き時間を、午前・午後・夜間に分ける
async function readPf489(hall, dates) {
  const T = (h) => (h || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
  const call = async (steps) => {
    const r = await fetch(RELAY, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-region': 'ap-northeast-1' }, body: JSON.stringify({ secret: SECRET, base: hall.base, steps }), signal: AbortSignal.timeout(140000) });
    const j = await r.json().catch(() => ({ error: `${r.status}` }));
    if (j.error) throw new Error(`中継でエラー（${j.error}）`);
    return j.pages;
  };
  // 施設の名前で探す（search があるとき）か、使用目的で探す
  const pre = hall.search ? [
    { get: 'Wm_TopMenu.aspx' },
    { get: 'Wm_ShisetsuKensaku.aspx?ActiveForm=Shisetsu' },
    { submit: [['txtSSName$txt', hall.search], ['cmdNext1', '[6]検索']] },
  ] : [
    { get: 'Wm_TopMenu.aspx' },
    { get: 'Wm_ShisetsuKensaku.aspx?ActiveForm=Purpose' },
    { submit: [['slPurpose1', hall.purpose.cat], ['cmdSelect2', '選択']] },
    { submit: [['slPurpose1', hall.purpose.cat], ['slPurpose2', hall.purpose.use], ['cmdNext4', '[6]検索']] },
    { get: 'Wm_ShisetsuSentaku.aspx?SearchRoute=Purpose' },
  ];
  const facs = [...((await call(pre)).at(-1)?.body || '').matchAll(/name="slShisetsu" value="(\d+)">([^<]+)/g)].map((m) => ({ idx: m[1], name: m[2].trim() }));
  const fac = facs.find((f) => new RegExp(hall.facility).test(f.name));
  if (!fac) throw new Error(`施設「${hall.facility}」が一覧にありません（${facs.map((f) => f.name).join('、')}）`);
  const [y, m, d] = dates[0].split('-').map(Number);
  const pick = [
    { submit: [['txtNen$txt', String(y)], ['txtTsuki$txt', String(m)], ['txtHi$txt', String(d)], ['slShisetsu', fac.idx], ['cmdNext', '[6]次へ']] },
    { get: 'Wm_ShitsujouSentaku.aspx' },
  ];
  const rooms = [...((await call([...pre, ...pick])).at(-1)?.body || '').matchAll(/Wm_JikanSentaku\.aspx\?SJCode=(\w+)&(?:amp;)?UseDate=\d+"[^>]*>([^<]+)</g)].map((x) => ({ code: x[1], name: T(x[2]).replace(/&#215;/g, '×').replace(/^・\s*/, '').replace(/^\([^)]*\)/, '').trim() }));
  const room = rooms.find((r) => new RegExp(hall.room).test(r.name));
  if (!room) throw new Error(`部屋「${hall.room}」が一覧にありません（${rooms.map((r) => r.name).join('、')}）`);
  const root = new URL(hall.base).pathname;
  const pages = await call([...pre, ...pick, ...dates.map((dt) => ({ get: `${root}Wm_JikanSentaku.aspx?SJCode=${room.code}&UseDate=${dt.replace(/-/g, '')}`, keep: true, cut: ['<form', '</form>'] }))]);
  const out = [];
  dates.forEach((dt, i) => {
    const b = pages[pages.length - dates.length + i]?.body || '';
    if (DEBUG) console.log(`  ${dt}: ${T(b).replace(/\s+/g, ' ').slice(0, 300)}`);
    const t = T(b);
    const lot = /抽選/.test(t) && !/予約申込ができます/.test(b);
    const off = /受付期間外/.test(t);
    // 空いている時間：選べる時間（slTime）か、「空いている時間帯のみを表示」の一覧（9:00～12:00 など）
    const times = lot || off ? [] : [
      ...[...b.matchAll(/name="slTime" value="\d+">\s*(\d{1,2}):\d{2}/g)].map((x) => Number(x[1])),
      ...[...(t.split('空き状況')[1] || '').matchAll(/(\d{1,2}):\d{2}\s*[～~〜-]\s*\d{1,2}:\d{2}/g)].map((x) => Number(x[1])),
    ];
    const slots = {};
    for (const nm of ['午前', '午後', '夜間']) {
      const free = times.some((h) => slotName(h) === nm);
      slots[nm] = { free, mark: free ? '○' : off ? '-' : lot ? '抽' : '×' };
    }
    out.push({ date: dt, slots });
  });
  return out;
}

// 葛飾区の文化施設（reserve.aserv.jp/k-mil）: 館・区分・施設を選んで日付を入れると、4日分の午前・午後・夜間が出る（色付き＝予約不可）
async function readAserv(hall, dates) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage({ locale: 'ja-JP' });
    p.on('dialog', (d) => { console.log(`  （サイトのメッセージ）${d.message()}`); d.accept().catch(() => {}); });
    await p.goto(hall.top, { waitUntil: 'networkidle' });
    // 選ぶと画面を読み直すことがあるので、読み直しが終わるのを待ってから次へ
    const choose = async (name, re) => {
      let v;
      for (let i = 0; i < 5 && !v; i++) {
        v = await p.evaluate(([n, r]) => [...document.querySelectorAll(`select[name=${n}] option`)].find((o) => o.value !== '-1' && new RegExp(r).test(o.text.trim()))?.value, [name, re]).catch(() => null);
        if (!v) await p.waitForTimeout(1000);
      }
      if (!v) throw new Error(`「${re}」が選択肢にありません（${name}）`);
      await p.selectOption(`select[name=${name}]`, v);
      await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(1500);
    };
    await choose('kanCode', hall.kan);
    await choose('skubunCode', hall.kubun);
    await choose('shisetsuCode', hall.room);
    const out = [];
    const got = new Map();
    for (const d of dates) {
      if (got.has(d)) continue;
      const ymd = d.replace(/-/g, '');
      let rows = [];
      for (let i = 0; i < 3; i++) {
        try { // 日付を送ると画面ごと読み直すことがあるので、途中で消えたら待ってやり直す
          await p.waitForLoadState('networkidle').catch(() => {});
          await p.evaluate((v) => { document.getElementById('selectDate').value = v; }, d.replace(/-/g, '/'));
          await Promise.all([p.waitForLoadState('networkidle'), p.evaluate((v) => window.sendData(v), ymd)]);
          await p.waitForTimeout(1200);
          await p.waitForLoadState('networkidle').catch(() => {});
          rows = await p.evaluate(() => [...document.querySelectorAll('#calBox .calList')].map((r) => ({
            date: (r.querySelector('.shisetsuName')?.textContent || '').match(/\d{4}\/\d{2}\/\d{2}/)?.[0],
            cells: [...r.querySelectorAll('div[title]')].filter((c) => /^\d+:\d{8}:\d$/.test(c.title)).map((c) => ({ k: Number(c.title.split(':')[2]), ng: c.id === 'stFuka' })),
          })));
          break;
        } catch (e) {
          if (i === 2) throw e;
          await p.waitForTimeout(3000);
        }
      }
      for (const r of rows) if (r.date) got.set(r.date.replace(/\//g, '-'), r.cells);
      if (!rows.length && DEBUG) console.log(`  ${d}: 表が出ません（${(await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 200)}）`);
    }
    for (const d of dates) {
      const cells = got.get(d);
      if (!cells) continue;
      const slots = {};
      for (const c of cells) slots[['午前', '午後', '夜間'][c.k]] = { free: !c.ng, mark: c.ng ? '×' : '○' };
      out.push({ date: d, slots });
    }
    return out;
  } finally {
    await browser.close();
  }
}

// 川崎市 ふれあいネット（簡易版 /web/）: 予約 → 利用目的から → 分類 → 目的 → 館 →（施設）→ 月の表 → 日を選ぶと1週間の午前・午後・夜間
async function readFureai(hall, dates) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage({ locale: 'ja-JP' });
    p.on('dialog', (d) => { console.log(`  （サイトのメッセージ）${d.message()}`); d.accept().catch(() => {}); });
    const act = async (js) => {
      try { await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle', timeout: 60000 }), p.evaluate((c) => setTimeout(() => (0, eval)(c), 0), js)]); }
      catch (e) { throw new Error(`画面が進みません（${js.slice(0, 80)}）：${(await p.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)}`); }
      await p.waitForTimeout(500);
    };
    const calls = (re) => p.evaluate((r) => [...document.querySelectorAll('a,input')].map((e) => (e.getAttribute('onclick') || e.getAttribute('href') || '').replace(/^javascript:/, '').trim()).filter((x) => new RegExp(r).test(x)), re);
    // 最初から月の表までたどる（週の表から月の表へは戻れないので、日を選ぶたびにやり直す）
    const openMonth = async (ym) => {
      await p.goto(hall.top, { waitUntil: 'networkidle' });
      await act(hall.entry || 'doAction(document.form1, gRsvWTransRsvMenuAction)');
      await act('doPpsdSearchAction(document.form1, gRsvWTransInstSrchPpsdAction)');
      await act(`sendPpsdCd(document.form1, gRsvWTransInstSrchPpsAction, '${hall.ppsd}','2')`);
      await act(`doTransInstSrchBuildAction(document.form1, gRsvWTransInstSrchBuildAction, '${hall.ppsd}' , '${hall.pps}')`);
      await act(`sendBldCd(document.form1, gRsvWTransInstSrchInstAction, '${hall.bld}')`);
      if (/施設を?選択/.test(await p.evaluate(() => document.body.innerText))) {
        const links = await p.evaluate(() => [...document.querySelectorAll('a,input[type=button],input[type=checkbox]')].map((a) => ({ t: (a.textContent || a.value || a.title || a.id || '').replace(/\s+/g, ' ').trim(), h: (a.getAttribute('href') || a.getAttribute('onclick') || '').replace(/^javascript:/, '') })));
        const c = links.find((a) => new RegExp(hall.room).test(a.t) && /send|doTrans|Inst/.test(a.h))?.h;
        if (!c) throw new Error(`施設「${hall.room}」が一覧にありません（${links.filter((a) => a.h).slice(0, 30).map((a) => `${a.t}=${a.h.slice(0, 70)}`).join(' / ')}）`);
        await act(c);
      }
      await act(`moveCalender(document.form1, gRsvWInstSrchMonthVacantAction, ${ym.replace('-', '')}01)`);
    };
    const seen = new Map();
    for (const ym of [...new Set(dates.map((d) => d.slice(0, 7)))]) {
      for (const d of dates.filter((x) => x.startsWith(ym))) {
        if (seen.has(d)) continue;
        await openMonth(ym);
        const [y, m, dd] = d.split('-').map(Number);
        const sel = (await calls(`selectDay\\(document\\.form1, gRsvWInstSrchVacantAction, \\d+, ${y}, ${m}, ${dd}\\)`))[0];
        if (!sel) { seen.set(d, null); continue; } // 月の表で選べない日（受付期間外など）
        await act(sel);
        const cells = await p.evaluate(() => [...document.querySelectorAll('table.rsvakitable img[alt]')].map((i) => i.alt));
        if (DEBUG) console.log(`  ${d}: ${cells.slice(0, 6).join(' / ')}`);
        for (const a of cells) {
          const mm = a.match(/^(\d+)月(\d+)日.曜日(午前|午後|夜間)(.+)$/);
          if (!mm) continue;
          const key = `${y + (Number(mm[1]) < m ? 1 : 0)}-${mm[1].padStart(2, '0')}-${mm[2].padStart(2, '0')}`;
          if (!seen.get(key)) seen.set(key, {});
          seen.get(key)[mm[3]] = mm[4];
        }
      }
    }
    const out = [];
    for (const d of dates) {
      const v = seen.get(d);
      const slots = {};
      for (const k of ['午前', '午後', '夜間']) {
        const t = v?.[k] || '';
        slots[k] = { free: /^空き$/.test(t), mark: /^空き$/.test(t) ? '○' : /予約あり/.test(t) ? '×' : '-' };
      }
      out.push({ date: d, slots });
    }
    return out;
  } finally {
    await browser.close();
  }
}

// 東大和市民会館（rikuu.net）: 空き状況照会の月別一覧（〇＝仮予約可能 ×＝不可 ‐＝参照期間外）
async function readRikuu(hall, dates) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage({ locale: 'ja-JP' });
    const post = async (js) => { await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle', timeout: 60000 }), p.evaluate((c) => setTimeout(() => (0, eval)(c), 0), js)]); await p.waitForTimeout(400); };
    await p.goto(hall.top, { waitUntil: 'networkidle' });
    await post("__doPostBack('btnUserEntry','')");
    const v = await p.evaluate((r) => [...document.querySelectorAll('#ddlShisetsu option')].find((o) => new RegExp(r).test(o.text))?.value, hall.room);
    if (!v) throw new Error(`施設「${hall.room}」が一覧にありません`);
    // 画面の一部だけを書き換える作り（ページは移動しない）なので、値が変わるのを待つ
    if ((await p.inputValue('#ddlShisetsu')) !== v) { await p.selectOption('#ddlShisetsu', v); await p.waitForLoadState('networkidle'); await p.waitForTimeout(1500); }
    const got = new Map();
    for (const ym of [...new Set(dates.map((d) => d.slice(0, 7).replace('-', '/')))]) {
      for (let i = 0; i < 24 && (await p.inputValue('#txtDate')) < ym; i++) {
        const before = await p.inputValue('#txtDate');
        await p.click('#btnAfter');
        await p.waitForFunction((b) => document.querySelector('#txtDate')?.value && document.querySelector('#txtDate').value !== b, before, { timeout: 30000 });
        await p.waitForLoadState('networkidle'); await p.waitForTimeout(300);
      }
      if ((await p.inputValue('#txtDate')) !== ym) { if (DEBUG) console.log(`  ${ym} の月に進めません`); continue; }
      const rows = await p.evaluate(() => [...document.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('td,th')].map((c) => c.innerText.trim())).filter((r) => /^\d{4}\/\d{2}\/\d{2}/.test(r[0] || '')));
      for (const r of rows) got.set(r[0].slice(0, 10).replace(/\//g, '-'), r.slice(1, 4));
    }
    return dates.filter((d) => got.has(d)).map((d) => {
      const c = got.get(d);
      const slots = {};
      ['午前', '午後', '夜間'].forEach((k, i) => { const t = c[i] || ''; slots[k] = { free: /[〇○]/.test(t), mark: /[〇○]/.test(t) ? '○' : /×/.test(t) ? '×' : '-' }; });
      return { date: d, slots };
    });
  } finally {
    await browser.close();
  }
}

// OEC の予約システム（えどねっと・文の京など。…/user/Home）: 利用目的で検索 → 施設を選ぶ → 日ごとの空き → 部屋の時間帯別空き
async function readOec(hall, dates) {
  const H = await import('../bunkyo/http.mjs');
  const site = new H.Site(hall.base, hall.relay ? { url: RELAY, secret: SECRET } : null);
  const home = await site.req('Home');
  // 利用目的の番号（名前で指定したときは Home の一覧から探す）
  const purpose = { ...hall.purpose };
  if (purpose.useName) {
    const u = home.replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#x([0-9A-F]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
    const all = [...u.matchAll(/"PurposeCategoryCode":(\d+),"PurposeCode":(\d+),"PurposeName":"([^"]+)"/g)];
    const hit = all.find((m) => new RegExp(purpose.useName).test(m[3]));
    if (!hit) throw new Error(`利用目的「${purpose.useName}」がありません（${all.map((m) => m[3]).slice(0, 40).join('、')}…）`);
    [purpose.categoryCode, purpose.useCode] = [hit[1], hit[2]];
    if (DEBUG) console.log(`  利用目的: ${hit[3]}（${hit[1]}-${hit[2]}）`);
  }
  await site.req('Home/SearchByPurpose', site.form([
    ['HomeModel.SelectedPlaceClassCategory', '1'], ['HomeModel.CapacityFromByPlaceClass', ''], ['HomeModel.CapacityToByPlaceClass', ''],
    ['HomeModel.SelectedPurposeCategory', purpose.categoryCode], ['HomeModel.SelectedPurpose', purpose.useCode],
    ['HomeModel.CapacityFromByPurpose', ''], ['HomeModel.CapacityToByPurpose', ''], ['SelectedLanguageCode', '0'],
  ]));
  const html = await site.req('AvailabilityCheckApplySelectFacility');
  const dec = (x) => x.replace(/&#x([0-9A-F]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
  // 施設ごとの hidden（id が name より前に来るサイトもある）
  const hidden = [...html.matchAll(/<input type="hidden"[^>]*?name="(SelectFacilities\.Facilities\[(\d+)\]\.SelectedFacility\.(?:Value|Text))"[^>]*?value="([^"]*)"/g)].map((m) => [m[1], dec(m[3]), m[2]]);
  const list = [];
  for (const [k, v, idx] of hidden) if (/Value$/.test(k)) list.push({ value: v, idx, name: hidden.find((h) => h[2] === idx && /Text$/.test(h[0]))?.[1] });
  if (DEBUG) console.log(`  施設一覧: ${list.map((f) => f.name).join('、')}`);
  const fre = new RegExp(hall.facility);
  const picked = list.filter((f) => fre.test(f.name));
  if (!picked.length && DEBUG) { const d = dec(html); const i = d.search(new RegExp(hall.facility)); console.log('  画面HTML: ' + d.slice(Math.max(0, i - 2500), i + 300).replace(/\s+/g, ' ')); }
  if (!picked.length) throw new Error(`施設「${hall.facility}」が一覧にありません（全${list.length}施設）`);
  await site.req('AvailabilityCheckApplySelectFacility/Next', site.form([...hidden.map(([k, v]) => [k, v]), ...picked.map((f) => [`SelectFacilities.Facilities[${f.idx}].IsChecked`, 'true']), ...picked.map((f, i) => [`SelectFacilities.Selected[${i}]`, f.value])]));
  const roomRe = new RegExp(hall.room);
  const out = [];
  // 横浜市のような新しい型：1週間ずつ、午前・午後・夜間それぞれの空きを読む
  if (hall.horizontal) {
    const got = new Map();
    for (const st of [...new Set(dates.map((d) => (L.weekday(d) === '日' ? L.addDays(d, -1) : d)))]) {
      for (const [tz, name] of [[1, '午前'], [2, '午後'], [3, '夜間']]) {
        for (const c of await H.weekH(site, st, tz)) {
          if (!roomRe.test(c.room)) continue;
          if (DEBUG && dates.includes(c.date)) console.log(`  ${c.date} ${c.room} ${name}: ${c.vacant} / ${c.disp}`);
          if (!got.has(c.date)) got.set(c.date, {});
          const free = c.vacant === 'vacant' && c.disp !== 'closed' && (hall.closedOk || c.disp !== 'receptionClosed');
          got.get(c.date)[name] = { free, mark: c.disp === 'closed' ? '休' : c.vacant === 'vacant' ? (c.disp === 'receptionClosed' ? '○' : '○') : c.vacant === 'some' ? '△' : '×' };
        }
      }
    }
    for (const d of dates) if (got.has(d)) out.push({ date: d, slots: got.get(d) });
    return out;
  }
  await site.req('AvailabilityCheckApplySelectDays');
  for (const d of dates) {
    const { cells } = await H.day(site, d);
    const mine = cells.filter((c) => roomRe.test(c.room));
    if (DEBUG) console.log(`  ${d}: ${cells.map((c) => `${c.room}[${c.status}]`).join(' / ') || '（表なし）'}`);
    if (!mine.length) { console.log(`  ⚠️ ${d}: 部屋「${hall.room}」が表にありません`); continue; }
    const c = mine[0];
    const slots = {};
    if (c.status === 'vacant' || c.status === 'some') {
      for (const t of await H.times(site, d, [c])) {
        if (!roomRe.test(t.room) || t.date !== d) continue;
        const from = Number((t.time.match(/(\d+):(\d+)〜/) || [0, 0, 0]).slice(1).join(''));
        const name = /午前/.test(t.time) ? '午前' : /午後/.test(t.time) ? '午後' : /夜/.test(t.time) ? '夜間' : from < 1200 ? '午前' : from < 1700 ? '午後' : '夜間';
        const free = t.status === 'vacant';
        const mark = free ? '○' : t.status === 'full' ? '×' : t.status === 'time-over' ? '-' : t.status === 'lot' ? '抽' : String(t.status);
        slots[name] = slots[name] == null ? { free, mark } : { free: slots[name].free && free, mark: slots[name].mark + mark };
      }
    } else {
      const mark = c.status === 'full' ? '×' : c.status === 'lot' ? '抽' : '-';
      for (const n of ['午前', '午後', '夜間']) slots[n] = { free: false, mark };
    }
    out.push({ date: d, slots });
  }
  return out;
}


// 江東区文化コミュニティ財団など（rsvW系・館の月表→日表で部屋ごとの行を読む）
async function readRsvPath(hall, dates) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage({ locale: 'ja-JP' });
    p.on('dialog', (d) => d.accept().catch(() => {}));
    const norm = (x) => x.replace(/\(_dom == 3\) \? document\.layers\['disp'\]\.document\.(\w+) : document\.\w+/g, 'document.$1').replace(/\(\(document\.(\w+) ?\)/g, '(document.$1');
    const act = async (js) => {
      try { await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle', timeout: 60000 }), p.evaluate((c) => setTimeout(() => (0, eval)(c), 0), js)]); }
      catch (e) { throw new Error(`画面が進みません（${norm(js).slice(0, 80)}）`); }
      await p.waitForTimeout(500);
    };
    const links = () => p.evaluate(() => [...document.querySelectorAll('a,input')].map((a) => ({ t: (a.textContent || a.value || a.alt || '').replace(/\s+/g, ' ').trim(), h: (a.getAttribute('href') || a.getAttribute('onclick') || '').replace(/^javaScript:/i, '') })).filter((x) => x.h));
    const openMonth = async (ym) => {
      await p.goto(hall.top, { waitUntil: 'networkidle' });
      for (const js of hall.entry) await act(js);
      for (const re of hall.path) {
        const x = (await links()).find((a) => new RegExp(re).test(a.t));
        if (!x) throw new Error(`「${re}」が画面にありません`);
        await act(x.h);
      }
      const mv = (await links()).find((a) => /moveCalender/.test(a.h));
      if (!mv) throw new Error('月の表が開けません');
      await act(mv.h.replace(/20\d\d(0[1-9]|1[0-2])01/, `${ym.replace('-', '')}01`));
    };
    const out = [];
    for (const d of dates) {
      const [y, m, dd] = d.split('-').map(Number);
      await openMonth(d.slice(0, 7));
      const sel = (await links()).find((a) => new RegExp(`selectDay\\(document\\.\\w+ ?, gRsvWInstSrchVacantAction, \\d+, ${y}, ${m}, ${dd}\\)`).test(norm(a.h)));
      const slots = {};
      let marks = [];
      if (sel) {
        await act(sel.h);
        const rows = await p.evaluate(() => [...document.querySelectorAll('tr')].map((r) => ({ name: (r.cells[0]?.innerText || '').replace(/\s+/g, ''), alts: [...r.querySelectorAll('img[alt]')].map((i) => i.alt) })));
        marks = rows.find((r) => new RegExp(hall.room).test(r.name) && r.alts.length >= 3)?.alts || [];
        if (DEBUG) console.log(`  ${d}: ${marks.join(' / ') || '（部屋の行が見つかりません）'}`);
      } else if (DEBUG) console.log(`  ${d}: 月の表で選べない日（全部予約あり・受付期間外など）`);
      ['午前', '午後', '夜間'].forEach((k, i) => {
        const t = marks[i] || '';
        slots[k] = { free: /^空き$/.test(t), mark: /^空き$/.test(t) ? '○' : /予約あり/.test(t) ? '×' : sel ? '-' : '×' };
      });
      out.push({ date: d, slots });
    }
    return out;
  } finally {
    await browser.close();
  }
}

// 荒川区 施設予約システム（stagia）
async function readStagia(hall, dates) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage({ locale: 'ja-JP' });
    p.on('dialog', (d) => d.accept().catch(() => {}));
    const nav = async (fn) => { await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle', timeout: 40000 }).catch(() => {}), fn()]); await p.waitForTimeout(600); };
    await p.goto(hall.top, { waitUntil: 'networkidle' });
    await nav(async () => (await p.$$('input[type=image]'))[1].click()); // 多機能操作
    await nav(() => p.click('text=空き状況の確認'));
    const pick = async (sel, label, fn) => {
      const v = await p.evaluate(([s, l]) => [...document.querySelector(s).options].find((o) => new RegExp(l).test(o.text.trim()))?.value, [sel, label]);
      if (v == null) throw new Error(`「${label}」が選べません`);
      await p.selectOption(sel, v);
      await nav(() => p.evaluate(fn));
    };
    await pick('select[name=g_bunruicd_1_show]', hall.kind, 'submitBunrui1()');
    await pick('select[name=g_bunruicd_2_show]', hall.facility, 'submitBunrui2()');
    if (await p.$('select[name=riyosmk]')) await pick('select[name=riyosmk]', hall.purpose || '.', 'changed()');
    await pick('select[name=g_basyocd]', hall.facility, 'btnOK_3()');
    if (await p.$('select[name=g_heyacd]')) {
      const ops = await p.evaluate(() => [...document.heyaform.g_heyacd.options].map((o) => o.value));
      await p.selectOption('select[name=g_heyacd]', ops);
      await nav(() => p.evaluate('heyaOK()'));
    }
    const out = [];
    for (const d of dates) {
      const [y, m, dd] = d.split('-');
      let ok = true;
      for (const [id, v] of [['#YYYY', y], ['#MM', m], ['#DD', dd]]) {
        const val = await p.evaluate(([id, v]) => [...(document.querySelector(id)?.options || [])].map((o) => o.value).find((o) => Number(o) === Number(v)), [id, v]);
        if (val == null) { ok = false; break; }
        await p.selectOption(id, val);
      }
      const slots = {};
      let cells = [];
      if (ok) {
        await nav(() => p.click('#btnOK'));
        const rows = await p.evaluate(() => [...document.querySelectorAll('table tr')].map((r) => [...r.cells].map((c) => (c.innerText.trim() || [...c.querySelectorAll('img')].map((i) => i.alt).join('/')).replace(/\s+/g, ''))));
        const head = (await p.evaluate(() => document.body.innerText)).match(/令和(\d+)年(\d+)月(\d+)日/);
        const same = head && 2018 + Number(head[1]) === Number(y) && Number(head[2]) === Number(m) && Number(head[3]) === Number(dd);
        cells = (same && rows.find((r) => new RegExp(hall.room).test(r[0]))?.slice(1)) || [];
        if (DEBUG) console.log(`  ${d}: ${cells.join(' / ') || `（表示できず：${head?.[0]} ${rows.map((r) => r.join('|')).filter((r) => /ホール/.test(r)).join(' ／ ').slice(0, 200)}）`}`);
      } else if (DEBUG) console.log(`  ${d}: まだ表示できない日`);
      ['午前', '午後', '夜間'].forEach((k, i) => {
        const t = (cells[i] || '').normalize('NFKC');
        slots[k] = { free: /^[OＯ○〇]$/.test(t), mark: /^[OＯ○〇]$/.test(t) ? '○' : /^[XＸ×]$/.test(t) ? '×' : '-' };
      });
      out.push({ date: d, slots });
    }
    return out;
  } finally {
    await browser.close();
  }
}

export const READERS = { 'p-kashikan': readPkashikan, eprs: readEprs, oec: readOec, uguisu: readUguisu, karuku: readKaruku, olympic: readOlympic, pf489: readPf489, aserv: readAserv, fureai: readFureai, rikuu: readRikuu, rsvpath: readRsvPath, stagia: readStagia };

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
      // 画面の切り替わりなどでたまに失敗するので、1回だけやり直す
      const res = await READERS[hall.platform](hall, dates).catch(async (e) => {
        console.log(`  （やり直します：${e.message.slice(0, 80)}）`);
        await new Promise((r) => setTimeout(r, 5000));
        return READERS[hall.platform](hall, dates);
      });
      for (const r of res) {
        const combos = okCombos(r.date, r.slots, config.combos);
        table.push({ hall: `${hall.city} ${hall.name}`, date: r.date, slots: Object.fromEntries(Object.entries(r.slots).map(([k, v]) => [k, v.mark])), combos, url: hall.base || hall.top, cal: hall.cal || hall.name.split(' ')[0] });
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
      lines.push('', `■ ${L.label(v.date)} ${v.hall.city} ${v.hall.name}`, `  取れる枠: ${v.combos.join('／')}`, ...(v.hall.note ? [`  ${v.hall.note}`] : []), `  ${v.hall.base || v.hall.top}`);
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
