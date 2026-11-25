const RELAY = 'https://jskulzunyckseeokgzax.supabase.co/functions/v1/jp-relay';
const raw = async (url, body) => { const r = await fetch(RELAY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: process.env.YANAGIBA_SECRET, raw: { url, body } }) }); return r.json(); };
const j = await raw('https://yoyaku.saf-ticket.jp/cultos/reserve/gin_menu');
console.log('SAF', j.status, j.location, (j.body || j.error || '').length);
const h = j.body || '';
console.log('SAF-TXT', h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 1500));
console.log('SAF-T', [...h.matchAll(/<(a|form|select|option|input|frame|iframe)\b[^>]*>([^<]{0,30})/gi)].map((m) => m[0].replace(/\s+/g, ' ').slice(0, 200)).slice(0, 60).join('\n'));
