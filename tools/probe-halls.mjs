const go = async (u) => { try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ja' }, redirect: 'follow', signal: AbortSignal.timeout(20000) }); return [r, await r.text()]; } catch (e) { console.log('ERR', u, e.cause?.code || e.message); return [null, '']; } };
for (const u of ['https://www.city.sumida.lg.jp/sisetu_info/sisetuyoyaku.html', 'https://risuru.hall-info.jp/topics/20251021.html', 'https://risuru.hall-info.jp/guide/guidance.html', 'https://www.chofu-culture-community.org/news/archives/43086']) {
  const [r, h] = await go(u); if (!r) continue;
  console.log('SITE', r.status, r.url, '\n  ' + [...new Set([...h.matchAll(/href="([^"#]+)"/gi)].map((m) => m[1]))].filter((x) => /yoyaku|user|reserve|shisetsu|rsv|eshisetsu|Home|web\/|index\.jsp|cgi/i.test(x) && !/\.pdf$|\.css|\.js/.test(x)).slice(0, 15).join('\n  '));
}
