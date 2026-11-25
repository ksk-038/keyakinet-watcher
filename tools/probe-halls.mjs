import { chromium } from 'playwright';
const b = await chromium.launch();
const dump = async (p, l) => {
  console.log(`\n${l}`, p.url(), (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 1500));
  console.log(`${l}-C`, (await p.evaluate(() => [...document.querySelectorAll('a,button,input,select')].filter((e) => e.offsetParent && e.type !== 'hidden').map((e) => `${e.tagName}#${e.id}[${e.name || ''}=${(e.value || '').slice(0, 15)}] ${(e.innerText || e.title || e.alt || '').trim().slice(0, 25)} ${e.tagName === 'SELECT' ? [...e.options].map((o) => o.text.trim()).slice(0, 25).join('/') : ''}`))).slice(0, 60).join('\n'));
};
for (const [l, u] of [['CHOFU', 'https://web02.rsv.ws-scs.jp/chofu-bunka/web/'], ['KMIL', 'https://reserve.aserv.jp/k-mil/jyoken.do'], ['KAWA', 'https://www.fureai-net.city.kawasaki.jp/user/view/user/homeIndex.html']]) {
  try { const p = await b.newPage({ locale: 'ja-JP' }); await p.goto(u, { waitUntil: 'networkidle', timeout: 40000 }); await p.waitForTimeout(2000); await dump(p, l); } catch (e) { console.log(l, 'ERR', e.message.slice(0, 150)); }
}
await b.close();
