import { chromium } from 'playwright';
const b = await chromium.launch();
const txt = async (p) => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
try {
  const p = await b.newPage({ locale: 'ja-JP' });
  await p.goto('https://reserve.aserv.jp/k-mil/jyoken.do', { waitUntil: 'networkidle' });
  await p.selectOption('select[name=kanCode]', { label: 'かめありリリオホール' }); await p.waitForTimeout(1500);
  await p.selectOption('select[name=skubunCode]', '4'); await p.waitForTimeout(1500);
  await p.selectOption('select[name=shisetsuCode]', '16'); await p.waitForTimeout(800);
  await p.evaluate(() => { const e = document.getElementById('selectDate'); e.value = '2027/11/27'; });
  await Promise.all([p.waitForLoadState('networkidle'), p.evaluate(() => sendData('20271127'))]); await p.waitForTimeout(1500);
  const h = await p.content();
  const i = h.indexOf('2027/11/27');
  console.log('KM html', h.slice(Math.max(0, i - 2500), i + 3500).replace(/\s+/g, ' '));
} catch (e) { console.log('KM ERR', e.message.slice(0, 200)); }
try {
  const p = await b.newPage({ locale: 'ja-JP' });
  await p.goto('https://www.fureai-net.city.kawasaki.jp/web/', { waitUntil: 'networkidle' });
  await Promise.all([p.waitForLoadState('networkidle'), p.evaluate(() => doAction(document.form1, gRsvWTransRsvMenuAction))]); await p.waitForTimeout(1500);
  console.log('KW rsv', p.url(), (await txt(p)).slice(0, 1200));
  console.log('KW rsv-C', (await p.evaluate(() => [...document.querySelectorAll('a,input,select')].filter((e) => e.type !== 'hidden').map((e) => `${e.tagName}#${e.id}[${e.name || ''}] ${(e.innerText || e.value || '').trim().slice(0, 25)} | ${(e.getAttribute('onclick') || e.getAttribute('href') || '').slice(0, 100)} ${e.tagName === 'SELECT' ? [...e.options].map((o) => o.text.trim()).slice(0, 30).join('/') : ''}`))).filter((s) => !/バナー|共有持分|ＣＲＥＸＩＳ|ＥＩＰ|文字サイズ|void/.test(s)).slice(10, 60).join('\n'));
} catch (e) { console.log('KW ERR', e.message.slice(0, 200)); }
await b.close();
