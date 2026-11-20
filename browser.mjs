// ブラウザで予約サイトを見るときの共通のしかけ
//   監視に要るのは文字だけなので、画像・文字の形のデータ（フォント）・動画・アクセス解析などは読み込まない
//   （通信量が減り、画面の表示も速くなる）。デザイン（CSS）は、ボタンが見えているかの判定に使うので読み込む
//   images: false にすると画像も止める。画像がボタンになっているサイト（板橋区・門真市）は止めない
const TRACKERS = /google-analytics|googletagmanager|doubleclick|googlesyndication|facebook\.net|clarity\.ms|hotjar/;
export async function light(ctx, { images = false } = {}) {
  await ctx.route('**/*', (route) => {
    const req = route.request();
    const t = req.resourceType();
    if (TRACKERS.test(req.url())) return route.abort();
    if (t === 'font' || t === 'media' || (t === 'image' && !images)) return route.abort();
    return route.continue();
  });
  if (process.env.NETLOG) netlog(ctx);
  return ctx;
}

// 作るとき用：画面の裏でやりとりしている中身を netlog.json に書き出す（NETLOG=1 のときだけ）
const LOG = [];
function netlog(ctx) {
  ctx.on('response', async (r) => {
    const q = r.request();
    if (!['document', 'xhr', 'fetch'].includes(q.resourceType())) return;
    let body = '';
    try { body = await r.text(); } catch { /* 読めない */ }
    LOG.push({ t: q.resourceType(), m: q.method(), url: q.url(), post: (q.postData() || '').slice(0, 20000), reqh: q.headers(), status: r.status(), ct: r.headers()['content-type'], size: body.length, body: body.slice(0, 200000) });
    await import('node:fs/promises').then((fs) => fs.writeFile('netlog.json', JSON.stringify(LOG)));
  });
}
