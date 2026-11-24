// 下調べ（ブランチ用）
import { chromium } from 'playwright';
import * as S from '../itabashi/scrape.mjs';
const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
const t = (s) => (s || '').replace(/\s+/g, ' ').trim();
// 大田区（うぐいすネット）: 利用目的の大分類・小分類
{
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept().catch(() => {}));
  try {
    const TOP = 'https://www.yoyaku.city.ota.tokyo.jp/eshisetsu/menu/Welcome.cgi';
    await page.goto(TOP, { waitUntil: 'load' });
    const imgs = await page.evaluate(() => [...document.querySelectorAll('img[alt], a')].map((e) => e.alt || e.innerText).filter(Boolean).map((s) => s.trim()).slice(0, 60));
    console.log('OTA TOP:', imgs.join(' | '));
    await S.go(page, page.locator('img[alt^="空き照会のみ"], a:has-text("ログインせずに空き状況を検索")'), '空き照会のみ');
    console.log('OTA 2:', t(await page.locator('body').innerText()).slice(0, 800));
    await S.go(page, page.getByText('空き照会・予約', { exact: true }), '空き照会・予約').catch((e) => console.log('skip', e.message));
    console.log('OTA 3:', t(await page.locator('body').innerText()).slice(0, 800));
    await S.go(page, S.row(page, '利用目的から絞り込む'), '利用目的から絞り込む').catch((e) => console.log('skip', e.message));
    console.log('OTA 4:', t(await page.locator('body').innerText()).slice(0, 1500));
  } catch (e) { console.log('OTA ❌', e.message); }
}
// 品川区: どこで の選択肢（きゅりあん）
{
  const page = await ctx.newPage();
  await page.goto('https://www.cm9.eprs.jp/shinagawa/web/index.jsp', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  console.log('SHINAGAWA bname:', (await page.evaluate(() => [...document.querySelectorAll('#bname option')].map((o) => o.text.trim()))).filter((x) => /きゅりあん|総合区民|すべて/.test(x)).join(' | '));
}
// 上尾市（pf-yoyaku）
for (const u of ['https://www.pf-yoyaku.com/User/ageo/']) {
  const page = await ctx.newPage();
  try {
    const r = await page.goto(u, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(3000);
    console.log(`AGEO ${r?.status()} ${page.url()} :: ${t(await page.locator('body').innerText()).slice(0, 1500)}`);
    console.log('AGEO links:', (await page.evaluate(() => [...document.querySelectorAll('a,button,input[type=submit],input[type=button]')].map((e) => `${(e.innerText || e.value || '').trim().slice(0, 30)}=>${e.getAttribute('href') || e.getAttribute('onclick') || ''}`))).slice(0, 60).join(' | '));
  } catch (e) { console.log('AGEO ❌', e.message); }
}
await browser.close();
