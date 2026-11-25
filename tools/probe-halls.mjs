const RELAY = 'https://jskulzunyckseeokgzax.supabase.co/functions/v1/jp-relay';
const steps = [{ get: 'gin_menu' }, { submit: [], form: 'gin_init' }, { submit: [], form: 'gin_z_dest_sel' }, { submit: [['riyosmk', '3']], form: 'gin_z_amenity_sel', replace: true }];
const r = await fetch(RELAY, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-region': 'ap-northeast-1' }, body: JSON.stringify({ secret: process.env.YANAGIBA_SECRET, base: 'https://yoyaku.saf-ticket.jp/cultos/reserve/', enc: 'utf8', steps }) });
const j = await r.json();
const h = j.pages?.at(-1)?.body || JSON.stringify(j).slice(0, 500);
console.log('SAFURL', j.pages?.map((p) => `${p.status} ${p.url}`).join(' | '));
console.log('SAFTXT', h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').slice(0, 2000));
console.log('SAFF', [...h.matchAll(/<(form|input|select|option|a)\b[^>]*>([^<]{0,25})/gi)].map((m) => m[0].replace(/\s+/g, ' ').slice(0, 220)).filter((s) => !/g_sessionid/.test(s)).slice(0, 70).join('\n'));
console.log('SAFJS', (h.match(/<script[\s\S]*?<\/script>/gi) || []).join(' ').replace(/\s+/g, ' ').slice(0, 1500));
