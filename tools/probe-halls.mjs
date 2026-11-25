import { chromium } from 'playwright';
const b = await chromium.launch();
const opts = (p, n) => p.evaluate((n) => [...document.querySelectorAll(`select[name=${n}] option`)].map((o) => `${o.value}:${o.text.trim()}`), n);
try {
  const p = await b.newPage({ locale: 'ja-JP' });
  p.on('dialog', (d) => { console.log('KM dialog', d.message()); d.accept(); });
  await p.goto('https://reserve.aserv.jp/k-mil/jyoken.do', { waitUntil: 'networkidle' });
  for (const kan of ['かめありリリオホール', 'かつしかシンフォニーヒルズ']) {
    await p.selectOption('select[name=kanCode]', { label: kan }); await p.waitForTimeout(1500);
    console.log('KM skubun', kan, (await opts(p, 'skubunCode')).join(' '));
  }
  await p.selectOption('select[name=kanCode]', { label: 'かめありリリオホール' }); await p.waitForTimeout(1500);
  const sk = (await opts(p, 'skubunCode')).find((x) => /ホール/.test(x))?.split(':')[0];
  if (sk) { await p.selectOption('select[name=skubunCode]', sk); await p.waitForTimeout(1500); }
  console.log('KM shisetsu', (await opts(p, 'shisetsuCode')).join(' '));
  console.log('KM date html', await p.evaluate(() => document.querySelector('#selectDate')?.outerHTML));
  console.log('KM buttons', (await p.evaluate(() => [...document.querySelectorAll('a,button,input[type=button],input[type=submit],img')].filter((e) => e.offsetParent).map((e) => `${e.tagName} ${(e.innerText || e.value || e.alt || '').trim().slice(0, 20)} | ${(e.getAttribute('onclick') || e.getAttribute('href') || '').slice(0, 80)}`))).join('\n'));
} catch (e) { console.log('KM ERR', e.message.slice(0, 200)); }
try {
  const p = await b.newPage({ locale: 'ja-JP' });
  await p.goto('https://www.fureai-net.city.kawasaki.jp/user/view/user/homeIndex.html', { waitUntil: 'networkidle' });
  console.log('KW btns', (await p.evaluate(() => [...document.querySelectorAll('a#goBtn, a#login, a#easyurl, a#multiurl')].map((a) => `${a.id} ${(a.innerText || [...a.querySelectorAll('img')].map((i) => i.alt).join('/')).trim().slice(0, 30)} | ${(a.getAttribute('onclick') || a.getAttribute('href') || '').slice(0, 120)}`))).join('\n'));
} catch (e) { console.log('KW ERR', e.message.slice(0, 200)); }
await b.close();
