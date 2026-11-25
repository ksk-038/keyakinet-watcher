// 部屋の「鏡の有無・鏡の仕様・利用費」を、東京・大阪のスプレッドシートから読む
//   シートは「リンクを知っている人は見られる」にしてある。B 施設名・C 部屋名・E 広さ・F 鏡有無・G 鏡の仕様・H 利用費・J メモ（「利用不可」で始まる部屋は使えない）
//   読めなかったときは空っぽを返す（空きの送信はそのまま続ける）
const TOKYO = '1jOgQENb9M80Sc3dQ93zaWosGwWlYZsPWXZMRvpucxUA';
const OSAKA = '1FJFTK0abUW2NF-4PhCCfJwELtoOJVaSMd4wSGyPSKTc';
// 区・市の名前 → [シート, タブの名前]（タブがない区はシートを読まない。名前違いのタブを読むと別の区の表が返ってくるため）
const TABS = {
  世田谷区: [TOKYO, '世田谷区'], 文京区: [TOKYO, '文京区'], 新宿区: [TOKYO, '新宿区'], 品川区: [TOKYO, '品川区'], 板橋区: [TOKYO, '板橋区'],
  オリンピックセンター: [TOKYO, 'オリセン'],
  大阪市: [OSAKA, '大阪市'], 寝屋川市: [OSAKA, '寝屋川市'], 守口市: [OSAKA, '守口市'], 門真市: [OSAKA, '門真市'],
};

/** 名前のゆれをそろえる（全角・半角、空白） */
export const norm = (s) => String(s || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
/** かっこの中を取った名前（「多目的ホール（100）」→「多目的ホール」） */
const bare = (s) => norm(s).replace(/[(（【\[][^()（）【】\[\]]*[)）】\]]/g, '').replace(/[(（【\[][^()（）【】\[\]]*[)）】\]]/g, '');

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
    const url = `https://docs.google.com/spreadsheets/d/${t[0]}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(t[1])}&tq=${encodeURIComponent('select B, C, E, F, G, H, J')}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (/^\s*</.test(text)) throw new Error('シートが公開されていない（ログイン画面が返ってきた）');
    list = parseCsv(text)
      .filter((r) => r[0] && r[0] !== '施設名')
      .map(([fac, room, area, mirror, spec, fee, memo]) => ({ fac, room, ng: /^\s*利用不可/.test(memo || ''), area: Number(String(area || '').replace(/,/g, '')) || null, mirror: (mirror || '').trim(), spec: (spec || '').trim(), fee: (fee || '').trim() }));
    console.log(`部屋の表（${ward}）: ${list.length}部屋`);
  } catch (e) {
    console.warn(`⚠ 部屋の表（${ward}）が読めません: ${e.message}`);
  }
  cache.set(ward, list);
  return list;
}

/** 「施設 部屋」に合う行を探して { area, mirror, mirror_note, fee } を返す（見つからなければ null）。area は広さ（㎡・わからなければ null） */
export async function roomInfoFor(ward) {
  const list = await load(ward);
  if (!list) return () => null;
  const exact = new Map(); const loose = new Map();
  for (const r of list) {
    const k = norm(r.fac + r.room);
    if (!exact.has(k)) exact.set(k, r);
    const b = bare(r.fac + r.room);
    if (!loose.has(b)) loose.set(b, r);
  }
  return (place) => {
    const r = exact.get(norm(place)) || loose.get(bare(place));
    if (!r) return null;
    // 「？」・空・「なし」「記載なし」などの中身のない説明は送らない
    const mirror = ['〇', '△', '×'].includes(r.mirror) ? r.mirror : null;
    const note = r.spec && !/^(なし|記載なし|-|)$/.test(r.spec) ? r.spec : null;
    const fee = r.fee && r.fee !== '-' ? r.fee : null;
    if (!r.area && !mirror && !note && !fee) return null;
    return { area: r.area, mirror, mirror_note: note, fee };
  };
}

/** シートでの扱い：'ok'＝使える部屋・'ng'＝「利用不可」の部屋・null＝シートにない部屋。シートが読めなければ全部 'ok' */
export async function roomStatusFor(ward) {
  const list = await load(ward);
  if (!list) return () => 'ok';
  const exact = new Map(); const loose = new Map();
  for (const r of list) {
    const k = norm(r.fac + r.room);
    // 同じ名前が2行あるときは「使える」を優先
    if (!exact.has(k) || !r.ng) exact.set(k, r);
    const b = bare(r.fac + r.room);
    if (!loose.has(b) || !r.ng) loose.set(b, r);
  }
  return (place) => {
    const r = exact.get(norm(place)) || loose.get(bare(place));
    return r ? (r.ng ? 'ng' : 'ok') : null;
  };
}
