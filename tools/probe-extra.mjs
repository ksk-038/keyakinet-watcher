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
  // O-PAS は表の行を押して進む
  async function rows(label) {
    const r = await page.evaluate(() => [...document.querySelectorAll('#mmaincolumn tr, #mmaincolumn li, #mmaincolumn label')].map((t) => t.innerText.replace(/\s+/g, ' ').trim() + ((t.getAttribute('onclick') || '') ? '  ◀押せる' : '')).filter((x) => x).slice(0, 80));
    const inp = await page.evaluate(() => [...document.querySelectorAll('#mmaincolumn input:not([type=hidden]), #mmaincolumn select')].map((i) => `${i.type}:${i.name}=${i.value}`).slice(0, 40));
    const btn = await page.evaluate(() => [...document.querySelectorAll('img[alt]')].map((i) => i.alt).filter((a) => /次|前|週|月|検索|表示|確定|選択/.test(a)));
    console.log(`\n##### ${label}\n${r.join('\n')}\n[入力] ${inp.join(' , ')}\n[ボタン] ${btn.join(' , ')}`);
  }
  async function row(text) {
    const l = page.locator(`#mmaincolumn tr:has-text("${text}"), #mmaincolumn li:has-text("${text}")`).first();
    if (!(await l.count())) { console.log(`「${text}」なし`); return false; }
    console.log(`→「${text}」`); await l.click().catch((e) => console.log(e.message.slice(0, 80)));
    await page.waitForLoadState('domcontentloaded').catch(() => {}); await page.waitForTimeout(2500); return true;
  }
  async function img(alt) {
    const l = page.locator(`img[alt*="${alt}"]`).first();
    if (!(await l.count())) { console.log(`ボタン「${alt}」なし`); return false; }
    console.log(`→ボタン「${alt}」`); await l.click().catch((e) => console.log(e.message.slice(0, 80)));
    await page.waitForTimeout(3000); return true;
  }
  await row('施設を指定する'); await rows('A');
  if (await row('体育館')) await rows('B');
  if (await row('大浜')) await rows('C');
  // チェックの付く画面なら全部付けて次へ
  const cb = page.locator('#mmaincolumn input[type=checkbox]');
  for (let k = 0; k < Math.min(await cb.count(), 10); k++) await cb.nth(k).check({ force: true }).catch(() => {});
  if (!(await img('次へ'))) await row('競技場') || await row('アリーナ');
  await rows('D');
  await img('次へ'); await rows('E');
  console.log('本文:', cut(await page.evaluate(() => document.querySelector('#mmaincolumn')?.innerText || ''), 3000));
} catch (e) { console.log('失敗', e.message); }
await b.close();
