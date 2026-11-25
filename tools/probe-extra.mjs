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
    const inp = await f.evaluate(() => [...document.querySelectorAll('input[type=radio],input[type=checkbox]')].map((i) => `${i.type}:${i.name}=${i.value} 「${(document.querySelector(`label[for="${i.id}"]`)?.innerText || i.closest('label,td,li')?.innerText || '').trim().slice(0, 40)}」`).slice(0, 60)).catch(() => []);
    const sel = await f.evaluate(() => [...document.querySelectorAll('select')].map((s) => s.name + ': ' + [...s.options].map((o) => o.text.trim()).slice(0, 40).join(' | '))).catch(() => []);
    console.log(`--- frame ${f.url()}\n${cut(txt, 1500)}\n[ボタン]\n${btn.join('\n')}\n[選択肢]\n${sel.join('\n')}\n[チェック]\n${inp.join('\n')}`);
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
  await press(['空き状況']);
  // 「施設を指定する」→ 次へ
  async function pick(text) {
    for (const f of page.frames()) {
      const l = f.locator(`label:has-text("${text}")`).first();
      if (await l.count().catch(() => 0)) { await l.click().catch(() => {}); console.log(`→「${text}」を選ぶ`); return true; }
    }
    return false;
  }
  await pick('施設を指定する');
  await press(['次へ']);
  await dump('施設の種類');
  if (await pick('体育館') || await pick('屋内')) { await press(['次へ']); await dump('施設の一覧'); }
  if (await pick('大浜体育館') || await pick('大浜')) { await press(['次へ']); await dump('部屋の一覧'); }
  // 部屋を全部選んで次へ
  for (const f of page.frames()) {
    const boxes = f.locator('input[type=checkbox]');
    const n = await boxes.count().catch(() => 0);
    for (let k = 0; k < Math.min(n, 3); k++) await boxes.nth(k).check({ force: true }).catch(() => {});
  }
  await press(['次へ']);
  await dump('空き表');
  await press(['次へ', '翌週', '次の週']);
  await dump('空き表2');
} catch (e) { console.log('失敗', e.message); }
await b.close();
