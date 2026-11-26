// 確かめ用：区・市ごとに「広さがわからない使える部屋」と、そのうち定員がわかる部屋を数える
import { sheetRows, sheetWards } from '../roominfo.mjs';
for (const w of sheetWards) {
  const rows = (await sheetRows(w)) || [];
  const unk = rows.filter((r) => !r.ng && r.area == null);
  const withCap = unk.filter((r) => r.cap);
  const odd = unk.filter((r) => !r.cap && r.capRaw);
  console.log(`■${w}: 使える部屋${rows.filter((r) => !r.ng).length}・広さ不明${unk.length}・うち定員あり${withCap.length}`);
  for (const r of unk) console.log(`  ${r.fac} ${r.room}｜定員欄「${r.capRaw}」${r.cap ? ` → ${r.cap}名` : ''}`);
  if (odd.length) console.log(`  （定員欄に書いてあるけど人数として読めない: ${odd.length}件）`);
}
