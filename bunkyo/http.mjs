// 文の京 施設予約ねっと（文京区）を、ブラウザを使わずに読む
//   画面の裏でやりとりしているデータを直接読む。見るのは「練習日・検索日」の1日分ずつだけ（1か月分の表は読まない）
//   流れ：Home → 利用目的で検索 → 施設を選ぶ → 日ごとの空き（1日表示）→ 空いている部屋だけ「時間帯別空き状況」
import * as L from '../lib.mjs';

const BASE = 'https://www.shisetsu.city.bunkyo.lg.jp/user/';
const DEBUG = process.env.DEBUG === '1';
let bytes = 0;

export class Site {
  constructor() { this.jar = new Map(); this.token = null; }
  cookie() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
  async req(path, form = null) {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(new URL(path, BASE), {
          method: form ? 'POST' : 'GET',
          headers: { Cookie: this.cookie(), 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ja', ...(form ? { 'X-Requested-With': 'XMLHttpRequest' } : {}) },
          body: form || undefined,
          redirect: 'manual',
          signal: AbortSignal.timeout(180000),
        });
        for (const c of r.headers.getSetCookie?.() || []) { const kv = c.split(';')[0]; const k = kv.indexOf('='); this.jar.set(kv.slice(0, k).trim(), kv.slice(k + 1)); }
        const text = await r.text();
        bytes += text.length;
        if (r.status >= 300 && r.status < 400) return this.req(r.headers.get('location'));
        if (!r.ok) throw new Error(`${path} が ${r.status}`);
        const tk = text.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
        if (tk) this.token = tk[1];
        if (/\/Error/.test(r.url) || /<title>[^<]*エラー/.test(text)) throw new Error(`${path} でエラー画面`);
        return text;
      } catch (e) {
        if (i === 2) throw e;
        await new Promise((x) => setTimeout(x, 5000 * (i + 1)));
      }
    }
  }
  form(fields) {
    const f = new FormData();
    for (const [k, v] of fields) f.append(k, v == null ? '' : String(v));
    f.append('__RequestVerificationToken', this.token || '');
    return f;
  }
}
const dec = (s) => s.replace(/&#x([0-9A-F]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');

// 利用目的で検索して、施設を選び、日ごとの空き状況の画面まで
export async function open(site, purpose, facilities) {
  await site.req('Home');
  await site.req('Home/SearchByPurpose', site.form([
    ['HomeModel.SelectedPlaceClassCategory', '1'], ['HomeModel.CapacityFromByPlaceClass', ''], ['HomeModel.CapacityToByPlaceClass', ''],
    ['HomeModel.SelectedPurposeCategory', purpose.categoryCode], ['HomeModel.SelectedPurpose', purpose.useCode],
    ['HomeModel.CapacityFromByPurpose', ''], ['HomeModel.CapacityToByPurpose', ''], ['SelectedLanguageCode', '0'],
  ]));
  const html = await site.req('AvailabilityCheckApplySelectFacility');
  const hidden = [...html.matchAll(/<input type="hidden" name="(SelectFacilities\.Facilities\[\d+\]\.SelectedFacility\.(?:Value|Text))" value="([^"]*)"/g)].map((m) => [m[1], dec(m[2])]);
  const list = [];
  for (let i = 0; i < hidden.length; i += 2) if (/Value$/.test(hidden[i][0])) list.push({ value: hidden[i][1], name: hidden[i + 1]?.[1] });
  const want = new Set(facilities.map(L.norm));
  const picked = list.filter((f) => want.has(L.norm(f.name)));
  if (!picked.length) throw new Error(`施設の一覧が読めません（${list.length}件）`);
  const missing = facilities.filter((n) => !list.some((f) => L.norm(f.name) === L.norm(n)));
  if (missing.length) console.warn(`⚠ 一覧に見つからなかった施設: ${missing.join('、')}`);
  await site.req('AvailabilityCheckApplySelectFacility/Next', site.form([...hidden, ...picked.map((f, i) => [`SelectFacilities.Selected[${i}]`, f.value])]));
  await site.req('AvailabilityCheckApplySelectDays');
  return picked.map((f) => f.name);
}

const cond = (date) => [['SearchCondition.StartDate', date], ['SearchCondition.DisplayTerm', '1'], ['SearchCondition.DisplayCalendar', '0'], ['SearchCondition.TimeZone', '2147483647']];

// 1日分の空き状況 → [{ facility, facilityCode, room, cap, status, row, cell }]
export async function day(site, date) {
  const txt = await site.req('AvailabilityCheckApplySelectDays/SearchCondition', site.form(cond(date)));
  let j;
  try { j = JSON.parse(txt); } catch { throw new Error('日ごとの空き状況が読めません'); }
  const model = (Array.isArray(j) ? j.find((x) => x?.AvailabilitySelectDays) : j)?.AvailabilitySelectDays;
  if (!model) throw new Error(`日ごとの空き状況が空です（${String(txt).slice(0, 120)}）`);
  const out = [];
  for (const f of model) for (const row of f.Rows || []) for (const cell of row.Cells || []) {
    if (cell.UseDate?.slice(0, 10) !== date) continue;
    out.push({ facility: f.FacilityName, facilityCode: f.FacilityCode, room: (row.ObjectName || '').trim(), desc: row.ObjectDescription || '', cap: row.Capacity || null, status: cell.Status, row, cell });
  }
  return { cells: out, model };
}

// 選んだ部屋（同じ日）の時間帯別空き状況 → [{ facility, room, cap, date, time, status }]
export async function times(site, date, picks) {
  const fields = [...cond(date)];
  const byFac = new Map();
  for (const p of picks) { if (!byFac.has(p.facilityCode)) byFac.set(p.facilityCode, []); byFac.get(p.facilityCode).push(p); }
  let fi = 0;
  for (const [code, ps] of byFac) {
    const a = `AvailabilitySelectDays[${fi++}]`;
    fields.push([`${a}.FacilityCode`, code], [`${a}.FacilityName`, ps[0].facility]);
    ps.forEach((p, ri) => {
      const r = `${a}.Rows[${ri}]`;
      fields.push([`${r}.FacilityCode`, p.row.FacilityCode], [`${r}.DisplayGroupCode`, p.row.DisplayGroupCode], [`${r}.ObjectName`, p.row.ObjectName], [`${r}.Capacity`, p.row.Capacity ?? '']);
      (p.row.ObjectCodeList || []).forEach((o, k) => fields.push([`${r}.ObjectCodeList[${k}]`, o]));
      const c = `${r}.Cells[0]`;
      fields.push([`${c}.IsChecked`, 'true'], [`${c}.FacilityCode`, p.cell.FacilityCode], [`${c}.DisplayGroupCode`, p.cell.DisplayGroupCode], [`${c}.UseDate`, p.cell.UseDate],
        [`${c}.Status`, p.cell.Status], [`${c}.ClosedDateName`, p.cell.ClosedDateName || ''], [`${c}.Disabled`, p.cell.Disabled ? 'True' : 'False']);
      (p.cell.ObjectCode || []).forEach((o, k) => fields.push([`${c}.ObjectCode[${k}]`, o]));
    });
  }
  await site.req('AvailabilityCheckApplySelectDays/Next', site.form(fields));
  const html = await site.req('AvailabilityCheckApplySelectTime');
  const m = html.match(/model: JSON\.parse\("((?:[^"\\]|\\.)*)"\)/);
  if (!m) throw new Error('時間帯別空き状況が読めません');
  const d = JSON.parse(JSON.parse(`"${m[1]}"`));
  const hm = (n) => { const v = Math.round(Number(n)); return `${Math.floor(v / 100)}:${String(v % 100).padStart(2, '0')}`; };
  const out = [];
  for (const f of d.AvailabilityTime?.FacilityList || []) for (const t of f.Tables || []) for (const p of t.Places || []) for (const c of p.Cells || []) {
    out.push({ facility: f.FacilityName, room: (p.ObjectName || '').trim(), cap: p.Capacity || null, date: t.UseDate.slice(0, 10), time: [L.norm(c.FrameName || ''), `${hm(c.TimeFrom)}〜${hm(c.TimeTo)}`].filter(Boolean).join(' '), status: c.Status });
  }
  // 次の日を見るために、日ごとの空き状況の画面に戻る
  await site.req('AvailabilityCheckApplySelectDays');
  return out;
}

export const used = () => bytes;
