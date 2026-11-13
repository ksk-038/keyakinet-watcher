// 新宿区しせつよやく 画面構造の調査用（開発中のみ）
import { chromium } from 'playwright';
const TOP = 'https://www.shinjuku.eprs.jp/regasu/web/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo', viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('dialog', async (d) => { console.log(`ダイアログ: ${d.message()}`); await d.accept().catch(() => {}); });
const sq = (s) => s.replace(/\s+/g, ' ');
await page.goto(TOP + 'index.jsp', { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(() => {});
await page.evaluate(() => {
  $('#bname').val('1000_0'); $('#purpose').val('24_280');
  $('#daystart').val('2026-11-14'); $('#days').val('31');
  $('#saturday').prop('checked', true);
  doSearch(document.form1, gRsvWOpeInstSrchVacantAction);
});
await page.waitForLoadState('domcontentloaded'); await page.waitForLoadState('networkidle').catch(() => {});
console.log('URL ' + page.url());
const dump = async (tag) => {
  const html = await page.content();
  console.log(`\n##### ${tag} ${page.url()} len=${html.length}`);
  const info = await page.evaluate(() => {
    const vis = (e) => !!(e.offsetParent || e.getClientRects().length);
    const sels = [...document.querySelectorAll('select')].map((s) => `SELECT id=${s.id} name=${s.name} vis=${vis(s)} onchange=${s.getAttribute('onchange')}\n  ${[...s.options].map((o) => `${o.value}=${o.text.trim()}${o.selected ? '*' : ''}`).join(' | ').slice(0, 3000)}`).join('\n');
    const btn = [...document.querySelectorAll('input,button,a,[onclick]')].filter((e) => e.type !== 'hidden' && vis(e) && !e.closest('table'))
      .map((e) => `${e.tagName}#${e.id} t=${(e.innerText || e.value || '').trim().replace(/\s+/g, ' ').slice(0, 15)} oc=${(e.getAttribute('onclick') || e.getAttribute('href') || '').slice(0, 100)}`).join('\n');
    const hid = [...document.querySelectorAll('input[type=hidden]')].map((e) => `${e.name || e.id}=${e.value.slice(0, 25)}`).join(' ').slice(0, 2500);
    return `${sels}\n--- buttons\n${btn}\n--- hidden\n${hid}`;
  });
  console.log(info);
  const tbs = await page.evaluate(() => [...document.querySelectorAll('table')].map((t, i) => `TABLE#${i} id=${t.id} cls=${t.className}: ${t.outerHTML.replace(/\s+/g, ' ').slice(0, 3500)}`).join('\n'));
  console.log('--- tables\n' + tbs.slice(0, 9000));
  console.log('--- body\n' + sq(await page.locator('body').innerText()).slice(0, 2500));
  return html;
};
const html = await dump('result');
console.log('=== SCRIPT SRCS\n' + [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]).join('\n'));
const inl = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => !s.includes('gRsvWOpeUnreservedDailyAction')).join('\n----\n');
console.log('=== INLINE SCRIPTS\n' + inl.slice(0, 6000));
const fns = new Set([...html.matchAll(/(?:onclick|onchange|href)="(?:javascript:)?\s*([A-Za-z_]\w*)\(/g)].map((m) => m[1]));
console.log('handlers: ' + [...fns].join(','));
for (const src of [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1])) {
  if (/jquery|bootstrap|paw_bsui|paw_doaction|paw_errormsg|paw_common|paw_l100|pawab2000/i.test(src)) continue;
  const js = await page.evaluate(async (u) => (await fetch(u)).text(), src).catch(() => '');
  console.log(`=== ${src} (${js.length})`);
  for (const fn of fns) { const i = js.indexOf(`function ${fn}(`); if (i >= 0) console.log(`--- ${fn}\n${js.slice(i, i + 1500)}`); }
}
await browser.close();
