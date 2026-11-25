import { chromium } from 'playwright';
const b = await chromium.launch();
for (const [l, u] of [['KMIL', 'https://reserve.aserv.jp/k-mil/'], ['KAWA', 'https://www.fureai-net.city.kawasaki.jp/web/']]) {
  try {
    const p = await b.newPage({ locale: 'ja-JP' });
    await p.goto(u, { waitUntil: 'networkidle', timeout: 40000 });
    console.log(l, p.url(), (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 1200));
    console.log(l + '-C', (await p.evaluate(() => [...document.querySelectorAll('a,button,input[type=button],input[type=submit],select')].filter((e) => e.offsetParent).map((e) => `${e.tagName}#${e.id}[${e.name || ''}] ${(e.innerText || e.value || '').trim().slice(0, 25)} ${e.tagName === 'SELECT' ? [...e.options].map((o) => o.text).slice(0, 15).join('/') : ''}`))).slice(0, 50).join('\n'));
  } catch (e) { console.log(l, 'ERR', e.message.slice(0, 150)); }
}
await b.close();
