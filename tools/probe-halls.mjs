import { chromium } from 'playwright';
const b = await chromium.launch();
const txt = async (p) => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const ctl = (p) => p.evaluate(() => [...document.querySelectorAll('a,input,select,button')].filter((e) => e.type !== 'hidden').map((e) => `${e.tagName}#${e.id}[${e.name || ''}=${(e.value || '').slice(0, 12)}] ${(e.innerText || e.alt || '').trim().slice(0, 25)} | ${(e.getAttribute('onclick') || e.getAttribute('href') || '').slice(0, 200)} ${e.tagName === 'SELECT' ? [...e.options].map((o) => `${o.value}:${o.text.trim()}`).slice(0, 40).join('/') : ''}`).filter((s) => !/void\(0\)|skip|文字サイズ|Benner/.test(s)));
try {
  const p = await b.newPage({ locale: 'ja-JP' });
  const act = async (js) => { await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle', timeout: 45000 }), p.evaluate((c) => setTimeout(() => (0, eval)(c), 0), js)]); await p.waitForTimeout(500); };
  await p.goto('https://saitama.rsv.ws-scs.jp/web/', { waitUntil: 'networkidle' });
  await act('canLogin(document.form1, gRsvWTransInstSrchVacantAction)');
  console.log('ST v', (await txt(p)).slice(0, 300)); console.log('ST v-C', (await ctl(p)).filter((x) => /Srch|Ppsd|Area/.test(x)).join('\n'));
  await act('doPpsdSearchAction(document.form1, gRsvWTransInstSrchPpsdAction)');
  console.log('ST ppsd', (await ctl(p)).filter((x) => /sendPpsdCd/.test(x)).join('\n'));
} catch (e) { console.log('ST ERR', e.message.slice(0, 200)); }
try {
  const p = await b.newPage({ locale: 'ja-JP' });
  await p.goto('https://rikuu.net/higashiyamato/client/Top.aspx', { waitUntil: 'networkidle' });
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle' }), p.evaluate(() => setTimeout(() => __doPostBack('btnUserEntry', ''), 0))]);
  console.log('HY', p.url(), (await txt(p)).slice(0, 1200)); console.log('HY-C', (await ctl(p)).slice(0, 50).join('\n'));
} catch (e) { console.log('HY ERR', e.message.slice(0, 200)); }
// 練馬・渋谷の新しい画面：裏の API を JS から探す
for (const [l, base] of [['NM', 'https://shisetsuyoyaku.city.nerima.tokyo.jp/'], ['SB', 'https://www.yoyaku.city.shibuya.tokyo.jp/']]) {
  try {
    const h = await (await fetch(base)).text();
    const js = [...h.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => new URL(m[1], base).href);
    const all = new Set();
    for (const u of js) { const s = await (await fetch(u)).text(); for (const m of s.matchAll(/["'`]\/?api\/[A-Za-z0-9_\/\-{}$.:]+["'`]/g)) all.add(m[0]); }
    console.log(l, 'js', js.length, [...all].slice(0, 120).join(' '));
    const ut = await (await fetch(base + 'api/use_types')).text(); console.log(l, 'use_types', ut.slice(0, 600));
  } catch (e) { console.log(l, 'ERR', e.message.slice(0, 150)); }
}
await b.close();
