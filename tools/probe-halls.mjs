// 下調べ: うぐいすネット（大田区）のトップ
const r = await fetch('https://www.yoyaku.city.ota.tokyo.jp/', { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ja' }, redirect: 'follow' });
const h = await r.text();
console.log('OTA', r.status, r.url, h.length);
console.log('OTA-TAGS', [...h.matchAll(/<(a|form|frame|iframe|script)\b[^>]*>/gi)].map((m) => m[0].replace(/\s+/g, ' ').slice(0, 200)).slice(0, 60).join('\n'));
console.log('OTA-TEXT', h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 1500));
