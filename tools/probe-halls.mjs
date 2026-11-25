const go = async (u) => { try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ja' }, redirect: 'follow', signal: AbortSignal.timeout(20000) }); return [r, await r.text()]; } catch (e) { console.log('ERR', u, e.cause?.code || e.message); return [null, '']; } };
for (const u of ['https://www.city.sumida.lg.jp/sisetu_info/sisetuyoyaku.html', 'https://risuru.hall-info.jp/topics/20251021.html', 'https://risuru.hall-info.jp/guide/guidance.html', 'https://www.chofu-culture-community.org/news/archives/43086']) {
  const [r, h] = await go(u); if (!r) continue;
  const host = new URL(r.url).host;
  console.log('SITE', r.status, r.url, h.length, '\n  ' + [...new Set([...h.matchAll(/href=["']?(https?:\/\/[^"' >]+)/gi)].map((m) => m[1]))].filter((x) => !x.includes(host) && !/\.(css|js|png|jpg)$|google|facebook|twitter|x\.com|instagram|youtube|line\.me|adobe/i.test(x)).slice(0, 25).join('\n  '));
  console.log('  TEXT', h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').match(/.{0,200}(予約システム|利用システム).{0,300}/)?.[0]);
}
