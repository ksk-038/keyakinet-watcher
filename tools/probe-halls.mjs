import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ locale: 'ja-JP' });
p.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept().catch(() => {}); });
const dump = async (tag) => {
  const r = await p.evaluate(() => ({ u: location.href, t: document.body.innerText.replace(/\s+/g, ' ').slice(0, 900), ts: !!document.querySelector('.cf-turnstile, iframe[src*="challenges.cloudflare"], script[src*="turnstile"]'), a: [...document.querySelectorAll('a,input[type=button],input[type=submit],button')].map((e) => `${(e.textContent || e.value || '').replace(/\s+/g, ' ').trim().slice(0, 24)}=${(e.getAttribute('onclick') || e.getAttribute('href') || '').slice(0, 120)}`).slice(0, 40) }));
  console.log(`\n### ${tag} ${r.u} turnstile=${r.ts}\n${r.t}\n  ${r.a.join('\n  ')}`);
};
for (const [tag, u] of [['TODA', 'https://yoyaku.city.toda.saitama.jp/yoyaku/'], ['ASAKA', 'https://www.pf-yoyaku.com/User/asaka/']]) {
  try { await p.goto(u, { waitUntil: 'networkidle', timeout: 40000 }); await dump(tag); } catch (e) { console.log(tag, 'ERR', e.message.slice(0, 200)); }
}
await b.close();
