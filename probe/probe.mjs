// 動作確認用：門真市の利用目的の一覧を保存する（作るときだけ使う）
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const out = 'probe-out';
await fs.mkdir(out, { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo', viewport: { width: 1280, height: 900 } });
const k = await ctx.newPage();
const txt = async () => (await k.locator('body').innerText()).replace(/\s+/g, ' ');
const td = (t) => k.locator('td').filter({ hasText: new RegExp(`^\\s*${t}\\s*$`) }).first();
const nav = (el) => Promise.all([k.waitForNavigation(), el.click()]);
for (const cat of ['文化利用', 'スポーツ']) {
  try {
    await k.goto('https://shisetsu-yoyaku.jp/kadoma/menu/Welcome.cgi', { waitUntil: 'load', timeout: 60000 });
    await nav(k.locator('img[alt^="空き照会のみ"]').first());
    await nav(k.getByText('空き照会・予約', { exact: true }).first());
    await nav(td('利用目的から絞り込む'));
    await nav(td(cat));
    console.log(`【${cat}】`, (await txt()).slice(0, 1500));
    await fs.writeFile(`${out}/k-${cat}.html`, await k.content());
    // 小分類の最初を開いて、施設の選択画面を保存
    const first = k.locator('td.cssTd, td a, td').filter({ hasText: /ダンス/ }).first();
    if (await first.count()) {
      await nav(first);
      console.log(`【${cat} ダンス】`, (await txt()).slice(0, 2500));
      await fs.writeFile(`${out}/k-${cat}-dance.html`, await k.content());
    }
  } catch (e) { console.log(cat, 'ERR', e.message.split('\n')[0]); }
}
await b.close();
