// 下調べ: うぐいすネット（大田区）を画面操作で
import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({ locale: 'ja-JP' });
p.on('dialog', (d) => { console.log('DIALOG', d.message()); d.accept(); });
const txt = async (l) => console.log(l, p.url(), (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 1800));
await p.goto('https://www.yoyaku.city.ota.tokyo.jp/eshisetsu/menu/Welcome.cgi', { waitUntil: 'networkidle' });
const inputs = await p.evaluate(() => [...document.querySelectorAll('input[type=text],input[type=search],button,a')].filter((e) => e.offsetParent).map((e) => `${e.tagName}#${e.id}[${e.name || ''}] ${(e.innerText || e.value || e.title || '').trim().slice(0, 30)} | ${(e.getAttribute('onclick') || '').slice(0, 80)}`).slice(0, 80));
console.log('VIS\n' + inputs.join('\n'));
const fn = await p.evaluate(() => [...document.scripts].map((s) => s.text).join('\n').match(/function (isSubmitDataSet|setShisetsuNameSearch|doNameSearch|searchByName)[\s\S]{0,600}/g));
console.log('FN', JSON.stringify(fn)?.slice(0, 2500));
await b.close();
