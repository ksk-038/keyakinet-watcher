// 動作確認用：大阪の予約サイトの画面を保存する（作るときだけ使う）
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const out = 'probe-out';
await fs.mkdir(out, { recursive: true });
const urls = JSON.parse(process.env.URLS);
const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo', viewport: { width: 1280, height: 900 } });
let i = 0;
for (const u of urls) {
  i++;
  const p = await ctx.newPage();
  try {
    const r = await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 90000 });
    console.log(`#${i} ${u} -> ${r?.status()} ${p.url()}`);
    await p.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await p.screenshot({ path: `${out}/${i}.png`, fullPage: true });
    let j = 0;
    for (const f of p.frames()) {
      const h = await f.content().catch(() => '');
      await fs.writeFile(`${out}/${i}-${j++}.html`, `<!-- ${f.url()} -->\n${h}`);
    }
  } catch (e) { console.log(`#${i} ${u} ERROR ${e.message.split('\n')[0]}`); }
  await p.close();
}
await b.close();
