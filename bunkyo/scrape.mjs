// 文の京 施設予約ねっと（文京区）の画面操作と読み取り
// けやきネットと同じ仕組みのサイトなので ../scrape.mjs をベースに、文京区の画面に合わせて調整
import fs from 'node:fs/promises';
import * as L from '../lib.mjs';

export const TOP = 'https://www.shisetsu.city.bunkyo.lg.jp/user/Home';
const DEBUG = process.env.DEBUG === '1';
const DEBUG_DIR = 'debug-bunkyo';
let step = 0;

export async function snap(page, name, force = false) {
  if (!DEBUG && !force) return;
  await fs.mkdir(DEBUG_DIR, { recursive: true });
  const p = `${DEBUG_DIR}/${String(++step).padStart(2, '0')}-${name}`;
  await page.screenshot({ path: `${p}.png`, fullPage: true }).catch(() => {});
  await fs.writeFile(`${p}.html`, await page.content().catch(() => '')).catch(() => {});
}

async function settle(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
}

async function clickText(page, text, { last = false } = {}) {
  const opt = typeof text === 'string' ? { exact: true } : undefined;
  const ropt = typeof text === 'string' ? { name: text, exact: true } : { name: text };
  const tries = [
    page.getByText(text, opt),
    page.getByRole('button', ropt),
    page.getByRole('link', ropt),
    page.getByRole('tab', ropt),
  ];
  if (typeof text === 'string') {
    // アイコン文字が前についたボタン（例: value=" 検索"）や、改行が入ったタブ名にも対応
    const esc = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${esc}\\s*$`, 'u');
    tries.push(page.getByRole('button', { name: re }), page.getByRole('link', { name: re }));
    const loose = new RegExp(text.split('').map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'));
    tries.push(page.getByText(loose));
  }
  let loc = null;
  for (const t of tries) {
    const v = t.filter({ visible: true });
    if (await v.count()) { loc = v; break; }
  }
  if (!loc) {
    const names = await page.evaluate(() =>
      [...document.querySelectorAll('a,button,input[type=submit],input[type=button],[role=button],[onclick]')]
        .filter((e) => e.offsetParent)
        .map((e) => `${e.tagName}:${(e.innerText || e.value || e.getAttribute('aria-label') || e.title || '').trim().slice(0, 30)}`)
        .slice(0, 80)
        .join(' | '),
    );
    console.log(`画面上のボタン類: ${names}`);
    throw new Error(`「${text}」が画面に見つかりません（${page.url()}）`);
  }
  await (last ? loc.last() : loc.first()).click();
  await settle(page);
}

// <label>文字</label> に対応する input のチェック状態
function isChecked(page, text) {
  return page.evaluate((t) => {
    const N = (s) => (s || '').normalize('NFKC').replace(/\s+/g, '');
    const lb = [...document.querySelectorAll('label')].find((l) => N(l.textContent) === N(t));
    const inp = lb && (lb.control || document.getElementById(lb.htmlFor) || lb.querySelector('input'));
    return !!inp?.checked;
  }, text);
}
function forceCheck(page, text) {
  return page.evaluate((t) => {
    const N = (s) => (s || '').normalize('NFKC').replace(/\s+/g, '');
    const lb = [...document.querySelectorAll('label')].find((l) => N(l.textContent) === N(t));
    const inp = lb && (lb.control || document.getElementById(lb.htmlFor) || lb.querySelector('input'));
    if (inp) { inp.checked = true; inp.dispatchEvent(new Event('change', { bubbles: true })); }
  }, text);
}

async function assertNoError(page) {
  const t = L.norm(await page.locator('body').innerText().catch(() => ''));
  if (t.includes('処理を続行できません')) throw new Error('「処理を続行できません」画面になりました');
}

// 1〜2枚目: 利用目的で検索 → 施設にチェックして次へ
export async function openFacilityGrid(page, config) {
  await page.goto(TOP, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await snap(page, 'top');
  await clickText(page, '利用目的から探す');
  if (!(await isChecked(page, config.purpose.category))) {
    await clickText(page, config.purpose.category);
    await page.waitForTimeout(1500);
    await settle(page);
  }
  if (!(await isChecked(page, config.purpose.use))) await clickText(page, config.purpose.use);
  if (!(await isChecked(page, config.purpose.use))) await forceCheck(page, config.purpose.use);
  if (!(await isChecked(page, config.purpose.use))) throw new Error(`利用目的「${config.purpose.use}」を選択できません`);
  await snap(page, 'purpose-selected');
  await clickText(page, '検索', { last: true });
  await assertNoError(page);
  await page
    .waitForFunction((n) => document.body?.innerText.includes(n), config.facilities[0], { timeout: 30000 })
    .catch(() => {});
  await snap(page, 'facility-list');

  for (let i = 0; i < 20; i++) {
    const shown = await page.evaluate((names) => names.every((n) => document.body.innerText.includes(n)), config.facilities);
    if (shown) break;
    const more = page.getByText(/さらに読み込む/).filter({ visible: true });
    if (!(await more.count())) break;
    await more.first().click();
    await page.waitForTimeout(800);
    await settle(page);
  }

  const missing = [];
  for (const name of config.facilities) {
    const loc = page.getByText(name, { exact: true }).filter({ visible: true });
    if (!(await loc.count())) { missing.push(name); continue; }
    // 既にチェック済みならクリックしない（押すと外れてしまう）
    if (await isChecked(page, name)) continue;
    await loc.first().click();
    await page.waitForTimeout(300);
    if (!(await isChecked(page, name))) await forceCheck(page, name);
  }
  if (missing.length === config.facilities.length) {
    const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    console.log(`URL: ${page.url()}\n画面の文字: ${body.slice(0, 1200)}`);
    throw new Error('施設一覧で対象施設が1つも見つかりません');
  }
  if (missing.length) console.warn(`⚠ 一覧に見つからなかった施設: ${missing.join('、')}`);
  await snap(page, 'facility-selected');
  await clickText(page, '次へ進む', { last: true });
  await assertNoError(page);
}


// 原因調査用: 表示期間まわりのHTMLと入力欄をログに出す
export async function dumpPeriod(page, tag) {
  if (!DEBUG) return;
  const info = await page.evaluate(() => {
    const ins = [...document.querySelectorAll('input,select,button')].filter((i) => i.type !== 'hidden' && i.type !== 'checkbox')
      .map((i) => `${i.tagName}[type=${i.type},id=${i.id},name=${i.name},value=${(i.value || '').slice(0, 20)},checked=${i.checked},text=${(i.innerText || '').trim().slice(0, 15)}]`).slice(0, 40).join('\n  ');
    const e = [...document.querySelectorAll('*')].find((x) => x.children.length === 0 && x.textContent.includes('表示期間'));
    let p = e; for (let i = 0; i < 4 && p?.parentElement; i++) p = p.parentElement;
    const tb = document.querySelector('table');
    return `入力欄:\n  ${ins}\n表示期間まわり: ${p ? p.outerHTML.replace(/\s+/g, ' ').slice(0, 3000) : 'なし'}\n最初の表の見出し: ${tb ? tb.rows[0]?.innerText.replace(/\s+/g, ' ').slice(0, 300) : 'なし'}`;
  });
  console.log(`--- [${tag}] ${page.url()}\n${info}`);
}

// 3枚目: 表示期間の開始日をセットして「1ヶ月」で表示
export async function showMonthFrom(page, date) {
  const [y, m, d] = date.split('-');
  const setDate = () =>
    page.evaluate((v) => {
      const inp = [...document.querySelectorAll('input')].find(
        (i) => i.type === 'date' || /^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(i.value.trim()),
      );
      if (!inp) return null;
      inp.removeAttribute('readonly');
      inp.value = inp.type === 'date' ? v.replace(/\//g, '-') : v;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return inp.value;
    }, `${y}/${m}/${d}`);

  await page
    .waitForFunction(() => [...document.querySelectorAll('input')].some((i) => /^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(i.value.trim())), null, { timeout: 30000 })
    .catch(() => {});
  await settle(page);
  const md = `${Number(m)}/${Number(d)}`;
  const head = () => page.evaluate(() => document.querySelector('table')?.rows[0]?.innerText.replace(/\s+/g, ' ') || '');
  const before = await head();
  if (DEBUG) {
    console.log('日付まわりHTML: ' + (await page.evaluate(() => { let p = document.querySelector('input[type=date]'); for (let i = 0; i < 6 && p?.parentElement; i++) p = p.parentElement; return p.outerHTML.replace(/\s+/g, ' ').slice(0, 4000); })));
    console.log('scripts: ' + (await page.evaluate(() => [...document.scripts].map((x) => x.src || `inline(${x.textContent.length})`).join(' '))));
    page.on('request', (r) => { if (!/\.(png|svg|css|js|woff2?)(\?|$)/.test(r.url())) console.log(`  → ${r.method()} ${r.url()} ${(r.postData() || '').slice(0, 300)}`); });
  }
  // 期間「1ヶ月」（ラベルをクリック）
  await page.getByText(/^1[ヶかケカヵ]月$/).filter({ visible: true }).first().click();
  await page.waitForTimeout(300);
  // 日付は普通に入力する（値を直接書き換えても画面側が拾わないため）
  const inp = page.locator('input[type=date]').first();
  await inp.fill(`${y}-${m}-${d}`);
  await inp.press('Tab').catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('button').filter({ hasText: /^\s*表示\s*$/ }).filter({ visible: true }).first().click();
  await page
    .waitForFunction(
      ([b, md]) => { const t = document.querySelector('table')?.rows[0]?.innerText.replace(/\s+/g, ' ') || ''; return t !== b && t.includes(md); },
      [before, md],
      { timeout: 30000 },
    )
    .catch(() => console.warn('⚠ 表の切り替わりを確認できませんでした'));
  await settle(page);
  console.log(`表の見出し: ${(await head()).slice(0, 200)}`);
  await assertNoError(page);
  await page.waitForFunction(() => document.querySelectorAll('table').length > 0, null, { timeout: 30000 }).catch(() => {});
  await settle(page);
  await snap(page, `grid-${date}`);
}

// 施設名の見出し（«説明文» が後ろについていてもOK。長い名前を優先）
function installHeads() {
  window.__kwHeads = (facilities) => {
    const N = (s) => (s || '').normalize('NFKC').replace(/\s+/g, '');
    const names = facilities.map((f) => [N(f), f]).sort((a, b) => b[0].length - a[0].length);
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('table') || el.querySelector('table')) continue;
      const t = N(el.textContent);
      if (t.length > 120) continue;
      const hit = names.find(([n]) => t === n || (t.startsWith(n) && /^[«《(（<≪]/.test(t.slice(n.length))));
      if (hit) out.push({ el, facility: hit[1] });
    }
    return out;
  };
}

// 3枚目の表を読む（施設ごとの表 → 部屋 × 日付 の記号、定員の列も読む）
export async function readGrid(page, facilities) {
  await page.evaluate(installHeads);
  const r = await page.evaluate(
    (facilities) => {
      const N = (s) => (s || '').normalize('NFKC').replace(/\s+/g, '');
      const heads = window.__kwHeads(facilities);
      const symOf = (c) =>
        N(c.textContent) ||
        [...c.querySelectorAll('img,[title],[aria-label]')]
          .map((e) => e.getAttribute('alt') || e.getAttribute('title') || e.getAttribute('aria-label') || '')
          .join('');
      const tables = [];
      const cells = [];
      let id = 0;
      for (const tb of document.querySelectorAll('table')) {
        const prev = heads.filter((h) => h.el.compareDocumentPosition(tb) & Node.DOCUMENT_POSITION_FOLLOWING);
        if (!prev.length) continue;
        const facility = prev.at(-1).facility;
        const rows = [...tb.rows];
        let hdr = -1;
        let mds = [];
        for (let i = 0; i < rows.length; i++) {
          // 見出しセルは「11/15」
          const nums = [...rows[i].cells].map((c) => N(c.textContent).match(/^(\d{1,2})\/(\d{1,2})/)).filter(Boolean);
          if (nums.length >= 1) { hdr = i; mds = nums.map((m) => [Number(m[1]), Number(m[2])]); break; }
        }
        if (hdr < 0) continue;
        // 「定員」列の位置
        const hcells = [...rows[hdr].cells];
        const capIdx = hcells.findIndex((c) => N(c.textContent) === '定員');
        const ti = tables.push({ facility, mds }) - 1;
        for (const r of rows.slice(hdr + 1)) {
          const cs = [...r.cells];
          if (cs.length < mds.length + 1) continue;
          const room = cs[0].innerText.replace(/\s+/g, ' ').trim();
          const lead = cs.slice(0, cs.length - mds.length);
          const capText = capIdx > 0 && lead[capIdx] ? N(lead[capIdx].textContent) : lead.slice(1).map((c) => N(c.textContent)).join(' ');
          const capM = capText.match(/(\d+)人/) || N(room).match(/定員(\d+)/);
          cs.slice(cs.length - mds.length).forEach((c, col) => {
            c.setAttribute('data-kw', String(id));
            cells.push({ id: id++, table: ti, facility, room, cap: capM ? Number(capM[1]) : null, col, sym: symOf(c) });
          });
        }
      }
      return { tables, cells };
    },
    facilities,
  );
  if (!r.tables.length) {
    console.log(`URL: ${page.url()} / table数: ${await page.locator('table').count()}`);
    console.log('最初の表: ' + (await page.evaluate(() => { const t = document.querySelector('table'); return t ? t.outerHTML.replace(/\s+/g, ' ').slice(0, 2500) : 'なし'; })));
    console.log('画面の文字: ' + (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 800));
  }
  return r;
}

export async function selectCells(page, ids) {
  for (const id of ids) {
    await page.locator(`[data-kw="${id}"]`).click();
    await page.waitForTimeout(150);
  }
  await snap(page, 'cells-selected');
  await clickText(page, '次へ進む', { last: true });
  await page
    .waitForFunction(() => /\d{4}年\d{1,2}月\d{1,2}日/.test(document.body?.innerText || ''), null, { timeout: 30000 })
    .catch(() => {});
  await settle(page);
  await assertNoError(page);
  await snap(page, 'timeslots');
}

// 5枚目: 時間帯別空き状況を読む
//   見出し行: 「2026年11月15日(日) | 9:00 | 10:00 | …」、データ行: 「部屋 | ○午前(横に何マス分か) | …」
export async function readSlots(page, facilities) {
  await page.evaluate(installHeads);
  const out = await page.evaluate(
    (facilities) => {
      const N = (s) => (s || '').normalize('NFKC').replace(/\s+/g, '');
      const heads = window.__kwHeads(facilities);
      const out = [];
      for (const tb of document.querySelectorAll('table')) {
        const rows = [...tb.rows];
        const prev = heads.filter((h) => h.el.compareDocumentPosition(tb) & Node.DOCUMENT_POSITION_FOLLOWING);
        const facility = prev.length ? prev.at(-1).facility : '';
        let dateText = '';
        let hpos = [];
        for (const r of rows) {
          const cs = [...r.cells];
          if (!cs.length) continue;
          if (/\d{4}年\d{1,2}月\d{1,2}日/.test(N(cs[0].textContent))) {
            dateText = N(cs[0].textContent);
            hpos = [];
            let col = 0;
            for (const c of cs.slice(1)) { hpos.push({ col, t: N(c.textContent) }); col += c.colSpan || 1; }
            continue;
          }
          if (!dateText || cs.length < 2) continue;
          const room = cs[0].innerText.replace(/\s+/g, ' ').trim();
          let col = 0;
          for (const c of cs.slice(1)) {
            const span = c.colSpan || 1;
            const text = N(c.textContent);
            const sym = (text.match(/[○◯〇△×✕]/) || [''])[0];
            const name = text.replace(/[○◯〇△×✕]/g, '');
            const st = [...hpos].reverse().find((h) => h.col <= col)?.t || '';
            const en = hpos.find((h) => h.col === col + span)?.t || '';
            const range = st && /\d/.test(st) ? `${st}〜${/\d/.test(en) ? en : ''}` : '';
            out.push({ facility, room, dateText, time: [name, range].filter(Boolean).join(' '), sym });
            col += span;
          }
        }
      }
      return out;
    },
    facilities,
  );
  return out;
}
