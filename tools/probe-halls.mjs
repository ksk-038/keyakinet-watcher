const H = await import('../bunkyo/http.mjs');
const site = new H.Site('https://www.shisetsu.city.yokohama.lg.jp/user/');
await site.req('Home');
await site.req('Home/SearchByPurpose', site.form([['HomeModel.SelectedPlaceClassCategory', '1'], ['HomeModel.CapacityFromByPlaceClass', ''], ['HomeModel.CapacityToByPlaceClass', ''], ['HomeModel.SelectedPurposeCategory', '2'], ['HomeModel.SelectedPurpose', '107'], ['HomeModel.CapacityFromByPurpose', ''], ['HomeModel.CapacityToByPurpose', ''], ['SelectedLanguageCode', '0']]));
const html = await site.req('AvailabilityCheckApplySelectFacility');
const hidden = [...html.matchAll(/<input type="hidden"[^>]*?name="(SelectFacilities\.Facilities\[(\d+)\]\.SelectedFacility\.(?:Value|Text))"[^>]*?value="([^"]*)"/g)].map((m) => [m[1], m[3], m[2]]);
const v = hidden.find((h) => /Text$/.test(h[0]) && /関内ホール/.test(h[1].replace(/&#x([0-9A-F]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16)))));
const val = hidden.find((h) => h[2] === v[2] && /Value$/.test(h[0]))[1];
await site.req('AvailabilityCheckApplySelectFacility/Next', site.form([...hidden.map(([k, x]) => [k, x]), [`SelectFacilities.Facilities[${v[2]}].IsChecked`, 'true'], ['SelectFacilities.Selected[0]', val]]));
await site.req('AvailabilityCheckApplySelectDays');
const terms = []; ['1日', '1週間', '2週間', '1ヶ月'].forEach((t, i) => terms.push([`SearchCondition.DisplayTermList[${i}].Value`, i + 1], [`SearchCondition.DisplayTermList[${i}].Text`, t]));
for (const d of ['2026-12-05', '2027-11-27']) {
  const t = await site.req('AvailabilityCheckApplySelectDays/ChangePeriod', site.form([['SearchCondition.StartDate', d], ['SearchCondition.DisplayTerm', '2'], ['SearchCondition.DisplayCalendar', '0'], ['SearchCondition.TimeZone', '0'], ...terms]));
  const j = JSON.parse(t);
  const hz = j?.[0]?.Horizontal?.[0];
  console.log('YKJ', d, Object.keys(hz || {}).join(','));
  console.log('YKJ2', JSON.stringify(hz).replace(/"FacilityNewsList":\[[^\]]*\],/, '').slice(0, 2500));
}
