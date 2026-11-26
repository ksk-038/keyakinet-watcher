const RELAY = 'https://jskulzunyckseeokgzax.supabase.co/functions/v1/jp-relay';
for (const url of ['https://yoyaku03.city.sumida.lg.jp/', 'https://www.shisetsuyoyaku.city.suginami.tokyo.jp/']) {
  const t = Date.now();
  try {
    const r = await fetch(RELAY, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-region': 'ap-northeast-1' }, body: JSON.stringify({ secret: process.env.YANAGIBA_SECRET, raw: { url, method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', 'Accept-Language': 'ja' } } }), signal: AbortSignal.timeout(90000) });
    const j = await r.json().catch(async () => ({ err: await r.text() }));
    const b = j.body || '';
    console.log('\nRELAY', url, r.status, j.status, j.location || '', j.err?.slice(0, 200) || '', b.length, `${Date.now() - t}ms`, b.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300));
  } catch (e) { console.log('\nRELAY ERR', url, e.message, `${Date.now() - t}ms`); }
}
