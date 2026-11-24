import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({ locale: 'ja-JP' });
try {
  await p.goto('https://yoyaku.musashino.or.jp/mnet/web/index.jsp', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4000);
  console.log('MUSA', p.url(), await p.title());
  console.log('MUSA-O', JSON.stringify(await p.evaluate(() => Object.fromEntries(['#bname', '#purpose'].map((s) => [s, [...document.querySelectorAll(`${s} option`)].map((o) => o.text.trim())])))).slice(0, 3000));
  console.log('MUSA-T', (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 800));
} catch (e) { console.log('MUSA ERR', e.message); }
await b.close();
