// 施設のスプレッドシートが、監視からどう読めているかを確かめる（タブごとの行数・最初と最後の行）
import { parseCsv } from '../roominfo.mjs';
const TABS = [['1jOgQENb9M80Sc3dQ93zaWosGwWlYZsPWXZMRvpucxUA', ['世田谷区', '文京区', '新宿区', '品川区', '板橋区', 'オリセン']], ['1FJFTK0abUW2NF-4PhCCfJwELtoOJVaSMd4wSGyPSKTc', ['大阪市', '寝屋川市', '守口市', '門真市']]];
for (const [id, tabs] of TABS) for (const tab of tabs) {
  for (const tq of ['select B, C, E, F, G, H, J', '']) {
    const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}${tq ? `&tq=${encodeURIComponent(tq)}` : ''}`;
    const rows = parseCsv(await (await fetch(url)).text());
    console.log(`${tab}（${tq ? '列をしぼる' : 'そのまま'}）: ${rows.length}行 先頭=${JSON.stringify(rows[0]).slice(0, 120)} 末尾=${JSON.stringify(rows.at(-1)).slice(0, 120)}`);
  }
}
