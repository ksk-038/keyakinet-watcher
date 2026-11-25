// 下調べ：堺市（O-PAS）・インスタベース・スペースマーケットの中身を見る（一度きり）
import { chromium } from 'playwright';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const cut = (s, n = 3000) => (s || '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').slice(0, n);

async function plain(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja' } });
    const t = await r.text();
    console.log(`\n=== ${url} → ${r.status} ${t.length}文字`);
    const nd = t.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    console.log('NEXT_DATA:', nd ? nd[1].length : 'なし', ' apollo:', /__APOLLO_STATE__/.test(t), ' nuxt:', /__NUXT__/.test(t));
    const ld = [...t.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1].slice(0, 600));
    if (ld.length) console.log('LD+JSON:', ld.slice(0, 2).join('\n---\n'));
    const m2 = [...t.matchAll(/(\d+(?:\.\d+)?)\s*(?:㎡|m²|平米)/g)].slice(0, 10).map((m) => m[0]);
    console.log('広さの例:', m2.join(' / '));
    const links = [...new Set([...t.matchAll(/href="(\/(?:space|spaces|rooms?)\/[^"?#]+)/g)].map((m) => m[1]))].slice(0, 8);
    console.log('部屋のリンク例:', links.join(' '));
    if (nd) console.log('NEXT_DATA先頭:', nd[1].slice(0, 2500));
    return t;
  } catch (e) { console.log(`\n=== ${url} → 失敗 ${e.message}`); }
}

const b = await chromium.launch();
const ctx = await b.newContext({ userAgent: UA, locale: 'ja-JP' });
const page = await ctx.newPage();
const api = [];
page.on('request', (q) => { if (['xhr', 'fetch'].includes(q.resourceType())) api.push(`${q.method()} ${q.url().slice(0, 200)}${q.postData() ? '  BODY ' + q.postData().slice(0, 300) : ''}`); });

// ---- 堺市 O-PAS ----
async function dump(label) {
  console.log(`\n##### ${label}  ${page.url()}`);
  for (const f of page.frames()) {
    const txt = await f.evaluate(() => document.body?.innerText || '').catch(() => '');
    const links = await f.evaluate(() => [...document.querySelectorAll('a,input[type=button],input[type=submit],button,img[alt]')].map((a) => (a.innerText || a.value || a.alt || '').trim() + ' → ' + (a.getAttribute('href') || a.getAttribute('onclick') || '')).filter((s) => s.length > 3).slice(0, 60)).catch(() => []);
    console.log(`--- frame ${f.url()}\n${cut(txt, 1500)}\n[ボタン]\n${links.join('\n')}`);
  }
}
try {
  await page.goto('https://reserve.opas.jp/sakai/Welcom.cgi', { waitUntil: 'networkidle', timeout: 60000 });
  await dump('堺市 入口');
  for (const word of ['空き状況', '空状況', '施設の空き', '空き照会', '利用者登録なし']) {
    const loc = page.getByText(word, { exact: false }).first();
    if (await loc.count()) {
      await loc.click({ timeout: 10000 }).catch((e) => console.log('click失敗', e.message));
      await page.waitForLoadState('networkidle').catch(() => {});
      await dump(`「${word}」を押した後`);
      break;
    }
  }
} catch (e) { console.log('堺市 失敗', e.message); }

// ---- インスタベース ----
await plain('https://www.instabase.jp/osaka/list/mirror');
await plain('https://www.instabase.jp/osaka/dance');
await plain('https://www.instabase.jp/osaka-sakai/list/mirror');
// ---- スペースマーケット ----
await plain('https://www.spacemarket.com/spaces/5t0bvbh2anxpvp8k/');
api.length = 0;
try {
  await page.goto('https://www.spacemarket.com/search?area=大阪府&purpose=ダンス', { waitUntil: 'networkidle', timeout: 60000 });
  console.log('\n##### スペースマーケット検索', page.url(), '\n', cut(await page.evaluate(() => document.body.innerText), 1500));
  console.log('通信:\n' + api.slice(0, 30).join('\n'));
} catch (e) { console.log('SM検索 失敗', e.message); }
api.length = 0;
try {
  await page.goto('https://www.instabase.jp/osaka/list/mirror', { waitUntil: 'networkidle', timeout: 60000 });
  console.log('\n##### インスタベース一覧（ブラウザ）通信:\n' + api.slice(0, 30).join('\n'));
} catch (e) { console.log('IB 失敗', e.message); }
await b.close();
