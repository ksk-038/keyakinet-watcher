// 動作確認用：大阪の予約サイトの画面と通信を保存する（作るときだけ使う）
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const out = 'probe-out';
await fs.mkdir(out, { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo', viewport: { width: 1280, height: 900 } });
const log = [];
ctx.on('response', async (r) => {
  const t = r.request().resourceType();
  if (!['xhr', 'fetch', 'document'].includes(t)) return;
  let body = '';
  try { body = (await r.text()).slice(0, 60000); } catch {}
  log.push({ t, method: r.request().method(), url: r.url(), post: r.request().postData(), status: r.status(), body });
});
const save = async (p, n) => {
  await p.screenshot({ path: `${out}/${n}.png`, fullPage: true }).catch(() => {});
  await fs.writeFile(`${out}/${n}.html`, await p.content().catch(() => ''));
};
// 1) 大阪市：空き状況ページ（東住吉会館）
const p = await ctx.newPage();
await p.goto('https://www.shisetsu-osaka.jp/shisetsu-nw/akijokyo.html?scd=26', { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => console.log(e.message));
await save(p, 'osaka-aki');
// 翌週・1か月後ボタンなど、押せるものの一覧
console.log(JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('button, a, select')].slice(0, 120).map((e) => `${e.tagName}#${e.id}.${e.className}|${(e.innerText || e.value || '').trim().slice(0, 30)}|${e.getAttribute('onclick') || e.getAttribute('href') || ''}`))));
// 2) 門真市：空き照会のみ → 空き照会・予約 → メニュー
const k = await ctx.newPage();
try {
  await k.goto('https://shisetsu-yoyaku.jp/kadoma/menu/Welcome.cgi', { waitUntil: 'load', timeout: 60000 });
  await Promise.all([k.waitForNavigation(), k.locator('img[alt^="空き照会のみ"]').first().click()]);
  await save(k, 'kadoma-1');
  await Promise.all([k.waitForNavigation(), k.getByText('空き照会・予約', { exact: true }).first().click()]);
  await save(k, 'kadoma-2');
  await Promise.all([k.waitForNavigation(), k.locator('td').filter({ hasText: /^\s*利用目的から絞り込む\s*$/ }).first().click()]);
  await save(k, 'kadoma-3');
} catch (e) { console.log('kadoma', e.message.split('\n')[0]); await save(k, 'kadoma-err'); }
await fs.writeFile(`${out}/net.json`, JSON.stringify(log, null, 1));
await b.close();
