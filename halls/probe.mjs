// 下調べ（ブランチ用）: サイトを開いて、題名・本文・予約らしいリンクをログに出す
import { chromium } from 'playwright';
const URLS = process.env.URLS.split(' ');
const browser = await chromium.launch();
for (const u of URLS) {
  const page = await (await browser.newContext({ locale: 'ja-JP' })).newPage();
  try {
    const r = await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);
    const info = await page.evaluate(() => {
      const t = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const links = [...document.querySelectorAll('a,frame,iframe,form,select')].map((e) => `${e.tagName}|${t(e.innerText).slice(0, 40)}|${e.getAttribute('href') || e.getAttribute('src') || e.getAttribute('action') || e.id || e.name || ''}`)
        .filter((x) => /予約|空き|yoyaku|rsv|reserve|eprs|shisetsu|施設|FRAME|FORM|SELECT|search/i.test(x));
      const opts = [...document.querySelectorAll('select')].map((s) => `SEL#${s.id || s.name}: ${[...s.options].map((o) => o.text.trim()).join(', ').slice(0, 900)}`);
      return { title: document.title, body: t(document.body?.innerText || '').slice(0, 700), links: links.slice(0, 40), opts };
    });
    console.log(`=== ${u} → ${r?.status()} ${page.url()}\nTITLE ${info.title}\nBODY ${info.body}\n${info.links.join('\n')}\n${info.opts.join('\n')}`);
  } catch (e) { console.log(`=== ${u} ❌ ${e.message.slice(0, 200)}`); }
}
await browser.close();
