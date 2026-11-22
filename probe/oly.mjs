import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('probe/out', { recursive: true });
const B = 'https://yoyaku.nyc.niye.go.jp/users/';
for (const f of ['sports_H.html', 'sports_L.html', 'culture_H.html']) {
  try {
    const r = await fetch(B + f, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(60000) });
    const buf = Buffer.from(new TextDecoder(f.includes('_') ? 'utf-8' : 'euc-jp').decode(await r.arrayBuffer()));
    writeFileSync(`probe/out/${f || 'root'}.html`, buf);
    console.log(f, r.status, buf.length, r.headers.get('content-type'));
  } catch (e) { console.log(f, 'ERR', e.message); }
}
