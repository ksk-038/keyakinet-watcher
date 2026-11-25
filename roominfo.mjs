// 部屋の「鏡の有無・鏡の仕様・利用費」を、東京・大阪のスプレッドシートから読む
//   シートは「リンクを知っている人は見られる」にしてある（書き出しの CSV で読む）。B 施設名・C 部屋名・E 広さ・F 鏡有無・G 鏡の仕様・H 利用費・J メモ（「利用不可」で始まる部屋は使えない）
//   読めなかったときは空っぽを返す（空きの送信はそのまま続ける）
const TOKYO = '1jOgQENb9M80Sc3dQ93zaWosGwWlYZsPWXZMRvpucxUA';
const OSAKA = '1FJFTK0abUW2NF-4PhCCfJwELtoOJVaSMd4wSGyPSKTc';
// 区・市の名前 → [シート, タブの番号（gid）]（タブがない区はシートを読まない）
//   タブの番号はシートの URL の「#gid=」の数字。タブを作り直したら直す
const TABS = {
  世田谷区: [TOKYO, 1531277077], 文京区: [TOKYO, 772434078], 新宿区: [TOKYO, 399230372], 品川区: [TOKYO, 738777137], 板橋区: [TOKYO, 1002541949],
  オリンピックセンター: [TOKYO, 1777001],
  大阪市: [OSAKA, 1422547724], 寝屋川市: [OSAKA, 312326896], 守口市: [OSAKA, 943925217], 門真市: [OSAKA, 1436876227],
};

/** 名前のゆれをそろえる（全角・半角、空白、「_」） */
export const norm = (s) => String(s || '').normalize('NFKC').replace(/[\s_]+/g, '').toLowerCase();
const BR = /[(\[【][^()\[\]【】]*[)\]】]/g;
/** かっこの中を取った名前（「多目的ホール（100）」→「多目的ホール」） */
const bare = (s) => norm(s).replace(BR, '').replace(BR, '');
/** かっこだけ取った名前（「体育室（窓側）」→「体育室窓側」） */
const flat = (s) => norm(s).replace(/[()\[\]【】]/g, '');
const forms = (s) => [norm(s), bare(s), flat(s)];
/** かっこの中の別名（「第1体育室（中体育室）」→「中体育室」） */
const aliases = (s) => [...norm(s).matchAll(/[(\[【]([^()\[\]【】]+)[)\]】]/g)].map((m) => m[1]);
/** 施設名の頭の「大阪市立」「大阪市」「オリセン」は無視する（予約サイトに出ないことがあるため） */
const core = (s) => bare(s).replace(/^(大阪市立|大阪市|オリセン)/, '');
const facSame = (a, b) => { const x = core(a); const y = core(b); return x === y || (Math.min(x.length, y.length) >= 4 && (x.endsWith(y) || y.endsWith(x))); };
/** 部屋名が同じか（ゆれ・かっこの別名・「小練習室」→「小練習室10」のような番号違い・「301」→「301会議室」） */
function roomSame(site, sheet) {
  const a = forms(site); const b = forms(sheet);
  if (a.some((x) => b.includes(x))) return true;
  if (aliases(sheet).some((x) => a.includes(x))) return true;
  const n = norm(sheet); const pr = bare(site);
  if (pr && n.startsWith(pr) && /^[0-9〜~・,、-]+$/.test(n.slice(pr.length))) return true;
  if (/^[0-9-]+$/.test(norm(site)) && n.startsWith(norm(site))) return true;
  return false;
}
/** シートの行の中から「施設 部屋」に当たる行を探す（いくつも当たることがある） */
export function finder(list) {
  return (place) => {
    const p = forms(place);
    const hit = list.filter((r) => forms(r.fac + r.room).some((x) => p.includes(x)));
    if (hit.length) return hit;
    // 区切り（空白・「_」）のどこで施設と部屋に分けても試す
    const cuts = [...String(place).matchAll(/[\s_]+/g)].map((m) => [m.index, m.index + m[0].length]);
    const out = new Set();
    for (const [a, b] of cuts) {
      const pf = place.slice(0, a); const pr = place.slice(b);
      for (const r of list) if (facSame(pf, r.fac) && roomSame(pr, r.room)) out.add(r);
    }
    return [...out];
  };
}

/** CSV を読む（"…" の中のカンマ・改行もそのまま） */
export function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const cache = new Map();
/** その区の部屋の表（読めなければ null） */
async function load(ward) {
  const t = TABS[ward];
  if (!t) return null;
  if (cache.has(ward)) return cache.get(ward);
  let list = null;
  try {
    // 「書き出し」で読む（シートに絞り込みをかけていても、隠れた行まで全部読める）
    const url = `https://docs.google.com/spreadsheets/d/${t[0]}/export?format=csv&gid=${t[1]}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (/^\s*</.test(text)) throw new Error('シートが公開されていない（ログイン画面が返ってきた）');
    // A No・B 施設名・C 部屋名・D 利用目的・E 広さ・F 鏡有無・G 鏡の仕様・H 利用費・I 定員・J メモ
    list = parseCsv(text)
      .filter((r) => r[1] && r[1] !== '施設名')
      .map((r) => ({ fac: r[1], room: r[2] || '', ng: /^\s*利用不可/.test(r[9] || ''), area: Number(String(r[4] || '').replace(/,/g, '')) || null, mirror: (r[5] || '').trim(), spec: (r[6] || '').trim(), fee: (r[7] || '').trim() }));
    console.log(`部屋の表（${ward}）: ${list.length}部屋`);
  } catch (e) {
    console.warn(`⚠ 部屋の表（${ward}）が読めません: ${e.message}`);
  }
  cache.set(ward, list);
  return list;
}

/** 「施設 部屋」に合う行を探して { area, mirror, mirror_note, fee } を返す（見つからなければ null）。area は広さ（㎡・わからなければ null）
 *  いくつも当たったとき（「小練習室」がシートでは小練習室10〜26 など）は、使える部屋の中で同じ値のものだけ返す */
export async function roomInfoFor(ward) {
  const list = await load(ward);
  if (!list) return () => null;
  const find = finder(list);
  const same = (rows, f) => { const v = rows.map(f); return v.every((x) => x === v[0]) ? v[0] : null; };
  return (place) => {
    const all = find(place);
    const rows = all.filter((r) => !r.ng).length ? all.filter((r) => !r.ng) : all;
    if (!rows.length) return null;
    // 「？」・空・「なし」「記載なし」などの中身のない説明は送らない
    const m = same(rows, (r) => r.mirror);
    const mirror = ['〇', '△', '×'].includes(m) ? m : null;
    const spec = same(rows, (r) => r.spec);
    const note = spec && !/^(なし|記載なし|-|)$/.test(spec) ? spec : null;
    const f = same(rows, (r) => r.fee);
    const fee = f && f !== '-' ? f : null;
    const area = same(rows, (r) => r.area);
    if (!area && !mirror && !note && !fee) return null;
    return { area, mirror, mirror_note: note, fee };
  };
}

/** シートでの扱い：'ok'＝使える部屋・'ng'＝「利用不可」の部屋・null＝シートにない部屋。シートが読めなければ全部 'ok' */
export async function roomStatusFor(ward) {
  const list = await load(ward);
  if (!list) return () => 'ok';
  const find = finder(list);
  return (place) => {
    const rows = find(place);
    if (!rows.length) return null;
    return rows.some((r) => !r.ng) ? 'ok' : 'ng';
  };
}

/** シートで「使える」なのに、今回の空きに一度も出てこなかった部屋（名前のずれを見つけるため） */
export async function unseenFor(ward, places) {
  const list = await load(ward);
  if (!list) return [];
  const find = finder(list);
  const seen = new Set(places.flatMap((p) => find(p)));
  return list.filter((r) => !r.ng && !seen.has(r)).map((r) => `${r.fac} ${r.room}${r.area ? `（${r.area}㎡）` : ''}`);
}
