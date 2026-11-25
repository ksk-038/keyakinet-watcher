// 点検：いまアプリに出ている空きの部屋を、施設のスプレッドシートと突き合わせる
//   ・シートで「利用不可」なのにアプリに出ている部屋
//   ・シートにないのにアプリに出ている部屋
//   ・広さ・鏡・利用費がつかない部屋
// 使い方: YANAGIBA_SECRET=... node tools/room-audit.mjs
import { rpc } from '../yanagiba.mjs';
import { roomStatusFor, roomInfoFor } from '../roominfo.mjs';

const rows = await rpc('facility_watch_places', {});
const byWard = Map.groupBy(rows, (r) => r.ward);
let bad = 0;
for (const [ward, list] of byWard) {
  const st = await roomStatusFor(ward);
  const info = await roomInfoFor(ward);
  const ng = list.filter((r) => st(r.place) === 'ng').map((r) => r.place);
  const none = list.filter((r) => st(r.place) === null).map((r) => r.place);
  const noInfo = list.filter((r) => st(r.place) === 'ok' && !info(r.place)).map((r) => r.place);
  const noArea = list.filter((r) => r.area == null).map((r) => r.place);
  const noFee = list.filter((r) => !r.fee).map((r) => r.place);
  bad += ng.length + none.length;
  console.log(`■ ${ward}: アプリに出ている部屋 ${list.length}（空き ${list.reduce((a, r) => a + r.n, 0)}件）`);
  console.log(`  シートで利用不可なのに出ている: ${ng.length ? JSON.stringify(ng) : 'なし'}`);
  console.log(`  シートにないのに出ている: ${none.length ? JSON.stringify(none) : 'なし'}`);
  if (noInfo.length) console.log(`  シートの行は見つかるが中身が空: ${JSON.stringify(noInfo)}`);
  if (noArea.length) console.log(`  広さ不明のまま出ている: ${JSON.stringify(noArea)}`);
  if (noFee.length) console.log(`  利用費がまだついていない: ${JSON.stringify(noFee)}`);
}
console.log(bad ? `⚠ 合わない部屋が ${bad} 件あります` : '✅ アプリに出ている部屋は、すべてシートで「使える」部屋です');
