const RELAY = 'https://jskulzunyckseeokgzax.supabase.co/functions/v1/jp-relay';
for (const v of ['2', '4', '7', '8', '11']) {
  const steps = [{ get: 'gin_menu' }, { submit: [], form: 'gin_init' }, { submit: [], form: 'gin_z_dest_sel' }, { submit: [['riyosmk', v]], form: 'gin_z_amenity_sel', replace: true }];
  const r = await fetch(RELAY, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-region': 'ap-northeast-1' }, body: JSON.stringify({ secret: process.env.YANAGIBA_SECRET, base: 'https://yoyaku.saf-ticket.jp/cultos/reserve/', enc: 'utf8', steps }) });
  const j = await r.json();
  const h = j.pages?.at(-1)?.body || '';
  console.log('SAFP', v, [...h.matchAll(/onClicks\('\d+'\)"[^>]*title="([^"]+)"/g)].map((m) => m[1]).join('、'));
}
