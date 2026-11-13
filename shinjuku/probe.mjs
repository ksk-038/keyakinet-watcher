// 新宿区しせつよやく 画面構造の調査用（開発中のみ）
import { chromium } from 'playwright';
const TOP = 'https://www.shinjuku.eprs.jp/regasu/web/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo', viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('dialog', async (d) => { console.log(`ダイアログ: ${d.message()}`); await d.accept().catch(() => {}); });
await page.goto(TOP + 'index.jsp', { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(() => {});
const html = await page.content();
const sq = (s) => s.replace(/\s+/g, ' ');
const a = html.indexOf('collapse-when'), b = html.indexOf('btn-go');
console.log('=== FORM HTML\n' + sq(html.slice(a - 300, b + 400)).slice(0, 12000));
console.log('=== SCRIPT SRCS\n' + [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]).join('\n'));
const inl = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n----\n');
console.log('=== INLINE SCRIPTS\n' + inl.slice(0, 15000));
// 外部JSから関数定義を拾う
for (const src of [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1])) {
  if (/jquery|bootstrap|popper|moment/i.test(src)) continue;
  const js = await page.evaluate(async (u) => (await fetch(u)).text(), src).catch(() => '');
  for (const fn of ['doSearch', 'filterInst', 'doAction', 'setThisWeek', 'gRsvWOpeInstSrchVacantAction']) {
    const i = js.indexOf(`function ${fn}`) >= 0 ? js.indexOf(`function ${fn}`) : js.indexOf(fn);
    if (i >= 0) console.log(`=== ${src} :: ${fn}\n${js.slice(i, i + 2500)}`);
  }
}
await browser.close();
