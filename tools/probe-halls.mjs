import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ locale: 'ja-JP' });
p.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept().catch(() => {}); });
const dump = async (tag) => {
  const r = await p.evaluate(() => ({ u: location.href, t: document.body.innerText.replace(/\s+/g, ' ').slice(0, 900), a: [...document.querySelectorAll('a,input[type=button],input[type=submit],input[type=image],button,select')].map((e) => `${(e.textContent || e.value || e.alt || e.name || '').replace(/\s+/g, ' ').trim().slice(0, 24)}=${(e.getAttribute('onclick') || e.getAttribute('href') || '').replace(/\(\(_dom == 3\) \? document\.layers\['disp'\]\.document\.(\w+) : document\.\w+ \)/g, '$1').slice(0, 150)}`).filter((s) => !/tenkey|prevkey|nextfocus/.test(s)).slice(0, 50) }));
  console.log(`\n### ${tag} ${r.u}\n${r.t}\n  ${r.a.join('\n  ')}`);
};
const act = async (js) => { await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle', timeout: 40000 }).catch((e) => console.log('nav', e.message.slice(0, 80))), p.evaluate((c) => setTimeout(() => (0, eval)(c), 0), js)]); await p.waitForTimeout(800); };
try {
  await p.goto('https://sisetun.kcf.or.jp/web/', { waitUntil: 'networkidle', timeout: 40000 });
  const on = await p.evaluate(() => [...document.querySelectorAll('a')].map((a) => (a.getAttribute('href') || '').replace(/^javaScript:/i, '')).find((h) => /formWTransInstSrchVacantAction/.test(h)));
  console.log('ENTRY', on);
  await act(on); await dump('KCF 1');
  const nx = await p.evaluate(() => [...document.querySelectorAll('a')].map((a) => (a.getAttribute('href') || '').replace(/^javaScript:/i, '')).filter((h) => /Ppsd|Bld|Inst|Srch/.test(h)));
  console.log('NEXT', nx.slice(0, 10).join('\n'));
  if (nx[0]) { await act(nx[0]); await dump('KCF 2'); }
} catch (e) { console.log('KCF ERR', e.message.slice(0, 200)); }
try {
  await p.goto('https://shisetsu.city.arakawa.tokyo.jp/stagia/reserve/gin_menu', { waitUntil: 'networkidle', timeout: 40000 });
  const imgs = await p.$$('input[type=image]');
  await Promise.all([p.waitForNavigation({ timeout: 30000 }).catch(() => {}), imgs[1].click()]);
  await p.click('text=空き状況の確認'); await p.waitForLoadState('networkidle'); await p.waitForTimeout(1000); await dump('AR 1');
  console.log((await p.content()).match(/<form[\s\S]{0,3000}?<\/form>/i)?.[0].replace(/\s+/g, ' ').slice(0, 3000));
} catch (e) { console.log('AR ERR', e.message.slice(0, 200)); }
await b.close();
