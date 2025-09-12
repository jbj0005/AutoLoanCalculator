(function(){
  if (window.__locationHooksLoaded) return; window.__locationHooksLoaded = true;

  window.geocode = async (addr) => {
    if (!addr) return { lat: NaN, lon: NaN, address: "" };
    const u = new URL("https://nominatim.openstreetmap.org/search");
    u.searchParams.set("q", addr);
    u.searchParams.set("format", "json");
    u.searchParams.set("addressdetails", "1");
    u.searchParams.set("limit", "1");
    const res = await fetch(u.toString(), { headers: { "Accept":"application/json" }});
    const list = await res.json();
    const hit = list?.[0];
    if (!hit) return { lat: NaN, lon: NaN, address: addr };
    return { lat: +hit.lat, lon: +hit.lon, address: hit.display_name, _addr: hit.address };
  };

  window.fetchActiveTaxes = async ({ countyName, stateNameOrCode, purchaseDate=new Date() }) => {
    const sb = window.supabase;
    if (!sb) throw new Error("Supabase client not found. Ensure config.js loads before location-hooks.js");

    let stCode = stateNameOrCode;
    if (!stCode || String(stCode).length !== 2) {
      const { data: st } = await sb.from('states').select('code').ilike('name', stateNameOrCode).maybeSingle();
      stCode = st?.code || stateNameOrCode;
    }
    const { data: state }  = await sb.from('states').select('base_state_tax_rate').eq('code', stCode).maybeSingle();
    const { data: county } = await sb.from('counties').select('county_tax_cap')
                               .eq('state_code', stCode).ilike('county_name', countyName).maybeSingle();
    const { data: countyRate } = await sb.rpc('county_surtax_on', {
      p_state: stCode,
      p_county: countyName,
      p_on: new Date(purchaseDate).toISOString().slice(0,10)
    });

    return {
      stateRate: Number(state?.base_state_tax_rate ?? 0),
      countyRate: Number(countyRate ?? 0),
      countyCap: Number(county?.county_tax_cap ?? 0)
    };
  };

  async function onUseAddress(){
    const input = document.getElementById('homeAddress');
    if (!input) return;
    const g = await window.geocode(input.value);
    const county = (g._addr?.county || '').replace(/ County$/i,'').trim();
    const state  = g._addr?.state_code || g._addr?.state || '';
    if (!county || !state) return;
    const t = await window.fetchActiveTaxes({ countyName: county, stateNameOrCode: state });
    window.state = window.state || {};
    window.state.countyRates = { meta: { stateRate: t.stateRate, countyCap: t.countyCap } };
    window.state.dbLocationGeo = { county: `${county}, ${state}` };
    if (typeof window.computeAll === 'function') window.computeAll();
  }

  window.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('homeAddress');
    if (!input) return;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); onUseAddress(); }});
  });
})();
