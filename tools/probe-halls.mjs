process.env.DEBUG = '1';
const { READERS } = await import('../halls/watch.mjs');
const cfg = JSON.parse((await import('node:fs')).readFileSync('halls/config.json', 'utf8'));
const hall = cfg.halls.find((h) => h.city === '横浜市');
for (const ds of [['2027-01-09'], ['2027-06-05'], ['2027-10-02']]) {
  try { console.log('YKR', ds, JSON.stringify(await READERS.oec(hall, ds))); } catch (e) { console.log('YKR ERR', ds, e.message.slice(0, 200)); }
}
