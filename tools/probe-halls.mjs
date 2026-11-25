import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ locale: 'ja-JP' });
p.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept().catch(() => {}); });
const norm = (s) => s.replace(/^javaScript:/i, '').replace(/\(?\(_dom == 3\) \? document\.layers\['disp'\]\.document\.(\w+) : document\.\w+ ?\)?/g, 'document.$1');
const hrefs = () => p.evaluate(() => [...document.querySelectorAll('a,input')].map((a) => ({ t: (a.textContent || a.value || a.alt || '').replace(/\s+/g, ' ').trim().slice(0, 30), h: (a.getAttribute('href') || a.getAttribute('onclick') || '').replace(/^javaScript:/i, '') })).filter((x) => x.h)).then((l) => l.map((x) => ({ ...x, n: norm(x.h) })));
const act = async (js) => { await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle', timeout: 40000 }).catch((e) => console.log('nav', e.message.slice(0, 80))), p.evaluate((c) => setTimeout(() => (0, eval)(c), 0), js)]); await p.waitForTimeout(800); };
const click = async (re) => { const x = (await hrefs()).find((a) => re.test(a.t)); console.log('CLICK', re, x?.h.slice(0, 160)); await act(x.h); };
try {
  await p.goto('https://sisetun.kcf.or.jp/web/', { waitUntil: 'networkidle', timeout: 40000 });
  await act('doAction(document.formWTransInstSrchVacantAction, gRsvWTransInstSrchVacantAction)');
  await act('doAction(document.formWTransInstSrchPpsdAction, gRsvWTransInstSrchPpsdAction)');
  await click(/^式典$/); await click(/^すべて$/); await click(/^江東区文化センター$/);
  const h = await hrefs();
  console.log('CAL', h.filter((x) => /moveCalender|selectDay|transSrchBld/.test(x.n)).slice(0, 6).map((x) => x.n).join('\n'));
  const mv = h.filter((x) => /moveCalender/.test(x.h)).pop();
  console.log('MV', mv?.h);
  await act(mv.h.replace(/20\d\d(0[1-9]|1[0-2])01/, '20271101'));
  console.log('MONTH', (await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))).slice(0, 600));
  const sd = (await hrefs()).filter((x) => /selectDay/.test(x.h));
  console.log('SD', sd.slice(0, 3).map((x) => x.n).join('\n'));
  console.log('MALT', (await p.evaluate(() => [...document.querySelectorAll('table img[alt]')].map((i) => i.alt))).join(' | ').slice(0, 1500)); console.log('SDALL', sd.map((x) => x.n.match(/(\d+)\)$/)?.[1]).join(','));
  const d27 = sd.find((x) => /, 2027, 11, 2[78]\)/.test(x.n)) || sd.find((x) => /2027, 11, (6|13|20)\)/.test(x.n));
  if (d27) { await act(d27.h); console.log('DAY', (await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))).slice(0, 1500)); console.log('ALTS', (await p.evaluate(() => [...document.querySelectorAll('table img[alt]')].map((i) => i.alt))).slice(0, 40).join(' | ')); console.log('ROWS', (await p.evaluate(() => [...document.querySelectorAll('table.rsvakitable tr')].map((r) => r.innerText.replace(/\s+/g, ' ') + ' || ' + [...r.querySelectorAll('img[alt]')].map((i) => i.alt).join(',')))).slice(0, 25).join('\n')); }
} catch (e) { console.log('KCF ERR', e.message.slice(0, 300)); }
try {
  await p.goto('https://shisetsu.city.arakawa.tokyo.jp/stagia/reserve/gin_menu', { waitUntil: 'networkidle', timeout: 40000 });
  const imgs = await p.$$('input[type=image]');
  await Promise.all([p.waitForNavigation({ timeout: 30000 }).catch(() => {}), imgs[1].click()]);
  await Promise.all([p.waitForNavigation({ timeout: 30000 }).catch(() => {}), p.click('text=空き状況の確認')]);
  const sels = async (t) => console.log('SELECTS', t, JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('select')].filter((s) => s.options.length).map((s) => ({ n: s.name, f: s.form?.name, o: [...s.options].map((o) => `${o.value}:${o.text.trim()}`).slice(0, 60) })))));
  const step = async (sel, val, fn) => { await p.selectOption(sel, val); await Promise.all([p.waitForNavigation({ timeout: 30000 }).catch(() => {}), p.evaluate(fn)]); await p.waitForTimeout(800); };
  await step('select[name=g_bunruicd_1_show]', '800', 'submitBunrui1()'); await step('select[name=g_bunruicd_2_show]', '851', 'submitBunrui2()'); await sels('after2');
  const s2 = await p.evaluate(() => [...document.querySelectorAll('select')].filter((s) => s.options.length).map((s) => s.name));
  if (s2.includes('riyosmk')) { const v = await p.evaluate(() => [...document.selForm_1.riyosmk.options].map((o) => o.value).find((x) => x)); if (v) { await step('select[name=riyosmk]', v, 'changed()'); await sels('after3'); } }
  await p.selectOption('select[name=g_basyocd]', '160'); await Promise.all([p.waitForNavigation({ timeout: 30000 }).catch(() => {}), p.evaluate('btnOK_3()')]); await p.waitForTimeout(800); await sels('after3b');
  if (await p.$('select[name=g_heyacd]')) { const ops = await p.evaluate(() => [...document.heyaform.g_heyacd.options].map((o) => o.value)); await p.selectOption('select[name=g_heyacd]', ops); await Promise.all([p.waitForNavigation({ timeout: 30000 }).catch(() => {}), p.evaluate('heyaOK()')]); await p.waitForTimeout(800); await sels('after4'); }
  await p.selectOption('#YYYY', '2027'); await p.evaluate('changeYear()'); console.log('MMops', await p.evaluate(() => [...document.querySelector('#MM').options].map((o) => o.value).join(',')));
  await p.selectOption('#MM', '11').catch((e) => console.log('MM', e.message.slice(0, 60))); await p.evaluate('changeDay()'); console.log('DDops', await p.evaluate(() => [...document.querySelector('#DD').options].map((o) => o.value).join(',')));
  await p.selectOption('#DD', '27').catch((e) => console.log('DD', e.message.slice(0, 60)));
  console.log('flagYobi', await p.evaluate('typeof flagYobi !== "undefined" && flagYobi'));
  await Promise.all([p.waitForNavigation({ timeout: 30000 }).catch(() => {}), p.click('#btnOK')]); await p.waitForTimeout(1500);
  console.log('RESULT', p.url(), (await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))).slice(0, 2500));
  console.log('RTABLE', (await p.evaluate(() => [...document.querySelectorAll('table tr')].map((r) => [...r.cells].map((c) => (c.innerText.trim() || [...c.querySelectorAll('img')].map((i) => i.alt).join('/')).replace(/\s+/g, ' ')).join(' | ')))).slice(0, 30).join('\n'));
  if(0)console.log('FORMDATE', (await p.content()).match(/<form name="formDate"[\s\S]{0,2500}?<\/form>/i)?.[0].replace(/\s+/g, ' '));
  console.log('PAGE', (await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))).slice(0, 800));
  if(0)console.log(await p.evaluate(() => [submitBunrui1, typeof submitBunrui2 === 'function' && submitBunrui2, typeof changed === 'function' && changed, typeof heyaOK === 'function' && heyaOK, typeof dateSub === 'function' && dateSub].map(String).join('\n').slice(0, 2500)));
} catch (e) { console.log('AR ERR', e.message.slice(0, 300)); }
await b.close();
