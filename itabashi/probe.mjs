// 開発用: 板橋区の画面を順にたどってHTMLとスクショを保存する
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const DIR = 'debug-itabashi';
await fs.mkdir(DIR, { recursive: true });
const b = await chromium.launch();
const page = await (await b.newContext({ locale: 'ja-JP', viewport: { width: 1280, height: 900 } })).newPage();
page.on('dialog', (d) => { console.log('dialog', d.message()); d.accept(); });
let n = 0;
async function snap(name) {
  const p = `${DIR}/${String(++n).padStart(2, '0')}-${name}`;
  await page.screenshot({ path: `${p}.png`, fullPage: true }).catch(() => {});
  for (const [i, f] of page.frames().entries()) await fs.writeFile(`${p}-f${i}.html`, `<!-- ${f.url()} -->\n` + (await f.content().catch(() => ''))).catch(() => {});
  console.log(n, name, page.url(), 'frames', page.frames().length);
}
async function click(text, nav = true) {
  for (const f of page.frames()) {
    const cands = [
      f.locator(`input[value*="${text}"]`), f.locator(`img[alt*="${text}"]`), f.getByRole('link', { name: text }),
      f.getByRole('button', { name: text }), f.getByText(text, { exact: false }),
    ];
    for (const c of cands) {
      if (await c.count().catch(() => 0)) {
        const el = c.first();
        console.log('click', text, await el.evaluate((e) => e.outerHTML.slice(0, 300)).catch(() => ''));
        const w = nav ? page.waitForNavigation({ timeout: 30000 }).catch(() => console.log('  (no nav)')) : null;
        await el.click();
        if (w) await w;
        await page.waitForLoadState('load').catch(() => {});
        await page.waitForTimeout(800);
        return;
      }
    }
  }
  throw new Error('not found: ' + text);
}
try {
  await page.goto('https://www.itabashi-shisetsu-yoyaku.jp/eshisetsu/menu/Welcome.cgi', { waitUntil: 'load' });
  await snap('top');
  for (const t of ['空き照会のみのかたはこちら', '空き照会・予約', '利用目的から絞り込む', '芸術・文化・趣味・教養', 'ダンス・バレエ等', '全て選択する']) {
    await click(t, t !== '全て選択する');
    await snap(t);
  }
  await click('次に進む');
  await snap('result');
  await click('31日表示', false).catch((e) => console.log(e.message));
  await snap('radio31');
  await page.locator('img[alt^="表示"], input[value="表示"], img[alt*="表示ボタン"]').first().click().catch((e) => console.log(e.message));
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForTimeout(3000);
  await snap('result31');
} catch (e) { console.log('ERR', e.message); await snap('error'); }
await b.close();
