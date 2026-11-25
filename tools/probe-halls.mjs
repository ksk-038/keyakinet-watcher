import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ locale: 'ja-JP' });
p.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept().catch(() => {}); });
try {
  await p.goto('https://yoyaku.city.toda.saitama.jp/yoyaku/', { waitUntil: 'networkidle', timeout: 40000 });
  await Promise.all([p.waitForLoadState('networkidle'), p.locator('a,button,input').filter({ hasText: /^検索$/ }).first().click()]);
  await p.waitForTimeout(1500);
  console.log('FORM', (await p.evaluate(() => [...document.querySelectorAll('input,select,button')].filter((e) => e.type !== 'hidden').map((e) => `${e.tagName}:${e.type}:${e.name}:${e.id}:${(e.value || e.innerText || '').slice(0, 20)}`).filter((s) => !/selectedMokuteki|headerMenu/.test(s)))).slice(0, 60).join('\n'));
  await p.selectOption('select[name="searchingOption:displayPeriod"]', { label: '1ヵ月' }).catch((e) => console.log('per', e.message.slice(0, 80)));
  await p.selectOption('select[name="searchingOption:selectedBasho"]', { label: '戸田市文化会館' }).catch((e) => console.log('bas', e.message.slice(0, 80)));
  await p.waitForTimeout(1500);
  console.log('AFTERBASHO', (await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))).slice(0, 1500));
} catch (e) { console.log('TODA ERR', e.message.slice(0, 300)); }
try {
  const r = await p.goto('https://www.pf-yoyaku.com/User/asaka/Home', { waitUntil: 'networkidle', timeout: 40000 });
  console.log('ASAKA', r.status(), p.url(), !!(await p.$('.cf-turnstile, iframe[src*="challenges.cloudflare"], script[src*="turnstile"]')), (await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))).slice(0, 600));
} catch (e) { console.log('ASAKA ERR', e.message.slice(0, 200)); }
await b.close();
