// 調べもの用: 吹田市の予約サイトに、部屋の詳しい説明（広さ・定員など）の画面があるか探す
import { chromium } from 'playwright';
import * as S from '../itabashi/scrape.mjs';
const TOP = 'https://suita-shisetsuyoyaku.growone.net/eshisetsu/menu/Welcome.cgi';
const browser = await chromium.launch();
const page = await (await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo' })).newPage();
page.on('dialog', (d) => d.accept().catch(() => {}));
const dump = async (what) => {
  const r = await page.evaluate(() => ({
    url: location.href,
    links: [...document.querySelectorAll('a, img[onclick], td[onclick], input[type=button], input[type=image]')]
      .map((e) => `${(e.innerText || e.alt || e.value || '').trim().slice(0, 30)} | ${e.getAttribute('href') || ''} | ${e.getAttribute('onclick') || ''}`)
      .filter((x) => /詳細|情報|案内|Detail|Info|Shosai|Syosai|Annai/i.test(x)).slice(0, 40),
  }));
  console.log(`=== ${what} ${r.url}\n${r.links.join('\n')}`);
};
await page.goto(TOP, { waitUntil: 'load' });
await dump('トップ');
await S.go(page, page.locator('img[alt^="空き照会のみ"]'), '空き照会のみ');
await dump('メニュー');
await S.go(page, page.getByText('空き照会・予約', { exact: true }), '空き照会・予約');
await dump('空き照会・予約');
await S.go(page, S.row(page, '利用目的から絞り込む'), '利用目的から絞り込む');
await S.go(page, S.row(page, 'ホール'), 'ホール');
await S.go(page, S.row(page, 'ホール（１５０名以上）'), 'ホール150');
await dump('部屋えらび');
const html = await page.content();
const i = html.indexOf('checkMeisaiUniqKey');
console.log('--- 部屋えらびのHTML（一部）---\n' + html.slice(Math.max(0, i - 1500), i + 2500));
// 詳細らしいものを1つ押してみる
const el = page.locator('a:has-text("詳細"), img[alt*="詳細"], a[href*="etail"], a[onclick*="etail"]').first();
if (await el.count()) {
  const [pop] = await Promise.all([page.context().waitForEvent('page', { timeout: 15000 }).catch(() => null), el.click()]);
  const p2 = pop || page;
  await p2.waitForLoadState('load').catch(() => {});
  console.log('--- 詳細の画面 ---\n' + (await p2.locator('body').innerText()).slice(0, 3000));
} else console.log('詳細らしいリンクなし');
await browser.close();
