import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ locale: 'ja-JP' });
p.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept().catch(() => {}); });
const fields = () => p.evaluate(() => [...document.querySelectorAll('input,select,button,a')].filter((e) => e.type !== 'hidden' && e.offsetParent).map((e) => `${e.tagName}:${e.type || ''}:${e.name || ''}:${e.id}:${(e.value || e.innerText || '').replace(/\s+/g, ' ').slice(0, 25)}`).filter((s) => !/selectedMokuteki|headerMenu|menuList|navigation|javascript/.test(s)));
const show = async (t) => { console.log(`\n### ${t} ${p.url()}\n${(await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))).slice(0, 1800)}`); console.log('TABLE', (await p.evaluate(() => [...document.querySelectorAll('table tr')].map((r) => [...r.cells].map((c) => (c.innerText.trim() || [...c.querySelectorAll('img')].map((i) => i.alt || i.title).join('/') || c.title || c.className).replace(/\s+/g, ' ')).join(' | ')))).slice(0, 40).join('\n')); console.log('F\n' + (await fields()).slice(0, 50).join('\n')); };
const click = async (loc) => { await loc.click(); await p.waitForLoadState('load').catch(() => {}); await p.waitForTimeout(3000); };
try {
  await p.goto('https://yoyaku.city.toda.saitama.jp/yoyaku/', { waitUntil: 'load', timeout: 60000 });
  await p.fill('#id1', '2027/11/27').catch((e) => console.log('fill', e.message.slice(0, 60)));
  await click(p.locator('#searchButton'));
  await click(p.locator('input[type=button][value="戸田市文化会館"]'));
  await show('BASHO');
  const hall = p.locator('input[type=button],button,a').filter({ hasText: /大ホール/ });
  const hv = p.locator('input[type=button][value*="大ホール"]');
  if (await hv.count()) { await click(hv.first()); await show('HALL'); } else if (await hall.count()) { await click(hall.first()); await show('HALL'); }
} catch (e) { console.log('TODA ERR', e.message.slice(0, 300)); }
await b.close();
