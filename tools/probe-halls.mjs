import { chromium } from 'playwright';
const b = await chromium.launch();
const txt = async (p) => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
try {
  const p = await b.newPage({ locale: 'ja-JP' });
  p.on('dialog', (d) => { console.log('KM dialog', d.message()); d.accept(); });
  await p.goto('https://reserve.aserv.jp/k-mil/jyoken.do', { waitUntil: 'networkidle' });
  await p.selectOption('select[name=kanCode]', { label: 'かめありリリオホール' }); await p.waitForTimeout(1500);
  await p.selectOption('select[name=skubunCode]', '4'); await p.waitForTimeout(1500);
  await p.selectOption('select[name=shisetsuCode]', '16'); await p.waitForTimeout(800);
  await p.evaluate(() => { const e = document.getElementById('selectDate'); e.removeAttribute('readonly'); e.value = '2027/11/27'; });
  console.log('KM sendData', (await p.evaluate(() => String(window.sendData))).slice(0, 600));
  await Promise.all([p.waitForLoadState('networkidle'), p.evaluate(() => sendData('20271127'))]); await p.waitForTimeout(2000);
  console.log('KM res', p.url(), (await txt(p)).slice(0, 2500));
  console.log('KM tbl', (await p.evaluate(() => [...document.querySelectorAll('table')].map((t) => t.innerText.replace(/\s+/g, ' ').slice(0, 600)).filter((s) => /リリオ|午前|午後|夜間|○|×/.test(s)).slice(0, 4).join(' ||| '))));
} catch (e) { console.log('KM ERR', e.message.slice(0, 200)); }
try {
  const p = await b.newPage({ locale: 'ja-JP' });
  await p.goto('https://www.fureai-net.city.kawasaki.jp/web/', { waitUntil: 'networkidle' });
  console.log('KW web', p.url(), (await txt(p)).slice(0, 800));
  console.log('KW web-C', (await p.evaluate(() => [...document.querySelectorAll('a,input,select,button,area')].filter((e) => e.type !== 'hidden').map((e) => `${e.tagName}#${e.id}[${e.name || ''}] ${(e.innerText || e.value || e.alt || [...(e.querySelectorAll ? e.querySelectorAll('img') : [])].map((i) => i.alt).join('/') || '').trim().slice(0, 25)} | ${(e.getAttribute('onclick') || e.getAttribute('href') || '').slice(0, 100)}`))).slice(0, 60).join('\n'));
} catch (e) { console.log('KW ERR', e.message.slice(0, 200)); }
await b.close();
