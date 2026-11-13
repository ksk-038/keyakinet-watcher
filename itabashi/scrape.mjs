// 板橋区「ITAリザーブ」の画面操作と読み取り
//   空き照会のみ → 空き照会・予約 → 利用目的から絞り込む → 大分類 → 小分類 → 全て選択 → 次に進む
//   → 「施設別空き状況照会」（7日表示）。曜日を絞り込むと、土曜だけ7日分などが1画面に並ぶ
import fs from 'node:fs/promises';
import * as L from '../lib.mjs';

export const TOP = 'https://www.itabashi-shisetsu-yoyaku.jp/eshisetsu/menu/Welcome.cgi';
const DEBUG = process.env.DEBUG === '1';
const DEBUG_DIR = 'debug-itabashi';
let step = 0;

export async function snap(page, name, force = false) {
  if (!DEBUG && !force) return;
  await fs.mkdir(DEBUG_DIR, { recursive: true });
  const p = `${DEBUG_DIR}/${String(++step).padStart(2, '0')}-${name}`;
  await page.screenshot({ path: `${p}.png`, fullPage: true }).catch(() => {});
  await fs.writeFile(`${p}.html`, await page.content().catch(() => '')).catch(() => {});
}

const WD = { 日: 'SUN', 月: 'MON', 火: 'TUE', 水: 'WED', 木: 'THU', 金: 'FRI', 土: 'SAT', 祝: 'HOL' };

// クリックして次の画面が出るまで待つ
async function go(page, locator, what) {
  const el = locator.first();
  if (!(await el.count())) {
    const body = L.norm(await page.locator('body').innerText().catch(() => ''));
    throw new Error(`「${what}」が見つかりません（${page.url().split('/').pop()}）${body.slice(0, 100)}`);
  }
  await Promise.all([page.waitForNavigation({ timeout: 60000 }), el.click()]);
  await page.waitForLoadState('load').catch(() => {});
  await checkError(page);
}

// 次の画面に進めなかったときは、画面の文言をエラーとして出す
//（トップの注意書きにも「システムエラー」の文字があるので、文言だけでは判定しない）
async function checkError(page) {
  const body = L.norm(await page.locator('body').innerText().catch(() => ''));
  const m = body.match(/(システムエラー|エラーが発生|時間外|処理を続行).{0,80}/);
  if (m && body.length < 1500) throw new Error(`予約サイトでエラー: ${m[0]}`);
}

const row = (page, text) => page.locator('td').filter({ hasText: new RegExp(`^\\s*${text.replace(/[()（）]/g, '.')}\\s*$`) });

// 検索して「施設別空き状況照会」を開く
export async function open(page, { category, genre }) {
  await page.goto(TOP, { waitUntil: 'load' });
  await go(page, page.locator('img[alt^="空き照会のみ"]'), '空き照会のみのかたはこちら');
  await go(page, page.getByText('空き照会・予約', { exact: true }), '空き照会・予約');
  await go(page, row(page, '利用目的から絞り込む'), '利用目的から絞り込む');
  await go(page, row(page, category), category);
  await go(page, row(page, genre), genre);
  await page.locator('img[alt^="全て選択する"]').first().click();
  await page.waitForTimeout(500);
  const n = await page.locator('input[name="checkMeisaiUniqKey"]').count();
  await snap(page, `select-${genre}`);
  await go(page, page.locator('img[alt^="次に進む"]'), '次に進む');
  return n;
}

// 表示開始日・曜日を指定して表示し直す
export async function show(page, start, weekdays) {
  // 画面の準備ができる前に表示し直すと「システムエラー」になるので、少し待つ
  //（動作確認モードでは画面の保存で自然に待てていたため、ふだんの実行だけ失敗していた）
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
  const codes = weekdays.map((w) => WD[w]).filter(Boolean);
  const [y, m, d] = start.split('-');
  await page.evaluate(({ y, m, d, codes }) => {
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    set('optYear', y); set('optMonth', m); set('optDay', d);
    set('radioshow', 'week');
    for (const c of ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN', 'HOL']) set(`checkShowDay${c}`, codes.includes(c) ? c : '');
  }, { y, m, d, codes });
  await Promise.all([page.waitForNavigation({ timeout: 90000 }), page.evaluate(() => isSubmitDataSet('Setup'))]);
  await page.waitForLoadState('load').catch(() => {});
  await snap(page, `result-${start}`);
  if (!(await page.locator('#facilitiesbox').count())) {
    await checkError(page);
    const body = L.norm(await page.locator('body').innerText().catch(() => ''));
    throw new Error(`空き状況の表が出ません: ${body.slice(0, 150)}`);
  }
}

// 表を読む: [{ building, room, date, time, sym }]
export async function read(page, start) {
  const raw = await page.evaluate(() => {
    const out = [];
    for (const t of document.querySelectorAll('#facilitiesbox table')) {
      const building = (t.closest('td')?.querySelector('h3')?.childNodes[0]?.textContent || '').trim();
      let days = [];
      let room = '';
      for (const tr of t.querySelectorAll('tr')) {
        const ds = [...tr.querySelectorAll('p.day')];
        if (ds.length) { days = ds.map((p) => p.textContent.replace(/\s+/g, '')); continue; }
        const f = tr.querySelector('td.facmds');
        if (f) { room = f.textContent.trim(); continue; }
        const tm = tr.querySelector('td.facmdstime');
        if (!tm) continue;
        const cells = [...tr.querySelectorAll('td')].filter((c) => c !== tm);
        cells.forEach((c, i) => {
          const img = c.querySelector('img');
          out.push({ building, room, day: days[i] || '', time: tm.innerText.replace(/\s+/g, ''), sym: img ? img.alt || img.title : c.textContent.trim() });
        });
      }
    }
    return out;
  });
  // 「11月14日」に年をつける（表示開始日の年から、月が戻ったら翌年）
  let [y, pm] = start.split('-').map(Number);
  const cache = new Map();
  return raw.map((c) => {
    const m = L.norm(c.day).match(/(\d{1,2})月(\d{1,2})日/);
    if (!m) return { ...c, date: null };
    const k = `${m[1]}-${m[2]}`;
    if (!cache.has(k)) {
      if (+m[1] < pm) y++;
      pm = +m[1];
      cache.set(k, L.ymd(y, +m[1], +m[2]));
    }
    return { ...c, date: cache.get(k) };
  });
}
