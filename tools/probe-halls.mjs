import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({ locale: 'ja-JP' });
p.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
const dump = async (l) => {
  console.log(`\n${l}`, p.url(), (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 2500));
  console.log(`${l}-C`, (await p.evaluate(() => [...document.querySelectorAll('input,button,a,select')].filter((e) => e.offsetParent && e.type !== 'hidden').map((e) => { const lb = e.id && document.querySelector(`label[for="${e.id}"]`); return `${e.tagName}#${e.id}[${e.name}=${(e.value || '').slice(0, 20)}] ${((lb && lb.innerText) || e.innerText || e.title || '').trim().slice(0, 30)} | ${(e.getAttribute('onclick') || '').slice(0, 90)}`; }))).slice(0, 80).join('\n'));
};
await p.goto('https://www.yoyaku.city.ota.tokyo.jp/eshisetsu/menu/Welcome.cgi', { waitUntil: 'networkidle' });
await p.click('text=ログインせずに空き状況を検索'); await p.waitForTimeout(800);
await p.click('label[for=yoyakuMode_1]'); await p.waitForTimeout(800);
await p.click('label[for=jouken1_3]'); await p.waitForTimeout(800);
await p.click('label[for=catSel3_15]'); await p.waitForTimeout(500);
await p.click('#submitbutton'); await p.waitForLoadState('networkidle'); await p.waitForTimeout(1500);
await p.check('#r_record12'); await p.waitForTimeout(300);
await p.click('#submitbutton'); await p.waitForLoadState('networkidle'); await p.waitForTimeout(1500);
await dump('P3');
console.log('P3-H', (await p.content()).replace(/\s+/g, ' ').match(/<table[\s\S]{0,4000}/)?.[0]);
await b.close();
