// ホール監視の下調べ（品川区しせつよやく）: どこで・何をするの選択肢をログに出す
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'ja-JP' });
await page.goto('https://www.cm9.eprs.jp/shinagawa/web/index.jsp', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#purpose option'), null, { timeout: 30000 });
const r = await page.evaluate(() => ({
  areas: [...document.querySelectorAll('#bname option')].map((o) => `${o.value}:${o.text.trim()}`),
  purposes: [...document.querySelectorAll('#purpose option')].map((o) => `${o.value}:${o.text.trim()}`),
}));
console.log('AREAS', r.areas.join(' | '));
console.log('PURPOSES', r.purposes.join(' | '));
await browser.close();
