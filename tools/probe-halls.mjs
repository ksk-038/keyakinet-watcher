import { chromium } from 'playwright';
const b = await chromium.launch();
try {
  const p = await b.newPage({ locale: 'ja-JP' });
  await p.goto('https://sst1.ka-ruku.com/komae/month', { waitUntil: 'networkidle' });
  await p.selectOption('#selShisetsu', '0010'); await p.selectOption('#selNengetu', '202711');
  await p.click('#searchMonth'); await p.waitForLoadState('networkidle'); await p.waitForTimeout(1500);
  const h = await p.evaluate(() => { const td = [...document.querySelectorAll('td,th')].find((e) => /^27\(土\)$/.test(e.innerText.trim())); return td ? td.closest('tr').outerHTML + '\n-- HEAD --\n' + td.closest('table').querySelector('tr').outerHTML : 'none'; });
  console.log('KOMAE-ROW', h.replace(/\s+/g, ' ').slice(0, 4000));
  console.log('KOMAE-LEG', (await p.evaluate(() => [...document.querySelectorAll('[class*=legend], .label, span[style]')].slice(0, 10).map((e) => e.outerHTML).join(' | '))).slice(0, 800));
} catch (e) { console.log('KOMAE ERR', e.message); }
try {
  const p = await b.newPage({ locale: 'ja-JP' });
  await p.goto('https://web118.rsv.ws-scs.jp/tokorozawa/web/index.jsp', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3000);
  for (const pur of ['演劇・歌劇', '舞踊']) {
    const v = await p.evaluate((t) => [...document.querySelectorAll('#purpose option')].find((o) => o.text.trim() === t)?.value, pur);
    await p.selectOption('#purpose', v); await p.waitForTimeout(2500);
    console.log('TOKO', pur, JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('#bname option')].map((o) => o.text.trim()))).slice(0, 1500));
  }
} catch (e) { console.log('TOKO ERR', e.message); }
await b.close();
