import { Site } from './pf489/client.mjs';
const show = (s, t) => { console.log(`\n===== ${t} ${s.page.url}\n${s.text().slice(0, 2500)}\n--- 入力欄: ${[...s.page.body.matchAll(/<(input|select)[^>]*name="([^"]+)"[^>]*>/gi)].map((m) => m[0].replace(/value="\/wE[^"]*"/, 'value="…"')).join(' ').slice(0, 3000)}`); };
for (const [base, p1, p2] of [['https://www4.pf489.com/moriguchi/mobile/', '1', '18'], ['https://www4.pf489.com/Neyagawa/mobile/', '1', '2']]) {
  const s = new Site(base);
  try {
    await s.req('Wm_ShisetsuKensaku.aspx?ActiveForm=Purpose');
    await s.submit([['slPurpose1', p1], ['cmdSelect2', '選択']]);
    await s.submit([['slPurpose1', p1], ['slPurpose2', p2], ['cmdNext4', '[6]検索']]);
    show(s, '施設選択');
    // 施設をぜんぶ選んで次へ（チェックボックスの名前を全部つける）
    const boxes = [...s.page.body.matchAll(/<input[^>]*type="checkbox"[^>]*>/gi)].map((m) => [(m[0].match(/name="([^"]+)"/) || [])[1], (m[0].match(/value="([^"]*)"/) || [])[1] ?? 'on']);
    const sub = [...s.page.body.matchAll(/<input[^>]*type="submit"[^>]*>/gi)].map((m) => [(m[0].match(/name="([^"]+)"/) || [])[1], (m[0].match(/value="([^"]*)"/) || [])[1]]);
    console.log('ボタン', JSON.stringify(sub));
    const next = sub.find(([n, v]) => /次|検索|決定/.test(v || '')) || sub.at(-1);
    if (next) { await s.submit([...boxes, next]); show(s, '次の画面'); }
    const sub2 = [...s.page.body.matchAll(/<input[^>]*type="submit"[^>]*>/gi)].map((m) => [(m[0].match(/name="([^"]+)"/) || [])[1], (m[0].match(/value="([^"]*)"/) || [])[1]]);
    console.log('ボタン2', JSON.stringify(sub2));
  } catch (e) { console.log('ERR', e.message); show(s, 'エラー時'); }
}
