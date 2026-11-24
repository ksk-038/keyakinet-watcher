// ホール空き監視の下調べ: 予約サイトの画面を順にたどってHTMLとスクショを保存する（動作確認用・通知はしない）
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const SITES = [
  { key: 'nishitokyo', url: 'https://k5.p-kashikan.jp/nishitokyo-city/', words: ['こもれび'] },
  { key: 'higashiyamato', url: 'https://k5.p-kashikan.jp/higashiyamato-city/', words: ['ハミング', '市民会館'] },
  { key: 'urayasu', url: 'https://k5.p-kashikan.jp/urayasu-city/', words: ['文化会館'] },
];
const OUT = 'debug-halls';
await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
for (const s of SITES) {
  const page = await (await browser.newContext({ locale: 'ja-JP', viewport: { width: 1280, height: 1800 } })).newPage();
  let n = 0;
  const save = async (tag) => {
    n++;
    await fs.writeFile(`${OUT}/${s.key}-${n}-${tag}.html`, await page.content());
    await page.screenshot({ path: `${OUT}/${s.key}-${n}-${tag}.png`, fullPage: true }).catch(() => {});
    console.log(`${s.key} ${n} ${tag}: ${page.url()}`);
  };
  const clickText = async (re) => {
    const el = page.locator('a, button, input[type=button], input[type=submit], [onclick]').filter({ hasText: re }).first();
    if (await el.count()) { await Promise.all([page.waitForLoadState('networkidle').catch(() => {}), el.click()]); await page.waitForTimeout(2500); return true; }
    const v = page.locator(`input[value*="${re.source}"]`).first();
    if (await v.count()) { await v.click(); await page.waitForTimeout(2500); return true; }
    return false;
  };
  try {
    await page.goto(s.url, { waitUntil: 'networkidle', timeout: 60000 });
    await save('top');
    for (const re of [/空き状況/, /施設の空き/, /空き照会/]) if (await clickText(re)) { await save('aki'); break; }
    for (const w of s.words) if (await clickText(new RegExp(w))) { await save(`fac-${w}`); break; }
    for (const re of [/ホール/, /検索/, /表示/]) if (await clickText(re)) { await save(`next-${re.source}`); break; }
  } catch (e) { console.log(`❌ ${s.key}: ${e.message}`); await save('error').catch(() => {}); }
}
await browser.close();
