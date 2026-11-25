import { chromium } from 'playwright';
const b = await chromium.launch();
const txt = async (p) => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const ctl = (p) => p.evaluate(() => [...document.querySelectorAll('a,input,select')].filter((e) => e.type !== 'hidden').map((e) => `${e.tagName}#${e.id}[${e.name || ''}=${(e.value || '').slice(0, 12)}] ${(e.innerText || '').trim().slice(0, 25)} | ${(e.getAttribute('onclick') || e.getAttribute('href') || '').slice(0, 300)} ${e.tagName === 'SELECT' ? [...e.options].map((o) => o.text.trim()).slice(0, 40).join('/') : ''}`).filter((s) => !/バナー|共有持分|ＣＲＥＸＩＳ|ＥＩＰ|void\(0\)|skip/.test(s)));
try {
  const p = await b.newPage({ locale: 'ja-JP' });
  await p.goto('https://www.fureai-net.city.kawasaki.jp/web/', { waitUntil: 'networkidle' });
  const act = async (js) => { await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle' }), p.evaluate((c) => setTimeout(() => (0, eval)(c), 0), js)]); await p.waitForTimeout(800); };
  await act('doAction(document.form1, gRsvWTransRsvMenuAction)');
  await act('doPpsdSearchAction(document.form1, gRsvWTransInstSrchPpsdAction)');
  const links = async () => (await ctl(p)).filter((x) => /send|javascript/.test(x) && !/gRsvPawqa|gRsvWTransInstSrchVacantAction|Lot|UserRegist|Pawnc|SiteMap|Help|RsvMenu/.test(x));
  await act("sendPpsdCd(document.form1, gRsvWTransInstSrchPpsAction, '210','2')");
  let L = await links(); console.log('KW pps', L.join('\n'));
  const pick = async (re) => { const x = L.find((y) => re.test(y)); if (!x) throw new Error('no ' + re + ' in ' + L.length); const js = x.split(' | ')[1].replace(/^javascript:/, '').trim(); await act(js.replace(/;$/, '')); L = await links(); };
  await pick(/演劇（公演/);
  console.log('KW kan', (await txt(p)).slice(0, 300), '\n', L.join('\n'));
  await pick(/宮前市民館/);
  console.log('KW inst', (await txt(p)).slice(0, 300), '\n', L.join('\n'));
} catch (e) { console.log('KW ERR', e.message.slice(0, 200)); }
await b.close();
