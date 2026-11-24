// 下調べ: 各ホールの公式サイトに「空き状況」のページがあるか
const sites = ['https://www.muse-tokorozawa.or.jp/', 'https://www.chofu-culture-community.org/', 'https://www.musashino.or.jp/', 'https://www.k-mst.or.jp/', 'https://www.nicesacademia.jp/', 'https://www.saf.or.jp/saitama_kaikan/', 'https://www.ecorma-hall.jp/', 'https://www.tachikawa-chiikibunka.or.jp/', 'https://www.ageo-bunka.jp/', 'https://www.city.ageo.lg.jp/', 'https://www.city.tokorozawa.saitama.jp/shisetu/yoyaku/', 'https://www.hikifune-bunka.jp/', 'https://www.akishima-bunka.jp/', 'https://www.machida-shiminhall.jp/', 'https://www.miyajigakki-hall.jp/', 'https://www.shibu-cul.jp/'];
for (const u of sites) {
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ja' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    const h = await r.text();
    const links = [...h.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => [m[1], m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()]).filter(([href, t]) => /空き|空室|予約|利用案内|施設利用|貸/.test(t + href)).slice(0, 12).map(([a, t]) => `${t.slice(0, 25)} → ${a}`);
    console.log('SITE', r.status, r.url, (h.match(/<title>([^<]*)/i) || [])[1]?.trim().slice(0, 40), '\n  ' + links.join('\n  '));
  } catch (e) { console.log('SITE ERR', u, e.cause?.code || e.message); }
}
