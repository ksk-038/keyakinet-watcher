// 新宿区「しせつよやく」の画面操作と読み取り
//   1枚目: どこで・何をする・開始日・曜日を入れて検索
//   2枚目: 館 → 施設 を順に選ぶと、その部屋の「7日分 × 区分」の表が出る（表示は画面内の通信で切り替わる）
import fs from 'node:fs/promises';
import * as L from '../lib.mjs';

export const TOP = 'https://www.shinjuku.eprs.jp/regasu/web/index.jsp';
const DEBUG = process.env.DEBUG === '1';
const DEBUG_DIR = 'debug-shinjuku';
let step = 0;

export async function snap(page, name, force = false) {
  if (!DEBUG && !force) return;
  await fs.mkdir(DEBUG_DIR, { recursive: true });
  const p = `${DEBUG_DIR}/${String(++step).padStart(2, '0')}-${name}`;
  await page.screenshot({ path: `${p}.png`, fullPage: true }).catch(() => {});
  await fs.writeFile(`${p}.html`, await page.content().catch(() => '')).catch(() => {});
}

const WD = { 日: 'sunday', 月: 'monday', 火: 'tuesday', 水: 'wednesday', 木: 'thursday', 金: 'friday', 土: 'saturday', 祝: 'holiday' };

// 画面内の通信が終わるまで待つ
async function idle(page) {
  await page
    .waitForFunction(() => window.$ && $.active === 0 && !window.isProcessing3 && !window.isProcessing4, null, { timeout: 30000 })
    .catch(() => console.warn('⚠ 画面の読み込み待ちがタイムアウト'));
}

// 1枚目の「どこで」の選択肢のうち「〜(すべて)」を全部（品川区の地区ごとなど）
export async function areaOptions(page, top = TOP) {
  await page.goto(top, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#bname option'), null, { timeout: 30000 });
  const list = await page.evaluate(() => [...document.querySelectorAll('#bname option')].map((o) => o.text.trim()).filter((t) => /[(（]すべて[)）]$/.test(t.normalize('NFKC'))));
  console.log(`どこで: ${list.join(' / ')}`);
  return list;
}

// 1枚目: 検索 → 2枚目へ。館の一覧と、表に出る日付（最大7日）を返す
export async function search(page, { top = TOP, area, purpose, start, weekdays }) {
  await page.goto(top, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.$ && window.doSearch && document.querySelector('#purpose option'), null, { timeout: 30000 });
  const nav = page.waitForURL((u) => !u.href.includes('index.jsp'), { timeout: 60000 });
  const err = await page.evaluate(
    ({ area, purpose, start, ids }) => {
      const N = (s) => (s || '').normalize('NFKC').replace(/\s+/g, '');
      const pick = (sel, label) => [...document.querySelectorAll(`${sel} option`)].find((o) => N(o.text) === N(label))?.value;
      const b = pick('#bname', area);
      const p = pick('#purpose', purpose);
      if (!b) return `どこで「${area}」が選択肢にありません`;
      if (!p) return `何をする「${purpose}」が選択肢にありません`;
      $('#bname').val(b);
      $('#purpose').val(p);
      $('#daystart').val(start);
      $('#days').val('31');
      $("input[name='dayofweek']").prop('checked', false);
      for (const id of ids) $(`#${id}`).prop('checked', true);
      $("input[name='timezone']").prop('checked', false);
      doSearch(document.form1, gRsvWOpeInstSrchVacantAction);
      return null;
    },
    { area, purpose, start, ids: weekdays.map((w) => WD[w]).filter(Boolean) },
  );
  if (err) throw new Error(err);
  await nav;
  await page.waitForLoadState('domcontentloaded');
  await idle(page);
  await snap(page, `result-${start}`);
  const r = await page.evaluate(() => ({
    buildings: [...document.querySelectorAll('#mansion-select option')].map((o) => ({ value: o.value, name: o.text.trim() })),
    viewDays: [1, 2, 3, 4, 5, 6, 7].map((i) => document.form1[`viewDay${i}`]?.value).filter(Boolean),
  }));
  if (!r.buildings.length) {
    const body = L.norm(await page.locator('body').innerText().catch(() => ''));
    if (/システム異常|処理を続行できません/.test(body)) throw new Error(`予約サイトでエラー: ${body.slice(0, 120)}`);
    console.log(`  （館の一覧がありません）${body.slice(0, 300)}`);
  }
  r.viewDays = r.viewDays.map((d) => L.ymd(+d.slice(0, 4), +d.slice(4, 6), +d.slice(6, 8)));
  return r;
}

// 館を選ぶ → その館の施設（部屋）一覧
export async function selectBuilding(page, value) {
  await idle(page);
  await page.evaluate((v) => { $('#facility-select').html(''); $('#mansion-select').val(v); selectBuild(2); }, value);
  await page.waitForFunction(() => document.querySelectorAll('#facility-select option').length > 0, null, { timeout: 30000 });
  await idle(page);
  return page.evaluate(() =>
    [...document.querySelectorAll('#facility-select option')].filter((o) => o.value && o.value !== '0').map((o) => ({ value: o.value, name: o.text.trim() })),
  );
}

// 施設を選ぶ → 表（7日分 × 区分）を読む
export async function readRoom(page, value) {
  await idle(page);
  await page.evaluate((v) => { $('#week-info').html(''); $('#facility-select').val(v); selectInst(2); }, value);
  await page.waitForFunction(() => document.querySelector('#week-info caption') && $.active === 0, null, { timeout: 30000 });
  await idle(page);
  return page.evaluate(() => {
    const t = document.querySelector('#week-info');
    const out = [];
    for (const tr of t.querySelectorAll('tbody tr')) {
      const label = (tr.querySelector('th')?.textContent || '').trim();
      for (const td of tr.querySelectorAll('td[id]')) {
        const m = td.id.match(/^(\d{4})(\d{2})(\d{2})_/);
        if (!m) continue;
        out.push({
          date: `${m[1]}-${m[2]}-${m[3]}`,
          label,
          time: [...td.querySelectorAll('.time-span')].map((s) => s.textContent.trim()).join(''),
          sym: [...td.querySelectorAll('img')].map((i) => i.alt || i.title || '').join('') || td.textContent.trim(),
        });
      }
    }
    return out;
  });
}
