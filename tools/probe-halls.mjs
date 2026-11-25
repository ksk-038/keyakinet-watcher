const RELAY = 'https://jskulzunyckseeokgzax.supabase.co/functions/v1/jp-relay';
const raw = async (url) => { const r = await fetch(RELAY, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-region': 'ap-northeast-1' }, body: JSON.stringify({ secret: process.env.YANAGIBA_SECRET, raw: { url } }) }); return r.json().catch(() => ({ error: r.status })); };
const j = await raw('https://www.pf-yoyaku.com/User/ageo/');
const h = j.body || '';
const srcs = [...h.matchAll(/<script[^>]*src="([^"]+)"/gi)].map((m) => new URL(m[1], 'https://www.pf-yoyaku.com/User/ageo/').href);
console.log('AG scripts', srcs.join(' '));
console.log('AG inline', (h.match(/<script(?![^>]*src)[^>]*>[\s\S]*?<\/script>/gi) || []).join(' ').replace(/\s+/g, ' ').slice(0, 1500));
for (const s of srcs.filter((x) => x.includes('pf-yoyaku'))) {
  const k = await raw(s);
  const b = k.body || '';
  console.log('AG js', s, b.length);
  const apis = [...new Set([...b.matchAll(/["'`](\/?(?:api|Api|API)\/[A-Za-z0-9_\/\-{}$.]+)["'`]/g)].map((m) => m[1]))];
  console.log('AG apis', apis.slice(0, 80).join(' '));
  console.log('AG turnstile', (b.match(/.{0,120}turnstile.{0,200}/gi) || []).slice(0, 4).join(' ||| '));
}
