// 守口市・寝屋川市の予約サイト（www4.pf489.com の携帯版）を、日本の中継（YANAGIBA の jp-relay）を通して開く
//   サイトは日本の外からのアクセスを受け付けないため、GitHub（アメリカ）から直接は開けない
const RELAY = 'https://jskulzunyckseeokgzax.supabase.co/functions/v1/jp-relay';
const SECRET = process.env.YANAGIBA_SECRET;

export class Site {
  constructor(base) {
    this.base = base; // 例: https://www4.pf489.com/moriguchi/mobile/
    this.jar = new Map();
    this.page = null; // { url, body }
  }
  cookie() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
  async req(url, body = null) {
    const abs = new URL(url, this.page?.url || this.base).href;
    for (let hop = 0; hop < 5; hop++) {
      let r;
      for (let i = 0; i < 3; i++) {
        r = await fetch(RELAY, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-region': 'ap-northeast-1' },
          body: JSON.stringify({ secret: SECRET, url: hop ? r0 : abs, method: body && !hop ? 'POST' : 'GET', body: hop ? null : body, headers: { Cookie: this.cookie(), ...(body && !hop ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), Referer: this.page?.url || this.base } }),
        }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }));
        if (r.ok) break;
        await new Promise((x) => setTimeout(x, 3000));
      }
      if (!r.ok) throw new Error(`中継でエラー ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = await r.json();
      if (j.error) throw new Error(`中継でエラー: ${j.error}`);
      for (const c of j.cookies || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); this.jar.set(kv.slice(0, i).trim(), kv.slice(i + 1)); }
      if (j.status >= 300 && j.status < 400 && j.location) { var r0 = new URL(j.location, hop ? r0 : abs).href; continue; }
      this.page = { url: hop ? r0 : abs, body: j.body };
      return this.page;
    }
    throw new Error('転送が多すぎます');
  }
  // 今の画面のフォームの値（hidden など）
  fields() {
    const b = this.page.body;
    const f = {};
    for (const m of b.matchAll(/<input[^>]*type="hidden"[^>]*>/gi)) {
      const n = (m[0].match(/name="([^"]+)"/) || [])[1];
      const v = (m[0].match(/value="([^"]*)"/) || [])[1] ?? '';
      if (n) f[n] = v.replace(/&amp;/g, '&');
    }
    return f;
  }
  action() { return ((this.page.body.match(/<form[^>]*action="([^"]+)"/i) || [])[1] || '').replace(/&amp;/g, '&'); }
  // フォームを送る。extra は [名前, 値] の並び（同じ名前を何回でも）
  async submit(extra) {
    const p = new URLSearchParams(this.fields());
    for (const [k, v] of extra) p.append(k, v);
    return this.req(this.action(), p.toString());
  }
  text() {
    return this.page.body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim();
  }
}
