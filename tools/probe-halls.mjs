import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ locale: 'ja-JP' });
p.on('dialog', (d) => d.accept().catch(() => {}));
const dump = async (tag) => {
  const r = await p.evaluate(() => ({ u: location.href, t: document.body.innerText.replace(/\s+/g, ' ').slice(0, 700), a: [...document.querySelectorAll('a,input[type=button],input[type=submit],input[type=image],button')].map((e) => `${(e.textContent || e.value || e.alt || '').replace(/\s+/g, ' ').trim().slice(0, 20)}=${(e.getAttribute('onclick') || e.getAttribute('href') || '').slice(0, 110)}`).slice(0, 40) }));
  console.log(`\n### ${tag} ${r.u}\n${r.t}\n  ${r.a.join('\n  ')}`);
};
try { await p.goto('https://sisetun.kcf.or.jp/web/', { waitUntil: 'networkidle', timeout: 40000 }); await dump('KCF top'); } catch (e) { console.log('KCF ERR', e.message.slice(0, 200)); }
try {
  await p.goto('https://shisetsu.city.arakawa.tokyo.jp/stagia/reserve/gin_menu', { waitUntil: 'networkidle', timeout: 40000 });
  await dump('AR menu');
  const imgs = await p.$$('input[type=image]');
  if (imgs[1]) { await Promise.all([p.waitForNavigation({ timeout: 30000 }).catch(() => {}), imgs[1].click()]); await p.waitForTimeout(1500); await dump('AR next'); }
} catch (e) { console.log('AR ERR', e.message.slice(0, 200)); }
await b.close();
