const RELAY = 'https://jskulzunyckseeokgzax.supabase.co/functions/v1/jp-relay';
for (const url of ['https://www.pf-yoyaku.com/User/asaka/Home', 'https://www.pf-yoyaku.com/User/asaka/', 'https://www.pf-yoyaku.com/User/ageo/Home']) {
  try {
    const r = await fetch(RELAY, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-region': 'ap-northeast-1' }, body: JSON.stringify({ secret: process.env.YANAGIBA_SECRET, raw: { url, method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', 'Accept-Language': 'ja' } } }), signal: AbortSignal.timeout(60000) });
    const j = await r.json();
    const b = j.body || '';
    console.log('\nRELAY', url, j.status, j.location || '', b.length, /turnstile|challenges\.cloudflare/i.test(b) ? 'TURNSTILE' : '', b.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 500));
    console.log('  links', [...b.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => !/\.css|\.ico|#/.test(h)).slice(0, 20).join(' '));
  } catch (e) { console.log('ERR', url, e.message); }
}
