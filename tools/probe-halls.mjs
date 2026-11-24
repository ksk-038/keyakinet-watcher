// 下調べ: えどねっと（OEC）の Home の利用目的の選択肢
import * as H from '../bunkyo/http.mjs';
const site = new H.Site('https://www.shisetsuyoyaku.city.edogawa.tokyo.jp/user/');
const html = await site.req('Home');
console.log('LEN', html.length);
for (const m of html.matchAll(/<select[^>]*(?:id|name)="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) console.log('SELECT', m[1], [...m[2].matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)/g)].map((o) => `${o[1]}:${o[2].trim()}`).join(' | ').slice(0, 1500));
for (const m of html.matchAll(/(Purpose[A-Za-z]*List|PlaceClass[A-Za-z]*List)\s*[:=]\s*(\[[\s\S]{0,1500})/g)) console.log('JS', m[1], m[2].replace(/\s+/g, ' ').slice(0, 1500));
const i = html.indexOf('SelectedPurpose'); console.log('AROUND', html.slice(Math.max(0, i - 300), i + 1200).replace(/\s+/g, ' '));
