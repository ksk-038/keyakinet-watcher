// 調べもの用: 予約サイトの「利用目的」をぜんぶ順に選んで、どの部屋がどの利用目的で出てくるかを一覧にする
//   node tools/purposes.mjs itabashi|kadoma|moriguchi|neyagawa
//   結果は purposes-<名前>.tsv（部屋 → 出てくる利用目的）。ふだんの見張りには使わない
import fs from 'node:fs/promises';
import * as L from '../lib.mjs';

const which = process.argv[2];
const out = new Map(); // 部屋 → Set(利用目的)
const add = (room, p) => { if (!out.has(room)) out.set(room, new Set()); out.get(room).add(p); };
async function save() {
  const lines = [...out].sort((a, b) => a[0].localeCompare(b[0], 'ja')).map(([k, v]) => `${k}\t${[...v].join(' / ')}`);
  await fs.writeFile(`purposes-${which}.tsv`, lines.join('\n') + '\n');
  console.log(`--- 部屋ごとの利用目的（${which}）---\n${lines.join('\n')}`);
}

// ---------- 板橋区・門真市（同じ仕組みのサイト。ブラウザで操作） ----------
async function itaStyle(top) {
  const { chromium } = await import('playwright');
  const S = await import('../itabashi/scrape.mjs');
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo' })).newPage();
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const toMenu = async () => {
    await page.goto(top, { waitUntil: 'load' });
    await S.go(page, page.locator('img[alt^="空き照会のみ"]'), '空き照会のみ');
    await S.go(page, page.getByText('空き照会・予約', { exact: true }), '空き照会・予約');
    await S.go(page, S.row(page, '利用目的から絞り込む'), '利用目的から絞り込む');
  };
  // 押せる見出し（リンクか onclick のあるマス）の文字
  const choices = () => page.evaluate(() => [...document.querySelectorAll('td')]
    .filter((td) => (td.onclick || td.getAttribute('onclick') || td.querySelector('a')) && !td.querySelector('td'))
    .map((td) => td.innerText.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length <= 40));
  await toMenu();
  const NAV = /戻る|トップ|メニュー|ログイン|ヘルプ|閉じる|次に進む|全て|利用者|お知らせ|^\d+$/;
  const cats = [...new Set(await choices())].filter((t) => !NAV.test(t));
  console.log(`大分類: ${cats.join(' / ')}`);
  for (const c of cats) {
    let genres = [];
    try {
      await toMenu();
      await S.go(page, S.row(page, c), c);
      genres = [...new Set(await choices())].filter((t) => !NAV.test(t) && !cats.includes(t));
    } catch (e) { console.log(`  ${c}: 開けず ${e.message}`); continue; }
    console.log(`【${c}】${genres.join(' / ')}`);
    for (const g of genres) {
      try {
        await toMenu();
        await S.go(page, S.row(page, c), c);
        await S.go(page, S.row(page, g), g);
        const rooms = await page.evaluate(() => [...document.querySelectorAll('input[name="checkMeisaiUniqKey"]')].map((i) => {
          const tr = i.closest('tr');
          return (tr ? tr.innerText : i.parentElement.innerText).replace(/\s+/g, ' ').trim();
        }));
        console.log(`  ${c} → ${g}: ${rooms.length}部屋`);
        for (const r of rooms) add(L.norm(r), `${c} → ${g}`);
      } catch (e) { console.log(`  ${c} → ${g}: 開けず ${e.message.slice(0, 80)}`); }
    }
  }
  await browser.close();
}

// ---------- 守口市・寝屋川市（pf489。中継を通して開く） ----------
const RELAY = 'https://jskulzunyckseeokgzax.supabase.co/functions/v1/jp-relay';
async function relay(base, steps) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(RELAY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-region': 'ap-northeast-1' },
        body: JSON.stringify({ secret: process.env.YANAGIBA_SECRET, base, steps }),
        signal: AbortSignal.timeout(140000),
      });
      const j = await r.json().catch(() => ({ error: `${r.status}` }));
      if (r.ok && !j.error) return j.pages;
      last = new Error(`中継でエラー（${j.error || r.status}）`);
    } catch (e) { last = e; }
    await new Promise((x) => setTimeout(x, 5000));
  }
  throw last;
}
const strip = (h) => L.norm((h || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&#215;/g, '×')).trim();
const options = (body, name) => {
  // 小分類はチェックボックスで並ぶこともある
  const boxes = [...(body || '').matchAll(new RegExp(`<input type="checkbox" name="${name}" value="([^"]*)">([^<]*)`, 'g'))].map((m) => ({ v: m[1], t: strip(m[2]) }));
  if (boxes.length) return boxes;
  const sel = (body || '').match(new RegExp(`<select[^>]*name="${name}"[^>]*>([\\s\\S]*?)</select>`));
  return sel ? [...sel[1].matchAll(/<option[^>]*?value="([^"]*)"[^>]*>([^<]*)/g)].map((m) => ({ v: m[1], t: strip(m[2]) })).filter((o) => o.v !== '' && o.t) : [];
};
async function pf489(base) {
  const d = new Date(Date.now() + 14 * 86400e3);
  const head = [{ get: 'Wm_TopMenu.aspx' }, { get: 'Wm_ShisetsuKensaku.aspx?ActiveForm=Purpose' }];
  const p0 = await relay(base, head);
  const cats = options(p0.at(-1)?.body, 'slPurpose1');
  console.log(`大分類: ${cats.map((c) => c.t).join(' / ')}`);
  for (const c of cats.filter((c) => c.v !== '0' && !/選択なし/.test(c.t))) {
    const p1 = await relay(base, [...head, { submit: [['slPurpose1', c.v], ['cmdSelect2', '選択']] }]);
    const b1 = p1.at(-1)?.body || '';
    const ps = options(b1, 'slPurpose2');
    if (!ps.length) console.log(`  （小分類が読めない: 画面${p1.length}枚 / ${(b1.match(/<select[^>]*>/g) || []).join(' ')} / ${b1.replace(/\s+/g, ' ').slice(b1.indexOf('slPurpose2') - 50, b1.indexOf('slPurpose2') + 400)}）`);
    console.log(`【${c.t}】${ps.map((p) => p.t).join(' / ')}`);
    for (const p of ps) {
      const label = `${c.t} → ${p.t}`;
      try {
        const pre = [...head, { submit: [['slPurpose1', c.v], ['cmdSelect2', '選択']] }, { submit: [['slPurpose1', c.v], ['slPurpose2', p.v], ['cmdNext4', '[6]検索']] }, { get: 'Wm_ShisetsuSentaku.aspx?SearchRoute=Purpose' }];
        const p2 = await relay(base, pre);
        const facs = [...(p2.at(-1)?.body || '').matchAll(/name="slShisetsu" value="(\d+)">([^<]+)/g)].map((m) => ({ idx: m[1], name: L.norm(m[2]) }));
        console.log(`  ${label}: ${facs.map((f) => f.name).join('・')}`);
        for (const f of facs) {
          const p3 = await relay(base, [...pre,
            { submit: [['txtNen$txt', String(d.getFullYear())], ['txtTsuki$txt', String(d.getMonth() + 1)], ['txtHi$txt', String(d.getDate())], ['slShisetsu', f.idx], ['cmdNext', '[6]次へ']] },
            { get: 'Wm_ShitsujouSentaku.aspx' }]);
          const rooms = [...(p3.at(-1)?.body || '').matchAll(/Wm_JikanSentaku\.aspx\?SJCode=\w+&(?:amp;)?UseDate=\d+"[^>]*>([^<]+)</g)]
            .map((m) => strip(m[1]).replace(/^・/, '').replace(/^\([^)]*\)/, '').trim());
          for (const r of rooms) add(`${f.name} ${r}`, label);
        }
      } catch (e) { console.log(`  ${label}: 開けず ${e.message.slice(0, 80)}`); }
    }
  }
}

const SITES = {
  itabashi: () => itaStyle('https://www.itabashi-shisetsu-yoyaku.jp/eshisetsu/menu/Welcome.cgi'),
  kadoma: () => itaStyle('https://shisetsu-yoyaku.jp/kadoma/menu/Welcome.cgi'),
  moriguchi: () => pf489('https://www4.pf489.com/moriguchi/mobile/'),
  neyagawa: () => pf489('https://www4.pf489.com/Neyagawa/mobile/'),
};
if (!SITES[which]) { console.log(`使い方: node tools/purposes.mjs ${Object.keys(SITES).join('|')}`); process.exit(1); }
try { await SITES[which](); } finally { await save(); }
