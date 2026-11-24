// 下調べ: うぐいすネット（大田区）
const go = async (u, opt = {}) => { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ja' }, redirect: 'follow', ...opt }); const h = await r.text(); console.log('URL', r.status, r.url, h.length); return h; };
const h = await go('https://www.yoyaku.city.ota.tokyo.jp/eshisetsu/');
console.log('TAGS', [...h.matchAll(/<(a|form|frame|iframe|input|select)\b[^>]*>/gi)].map((m) => m[0].replace(/\s+/g, ' ').slice(0, 220)).slice(0, 80).join('\n'));
console.log('TEXT', h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 1500));
