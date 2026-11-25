const go = async (u) => { try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', 'Accept-Language': 'ja' }, redirect: 'follow', signal: AbortSignal.timeout(20000) }); const h = await r.text(); console.log('\nURL', r.status, r.url, h.length); return h; } catch (e) { console.log('\nERR', u, e.cause?.code || e.message); return ''; } };
const links = (h, re) => [...new Set([...h.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => `${m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 30)} → ${m[1]}`))].filter((s) => re.test(s)).slice(0, 15).join('\n  ');
let h = await go('https://www.kcf.or.jp/koto/shisetsu/ichiran/detail/?id=2'); console.log('KCF', links(h, /予約|空き|yoyaku|reserve|kashikan|rsv/i));
console.log('KCF seats', (h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').match(/.{0,80}(定員|席).{0,80}/g) || []).slice(0, 4).join(' | '));
h = await go('https://www.sunpearl-arakawa.com/guide/subscribe/'); console.log('SP', links(h, /予約|空き|yoyaku|reserve|kashikan|rsv|システム/i));
console.log('SP cancel', (h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').match(/.{0,100}(取消|キャンセル|還付).{0,200}/g) || []).slice(0, 4).join(' | '));
h = await go('https://www.city.arakawa.tokyo.jp/a008/shisetsuannai/sisetuyoyaku/bunkashisetsu-riyou.html'); console.log('AR', links(h, /予約システム|yoyaku|reserve|shisetsu|rsv/i));
