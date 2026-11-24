const go = async (u) => { try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ja' }, redirect: 'follow', signal: AbortSignal.timeout(20000) }); return [r, await r.text()]; } catch (e) { console.log('ERR', u, e.cause?.code || e.message); return [null, '']; } };
const all = (h, re) => [...new Set([...h.matchAll(/href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => `${m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 30)} → ${m[1]}`))].filter((s) => re.test(s)).slice(0, 12).join('\n  ');
for (const [u, re] of [['https://www.city.sumida.lg.jp/sisetu_info/sisetuyoyaku.html', /システム|予約|空き|http/], ['https://www.chofu-culture-community.org/renter', /予約|空き|システム|reserve|yoyaku/i], ['https://www.muse-tokorozawa.or.jp/guide/', /空き|予約|システム/], ['https://www.saf.or.jp/saitama/rental/', /空き|予約状況|システム|calendar/i], ['https://www.tachikawa-chiikibunka.or.jp/', /RISURU|リスル|市民会館|貸|空き/i]]) {
  const [r, h] = await go(u); if (!r) continue;
  console.log('SITE', r.status, r.url, '\n  ' + all(h, re));
}
