const RELAY = 'https://jskulzunyckseeokgzax.supabase.co/functions/v1/jp-relay';
const r = await fetch(RELAY, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-region': 'ap-northeast-1' }, body: JSON.stringify({ secret: process.env.YANAGIBA_SECRET, raw: { url: 'https://yoyaku.saf-ticket.jp/cultos/reserve/gin_menu' } }) });
const j = await r.json();
console.log('SAFRAW', (j.body || '').replace(/\s+/g, ' ').replace(/<!--[\s\S]*?-->/g, '').slice(0, 3600));
