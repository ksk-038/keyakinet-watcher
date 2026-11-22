import fs from 'node:fs';
const RELAY = 'https://jskulzunyckseeokgzax.supabase.co/functions/v1/jp-relay';
const base = 'https://www4.pf489.com/moriguchi/mobile/';
const relay = async (steps) => { const r = await fetch(RELAY, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-region': 'ap-northeast-1' }, body: JSON.stringify({ secret: process.env.YANAGIBA_SECRET, base, steps }) }); const j = await r.json(); if (j.error) throw new Error(j.error); return j.pages; };
const opts = (b, n) => [...(b || '').matchAll(new RegExp(`<option[^>]*value="([^"]*)"[^>]*>([^<]*)`, 'g'))].map((m) => [m[1], m[2].trim()]);
const out = [];
const p = await relay([{ get: 'Wm_TopMenu.aspx' }, { get: 'Wm_ShisetsuKensaku.aspx?ActiveForm=Purpose' }]);
const cats = opts(p.at(-1).body);
out.push('cats ' + JSON.stringify(cats));
const pur = {};
for (const [c] of cats) {
  if (!c) continue;
  const q = await relay([{ get: 'Wm_TopMenu.aspx' }, { get: 'Wm_ShisetsuKensaku.aspx?ActiveForm=Purpose' }, { submit: [['slPurpose1', c], ['cmdSelect2', '選択']] }]);
  pur[c] = opts(q.at(-1).body).filter(([v]) => v && !cats.some(([x]) => x === v && false));
  out.push(`cat ${c} ` + JSON.stringify(pur[c]));
}
// 守口市民体育館の部屋：目的ごと
for (const [c, ps] of Object.entries(pur)) for (const [v, name] of ps) {
  if (!/体操|エアロ|ヨガ|ダンス|バレエ|舞|会議|研修|ストレッチ|健康|卓球|バドミントン|その他|太極/.test(name)) continue;
  try {
    const q = await relay([
      { get: 'Wm_TopMenu.aspx' }, { get: 'Wm_ShisetsuKensaku.aspx?ActiveForm=Purpose' },
      { submit: [['slPurpose1', c], ['cmdSelect2', '選択']] },
      { submit: [['slPurpose1', c], ['slPurpose2', v], ['cmdNext4', '[6]検索']] },
      { get: 'Wm_ShisetsuSentaku.aspx?SearchRoute=Purpose' },
    ]);
    const b = q.at(-1).body || '';
    const facs = [...b.matchAll(/name="slShisetsu" value="(\d+)">([^<]+)/g)].map((m) => [m[1], m[2]]);
    const gym = facs.find((f) => /体育館/.test(f[1]));
    let rooms = '';
    if (gym) {
      const r = await relay([
        { get: 'Wm_TopMenu.aspx' }, { get: 'Wm_ShisetsuKensaku.aspx?ActiveForm=Purpose' },
        { submit: [['slPurpose1', c], ['cmdSelect2', '選択']] },
        { submit: [['slPurpose1', c], ['slPurpose2', v], ['cmdNext4', '[6]検索']] },
        { get: 'Wm_ShisetsuSentaku.aspx?SearchRoute=Purpose' },
        { submit: [['txtNen$txt', '2027'], ['txtTsuki$txt', '1'], ['txtHi$txt', '20'], ['slShisetsu', gym[0]], ['cmdNext', '[6]次へ']] },
        { get: 'Wm_ShitsujouSentaku.aspx' },
      ]);
      rooms = [...(r.at(-1).body || '').matchAll(/SJCode=[^"]+"[^>]*>([^<]+)/g)].map((m) => m[1].trim()).join(' / ');
    }
    out.push(`${c}/${v} ${name}: ${facs.map((f) => f[1]).join('・')} || 体育館の部屋: ${rooms}`);
  } catch (e) { out.push(`${c}/${v} ${name}: ERR ${e.message}`); }
}
fs.mkdirSync('probe/out', { recursive: true });
fs.writeFileSync('probe/out/pf.txt', out.join('\n'));
console.log(out.join('\n'));
