import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ locale: 'ja-JP' });
p.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept().catch(() => {}); });
const hrefs = () => p.evaluate(() => [...document.querySelectorAll('a,input')].map((a) => ({ t: (a.textContent || a.value || a.alt || '').replace(/\s+/g, ' ').trim().slice(0, 30), h: (a.getAttribute('href') || a.getAttribute('onclick') || '').replace(/^javaScript:/i, '').replace(/\(?\(_dom == 3\) \? document\.layers\['disp'\]\.document\.(\w+) : document\.\w+ \)?/g, 'document.$1') })).filter((x) => x.h && !/tenkey|prevkey|nextfocus|^#|^http/.test(x.h)));
const show = async (tag) => { const t = await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 500)); const h = await hrefs(); console.log(`\n### ${tag}\n${t}\n  ${h.slice(0, 45).map((x) => `${x.t}=${x.h.slice(0, 140)}`).join('\n  ')}`); return h; };
const act = async (js) => { await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle', timeout: 40000 }).catch((e) => console.log('nav', e.message.slice(0, 80))), p.evaluate((c) => setTimeout(() => (0, eval)(c), 0), js)]); await p.waitForTimeout(800); };
try {
  await p.goto('https://sisetun.kcf.or.jp/web/', { waitUntil: 'networkidle', timeout: 40000 });
  await act('doAction(document.formWTransInstSrchVacantAction, gRsvWTransInstSrchVacantAction)');
  await act('doAction(document.formWTransInstSrchPpsdAction, gRsvWTransInstSrchPpsdAction)');
  let h = await show('KCF ppsd');
  const pick = async (re, tag) => { const x = h.find((a) => re.test(a.t) || re.test(a.h)); console.log('PICK', tag, x && `${x.t}=${x.h}`); if (x) { await act(x.h); h = await show(tag); } return !!x; };
  (await pick(/ホール|文化|集会|ppsd/i, 'KCF 3')) && (await pick(/江東区文化センター|sendPps|Build/i, 'KCF 4')) && (await pick(/江東区文化センター|sendBld/, 'KCF 5')) && (await pick(/^ホール$|sendInst|Inst/, 'KCF 6'));
} catch (e) { console.log('KCF ERR', e.message.slice(0, 300)); }
try {
  await p.goto('https://shisetsu.city.arakawa.tokyo.jp/stagia/reserve/gin_menu', { waitUntil: 'networkidle', timeout: 40000 });
  const imgs = await p.$$('input[type=image]');
  await Promise.all([p.waitForNavigation({ timeout: 30000 }).catch(() => {}), imgs[1].click()]);
  await Promise.all([p.waitForNavigation({ timeout: 30000 }).catch(() => {}), p.click('text=空き状況の確認')]);
  const sels = async () => console.log('SELECTS', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('select')].map((s) => ({ n: s.name, f: s.form?.name, o: [...s.options].map((o) => `${o.value}:${o.text.trim()}`).slice(0, 40) })))));
  await sels();
  await p.selectOption('form[name=gml_z_group_sel_1] select', { label: '文化施設・会議室等' }).catch((e) => console.log('sel1', e.message.slice(0, 100)));
  await Promise.all([p.waitForNavigation({ timeout: 30000 }).catch(() => {}), p.evaluate(() => submitBunrui1())]); await p.waitForTimeout(800); await sels();
} catch (e) { console.log('AR ERR', e.message.slice(0, 300)); }
await b.close();
