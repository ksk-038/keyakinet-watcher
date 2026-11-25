const RELAY = 'https://jskulzunyckseeokgzax.supabase.co/functions/v1/jp-relay';
const call = async (steps) => (await (await fetch(RELAY, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-region': 'ap-northeast-1' }, body: JSON.stringify({ secret: process.env.YANAGIBA_SECRET, base: 'https://www.pf489.com/machida/mobile/', steps }) })).json());
const opts = (h, name) => [...(h.match(new RegExp(`<select[^>]*name="${name}"[\\s\\S]*?</select>`, 'i'))?.[0] || '').matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)/gi)].map((m) => `${m[1]}:${m[2].trim()}`).join(' ');
let j = await call([{ get: 'Wm_TopMenu.aspx' }, { get: 'Wm_ShisetsuKensaku.aspx?ActiveForm=Purpose' }]);
let h = j.pages?.at(-1)?.body || JSON.stringify(j).slice(0, 300);
console.log('MP urls', j.pages?.map((p) => `${p.status} ${p.url}`).join(' | '));
console.log('MP p1', opts(h, 'slPurpose1'));
console.log('MP txt', h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 600));
// 施設から探す
j = await call([{ get: 'Wm_TopMenu.aspx' }, { get: 'Wm_ShisetsuKensaku.aspx?ActiveForm=Shisetsu' }]);
h = j.pages?.at(-1)?.body || '';
console.log('MS', h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 800));
console.log('MS sel', [...h.matchAll(/<select[^>]*name="([^"]+)"/gi)].map((m) => m[1]).join(','), opts(h, 'slShisetsu'), opts(h, 'slBunrui'));
