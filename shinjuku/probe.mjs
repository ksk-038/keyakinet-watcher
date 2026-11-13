import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await (await browser.newContext({ locale: 'ja-JP' })).newPage();
const sq = (s) => s.replace(/\s+/g, ' ');
await page.goto('https://www.shinjuku.eprs.jp/regasu/web/index.jsp', { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(() => {});
const nav = page.waitForURL((u) => !u.href.includes('index.jsp'), { timeout: 60000 });
await page.evaluate(() => doAction(document.form1, gRsvWTransInstListAction));
await nav; await page.waitForLoadState('networkidle').catch(() => {});
console.log('URL ' + page.url());
console.log('BODY ' + sq(await page.locator('body').innerText()).slice(0, 4000));
console.log('LINKS ' + (await page.evaluate(() => [...document.querySelectorAll('a,button,[onclick]')].map((e) => `${(e.innerText || '').trim().slice(0, 20)}=>${(e.getAttribute('onclick') || e.getAttribute('href') || '').slice(0, 120)}`).join('\n'))).slice(0, 5000));
// 最初の館の詳細を開いてみる
const first = page.locator('a,button').filter({ hasText: '生涯学習館' }).first();
if (await first.count()) {
  await first.click(); await page.waitForLoadState('networkidle').catch(() => {});
  console.log('URL2 ' + page.url());
  console.log('BODY2 ' + sq(await page.locator('body').innerText()).slice(0, 5000));
  console.log('LINKS2 ' + (await page.evaluate(() => [...document.querySelectorAll('a,button,[onclick]')].map((e) => `${(e.innerText || '').trim().slice(0, 20)}=>${(e.getAttribute('onclick') || e.getAttribute('href') || '').slice(0, 120)}`).join('\n'))).slice(0, 3000));
}
await browser.close();
