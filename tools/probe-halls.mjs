const r = await fetch('https://www.city.sumida.lg.jp/sisetu_info/sisetuyoyaku.html', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'Accept-Language': 'ja' } });
console.log('SUMIDA', r.status, (await r.text()).slice(0, 400));
for (const u of ['https://www.shisetsuyoyaku.city.sumida.lg.jp/user/Home', 'https://sumida-shisetsu.jp/user/Home', 'https://www.yoyaku.city.sumida.lg.jp/user/Home']) {
  try { const x = await fetch(u, { signal: AbortSignal.timeout(15000) }); console.log('TRY', x.status, x.url, (await x.text()).length); } catch (e) { console.log('TRY ERR', u, e.cause?.code || e.message); }
}
