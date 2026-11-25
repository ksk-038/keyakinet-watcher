import { chromium } from 'playwright';
const b = await chromium.launch();
const ctl = (p) => p.evaluate(() => [...document.querySelectorAll('a')].map((e) => `${(e.innerText || '').trim().slice(0, 30)} | ${(e.getAttribute('href') || '').replace(/\(_dom == 3\) \? document\.layers\['disp'\]\.document\.form1 : document\.form1/g, 'F').slice(0, 160)}`).filter((s) => /send|doTrans/.test(s)));
try {
  const p = await b.newPage({ locale: 'ja-JP' });
  const act = async (js) => { await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle', timeout: 45000 }), p.evaluate((c) => setTimeout(() => (0, eval)(c), 0), js)]); await p.waitForTimeout(500); };
  await p.goto('https://saitama.rsv.ws-scs.jp/web/', { waitUntil: 'networkidle' });
  await act('canLogin(document.form1, gRsvWTransInstSrchVacantAction)');
  await act('doPpsdSearchAction(document.form1, gRsvWTransInstSrchPpsdAction)');
  await act("sendPpsdCd(document.form1, gRsvWTransInstSrchPpsAction, '200','2')");
  console.log('ST pps', (await ctl(p)).join('\n'));
  const L = await ctl(p); const x = L.find((y) => /公演|発表|舞踊|ダンス/.test(y)) || L[1];
  await act(x.split(' | ')[1].replace(/^javascript:/, '').replace(/\bF\b/g, 'document.form1'));
  console.log('ST bld', x.split(' | ')[0], '\n', (await ctl(p)).join('\n'));
} catch (e) { console.log('ST ERR', e.message.slice(0, 200)); }
await b.close();
