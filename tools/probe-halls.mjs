const go = async (u) => { try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', 'Accept-Language': 'ja' }, redirect: 'follow', signal: AbortSignal.timeout(20000) }); const h = await r.text(); console.log('\nURL', r.status, r.url, h.length); return h; } catch (e) { console.log('\nERR', u, e.cause?.code || e.message); return ''; } };
const text = (h, n) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').slice(0, n);
const links = (h, re) => [...new Set([...h.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => `${m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 30)} → ${m[1]}`))].filter((s) => re.test(s)).slice(0, 15).join('\n  ');
let h = await go('https://www.fureai-net.city.kawasaki.jp/'); console.log('KAWA', text(h, 600)); console.log('  ' + links(h, /./));
h = await go('https://www.k-mil.gr.jp/'); console.log('KMIL', text(h, 200)); console.log('  ' + links(h, /空き|予約|貸|利用/));
h = await go('https://www.city.machida.tokyo.jp/'); console.log('MACHI', text(h, 100));
h = await go('https://www.machida-bunka.or.jp/'); console.log('MACHI2', text(h, 200)); console.log('  ' + links(h, /空き|予約|貸|利用|ホール/));
