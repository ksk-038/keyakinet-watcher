import { chromium } from 'playwright';
const B = 'https://www.shisetsu.city.yokohama.lg.jp/user/';
const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'ja-JP' });
const p = await ctx.newPage();
const logs = [];
p.on('request', (r) => { if (r.method() === 'POST') logs.push(`${r.url().replace(B, '')} :: ${(r.postData() || '').slice(0, 1500)}`); });
p.on('response', async (r) => { if (/SelectDays\//.test(r.url())) { try { logs.push(`RESP ${r.url().replace(B, '')} ${r.status()} ${(await r.text()).slice(0, 300)}`); } catch {} } });
try {
  await p.goto(B + 'Home', { waitUntil: 'networkidle' });
  const tok = await p.evaluate(() => document.querySelector('input[name=__RequestVerificationToken]')?.value);
  const f = { 'HomeModel.SelectedPlaceClassCategory': '1', 'HomeModel.CapacityFromByPlaceClass': '', 'HomeModel.CapacityToByPlaceClass': '', 'HomeModel.SelectedPurposeCategory': '2', 'HomeModel.SelectedPurpose': '107', 'HomeModel.CapacityFromByPurpose': '', 'HomeModel.CapacityToByPurpose': '', SelectedLanguageCode: '0', __RequestVerificationToken: tok };
  const r = await ctx.request.post(B + 'Home/SearchByPurpose', { form: f, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
  console.log('YK sbp', r.status(), (await r.text()).slice(0, 200));
  await p.goto(B + 'AvailabilityCheckApplySelectFacility', { waitUntil: 'networkidle' });
  const lab = await p.evaluate(() => { const l = [...document.querySelectorAll('label')].find((x) => /関内ホール/.test(x.textContent)); if (l) l.click(); return l?.textContent.trim(); });
  console.log('YK fac', lab);
  await p.waitForTimeout(800);
  const btns = await p.evaluate(() => [...document.querySelectorAll('button,a,input[type=button],input[type=submit]')].filter((e) => e.offsetParent).map((e) => (e.innerText || e.value || '').trim()).filter(Boolean));
  console.log('YK btns', btns.slice(0, 30).join(' / '));
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {}), p.click('text=次へ進む')]);
  await p.waitForTimeout(2000);
  console.log('YK days', p.url(), (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 1500));
  console.log('YK days-C', (await p.evaluate(() => [...document.querySelectorAll('input,select,button')].filter((e) => e.offsetParent && e.type !== 'hidden').map((e) => `${e.tagName}#${e.id}[${e.name}=${(e.value || '').slice(0, 15)}] ${(e.innerText || '').trim().slice(0, 20)}`))).slice(0, 40).join('\n'));
  // 日付を変えて表示
  const di = await p.$('input[type=date], input[name*="Date"], input[id*="date" i]');
  if (di) { await di.fill('2027-01-09').catch(async () => { await di.evaluate((e) => { e.value = '2027/01/09'; e.dispatchEvent(new Event('change', { bubbles: true })); }); }); }
  await p.click('text=表示', { timeout: 5000 }).catch((e) => console.log('YK no 表示', e.message.slice(0, 80)));
  await p.waitForTimeout(3000);
  console.log('YK after', (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 800));
} catch (e) { console.log('YK ERR', e.message.slice(0, 200)); }
console.log('YK logs\n' + logs.join('\n'));
await b.close();
