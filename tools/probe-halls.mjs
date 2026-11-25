const RELAY = 'https://jskulzunyckseeokgzax.supabase.co/functions/v1/jp-relay';
const raw = async (url) => { const r = await fetch(RELAY, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-region': 'ap-northeast-1' }, body: JSON.stringify({ secret: process.env.YANAGIBA_SECRET, raw: { url } }) }); return r.json().catch(() => ({ error: r.status })); };
const text = (h, n) => (h || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').slice(0, n);
const tags = (h) => [...(h || '').matchAll(/<(a|form|frame|iframe|input|select)\b[^>]*>([^<]{0,30})/gi)].map((m) => m[0].replace(/\s+/g, ' ').slice(0, 220)).slice(0, 40).join('\n');
for (const u of ['https://www.pf489.com/machida/', 'https://www.pf-yoyaku.com/User/ageo/']) {
  const j = await raw(u);
  console.log('\nRAW', u, j.status, j.location, j.error || '', (j.body || '').length);
  console.log('TXT', text(j.body, 900)); console.log(tags(j.body));
}
