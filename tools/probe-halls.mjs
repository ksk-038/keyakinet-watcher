const go = async (u) => { try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', 'Accept-Language': 'ja' }, redirect: 'follow', signal: AbortSignal.timeout(20000) }); const h = await r.text(); console.log('\nURL', r.status, r.url, h.length); return h; } catch (e) { console.log('\nERR', u, e.cause?.code || e.message); return ''; } };
let h = await go('https://yoyaku03.city.sumida.lg.jp/user/Home');
const u = h.replace(/\\u([0-9a-f]{4})/gi, (_, x) => String.fromCodePoint(parseInt(x, 16))).replace(/&#x([0-9A-F]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16)));
console.log('SUMI-P', [...u.matchAll(/"PurposeCategoryCode":(\d+),"PurposeCode":(\d+),"PurposeName":"([^"]+)"/g)].map((m) => `${m[1]}-${m[2]}${m[3]}`).join(' ').slice(0, 1500), /Turnstile|turnstile/.test(h) ? 'TURNSTILE' : '');
h = await go('https://yoyaku.saf-ticket.jp/cultos/reserve/gin_menu');
console.log('SAF', h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 1500));
console.log('SAF-T', [...h.matchAll(/<(a|form|select|option|input)\b[^>]*>([^<]{0,30})/gi)].map((m) => m[0].replace(/\s+/g, ' ').slice(0, 180)).slice(0, 50).join('\n'));
