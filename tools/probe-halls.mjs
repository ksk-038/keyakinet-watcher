// 下調べ: えどねっと（OEC）の Home の利用目的の選択肢
import * as H from '../bunkyo/http.mjs';
const site = new H.Site('https://www.shisetsuyoyaku.city.edogawa.tokyo.jp/user/');
const html = await site.req('Home');
const dec = (s) => s.replace(/&#x([0-9A-F]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
const d = dec(html);
for (const k of ['PurposeList', 'Purposes', 'UseList', 'PurposeCategoryList', 'PlaceClassList', 'FacilityTypeList']) {
  let i = -1; let n = 0;
  while ((i = d.indexOf(k, i + 1)) >= 0 && n++ < 3) console.log('KEY', k, d.slice(i, i + 1500).replace(/\s+/g, ' '));
}
for (const m of d.matchAll(/(演奏|発表|公演|ホール|舞台|演劇)[^<"]{0,30}/g)) console.log('HIT', d.slice(Math.max(0, m.index - 200), m.index + 100).replace(/\s+/g, ' '));
