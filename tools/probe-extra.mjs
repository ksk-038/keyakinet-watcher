// 下調べ：堺市（O-PAS）の空き状況がログインなしで見られるか（一度きり）
import { chromium } from 'playwright';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const cut = (s, n) => (s || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').slice(0, n);
const b = await chromium.launch();
const page = await (await b.newContext({ userAgent: UA, locale: 'ja-JP' })).newPage();
page.on('dialog', (d) => { console.log('ダイアログ:', d.message()); d.dismiss(); });
async function dump(label) {
  console.log(`\n##### ${label}  ${page.url()}`);
  for (const f of page.frames()) {
    const txt = await f.evaluate(() => document.body?.innerText || '').catch(() => '');
    const btn = await f.evaluate(() => [...document.querySelectorAll('a,input[type=button],input[type=submit],input[type=image],button,img[alt]')].map((a) => (a.innerText || a.value || a.alt || '').trim() + ' → ' + (a.getAttribute('href') || a.getAttribute('onclick') || '').slice(0, 120)).filter((s) => s.length > 4).slice(0, 50)).catch(() => []);
    const sel = await f.evaluate(() => [...document.querySelectorAll('select')].map((s) => s.name + ': ' + [...s.options].map((o) => o.text.trim()).slice(0, 40).join(' | '))).catch(() => []);
    console.log(`--- frame ${f.url()}\n${cut(txt, 1500)}\n[ボタン]\n${btn.join('\n')}\n[選択肢]\n${sel.join('\n')}`);
  }
}
async function press(words) {
  for (const f of page.frames()) for (const w of words) {
    const loc = f.locator(`a:has-text("${w}"), input[value*="${w}"], button:has-text("${w}"), img[alt*="${w}"]`).first();
    if (await loc.count().catch(() => 0)) {
      console.log(`→「${w}」を押す`);
      await loc.click({ timeout: 10000 }).catch((e) => console.log('押せず', e.message.slice(0, 100)));
      await page.waitForTimeout(3000);
      return true;
    }
  }
  return false;
}
try {
  await page.goto('https://reserve.opas.jp/sakai/Welcome.cgi', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  await dump('入口');
  if (await press(['空き照会', '空き状況', '空状況', '空き施設', '施設の空き'])) {
    await dump('1段目');
    if (await press(['体育館', 'スポーツ', '屋内'])) { await dump('2段目'); if (await press(['大浜', '鴨谷', '初芝'])) await dump('3段目'); }
  }
} catch (e) { console.log('失敗', e.message); }
await b.close();
