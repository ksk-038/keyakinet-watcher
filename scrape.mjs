// けやきネットの画面操作と読み取り
import fs from 'node:fs/promises';
import * as L from './lib.mjs';

export const TOP = 'https://setagaya.keyakinet.net/Web/Home/WgR_ModeSelect';
const DEBUG = process.env.DEBUG === '1';
let step = 0;

export async function snap(page, name, force = false) {
  if (!DEBUG && !force) return;
  await fs.mkdir('debug', { recursive: true });
  const p = `debug/${String(++step).padStart(2, '0')}-${name}`;
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
    // アイコン文字が前についたボタン（例: value=" 検索"）にも対応
    const esc = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${esc}\\s*$`, 'u');
    tries.push(page.getByRole('button', { name: re }), page.getByRole('link', { name: re }));
  }
  let loc = null;
  for (const t of tries) {
    const v = t.filter({ visible: true });
    if (await v.count()) { loc = v; break; }
  }
  if (!loc) {
    // 原因調査用: 画面上のボタン・リンクの文字をログに出す
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

// <label for=...>文字</label> に対応する input のチェック状態
function isChecked(page, text) {
  return page.evaluate((t) => {
    const lb = [...document.querySelectorAll('label')].find((l) => l.textContent.trim() === t);
    const inp = lb && (lb.control || document.getElementById(lb.htmlFor));
    return !!inp?.checked;
  }, text);
}
function forceCheck(page, text) {
  return page.evaluate((t) => {
    const lb = [...document.querySelectorAll('label')].find((l) => l.textContent.trim() === t);
    const inp = lb && (lb.control || document.getElementById(lb.htmlFor));
    if (inp) { inp.checked = true; inp.dispatchEvent(new Event('change', { bubbles: true })); }
  }, text);
}

async function assertNoError(page) {
  const t = L.norm(await page.locator('body').innerText().catch(() => ''));
  if (t.includes('処理を続行できません')) throw new Error('「処理を続行できません」画面になりました');
}

// 1〜2枚目: 使用目的で検索 → 施設を選んで次へ
export async function openFacilityGrid(page, config) {
  await page.goto(TOP, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await snap(page, 'top');
  await clickText(page, '使用目的から探す');
  // 分類（ラジオ）: 既に選ばれていれば触らない。選ぶと使用目的の一覧が読み直される
  if (!(await isChecked(page, config.purpose.category))) {
    await clickText(page, config.purpose.category);
    await page.waitForTimeout(1500);
    await settle(page);
  }
  // 使用目的（チェックボックス）
  await clickText(page, config.purpose.use);
  if (!(await isChecked(page, config.purpose.use))) await forceCheck(page, config.purpose.use);
  if (!(await isChecked(page, config.purpose.use))) throw new Error(`使用目的「${config.purpose.use}」を選択できません`);
  await snap(page, 'purpose-selected');
  await clickText(page, '検索', { last: true });
  await assertNoError(page);
  // 施設一覧は後から描画されるので、施設名が出るまで待つ
  await page
    .waitForFunction((n) => document.body?.innerText.includes(n), config.facilities[0], { timeout: 30000 })
    .catch(() => {});
  await snap(page, 'facility-list');

  // 一覧は少しずつ表示されるので「さらに読み込む」を押して全施設を出す
  for (let i = 0; i < 20; i++) {
    const shown = await page.evaluate(
      (names) => names.every((n) => document.body.innerText.includes(n)),
      config.facilities,
    );
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
    await loc.first().click();
    await page.waitForTimeout(150);
  }
  if (missing.length === config.facilities.length) {
    const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    console.log(`URL: ${page.url()}\n画面の文字: ${body.slice(0, 1200)}`);
    console.log(`施設名を含む要素: ${await page.evaluate((n) => [...document.querySelectorAll('*')].filter((e) => e.children.length === 0 && (e.textContent || e.value || '').includes(n)).map((e) => e.outerHTML.slice(0, 200)).slice(0, 5).join(' || '), config.facilities[0])}`);
    throw new Error('施設一覧で対象施設が1つも見つかりません');
  }
  if (missing.length) console.warn(`⚠ 一覧に見つからなかった施設: ${missing.join('、')}`);
  await snap(page, 'facility-selected');
  await clickText(page, '次へ進む', { last: true });
  await assertNoError(page);
}

// 3枚目: 表示開始日をセットして「1ヶ月」で表示
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

  if ((await setDate()) === null) throw new Error('表示開始日の入力欄が見つかりません');
  await clickText(page, /^1[ヶかケカヵ]月$/);
  await setDate(); // 期間ボタンで日付が戻る場合に備えてもう一度
  await clickText(page, '表示');
  await assertNoError(page);
  await snap(page, `grid-${date}`);
}

// 3枚目の表を読む（施設ごとの表 → 部屋 × 日付 の記号）
export async function readGrid(page, facilities) {
  return page.evaluate((facilities) => {
    const N = (s) => (s || '').normalize('NFKC').replace(/\s+/g, '');
    const byNorm = new Map(facilities.map((f) => [N(f), f]));
    const heads = [...document.querySelectorAll('body *')].filter(
      (el) => !el.closest('table') && byNorm.has(N(el.textContent)),
    );
    const symOf = (c) =>
      N(c.textContent) ||
      [...c.querySelectorAll('img,[title],[aria-label]')]
        .map((e) => e.getAttribute('alt') || e.getAttribute('title') || e.getAttribute('aria-label') || '')
        .join('');

    const tables = [];
    const cells = [];
    let id = 0;
    for (const tb of document.querySelectorAll('table')) {
      const prev = heads.filter((h) => h.compareDocumentPosition(tb) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (!prev.length) continue;
      const facility = byNorm.get(N(prev.at(-1).textContent));
      const rows = [...tb.rows];
      let hdr = -1;
      let days = [];
      for (let i = 0; i < rows.length; i++) {
        const nums = [...rows[i].cells].map((c) => N(c.textContent)).filter((t) => /^\d{1,2}$/.test(t));
        if (nums.length >= 3) { hdr = i; days = nums.map(Number); break; }
      }
      if (hdr < 0) continue;
      const monthLabel = (tb.textContent.normalize('NFKC').match(/\d{4}年\d{1,2}月/) || [''])[0];
      const ti = tables.push({ facility, monthLabel, days }) - 1;
      for (const r of rows.slice(hdr + 1)) {
        const cs = [...r.cells];
        if (cs.length < days.length + 1) continue;
        const room = cs[0].innerText.replace(/\s+/g, ' ').trim();
        if (/^\d{4}年\d{1,2}月$/.test(N(room))) continue; // 曜日の行
        cs.slice(cs.length - days.length).forEach((c, col) => {
          c.setAttribute('data-kw', String(id));
          cells.push({ id: id++, table: ti, facility, room, col, sym: symOf(c) });
        });
      }
    }
    return { tables, cells };
  }, facilities);
}

export async function selectCells(page, ids) {
  for (const id of ids) {
    await page.locator(`[data-kw="${id}"]`).click();
    await page.waitForTimeout(150);
  }
  await snap(page, 'cells-selected');
  await clickText(page, '次へ進む', { last: true });
  await assertNoError(page);
  await snap(page, 'timeslots');
}

// 4枚目: 時間帯別空き状況を読む
export async function readSlots(page, facilities) {
  return page.evaluate((facilities) => {
    const N = (s) => (s || '').normalize('NFKC').replace(/\s+/g, '');
    const byNorm = new Map(facilities.map((f) => [N(f), f]));
    const heads = [...document.querySelectorAll('body *')].filter(
      (el) => !el.closest('table') && byNorm.has(N(el.textContent)),
    );
    const out = [];
    for (const tb of document.querySelectorAll('table')) {
      const rows = [...tb.rows];
      const hi = rows.findIndex((r) => /\d{4}年\d{1,2}月\d{1,2}日/.test(N(r.cells[0]?.textContent)));
      if (hi < 0) continue;
      const prev = heads.filter((h) => h.compareDocumentPosition(tb) & Node.DOCUMENT_POSITION_FOLLOWING);
      const facility = prev.length ? byNorm.get(N(prev.at(-1).textContent)) : '';
      const hcells = [...rows[hi].cells];
      const dateText = N(hcells[0].textContent);
      const times = hcells.slice(1).map((c) => N(c.textContent));
      for (const r of rows.slice(hi + 1)) {
        const cs = [...r.cells];
        if (cs.length < times.length + 1) continue;
        const room = cs[0].innerText.replace(/\s+/g, ' ').trim();
        cs.slice(cs.length - times.length).forEach((c, j) =>
          out.push({ facility, room, dateText, time: times[j], sym: N(c.textContent) }),
        );
      }
    }
    return out;
  }, facilities);
}
