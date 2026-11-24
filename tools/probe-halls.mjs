import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({ locale: 'ja-JP' });
p.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
await p.goto('https://www.yoyaku.city.ota.tokyo.jp/eshisetsu/menu/Welcome.cgi', { waitUntil: 'networkidle' });
const lab = (re) => p.evaluate((re) => [...document.querySelectorAll('input[type=radio],input[type=checkbox]')].map((e) => { const l = document.querySelector(`label[for="${e.id}"]`); return `${e.id}=${e.value} ${(l?.innerText || '').trim()}`; }).filter((s) => new RegExp(re).test(s)), re);
console.log('R', (await lab('^(yoyakuMode|jouken1|catSel1)')).join('\n'));
console.log('K', (await lab('プラザ|ホール')).join('\n'));
await p.click('text=ログインせずに空き状況を検索'); await p.waitForTimeout(800);
await p.click('label[for=yoyakuMode_1]'); await p.waitForTimeout(800);
await p.click('label[for=jouken1_3]'); await p.waitForTimeout(800);
const k = await p.evaluate(() => [...document.querySelectorAll('input[name=catSel3]')].find((e) => /区民プラザ/.test(document.querySelector(`label[for="${e.id}"]`)?.innerText || ''))?.id);
console.log('KID', k);
if (k) { await p.click(`label[for=${k}]`); await p.waitForTimeout(500); }
await p.click('#submitbutton'); await p.waitForLoadState('networkidle'); await p.waitForTimeout(1000);
console.log('P2', p.url(), (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 2500));
console.log('P2C', (await p.evaluate(() => [...document.querySelectorAll('input,button,a')].filter((e) => e.offsetParent).map((e) => `${e.tagName}#${e.id}[${e.name}=${e.value || ''}] ${(e.innerText || e.title || '').trim().slice(0, 30)} | ${(e.getAttribute('onclick') || '').slice(0, 90)}`))).slice(0, 70).join('\n'));
await b.close();
