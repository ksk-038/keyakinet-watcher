// 新宿区しせつよやく 画面構造の調査用（開発中のみ）
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const TOP = 'https://www.shinjuku.eprs.jp/regasu/web/';
const DIR = 'debug-shinjuku';
let n = 0;
async function snap(page, name) {
  await fs.mkdir(DIR, { recursive: true });
  const p = `${DIR}/${String(++n).padStart(2, '0')}-${name}`;
  await page.screenshot({ path: `${p}.png`, fullPage: true }).catch(() => {});
  await fs.writeFile(`${p}.html`, await page.content().catch(() => ''));
}
async function dump(page, tag) {
  const info = await page.evaluate(() => {
    const vis = (e) => !!(e.offsetParent || e.getClientRects().length);
    const forms = [...document.forms].map((f) => `FORM name=${f.name} id=${f.id} action=${f.getAttribute('action')} method=${f.method}`).join('\n');
    const sels = [...document.querySelectorAll('select')].map((s) => `SELECT name=${s.name} id=${s.id} vis=${vis(s)} onchange=${(s.getAttribute('onchange') || '').slice(0, 80)}\n    ${[...s.options].map((o) => `${o.value}=${o.text.trim()}${o.selected ? '*' : ''}`).join(' | ').slice(0, 1500)}`).join('\n');
    const ins = [...document.querySelectorAll('input,button,a')].filter((e) => e.type !== 'hidden' && vis(e))
      .map((e) => `${e.tagName} type=${e.type || ''} name=${e.name || ''} id=${e.id} cls=${(e.className || '').toString().slice(0, 40)} val=${(e.value || '').slice(0, 20)} text=${(e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 20)} onclick=${(e.getAttribute('onclick') || e.getAttribute('href') || '').slice(0, 90)}`).slice(0, 120).join('\n');
    const hid = [...document.querySelectorAll('input[type=hidden]')].map((e) => `${e.name}=${e.value.slice(0, 30)}`).join(' ').slice(0, 1500);
    const tbs = [...document.querySelectorAll('table')].map((t, i) => `TABLE#${i} id=${t.id} cls=${t.className}\n${t.outerHTML.replace(/\s+/g, ' ').slice(0, 2500)}`).join('\n').slice(0, 8000);
    return `${forms}\n${sels}\n--- 操作要素\n${ins}\n--- hidden\n${hid}\n--- 表\n${tbs}`;
  });
  console.log(`\n===== [${tag}] ${page.url()}\n${info}`);
}
const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo', viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('dialog', async (d) => { console.log(`ダイアログ: ${d.message()}`); await d.accept().catch(() => {}); });
const settle = async () => { await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); };
try {
  await page.goto(TOP + 'index.jsp', { waitUntil: 'domcontentloaded' }); await settle();
  await snap(page, 'index'); await dump(page, 'index');
  if (!(await page.locator('select').count())) {
    await page.goto(TOP + 'rsvWOpeHomeAction.do', { waitUntil: 'domcontentloaded' }); await settle();
    await snap(page, 'home'); await dump(page, 'home');
  }
  // 条件: 土曜・1週間（とりあえず画面通り）
  const click = async (t) => { const l = page.getByText(t, { exact: true }).filter({ visible: true }); console.log(`click ${t}: ${await l.count()}`); if (await l.count()) { await l.first().click(); await page.waitForTimeout(500); } };
  await click('土');
  for (const s of await page.locator('select').all()) {
    const opts = await s.locator('option').allTextContents();
    const dance = opts.find((o) => o.includes('ダンス（社交ダンス以外') || o.includes('ダンス(社交ダンス以外'));
    if (dance) { await s.selectOption({ label: dance }); console.log('purpose set'); }
  }
  await page.waitForTimeout(1000); await settle();
  await snap(page, 'cond'); await dump(page, 'cond');
  await page.getByRole('button', { name: /検索/ }).filter({ visible: true }).last().click().catch(async () => { await click('検索'); });
  await page.waitForLoadState('domcontentloaded'); await settle();
  await snap(page, 'result'); await dump(page, 'result');
  console.log('BODY: ' + (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 3000));
  await click('日付順'); await settle();
  await snap(page, 'bydate'); await dump(page, 'bydate');
  console.log('BODY: ' + (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 4000));
} catch (e) { console.error(e); await snap(page, 'error'); process.exitCode = 1; }
await browser.close();
