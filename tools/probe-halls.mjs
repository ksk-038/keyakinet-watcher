for (const u of ['https://www.shisetsu.city.yokohama.lg.jp/user/Home', 'https://www.shisetsu.city.yokohama.lg.jp/']) {
  try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', 'Accept-Language': 'ja' }, redirect: 'follow', signal: AbortSignal.timeout(20000) }); const h = await r.text();
    console.log('YK', r.status, r.url, h.length, /turnstile/i.test(h) ? 'TURNSTILE' : '', /PurposeCategoryCode/.test(h) ? 'OEC' : '');
    const d = h.replace(/\\u([0-9a-f]{4})/gi, (_, x) => String.fromCodePoint(parseInt(x, 16))).replace(/&#x([0-9A-F]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16)));
    console.log('YK-P', [...d.matchAll(/"PurposeCategoryCode":(\d+),"PurposeCode":(\d+),"PurposeName":"([^"]+)"/g)].map((m) => `${m[1]}-${m[2]}${m[3]}`).join(' ').slice(0, 1500));
    console.log('YK-T', d.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 400));
  } catch (e) { console.log('YK ERR', u, e.cause?.code || e.message); }
}
