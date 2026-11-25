// 施設のスプレッドシートが、監視からどう読めているかを確かめる（タブごとの行数）
import { parseCsv } from '../roominfo.mjs';
const OS = '1FJFTK0abUW2NF-4PhCCfJwELtoOJVaSMd4wSGyPSKTc';
for (const [name, url] of [
  ['gviz', `https://docs.google.com/spreadsheets/d/${OS}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent('大阪市')}`],
  ['export', `https://docs.google.com/spreadsheets/d/${OS}/export?format=csv&gid=1422547724`],
]) {
  const res = await fetch(url, { redirect: 'follow' });
  const text = await res.text();
  const rows = parseCsv(text);
  console.log(`${name}: HTTP ${res.status} ${rows.length}行 鶴見小ホール=${rows.some((r) => r.join('|').includes('鶴見区民センター|小ホール'))} 先頭=${text.slice(0, 80).replace(/\n/g, ' ')}`);
}
