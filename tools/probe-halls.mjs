import { chromium } from 'playwright';
const b = await chromium.launch();
const txt = async (p) => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const ctl = (p) => p.evaluate(() => [...document.querySelectorAll('a,input,select,button,area')].filter((e) => e.type !== 'hidden').map((e) => `${e.tagName}#${e.id}[${e.name || ''}=${(e.value || '').slice(0, 12)}] ${(e.innerText || e.alt || [...(e.querySelectorAll ? e.querySelectorAll('img') : [])].map((i) => i.alt).join('/') || '').trim().slice(0, 25)} | ${(e.getAttribute('onclick') || e.getAttribute('href') || '').slice(0, 160)} ${e.tagName === 'SELECT' ? [...e.options].map((o) => o.text.trim()).slice(0, 30).join('/') : ''}`).filter((s) => !/void\(0\)|skip|文字サイズ/.test(s)));
try { const p = await b.newPage({ locale: 'ja-JP' }); await p.goto('https://rikuu.net/higashiyamato/client/Top.aspx', { waitUntil: 'networkidle' });
  console.log('HY', p.url(), (await txt(p)).slice(0, 800)); console.log('HY-C', (await ctl(p)).slice(0, 40).join('\n')); } catch (e) { console.log('HY ERR', e.message.slice(0, 150)); }
try { const p = await b.newPage({ locale: 'ja-JP' }); await p.goto('https://saitama.rsv.ws-scs.jp/web/', { waitUntil: 'networkidle' });
  console.log('ST-C', (await ctl(p)).slice(0, 40).join('\n')); } catch (e) { console.log('ST ERR', e.message.slice(0, 150)); }
try { const p = await b.newPage({ locale: 'ja-JP' }); const api = [];
  p.on('request', (r) => { if (/api|json/i.test(r.url()) && !/google|gtag/.test(r.url())) api.push(`${r.method()} ${r.url()}`); });
  await p.goto('https://shisetsuyoyaku.city.nerima.tokyo.jp/', { waitUntil: 'networkidle' });
  await p.click('#facility', { force: true }).catch(() => {}); await p.waitForTimeout(1500);
  console.log('NM opts', (await p.evaluate(() => [...document.querySelectorAll('[role=option], .ant-select-item, li')].map((e) => e.textContent.trim()).filter((t) => /文化|ホール/.test(t)).slice(0, 30))).join(' / '));
  console.log('NM api', [...new Set(api)].slice(0, 30).join('\n')); } catch (e) { console.log('NM ERR', e.message.slice(0, 150)); }
await b.close();
