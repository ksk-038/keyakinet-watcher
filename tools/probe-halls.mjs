const RELAY = 'https://jskulzunyckseeokgzax.supabase.co/functions/v1/jp-relay';
const r = await fetch(RELAY, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-region': 'ap-northeast-1' }, body: JSON.stringify({ secret: process.env.YANAGIBA_SECRET, base: 'https://k5.p-kashikan.jp/tachikawa-city/', enc: 'utf8', steps: [{ get: 'Top' }, { post: 'SrchSst', data: 'op=SrchSst&UseYM=202711&UseDay=27&UseDate=20271127&ShisetsuCode=003', keep: true }] }) });
const j = await r.json();
const last = j.pages?.at(-1); console.log('KEYS', typeof last, last && Object.keys(last)); const h = typeof last === 'string' ? last : (last?.html || last?.body || last?.text || JSON.stringify(j).slice(0, 800));
const t = h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
console.log('LEN', h.length);
for (const m of t.matchAll(/.{0,120}[●×○△－].{0,120}/g)) console.log('CTX', m[0]);
const i = h.indexOf('大ホール'); console.log('CELL', h.slice(i - 200, i + 1800).replace(/\s+/g, ' '));
