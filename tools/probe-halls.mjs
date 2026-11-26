import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ locale: 'ja-JP' });
p.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept().catch(() => {}); });
const fields = () => p.evaluate(() => [...document.querySelectorAll('input,select,button,a.btn')].filter((e) => e.type !== 'hidden' && e.offsetParent).map((e) => `${e.tagName}:${e.type || ''}:${e.name}:${e.id}:${(e.value || e.innerText || '').replace(/\s+/g, ' ').slice(0, 25)}`).filter((s) => !/selectedMokuteki|headerMenu|menuList/.test(s)));
try {
  await p.goto('https://yoyaku.city.toda.saitama.jp/yoyaku/', { waitUntil: 'networkidle', timeout: 40000 });
  console.log('TOP', (await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))).slice(0, 300));
  console.log('F1\n' + (await fields()).join('\n'));
  // 場所を選ぶ（ラベルクリック）
  await p.locator('label', { hasText: /^戸田市文化会館$/ }).first().click().catch((e) => console.log('lab', e.message.slice(0, 80)));
  await p.selectOption('select[name="searchingOption:selectedBasho"]', { label: '戸田市文化会館' }).catch((e) => console.log('bas', e.message.slice(0, 80)));
  await p.selectOption('select[name="searchingOption:displayPeriod"]', { label: '1ヵ月' }).catch((e) => console.log('per', e.message.slice(0, 80)));
  await p.waitForTimeout(1500);
  console.log('F2\n' + (await fields()).join('\n'));
  const btn = p.locator('button,input[type=submit],a').filter({ hasText: /検索/ });
  console.log('btns', await btn.allInnerTexts());
  const html = await p.content();
  console.log('DATEFIELDS', [...html.matchAll(/<input[^>]*(date|Date|hizuke|ymd)[^>]*>/g)].map((m) => m[0]).slice(0, 8).join('\n'));
  if (await btn.count()) { await Promise.all([p.waitForLoadState('networkidle'), btn.last().click()]); await p.waitForTimeout(2500);
    console.log('RES', p.url(), (await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))).slice(0, 2500));
    console.log('TABLE', (await p.evaluate(() => [...document.querySelectorAll('table tr')].map((r) => [...r.cells].map((c) => (c.innerText.trim() || [...c.querySelectorAll('img')].map((i) => i.alt).join('/')).replace(/\s+/g, ' ')).join(' | ')))).slice(0, 30).join('\n'));
    console.log('F3\n' + (await fields()).slice(0, 40).join('\n'));
  }
} catch (e) { console.log('TODA ERR', e.message.slice(0, 300)); }
await b.close();
