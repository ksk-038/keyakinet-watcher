import { chromium } from 'playwright';
const B = 'https://www.shisetsu.city.yokohama.lg.jp/user/';
const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'ja-JP' });
const p = await ctx.newPage();
const logs = [];
p.on('request', (r) => { if (r.method() === 'POST' && /SelectDays\//.test(r.url())) logs.push(`${r.url().replace(B, '')} :: ${(r.postData() || '').replace(/------WebKitFormBoundary\w+(--)?\r?\n?/g, '').replace(/Content-Disposition: form-data; name=/g, '').replace(/\r?\n\r?\n/g, '=').replace(/\r?\n/g, ' & ').slice(0, 3000)}`); });
p.on('response', async (r) => { if (/SelectDays\//.test(r.url())) { try { logs.push(`RESP ${r.url().replace(B, '')} ${r.status()} ${(await r.text()).slice(0, 200)}`); } catch {} } });
try {
  await p.goto(B + 'Home', { waitUntil: 'networkidle' });
  const tok = await p.evaluate(() => document.querySelector('input[name=__RequestVerificationToken]')?.value);
  await ctx.request.post(B + 'Home/SearchByPurpose', { form: { 'HomeModel.SelectedPlaceClassCategory': '1', 'HomeModel.CapacityFromByPlaceClass': '', 'HomeModel.CapacityToByPlaceClass': '', 'HomeModel.SelectedPurposeCategory': '2', 'HomeModel.SelectedPurpose': '107', 'HomeModel.CapacityFromByPurpose': '', 'HomeModel.CapacityToByPurpose': '', SelectedLanguageCode: '0', __RequestVerificationToken: tok }, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
  await p.goto(B + 'AvailabilityCheckApplySelectFacility', { waitUntil: 'networkidle' });
  await p.evaluate(() => { const l = [...document.querySelectorAll('label')].find((x) => /関内ホール/.test(x.textContent)); const i = document.getElementById(l.getAttribute('for')); if (!i.checked) i.click(); });
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {}), p.click('#test')]);
  await p.waitForTimeout(1500);
  logs.length = 0;
  const inp = p.locator('input[name="SearchCondition.StartDate"]');
  console.log('YKD type', await inp.getAttribute('type'), await inp.inputValue());
  await inp.fill('2027-11-27');
  await inp.dispatchEvent('change'); await inp.blur();
  await p.waitForTimeout(3000);
  console.log('YKD text1', (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').match(/前の期間.{0,300}/)?.[0]);
  if (!logs.length) { await p.locator('button', { hasText: '表示の変更' }).click().catch(() => {}); await p.waitForTimeout(2000); const bs = await p.evaluate(() => [...document.querySelectorAll('button')].filter((e) => e.offsetParent).map((e) => e.innerText.trim()).filter(Boolean)); console.log('YKD btns', bs.join(' / ')); await p.locator('button', { hasText: /^表示$|この条件で表示|適用|検索/ }).first().click({ timeout: 4000 }).catch(() => {}); await p.waitForTimeout(3000); }
  console.log('YKD text2', (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').match(/前の期間.{0,300}/)?.[0]);
} catch (e) { console.log('YKD ERR', e.message.slice(0, 200)); }
console.log('YKD logs\n' + logs.join('\n'));
await b.close();
