// 守口市・寝屋川市（www4.pf489.com の携帯版）の空き監視 → YANAGIBA・LINE通知
//   サイトは日本の外からのアクセスを受け付けないので、YANAGIBA の中継（jp-relay・東京）を通して開く
//   サイトは画面のつながりを1回の中継の中でしか保てないので、手順をまとめて送り、1回で最後までたどる
//   使用目的「ダンス」で検索して出てくる施設・部屋だけを見る（サイトがダンスに使えるとしている部屋）
//   node pf489/watch.mjs [moriguchi|neyagawa]   … 指定がなければ両方
//   DEBUG=1 で読み取った中身をログに出す
import fs from 'node:fs/promises';
import * as L from '../lib.mjs';
import * as Y from '../yanagiba.mjs';

const config = JSON.parse(await fs.readFile(new URL('./config.json', import.meta.url), 'utf8'));
const ROOMS = JSON.parse(await fs.readFile(new URL('./rooms.json', import.meta.url), 'utf8'));
const RELAY = 'https://jskulzunyckseeokgzax.supabase.co/functions/v1/jp-relay';
const SECRET = process.env.YANAGIBA_SECRET;
const DEBUG = process.env.DEBUG === '1';
const BASE = '大阪';
const only = process.argv[2];

async function line(text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const to = process.env.LINE_USER_ID;
  if (!token || !to) { console.log(`[LINE未設定のため表示のみ]\n${text}`); return; }
  const r = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages: [{ type: 'text', text: text.slice(0, 4990) }] }),
  });
  if (!r.ok) throw new Error(`LINE送信に失敗 ${r.status}: ${await r.text()}`);
}
const stateFile = (k) => `state-${k}/state.json`;
async function loadState(k) { try { return JSON.parse(await fs.readFile(stateFile(k), 'utf8')); } catch { return { notified: [] }; } }
async function saveState(k, s) { await fs.mkdir(`state-${k}`, { recursive: true }); await fs.writeFile(stateFile(k), JSON.stringify(s, null, 2)); }

// 中継に手順を送る → 画面の一覧 [{ url, status, body? }]
async function relay(base, steps) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(RELAY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-region': 'ap-northeast-1' },
        body: JSON.stringify({ secret: SECRET, base, steps }),
        signal: AbortSignal.timeout(140000),
      });
      const j = await r.json().catch(async () => ({ error: `${r.status}` }));
      if (r.ok && !j.error) return j.pages;
      last = new Error(`中継でエラー（${j.error || r.status}）`);
    } catch (e) { last = e; }
    await new Promise((x) => setTimeout(x, 5000));
  }
  throw last;
}

const text = (h) => (h || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
const ymd8 = (d) => d.replace(/-/g, '');
// 使用目的で検索して、施設選択の画面まで
const prefix = (s) => [
  { get: 'Wm_TopMenu.aspx' },
  { get: 'Wm_ShisetsuKensaku.aspx?ActiveForm=Purpose' },
  { submit: [['slPurpose1', s.cat], ['cmdSelect2', '選択']] },
  { submit: [['slPurpose1', s.cat], ['slPurpose2', s.purpose], ['cmdNext4', '[6]検索']] },
  { get: 'Wm_ShisetsuSentaku.aspx?SearchRoute=Purpose' },
];
const pickFacility = (idx, date) => {
  const [y, m, d] = date.split('-').map(Number);
  return [
    { submit: [['txtNen$txt', String(y)], ['txtTsuki$txt', String(m)], ['txtHi$txt', String(d)], ['slShisetsu', String(idx)], ['cmdNext', '[6]次へ']] },
    { get: 'Wm_ShitsujouSentaku.aspx' }, // 施設からのお知らせの画面をとばして、部屋の一覧へ
  ];
};
// 施設選択の画面 → [{ idx, name }]
const facilitiesOf = (body) => [...(body || '').matchAll(/name="slShisetsu" value="(\d+)">([^<]+)/g)].map((m) => ({ idx: m[1], name: L.norm(m[2]) }));
// 部屋の一覧の画面 → [{ code, name, mark }]
const roomsOf = (body) => [...(body || '').matchAll(/Wm_JikanSentaku\.aspx\?SJCode=(\w+)&(?:amp;)?UseDate=\d+"[^>]*>([^<]+)</g)].map((m) => {
  // 「・ (△)会議室１」「・ (&#215;)剣道場」「・ (休館日)大体育室」→ 部屋の名前と、その日の印
  const t = L.norm(text(m[2]).replace(/&#215;/g, '×')).replace(/^・/, '');
  const mk = (t.match(/^\(([^)]*)\)/) || [])[1] || '';
  return { code: m[1], name: t.replace(/^\([^)]*\)/, '').trim(), mark: mk };
});
// 時間を選ぶ画面 → 空いている時間 ["9:00〜9:30", …]（抽選の受付中は先着で取れないので数えない）
function timesOf(body) {
  const b = body || '';
  if (/抽選/.test(text(b)) && !/予約申込ができます/.test(b)) return [];
  return [...b.matchAll(/name="slTime" value="\d+">\s*(\d{1,2}:\d{2})\s*[～~〜-]\s*(\d{1,2}:\d{2})/g)].map((m) => `${m[1]}〜${m[2]}`);
}
// 「面」の選択肢（全面以外）→ [{ v, label, part(全面に対する広さの割合) }]
function menOf(body) {
  const sel = (body || '').match(/<select name="slMen">([\s\S]*?)<\/select>/);
  if (!sel) return [];
  return [...sel[1].matchAll(/<option value="(\d+)"[^>]*>([^<]+)/g)].map((m) => ({ v: m[1], label: L.norm(m[2]).trim() }))
    .filter((m) => m.v !== '0' && !/全面/.test(m.label))
    .map((m) => { const f = m.label.match(/(\d)\/(\d)/); return { ...m, part: f ? Number(f[1]) / Number(f[2]) : 0.5 }; });
}
// 続いている30分ごとのコマをつなげる
function joinSlots(ts) {
  const toM = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const fm = (n) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  const rs = ts.map((t) => t.split('〜').map(toM)).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of rs) { const p = out.at(-1); if (p && r[0] <= p[1]) p[1] = Math.max(p[1], r[1]); else out.push([...r]); }
  return out.map(([a, b]) => `${fm(a)}〜${fm(b)}`);
}
const areaOf = (fac, room) => {
  const k = Object.keys(ROOMS).find((x) => x !== '_説明' && L.norm(x) === L.norm(`${fac} ${room}`));
  return k ? ROOMS[k] : null;
};

// 施設・部屋の一覧はめったに変わらないので、1週間覚えておく（中継に問い合わせる回数を半分以下に）
const LIST_DAYS = 7;
async function loadLists(k) { try { return JSON.parse(await fs.readFile(`state-${k}/lists.json`, 'utf8')); } catch { return {}; } }
async function saveLists(k, x) { await fs.mkdir(`state-${k}`, { recursive: true }); await fs.writeFile(`state-${k}/lists.json`, JSON.stringify(x)); }
const fresh = (x) => x?.at && Date.now() - Date.parse(x.at) < LIST_DAYS * 86400e3;

async function scanCity(city, dates, G, refresh = false) {
  const out = [];
  const seen = new Set();
  const log = [];
  const lists = refresh ? {} : await loadLists(city.key);
  const want = (area, d) => (G.dates.has(d) && (area == null || Y.bigEnough(area, d, null, BASE))) || (G.sdates.has(d) && Y.searchHit(G, d, area, null));
  for (const s of city.searches) {
    const pre = prefix(s);
    const sk = `${s.cat}-${s.purpose}`;
    let facs = fresh(lists[sk]) ? lists[sk].facs : null;
    if (!facs) {
      const p0 = await relay(city.base, pre);
      facs = facilitiesOf(p0.at(-1)?.body);
      if (!facs.length) throw new Error(`施設の一覧が出ません（${s.label}）`);
      lists[sk] = { at: new Date().toISOString(), facs };
    }
    console.log(`【${city.name} ${s.label}】${facs.map((f) => f.name).join('・')}`);
    for (const f of facs) {
      const rk = `${sk}|${f.idx}|${f.name}`;
      let rooms = fresh(lists[rk]) ? lists[rk].rooms : null;
      if (!rooms) {
        const p1 = await relay(city.base, [...pre, ...pickFacility(f.idx, dates[0])]);
        rooms = roomsOf(p1.at(-1)?.body);
        lists[rk] = { at: new Date().toISOString(), rooms };
      }
      const targets = [];
      for (const r of rooms) {
        if (L.badRoom(r.name) || (config.excludeRoomWords || []).some((w) => r.name.includes(L.norm(w)))) continue;
        const area = areaOf(f.name, r.name);
        log.push(`${f.name} ${r.name}（${area ?? '広さ不明'}）\t${s.label}`);
        for (const d of dates) if (want(area, d) && !seen.has(`${f.name}|${r.name}|${d}`)) targets.push({ r, d, area });
      }
      if (!targets.length) continue;
      // 1回の中継で開く画面は40までにする（多いときは分ける）
      for (let i = 0; i < targets.length; i += 40) {
        const part = targets.slice(i, i + 40);
        const root = new URL(city.base).pathname;
        const p2 = await relay(city.base, [...pre, ...pickFacility(f.idx, dates[0]), ...part.map((t) => ({ get: `${root}Wm_JikanSentaku.aspx?SJCode=${t.r.code}&UseDate=${ymd8(t.d)}`, keep: true }))]);
        const pages = p2.slice(-part.length);
        // 覚えていた一覧がずれている（時間の画面が出ない）ときは、一覧を読み直してもう一度
        if (!refresh && pages.every((pg) => !/JikanSentaku/.test(pg?.body || ''))) throw Object.assign(new Error('一覧が古いようです'), { stale: true });
        const halves = [];
        part.forEach((t, j) => {
          seen.add(`${f.name}|${t.r.name}|${t.d}`);
          for (const time of joinSlots(timesOf(pages[j]?.body))) {
            out.push({ date: t.d, facility: f.name, room: t.r.name, area: t.area, cap: null, time, place: `${f.name} ${t.r.name}`, url: city.top });
          }
          // 体育室など「面」を分けて貸す部屋は、全面だけでなく半面などの空きも見る（広さは面の分だけ小さくする）
          const men = menOf(pages[j]?.body);
          if (men.length) halves.push({ ...t, men });
        });
        for (const h of halves) {
          const steps = [...pre, ...pickFacility(f.idx, dates[0]), { get: `${root}Wm_JikanSentaku.aspx?SJCode=${h.r.code}&UseDate=${ymd8(h.d)}` },
            ...h.men.map((m) => ({ submit: [['slMen', m.v], ['cmdChangeMen', '切替']], keep: true }))];
          const pm = (await relay(city.base, steps)).slice(-h.men.length);
          h.men.forEach((m, j) => {
            const area = h.area != null ? Math.round(h.area * m.part) : null;
            if (!want(area, h.d)) return;
            for (const time of joinSlots(timesOf(pm[j]?.body))) {
              out.push({ date: h.d, facility: f.name, room: `${h.r.name}（${m.label}）`, area, cap: null, time, place: `${f.name} ${h.r.name}（${m.label}）`, url: city.top });
            }
          });
        }
      }
    }
  }
  await saveLists(city.key, lists);
  if (DEBUG) console.log(`--- 見た部屋（ダンスで使える部屋）---\n${[...new Set(log)].join('\n')}`);
  return out.map((s) => ({ ...s, usual: G.dates.has(s.date) && (s.area == null || Y.bigEnough(s.area, s.date, null, BASE)) }));
}

function buildMessage(name, slots, title = `🎉 ${name}に空きが出ました`) {
  const byDate = new Map();
  for (const s of slots) {
    const k = `${s.place}（${s.area ? `${Math.round(s.area)}㎡` : '広さ不明'}）`;
    if (!byDate.has(s.date)) byDate.set(s.date, new Map());
    const m = byDate.get(s.date);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(s.time);
  }
  const lines = [title];
  for (const date of [...byDate.keys()].sort()) {
    lines.push('', `📅 ${L.label(date)}`);
    for (const [room, times] of byDate.get(date)) lines.push(`・${room}`, `  ${L.joinTimes(times)}`);
  }
  lines.push('', `予約: ${slots[0]?.url || ''}`);
  return lines.join('\n');
}

async function runCity(city) {
  const today = L.jstToday();
  const G = await Y.load(config.watch, today, city.name);
  const dates = [...new Set([...G.dates, ...G.sdates])].sort();
  if (!dates.length) { console.log(`${city.name}: 見張る日付がありません`); return; }
  console.log(`${city.name} 見張る日付: ${dates.map(L.label).join(' ')}`);
  const state = await loadState(city.key);
  let placed;
  try {
    placed = await scanCity(city, dates, G).catch((e) => {
      if (!e.stale) throw e;
      console.log('施設・部屋の一覧を読み直します');
      return scanCity(city, dates, G, true);
    });
  } catch (e) {
    console.error(`❌ ${city.name}: ${e.message}`);
    const fails = (state.fails || 0) + 1;
    const last = state.lastErrorAt ? Date.parse(state.lastErrorAt) : 0;
    if (fails >= 2 && Date.now() - last > 12 * 3600e3) {
      await line(`⚠️ ${city.name} 空き監視でエラー\n${e.message.slice(0, 300)}\n（12時間に1回だけお知らせします）`).catch(() => {});
      await saveState(city.key, { ...state, lastErrorAt: new Date().toISOString(), fails });
    } else await saveState(city.key, { ...state, fails });
    process.exitCode = 1;
    return;
  }
  await Y.report(G, { site: city.key, ward: city.name, url: city.top, stateDir: `state-${city.key}` }, placed);
  const open = placed.filter((s) => Y.lineOk(s, G, city.name, placed));
  const key = (s) => `${s.date}|${s.place}|${s.time}`;
  const first = !state.notified.length && !state.lastErrorAt && !state.started;
  const seen = new Set(first ? open.map(key) : state.notified);
  const fresh = open.filter((s) => !seen.has(key(s)));
  console.log(`${city.name}: 空き ${placed.length}件（LINEの対象 ${open.length}・新しい分 ${fresh.length}）${first ? '・初回のため記録だけ' : ''}`);
  if (DEBUG && placed.length) console.log(buildMessage(city.name, placed, '（プレビュー）'));
  if (process.env.NOTIFY_ALL === '1') await line(open.length ? buildMessage(city.name, open, `📋 ${city.name}の今の空き状況`) : `📋 ${city.name}: 今は条件に合う空きがありません`);
  else if (fresh.length) await line(buildMessage(city.name, L.widen(fresh, placed)));
  await saveState(city.key, { notified: open.map(key), lastErrorAt: state.lastErrorAt, started: true });
}

if (process.env.TEST_NOTIFY === '1') await line('✅ 守口市・寝屋川市 空き監視のテスト通知です');
else {
  const h = L.jstHour();
  const q = config.quietHours;
  if (q && h >= q.from && h < q.to && process.env.FORCE !== '1') console.log('深夜のためお休み');
  else for (const c of config.cities) if (!only || only === c.key) await runCity(c);
}
