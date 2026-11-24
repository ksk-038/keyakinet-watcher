import { chromium } from 'playwright';
const b = await chromium.launch();
try {
  const p = await b.newPage({ locale: 'ja-JP' });
  await p.goto('https://sst1.ka-ruku.com/komae/month', { waitUntil: 'networkidle' });
  await p.selectOption('#selShisetsu', '0010'); await p.selectOption('#selNengetu', '202711');
  const btn = await p.$('button:has-text("検索"), input[value="検索"]');
  await Promise.all([p.waitForLoadState('networkidle'), btn.click()]); await p.waitForTimeout(1500);
  console.log('KOMAE', p.url(), (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 2000));
  console.log('KOMAE-H', (await p.content()).replace(/\s+/g, ' ').match(/空き状況<[\s\S]{0,3500}/)?.[0]);
} catch (e) { console.log('KOMAE ERR', e.message); }
try {
  const p = await b.newPage({ locale: 'ja-JP' });
  await p.goto('https://web118.rsv.ws-scs.jp/tokorozawa/web/index.jsp', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3000);
  console.log('TOKO-O', JSON.stringify(await p.evaluate(() => Object.fromEntries(['#bname', '#purpose'].map((s) => [s, [...document.querySelectorAll(`${s} option`)].map((o) => o.text.trim())])))).slice(0, 3500));
} catch (e) { console.log('TOKO ERR', e.message); }
await b.close();
