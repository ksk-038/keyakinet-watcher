// スプレッドシート「ざわめき祭2027 ホール候補リスト」に貼る Google Apps Script
//   ホール空き監視の結果を「ホール空き監視」タブに書き、「抽選カレンダー」タブの「今の空き」列も書き換える
//   1. スプレッドシートの「拡張機能」→「Apps Script」を開き、このファイルの中身を全部貼って保存
//   2. 下の SECRET を好きな合言葉に書き換える
//   3. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」、実行ユーザー「自分」、アクセス「全員」でデプロイ → 出てきた URL をコピー
//   4. GitHub の keyakinet-watcher → Settings → Secrets → Actions に HALLS_SHEET_URL（3の URL）と HALLS_SHEET_SECRET（2の合言葉）を登録
const SECRET = 'ここを合言葉に書き換える';
const TAB = 'ホール空き監視';
const CAL = '抽選カレンダー';

function doPost(e) {
  const q = JSON.parse(e.postData.contents);
  if (q.secret !== SECRET) return ContentService.createTextOutput('unauthorized');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(TAB) || ss.insertSheet(TAB);
  const wd = ['日', '月', '火', '水', '木', '金', '土'];
  const at = Utilities.formatDate(new Date(q.checkedAt), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  const rows = q.rows.map((r) => {
    const d = new Date(`${r.date}T00:00:00+09:00`);
    return [r.hall, r.date.replace(/-/g, '/'), wd[d.getDay()], r.slots['午前'] || '', r.slots['午後'] || '', r.slots['夜間'] || '', r.combos.join('／') || '—', r.url];
  });
  // このホールたちの行を書き換える（ほかのホールの行は残す）
  const halls = new Set(q.rows.map((r) => r.hall));
  const last = sh.getLastRow();
  const old = last >= 3 ? sh.getRange(3, 1, last - 2, 8).getValues().filter((r) => r[0] && !halls.has(r[0])) : [];
  const all = old.concat(rows).sort((a, b) => String(a[1]).localeCompare(String(b[1])) || String(a[0]).localeCompare(String(b[0])));
  if (last >= 3) sh.getRange(3, 1, last - 2, 8).clearContent();
  if (all.length) sh.getRange(3, 1, all.length, 8).setValues(all);
  sh.getRange(1, 1).setValue(`ホール空き監視（自動更新）最終確認: ${at}　●/〇=空き ×=予約済 -=受付期間外`);
  updateCalendar(ss, q.rows, at);
  return ContentService.createTextOutput('ok');
}

// 「抽選カレンダー」の「今の空き」列：ホール名（A列）と「11月分／12月分」（B列）の行に、その月の公演日の空きを書く
function updateCalendar(ss, rows, at) {
  const sh = ss.getSheetByName(CAL);
  if (!sh) return;
  const head = sh.getRange(3, 1, 1, 10).getValues()[0];
  const col = head.findIndex((v) => String(v).indexOf('今の空き') === 0) + 1;
  if (!col) return;
  const wd = ['日', '月', '火', '水', '木', '金', '土'];
  const last = sh.getLastRow();
  const ab = sh.getRange(5, 1, last - 4, 2).getValues();
  let hallText = '';
  ab.forEach(([a, b], i) => {
    if (a) hallText = String(a);
    const m = String(b).match(/^(\d+)月分/);
    if (!m) return;
    const mine = rows.filter((r) => r.cal && hallText.indexOf(r.cal) >= 0 && Number(r.date.slice(5, 7)) === Number(m[1]));
    if (!mine.length) return;
    // 1つの行に複数のホールが入るとき（川崎の3市民館など）は、ホール名を先頭につける
    const many = new Set(mine.map((r) => r.hall)).size > 1;
    const lines = mine.sort((x, y) => (x.hall || '').localeCompare(y.hall || '') || x.date.localeCompare(y.date)).map((r) => {
      const d = new Date(`${r.date}T00:00:00+09:00`);
      const label = `${d.getMonth() + 1}/${d.getDate()}(${wd[d.getDay()]})`;
      const free = ['午前', '午後', '夜間'].filter((k) => /[●〇○]|空き/.test(r.slots[k] || ''));
      const vals = ['午前', '午後', '夜間'].map((k) => r.slots[k]).filter((v) => v != null);
      const pre = many ? `${String(r.hall || '').replace(/^\S+\s/, '').replace(/ 大ホール$/, '')} ` : '';
      if (free.length) return `${pre}${label} ${free.join('・')} 空き`;
      if (vals.length && vals.every((v) => v === '-')) return `${pre}${label} 受付前`;
      return `${pre}${label} ×`;
    });
    sh.getRange(5 + i, col).setValue(lines.join('\n'));
  });
  sh.getRange(2, col).setValue(`${at.slice(5)}時点（自動）`);
}
