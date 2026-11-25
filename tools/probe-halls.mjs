import { chromium } from 'playwright';
const b = await chromium.launch();
const txt = async (p) => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const ctl = (p) => p.evaluate(() => [...document.querySelectorAll('a,input,select,button')].filter((e) => e.type !== 'hidden').map((e) => `${e.tagName}#${e.id}[${e.name || ''}=${(e.value || '').slice(0, 12)}] ${(e.innerText || e.alt || '').trim().slice(0, 25)} | ${(e.getAttribute('onclick') || e.getAttribute('href') || '').slice(0, 160)} ${e.tagName === 'SELECT' ? [...e.options].map((o) => o.text.trim()).slice(0, 30).join('/') : ''}`).filter((s) => !/バナー|void\(0\)|skip|文字サイズ/.test(s)));
for (const [l, u] of [['HY', 'https://rikuu.net/higashiyamato/client/ReserveSearch_Calendar.aspx'], ['SB', 'https://www.yoyaku.city.shibuya.tokyo.jp/'], ['NM', 'https://shisetsuyoyaku.city.nerima.tokyo.jp/']]) {
  try { const p = await b.newPage({ locale: 'ja-JP' }); await p.goto(u, { waitUntil: 'networkidle', timeout: 45000 }); await p.waitForTimeout(1500);
    const h = await p.content();
    console.log(`\n${l}`, p.url(), /turnstile|recaptcha|hcaptcha/i.test(h) ? 'BOTCHECK' : '', (await txt(p)).slice(0, 1200));
    console.log(`${l}-C`, (await ctl(p)).slice(0, 50).join('\n'));
  } catch (e) { console.log(l, 'ERR', e.message.slice(0, 150)); }
}
// さいたま：川崎と同じ型か
try {
  const p = await b.newPage({ locale: 'ja-JP' });
  const act = async (js) => { await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle', timeout: 45000 }), p.evaluate((c) => setTimeout(() => (0, eval)(c), 0), js)]); await p.waitForTimeout(500); };
  await p.goto('https://saitama.rsv.ws-scs.jp/web/', { waitUntil: 'networkidle' });
  console.log('\nST top', p.url(), (await txt(p)).slice(0, 600));
  await act('doAction(document.form1, gRsvWTransRsvMenuAction)');
  console.log('ST menu', (await ctl(p)).filter((x) => /Srch/.test(x)).join('\n'));
  await act('doPpsdSearchAction(document.form1, gRsvWTransInstSrchPpsdAction)');
  console.log('ST ppsd', (await ctl(p)).filter((x) => /sendPpsdCd/.test(x)).join('\n'));
} catch (e) { console.log('ST ERR', e.message.slice(0, 200)); }
await b.close();
