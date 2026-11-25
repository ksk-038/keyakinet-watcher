import { chromium } from 'playwright';
const b = await chromium.launch();
const txt = async (p) => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const ctl = (p) => p.evaluate(() => [...document.querySelectorAll('a,input,select')].filter((e) => e.type !== 'hidden').map((e) => `${e.tagName}#${e.id}[${e.name || ''}=${(e.value || '').slice(0, 12)}] ${(e.innerText || '').trim().slice(0, 25)} | ${(e.getAttribute('onclick') || e.getAttribute('href') || '').slice(0, 110)} ${e.tagName === 'SELECT' ? [...e.options].map((o) => o.text.trim()).slice(0, 40).join('/') : ''}`).filter((s) => !/バナー|共有持分|ＣＲＥＸＩＳ|ＥＩＰ|void\(0\)|skip/.test(s)));
try {
  const p = await b.newPage({ locale: 'ja-JP' });
  await p.goto('https://www.fureai-net.city.kawasaki.jp/web/', { waitUntil: 'networkidle' });
  await Promise.all([p.waitForLoadState('networkidle'), p.evaluate(() => doAction(document.form1, gRsvWTransRsvMenuAction))]);
  await Promise.all([p.waitForLoadState('networkidle'), p.evaluate(() => doPpsdSearchAction(document.form1, gRsvWTransInstSrchPpsdAction))]); await p.waitForTimeout(1000);
  console.log('KW ppsd', p.url(), (await txt(p)).slice(0, 1500));
  console.log('KW ppsd-C', (await ctl(p)).slice(8, 70).join('\n'));
} catch (e) { console.log('KW ERR', e.message.slice(0, 200)); }
await b.close();
