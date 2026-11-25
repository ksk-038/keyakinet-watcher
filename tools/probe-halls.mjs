import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ locale: 'ja-JP' });
p.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept().catch(() => {}); });
try {
  await p.goto('https://yoyaku.city.toda.saitama.jp/yoyaku/', { waitUntil: 'networkidle', timeout: 40000 });
  const btn = await p.$('text=検索');
  console.log('btn', !!btn);
  await Promise.all([p.waitForLoadState('networkidle'), p.locator('a,button,input').filter({ hasText: /^検索$/ }).first().click().catch((e) => console.log('c', e.message.slice(0, 100)))]);
  await p.waitForTimeout(2000);
  console.log('URL', p.url());
  console.log((await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))).slice(0, 2500));
  console.log('SEL', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('select')].map((s) => ({ n: s.name, o: [...s.options].map((o) => o.text.trim()).slice(0, 60) })))).slice(0, 3000));
  console.log('CHK', (await p.evaluate(() => [...document.querySelectorAll('label')].map((l) => l.innerText.trim()).filter(Boolean))).slice(0, 120).join(' | '));
} catch (e) { console.log('TODA ERR', e.message.slice(0, 300)); }
try {
  const r = await p.goto('https://www.pf-yoyaku.com/User/asaka/', { waitUntil: 'networkidle', timeout: 40000 });
  console.log('ASAKA', r.status(), (await p.content()).slice(0, 1500).replace(/\s+/g, ' '));
} catch (e) { console.log('ASAKA ERR', e.message.slice(0, 200)); }
await b.close();
