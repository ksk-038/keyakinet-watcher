// ホール空き監視の下調べ（中継・東京から開く）: 画面の中身をログに出すだけ。通知はしない
const RELAY = 'https://jskulzunyckseeokgzax.supabase.co/functions/v1/jp-relay';
const SECRET = process.env.YANAGIBA_SECRET;
const SITES = [
  { base: 'https://k5.p-kashikan.jp/nishitokyo-city/', steps: [{ get: 'Top' }, { post: 'SrchSst', data: 'op=SrchSst' }, { post: 'SrchSst', data: 'op=SrchSst&UseYM=202711&UseDay=27&UseDate=20271127&ShisetsuCode=002' }] },
];
async function relay(base, steps) {
  const r = await fetch(RELAY, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-region': 'ap-northeast-1' }, body: JSON.stringify({ secret: SECRET, base, enc: 'utf8', steps }), signal: AbortSignal.timeout(140000) });
  return { status: r.status, j: await r.json().catch(async () => ({ raw: (await r.text()).slice(0, 500) })) };
}
for (const s of SITES) {
  const { status, j } = await relay(s.base, s.steps);
  console.log(`=== ${s.base} relay ${status} ${j.error || ''} ${j.raw || ''}`);
  for (const p of j.pages || []) {
    const b = p.body || '';
    if (s.raw) { const js = b; for (const m of js.matchAll(/(function \w+|url\s*:|\$\.(ajax|post|get)\(|action\s*=|op\.value|\.submit\(\))[\s\S]{0,160}/g)) console.log('JS> ' + m[0].replace(/\s+/g, ' ')); continue; }
    console.log(`--- PAGE ${p.url} ${p.status} len=${b.length}`);
    const tags = [...b.matchAll(/<(a|form|input|select|option|button|iframe|label)\b[^>]*>(?:[^<]{0,40})/gi)].map((m) => m[0].replace(/\s+/g, ' ').slice(0, 220));
    console.log(tags.filter((t) => !/navigation-link|menu-|scd0|select-bt/.test(t)).slice(0, 300).join('\n'));
    console.log('--- TEXT', b.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 7000));
  }
}
