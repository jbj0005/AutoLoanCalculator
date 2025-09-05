/* Auto Loan Calculator - Mobile-Friendly, GitHub Pages ready
 * Core logic and lightweight UI wiring
 */

// --- Configuration / Defaults ---
const HOME_ADDRESS_DEFAULT = ""; // no personal default; user can set ZIP or address
const COUNTY_DATA_URL = "data/county_tax_fl.json";

// --- Global State ---
const state = {
  countyRates: null,
  homeAddress: null,
  homeCoords: null,
  homeZip: null,
  homeCity: null,
  vehicleCoords: null,
  vehicleCounty: null,
  vehicleZip: null,
  vehicleCity: null,
  countyRateUsed: null,
  supabase: null,
  selectedVehicle: null,
  dbLocationGeo: null,
  pendingRatesImport: null,
  pendingHomeGeo: null
};

// --- DOM Helpers ---
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const messagesEl = () => document.getElementById('calcMessages');

// Toggle placeholder styling on computed display elements
function setReadyPlaceholder(el, isPlaceholder){
  if (!el) return;
  el.classList.toggle('placeholder', !!isPlaceholder);
  if (isPlaceholder){
    const txt = (el.textContent || '').trim();
    if (!txt){ el.textContent = '- -'; }
  }
}

// Debounce helper
function debounce(fn, ms){
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function setSupabaseStatus(text, cls = 'warn'){
  const el = document.getElementById('supabase-status');
  if(!el) return;
  el.textContent = text;
  el.classList.remove('ok','warn','err');
  el.classList.add(cls);
}

// --- Formatting Helpers ---
const currencyFmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });
const numberFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const numberFmt4 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });

function formatCurrency(n){
  if (isNaN(n) || n === null) return '$0.00';
  return currencyFmt.format(n);
}
function parseCurrency(s){
  if (typeof s === 'number') return s;
  if (!s) return 0;
  // Remove anything not number, minus or dot
  const v = parseFloat(String(s).replace(/[^0-9.-]/g, ''));
  return isNaN(v) ? 0 : v;
}
function formatPercent(p){
  if (isNaN(p)) return '—';
  return `${numberFmt.format(p)}%`;
}
function parsePercent(s){
  if (typeof s === 'number') return s;
  if (!s) return 0;
  const v = parseFloat(String(s).replace(/[^0-9.-]/g, ''));
  return isNaN(v) ? 0 : v;
}

function normalizeLocationFromGeo(geo){
  if (!geo) return '';
  const zipOut = geo.zip || '';
  const st = geo.state_code || (geo.state && /florida/i.test(geo.state) ? 'FL' : null);
  const parts = [];
  if (geo.city) parts.push(geo.city);
  const tail = [st, zipOut].filter(Boolean).join(' ');
  if (tail) parts.push(tail);
  return parts.join(', ').trim();
}

// Parse price expressions for Final Sale Price, supporting formulas like:
// - "MSRP - 7500"
// - "82000 - 6%"
// - "MSRP - 6%" or "82000 * 0.94"
// Falls back to currency parsing if expression is not recognized.
function parsePriceExpression(input, msrp){
  if (!input) return 0;
  const s = String(input).trim();
  if (!s) return 0;
  const MSRP_VAL = Number(msrp) || 0;

  // Pattern: <base> (+|-) <percent>%
  const mPct = s.match(/^\s*(msrp|[\d$,\.]+)\s*([+\-])\s*([\d.]+)\s*%\s*$/i);
  if (mPct){
    const baseStr = mPct[1];
    const op = mPct[2];
    const pct = parseFloat(mPct[3]);
    const base = /msrp/i.test(baseStr) ? MSRP_VAL : parseCurrency(baseStr);
    if (!isNaN(base) && !isNaN(pct)){
      const delta = base * (pct/100);
      return op === '+' ? (base + delta) : (base - delta);
    }
  }

  // Replace MSRP token, strip $ and commas
  let expr = s.replace(/msrp/gi, String(MSRP_VAL)).replace(/[$,]/g, '');
  // Allow only safe arithmetic characters
  if (/^[0-9+\-*/().\s]+$/.test(expr)){
    try {
      // eslint-disable-next-line no-new-func
      const val = Function(`"use strict";return (${expr});`)();
      const num = Number(val);
      if (isFinite(num)) return num;
    } catch {}
  }
  // Fallback to currency parsing
  return parseCurrency(s);
}

// Bind currency inputs to auto-format on blur
function attachCurrencyFormatter(input){
  input.addEventListener('blur', () => {
    const n = parseCurrency(input.value);
    input.value = n ? formatCurrency(n) : '';
    computeAll();
  });
  input.addEventListener('input', () => computeAll());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter'){ e.preventDefault(); input.blur(); } });
}

// --- County rates ---
async function loadCountyRates(){
  try {
    const res = await fetch(COUNTY_DATA_URL);
    const json = await res.json();
    state.countyRates = json;
    localStorage.setItem('countyRates', JSON.stringify(json));
  } catch (e) {
    const cached = localStorage.getItem('countyRates');
    if (cached){
      state.countyRates = JSON.parse(cached);
    } else {
      state.countyRates = { meta: { stateRate: 0.06, countyCap: 5000 }, counties: { DEFAULT: 0.01 } };
    }
  }
}

function getCountyRate(countyName){
  if (!state.countyRates) return { rate: 0.01, defaulted: true };
  const name = (countyName || '').replace(/county$/i,'').trim();
  const { counties } = state.countyRates;
  if (name && counties[name]) return { rate: counties[name], defaulted: false };
  return { rate: counties.DEFAULT ?? 0.01, defaulted: true };
}

// --- Geocoding & Distance ---
// Google Geocoding (REST)
async function geocodeGoogle(query, { biasFL = true } = {}){
  const base = 'https://maps.googleapis.com/maps/api/geocode/json';
  const url = new URL(base);
  url.searchParams.set('address', query);
  url.searchParams.set('key', window.GMAPS_API_KEY);
  const comps = ['country:US'];
  if (biasFL && !/\b[A-Z]{2}\b/i.test(query) && !/Florida/i.test(query)) comps.push('administrative_area:FL');
  url.searchParams.set('components', comps.join('|'));
  const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('Google geocode failed');
  const data = await res.json();
  if (!data.results || !data.results.length) throw new Error('No results');
  const r = data.results[0];
  const get = (type, short=false) => {
    const c = (r.address_components||[]).find(ac => ac.types.includes(type));
    return c ? (short ? c.short_name : c.long_name) : null;
  };
  const city = get('locality') || get('postal_town') || get('sublocality') || get('administrative_area_level_3');
  const county = get('administrative_area_level_2');
  const state_code = get('administrative_area_level_1', true);
  const zip = get('postal_code');
  const loc = r.geometry?.location || {};
  return { lat: Number(loc.lat), lon: Number(loc.lng), city, county, state_code, zip };
}

// Reverse geocode: lat/lon -> city/county/state/zip
async function geocodeGoogleReverse(lat, lon){
  const base = 'https://maps.googleapis.com/maps/api/geocode/json';
  const url = new URL(base);
  url.searchParams.set('latlng', `${lat},${lon}`);
  url.searchParams.set('key', window.GMAPS_API_KEY);
  const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('Google reverse geocode failed');
  const data = await res.json();
  if (!data.results || !data.results.length) throw new Error('No results');
  const r = data.results[0];
  const get = (type, short=false) => {
    const c = (r.address_components||[]).find(ac => ac.types.includes(type));
    return c ? (short ? c.short_name : c.long_name) : null;
  };
  const city = get('locality') || get('postal_town') || get('sublocality') || get('administrative_area_level_3');
  const county = get('administrative_area_level_2');
  const state_code = get('administrative_area_level_1', true);
  const zip = get('postal_code');
  return { city, county, state_code, zip };
}

// (Removed Nominatim implementation — using Google only)

function parseLooseLocation(q){
  const out = { city: null, state_code: null, zip: null, lat: null, lon: null, county: null };
  const zipm = q.match(/\b(\d{5})(?:-\d{4})?\b/);
  if (zipm) out.zip = zipm[1];
  const parts = q.split(',').map(s=>s.trim()).filter(Boolean);
  if (parts.length){ out.city = parts[0]; }
  const st = parts.length>1 ? parts[1] : '';
  const st2 = st.match(/\b([A-Z]{2})\b/i);
  if (st2) out.state_code = st2[1].toUpperCase();
  return out;
}
// Wrapper: use Google only; if missing key, return best-effort parsed location so UI isn't blank
async function geocode(address){
  const q = (address || '').trim();
  if (!q) throw new Error('Empty address');
  // If no key or geocoding disabled, use a best-effort parser (no county)
  if (!window.GMAPS_API_KEY || window.ENABLE_GOOGLE_GEOCODING === false){
    return parseLooseLocation(q);
  }
  try {
    return await geocodeGoogle(q, { biasFL: !/\b[A-Z]{2}\b/i.test(q) && !/Florida/i.test(q) });
  } catch (e) {
    // Fallback to best-effort parse so notes still update even if Google fails/geofenced
    return parseLooseLocation(q);
  }
}

function haversineMi(a, b){
  if (!a || !b) return null;
  const toRad = (d) => d * Math.PI / 180;
  const R = 3958.7613; // miles
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  return R * c;
}

async function ensureHomeCoords(){
  const addr = state.homeAddress || HOME_ADDRESS_DEFAULT;
  if (!addr){
    // No home address set; skip geocoding and keep distance hidden
    return;
  }
  const cached = localStorage.getItem('homeCoords');
  if (cached){
    try { state.homeCoords = JSON.parse(cached); } catch {}
  }
  if (!state.homeCoords){
    try {
      const res = await geocode(addr);
      state.homeCoords = { lat: res.lat, lon: res.lon };
      state.homeZip = res.zip || null;
      state.homeCity = res.city || null;
      localStorage.setItem('homeCoords', JSON.stringify(state.homeCoords));
    } catch(e){
      console.warn('Home geocode failed', e);
    }
  }
  // Try to keep homeZip in sync if missing
  if (addr && (!state.homeZip || !state.homeCity)){
    try { const res = await geocode(addr); state.homeZip = state.homeZip || res.zip || null; state.homeCity = state.homeCity || res.city || null; } catch{}
  }
}

async function updateVehicleGeodata(){
  const loc = (state.selectedVehicle?.location || '').trim();
  if (!loc) { state.vehicleCoords = null; state.vehicleCounty = null; return; }
  try {
    const res = await geocode(loc);
    state.vehicleCoords = { lat: res.lat, lon: res.lon };
    state.vehicleCounty = res.county;
    state.vehicleZip = res.zip || null;
    state.vehicleCity = res.city || null;
  } catch(e){
    // Keep previous values on failure to avoid wiping known data
    console.warn('Vehicle geocode failed; preserving existing geo', e);
  }
}

// --- Supabase ---
function initSupabase(){
  try {
    if (window.SUPABASE_URL && window.SUPABASE_ANON_KEY){
      state.supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
      setSupabaseStatus('Connected', 'ok');
    } else {
      setSupabaseStatus('Supabase not configured', 'warn');
    }
  } catch(e){
    console.warn('Supabase init failed', e);
    setSupabaseStatus('Supabase init failed', 'err');
  }
}

async function loadVehicles(){
  const selectEl = $('#vehicleSelect');
  if (!state.supabase){ selectEl.innerHTML = '<option value="">Select Vehicle</option>'; return; }
  const { data, error } = await state.supabase
    .from('vehicles')
    .select('id,name,msrp,location,latitude,longitude,county')
    .order('name');
  if (error){ console.warn(error); return; }
  selectEl.innerHTML = '<option value="">Select Vehicle</option>' +
    data.map(v => `<option value="${v.id}" data-name="${encodeURIComponent(v.name||'')}" data-msrp="${v.msrp||''}" data-location="${encodeURIComponent(v.location||'')}" data-lat="${v.latitude ?? ''}" data-lon="${v.longitude ?? ''}" data-county="${encodeURIComponent(v.county || '')}">${v.name}</option>`).join('');
}

async function saveVehicle(){
  if (!state.supabase){ alert('Supabase not configured'); return; }
  let selected = $('#vehicleSelect').value || null;
  const name = $('#dbVehicleName').value.trim();
  const msrp = parseCurrency($('#dbMsrp').value);
  const location = $('#dbLocation').value.trim();
  if (!name){ alert('Enter a vehicle name'); return; }
  let geo = state.dbLocationGeo;
  if (!geo && location){
    try { geo = await geocode(location); } catch { geo = null; }
  }
  // Improve geo: if we have coords but missing county, try reverse geocode
  if (geo && (geo.county == null || geo.county === '—') && isFinite(geo.lat) && isFinite(geo.lon) && window.ENABLE_GOOGLE_GEOCODING !== false){
    try { const rev = await geocodeGoogleReverse(geo.lat, geo.lon); geo = { ...geo, county: rev.county || geo.county, state_code: geo.state_code || rev.state_code, zip: geo.zip || rev.zip, city: geo.city || rev.city }; } catch {}
  }
  // Normalize location string if we have structured geo
  let locationNorm = location;
  if (geo){
    const norm = normalizeLocationFromGeo(geo);
    if (norm) locationNorm = norm;
  }

  if (selected){
    const { error } = await state.supabase.from('vehicles')
      .update({ name, msrp, location: locationNorm, latitude: geo?.lat ?? null, longitude: geo?.lon ?? null, county: geo?.county ?? null })
      .eq('id', selected);
    if (error){ alert('Update failed: ' + error.message); return; }
    // Reflect new location immediately in UI
    if (state.selectedVehicle && state.selectedVehicle.id === selected){
      state.selectedVehicle.location = locationNorm;
      if (geo && isFinite(geo.lat) && isFinite(geo.lon)){
        state.vehicleCoords = { lat: Number(geo.lat), lon: Number(geo.lon) };
      }
      if (geo && geo.county){ state.vehicleCounty = geo.county; }
      if (geo && geo.city){ state.vehicleCity = geo.city; }
      if (geo && geo.zip){ state.vehicleZip = geo.zip; }
      // Only re-geocode after save if we didn't have a structured geo
      if (!geo){ try { await updateVehicleGeodata(); } catch {} }
      updateDistanceUI();
      updateDbMetaUI();
      computeAll();
    }
  } else {
    const { data, error } = await state.supabase.from('vehicles')
      .insert({ name, msrp, location: locationNorm, latitude: geo?.lat ?? null, longitude: geo?.lon ?? null, county: geo?.county ?? null })
      .select('id');
    if (error){ alert('Insert failed: ' + error.message); return; }
    if (data && data[0]?.id){ selected = String(data[0].id); }
  }
  state.dbLocationGeo = null;
  await loadVehicles();
  if (selected){
    $('#vehicleSelect').value = String(selected);
    onVehicleSelected();
  }
}

async function deleteVehicle(){
  if (!state.supabase){ alert('Supabase not configured'); return; }
  const id = $('#vehicleSelect').value;
  if (!id){ alert('Select a vehicle to delete'); return; }
  if (!confirm('Delete this vehicle?')) return;
  const { error } = await state.supabase.from('vehicles').delete().eq('id', id);
  if (error){ alert('Delete failed: ' + error.message); return; }
  // Clear selection and calculator
  $('#vehicleSelect').value = '';
  state.selectedVehicle = null;
  state.vehicleCoords = null; state.vehicleCounty = null; state.vehicleCity = null; state.vehicleZip = null;
  const summaryVeh = document.getElementById('summaryVehicle'); if (summaryVeh) summaryVeh.textContent = '—';
  const summaryMsrp = document.getElementById('summaryMsrp'); if (summaryMsrp) summaryMsrp.textContent = '—';
  const cityEl = document.getElementById('dbCity'); if (cityEl) cityEl.textContent = '—';
  const countyEl = document.getElementById('dbCounty'); if (countyEl) countyEl.textContent = '—';
  const distEl = document.getElementById('dbDistance'); if (distEl) distEl.textContent = '—';
  updateDistanceUI();
  computeAll();
  await loadVehicles();
}

function onVehicleSelected(){
  const opt = $('#vehicleSelect').selectedOptions[0];
  if (!opt || !opt.value){
    // Clear DB-referenced calculator cells and related state
    state.selectedVehicle = null;
    state.vehicleCoords = null;
    state.vehicleCounty = null;
    state.vehicleZip = null;
    state.vehicleCity = null;
    const vNameEl = document.getElementById('summaryVehicle');
    const msrpEl = document.getElementById('summaryMsrp');
    if (vNameEl) vNameEl.textContent = '—';
    if (msrpEl) msrpEl.textContent = '—';
    const cityEl = document.getElementById('dbCity'); if (cityEl) cityEl.textContent = '—';
    const countyEl = document.getElementById('dbCounty'); if (countyEl) countyEl.textContent = '—';
    const distEl = document.getElementById('dbDistance'); if (distEl) distEl.textContent = '—';
    updateDistanceUI();
    updateDbMetaUI();
    computeAll();
    return;
  }
  const name = decodeURIComponent(opt.dataset.name || '');
  const msrp = opt.dataset.msrp || '';
  const location = decodeURIComponent(opt.dataset.location || '');
  state.selectedVehicle = { id: opt.value, name, msrp: parseCurrency(msrp), location };
  const summaryVeh2 = document.getElementById('summaryVehicle'); if (summaryVeh2) summaryVeh2.textContent = name || '—';
  const summaryMsrp2 = document.getElementById('summaryMsrp'); if (summaryMsrp2) summaryMsrp2.textContent = msrp ? formatCurrency(parseCurrency(msrp)) : '—';
  // Reflect selection in DB form for convenient updates
  $('#dbVehicleName').value = name || '';
  $('#dbMsrp').value = msrp ? formatCurrency(parseCurrency(msrp)) : '';
  $('#dbLocation').value = location || '';
  // If Final Sale Price is blank/zero, auto-fill MSRP for convenience
  const fpEl = document.getElementById('finalPrice');
  if (fpEl){
    const curVal = parseCurrency(fpEl.value);
    const msNum = parseCurrency(msrp);
    if ((!fpEl.value.trim() || curVal <= 0) && msNum > 0){
      fpEl.value = formatCurrency(msNum);
    }
  }
  // Prefer stored coords/county if available
  const lat = parseFloat(opt.dataset.lat || '');
  const lon = parseFloat(opt.dataset.lon || '');
  const county = decodeURIComponent(opt.dataset.county || '');
  if (!Number.isNaN(lat) && !Number.isNaN(lon)){
    state.vehicleCoords = { lat, lon };
  } else {
    state.vehicleCoords = null;
  }
  state.vehicleCounty = county || null;
  updateVehicleGeodata().then(() => { updateDistanceUI(); updateDbMetaUI(); computeAll(); });
}

// --- Core Calculations ---
function computeAll(){
  const name = state.selectedVehicle?.name || '';
  const msrp = Number.isFinite(state.selectedVehicle?.msrp) ? state.selectedVehicle.msrp : 0;
  const finalPrice = parsePriceExpression($('#finalPrice').value, msrp);
  const priceForCalc = (finalPrice && finalPrice > 0) ? finalPrice : msrp; // Assume MSRP when Final is blank
  const tradeValue = parseCurrency($('#tradeValue').value);
  const payoffRaw = parseCurrency($('#loanPayoff').value);
  const payoff = tradeValue > 0 ? payoffRaw : 0;
  const cashDown = parseCurrency($('#cashDown').value);
  const apr = parsePercent($('#apr').value); // annual %
  const term = parseInt($('#term').value || '0', 10) || 0;
  const financeTF = $('#financeTF').checked;

  // Savings
  const savingsEl = $('#savings');
  savingsEl.classList.remove('warn');
  if (finalPrice > 0 && msrp > 0){
    if (finalPrice < msrp){
      const s = msrp - finalPrice;
      savingsEl.textContent = `You save ${formatCurrency(s)}`;
    } else if (finalPrice > msrp){
      const over = finalPrice - msrp;
      savingsEl.textContent = `Over MSRP by ${formatCurrency(over)}`;
      savingsEl.classList.add('warn');
    } else {
      savingsEl.textContent = '';
    }
  } else {
    savingsEl.textContent = '';
  }

  // Trade Equity
  const equity = tradeValue - payoff;
  const te = $('#tradeEquity');
  te.classList.remove('delta-neg','delta-pos');
  if (tradeValue || payoff){
    if (equity < 0){
      te.textContent = `(${formatCurrency(-equity)})`;
      te.classList.add('delta-neg');
    } else {
      te.textContent = formatCurrency(equity);
      if (equity > 0) te.classList.add('delta-pos');
    }
  } else {
    te.textContent = '—';
  }
  const negEquity = equity < 0 ? -equity : 0;

  // Dealer Fees total
  const dealerFeesTotal = $$('#dealerFeesList .fee-row input.fee-amount')
    .map(i => parseCurrency(i.value)).reduce((a,b)=>a+b,0);
  $('#dealerFeesTotal').textContent = formatCurrency(dealerFeesTotal);

  // Gov Fees total
  const govFeesTotal = $$('#govFeesList .fee-row input.fee-amount')
    .map(i => parseCurrency(i.value)).reduce((a,b)=>a+b,0);
  $('#govFeesTotal').textContent = formatCurrency(govFeesTotal);

  // County + Taxes
  let countyName = state.vehicleCounty || '';
  let countyRateSource = 'lookup';
  let countyRate;
  const hasVehicle = !!state.selectedVehicle;
  if (hasVehicle){
    if (countyName){
      countyRate = getCountyRate(countyName).rate;
      countyRateSource = 'lookup';
    } else {
      // No county resolved; fall back to DEFAULT in table, do not prompt
      countyRate = getCountyRate('').rate;
      countyRateSource = 'default';
    }
  } else {
    // No vehicle selected: use DEFAULT county rate from table; no prompts
    countyRate = getCountyRate('').rate;
    countyRateSource = 'default';
  }
  state.countyRateUsed = countyRate;

  const stateRate = state.countyRates?.meta?.stateRate ?? 0.06;
  const countyCap = state.countyRates?.meta?.countyCap ?? 5000;
  // Florida: Tax base is selling price less trade-in allowance (if any),
  // plus taxable dealer fees. Government fees are NOT taxable.
  const hasTrade = tradeValue > 0;
  const baseBeforeFees = hasTrade ? Math.max(0, priceForCalc - tradeValue) : priceForCalc;
  const taxableBase = Math.max(0, baseBeforeFees + dealerFeesTotal);
  const stateTax = taxableBase * stateRate;
  const countyTax = Math.min(taxableBase, countyCap) * countyRate;
  const taxes = stateTax + countyTax;
  const showTaxes = ((priceForCalc && priceForCalc > 0) || tradeValue);
  $('#taxes').textContent = showTaxes ? formatCurrency(taxes) : '- -';
  const tb = document.getElementById('taxesBreakdown');
  if (tb){ tb.textContent = showTaxes ? `State: ${formatCurrency(stateTax)} • County: ${formatCurrency(countyTax)}` : '- -'; }
  const trn = document.getElementById('taxesRatesNote');
  if (trn){
    const cPct = (countyRate*100).toFixed(2) + '%';
    if (state.selectedVehicle){
      if (countyName){
        trn.textContent = `County: ${countyName} - ${cPct}`;
      } else {
        trn.textContent = `County: Default - ${cPct}`;
      }
    } else {
      trn.textContent = `County: Default - ${cPct}`;
    }
  }
  // Tax savings with trade-in
  const noteWith = document.getElementById('tradeSavingsWith');
  if (showTaxes){
    const baseBeforeFeesNoTrade = Math.max(0, priceForCalc);
    const taxableBaseNoTrade = Math.max(0, baseBeforeFeesNoTrade + dealerFeesTotal);
    const stateTaxNo = taxableBaseNoTrade * stateRate;
    const countyTaxNo = Math.min(taxableBaseNoTrade, countyCap) * countyRate;
    const taxesNo = stateTaxNo + countyTaxNo;
    const delta = Math.max(0, taxesNo - taxes);
    if (noteWith){
      setReadyPlaceholder(noteWith, false);
      noteWith.textContent = `Tax Savings w/ Trade-in: ${formatCurrency(tradeValue > 0 ? delta : 0)}`;
    }
  } else {
    if (noteWith){ setReadyPlaceholder(noteWith, true); noteWith.textContent = 'Tax Savings w/ Trade-in: - -'; }
  }
  // Total Taxes & Fees (dealer + gov + taxes)
  const totalTF = dealerFeesTotal + govFeesTotal + taxes;
  const totalTFEl = document.getElementById('totalTF');
  if (totalTFEl){ totalTFEl.textContent = ((priceForCalc && priceForCalc > 0) || tradeValue || dealerFeesTotal || govFeesTotal) ? formatCurrency(totalTF) : '- -'; }

  // Amount Financed
  // Formula used:
  // amount = finalPrice - tradeValue + payoff + (financeTF ? (govFees + dealerFees + taxes) : 0) - cashDown
  const feesTotal = govFeesTotal + dealerFeesTotal;
  const baseAmount = (priceForCalc - tradeValue + payoff) - cashDown;
  const amountWithTF = Math.max(0, baseAmount + (feesTotal + taxes));
  const amountWithoutTF = Math.max(0, baseAmount);
  const amountFinanced = financeTF ? amountWithTF : amountWithoutTF;
  const amtEl = document.getElementById('amountFinanced');
  if (((priceForCalc && priceForCalc > 0) || tradeValue || payoff || govFeesTotal || dealerFeesTotal || taxes || cashDown)){
    setReadyPlaceholder(amtEl, false); amtEl.textContent = formatCurrency(amountFinanced);
  } else { setReadyPlaceholder(amtEl, true); }

  // APR monthly and Payments
  const monthlyRate = apr / 100 / 12;
  const mRateEl = document.getElementById('monthlyApr');
  if (apr){ setReadyPlaceholder(mRateEl, false); mRateEl.textContent = `${numberFmt4.format(apr/12)}%`; }
  else { setReadyPlaceholder(mRateEl, true); }
  const pmt = calcPayment(amountFinanced, monthlyRate, term);
  const pmt0 = calcPayment(amountFinanced, 0, term);
  // Savings on monthly payment if not financing taxes & fees
  const pmtWith = calcPayment(amountWithTF, monthlyRate, term);
  const pmtWithout = calcPayment(amountWithoutTF, monthlyRate, term);
  const pmtSavings = Math.max(0, pmtWith - pmtWithout);
  const pmtSavingsEl = document.getElementById('pmtSavings');
  if (pmtSavingsEl){ if (term && (feesTotal || taxes)){ setReadyPlaceholder(pmtSavingsEl, false); pmtSavingsEl.textContent = `${formatCurrency(pmtSavings)}/mo`; } else { setReadyPlaceholder(pmtSavingsEl, true); } }
  const mpEl = document.getElementById('monthlyPayment');
  if (amountFinanced && term){ setReadyPlaceholder(mpEl, false); mpEl.textContent = formatCurrency(pmt); } else { setReadyPlaceholder(mpEl, true); }
  const p0El = document.getElementById('payment0');
  if (amountFinanced && term){ setReadyPlaceholder(p0El, false); p0El.textContent = formatCurrency(pmt0); } else { setReadyPlaceholder(p0El, true); }
  const delta = pmt - pmt0;
  const pdEl = document.getElementById('paymentDelta');
  if (amountFinanced && term){ setReadyPlaceholder(pdEl, false); pdEl.textContent = `${formatCurrency(delta)}/mo`; } else { setReadyPlaceholder(pdEl, true); }

  // Distance
  updateDistanceUI();
  updateDbMetaUI();
  computeCalcPanelWidth();
}

function calcPayment(pv, r, n){
  if (!pv || !n) return 0;
  if (!r) return pv / n;
  return (r * pv) / (1 - Math.pow(1 + r, -n));
}

function updateDistanceUI(){
  const dEl = $('#dbDistance');
  if (!dEl) return;
  if (!state.homeCoords || !isFinite(state.homeCoords.lat) || !isFinite(state.homeCoords.lon)){
    dEl.textContent = '—';
    return;
  }
  // If editing in modal and we have a live geocode result, use that for preview distance
  const vehModal = document.getElementById('vehicleModal');
  const modalOpen = !!(vehModal && vehModal.classList.contains('open'));
  const coords = (modalOpen && state.dbLocationGeo && isFinite(state.dbLocationGeo.lat) && isFinite(state.dbLocationGeo.lon))
    ? { lat: Number(state.dbLocationGeo.lat), lon: Number(state.dbLocationGeo.lon) }
    : state.vehicleCoords;
  if (!coords || !isFinite(coords.lat) || !isFinite(coords.lon)){
    dEl.textContent = '—';
    return;
  }
  const d = haversineMi(state.homeCoords, coords);
  dEl.textContent = d ? `${numberFmt.format(d)} mi` : '—';
}

function updateDbMetaUI(){
  const cityEl = $('#dbCity');
  const countyEl = $('#dbCounty');
  const homeAddrEl = $('#dbHomeAddress');
  if (!cityEl && !countyEl) return;
  const vehModal = document.getElementById('vehicleModal');
  const modalOpen = !!(vehModal && vehModal.classList.contains('open'));
  if (modalOpen && state.dbLocationGeo){
    if (cityEl) cityEl.textContent = state.dbLocationGeo.city || '—';
    if (countyEl) countyEl.textContent = state.dbLocationGeo.county || '—';
  } else {
    if (cityEl) cityEl.textContent = state.vehicleCity || '—';
    if (countyEl) countyEl.textContent = state.vehicleCounty || '—';
  }
  if (homeAddrEl){ homeAddrEl.textContent = state.homeAddress || '—'; }
}

// --- Dynamic calculator width ---
function computeCalcPanelWidth(){
  const panel = document.getElementById('calc-panel');
  if (!panel) return;
  const inputs = [
    document.getElementById('finalPrice'),
    document.getElementById('tradeValue'),
    document.getElementById('loanPayoff'),
    document.getElementById('cashDown'),
    document.getElementById('apr'),
    document.getElementById('term'),
    document.querySelector('#calc-panel .amount-row .checkbox'),
    ...Array.from(document.querySelectorAll('#dealerFeesList .fee-row input.fee-amount')),
    ...Array.from(document.querySelectorAll('#govFeesList .fee-row input.fee-amount')),
    ...Array.from(document.querySelectorAll('#dealerFeesList .fee-row input.fee-name')),
    ...Array.from(document.querySelectorAll('#govFeesList .fee-row input.fee-name')),
  ].filter(Boolean);

  const noteEls = Array.from(document.querySelectorAll('#calc-panel .cell-value .note, #calc-panel .cell-value .hint'));
  // Toggle wrapping based on length vs base reference note
  const baseNoteText = '6% state + county rate on first $5k';
  const baseLen = baseNoteText.length;
  noteEls.forEach(el => {
    const len = (el.textContent || '').trim().length;
    if (len > baseLen) el.classList.add('wrap-note');
    else el.classList.remove('wrap-note');
  });
  const nowrapNotes = noteEls.filter(el => !el.classList.contains('wrap-note'));
  const itemsToMeasure = inputs.slice();
  if (nowrapNotes.length) itemsToMeasure.push(...nowrapNotes);

  if (!itemsToMeasure.length){ panel.style.maxWidth = '380px'; return; }

  const measurer = document.createElement('span');
  measurer.style.position = 'absolute';
  measurer.style.visibility = 'hidden';
  measurer.style.whiteSpace = 'pre';
  document.body.appendChild(measurer);

  let maxText = 0;
  for (const el of itemsToMeasure){
    const cs = window.getComputedStyle(el);
    measurer.style.fontFamily = cs.fontFamily;
    measurer.style.fontSize = cs.fontSize;
    measurer.style.fontWeight = cs.fontWeight;
    measurer.style.letterSpacing = cs.letterSpacing;
    const text = ('value' in el) ? (el.value || el.placeholder || '') : el.textContent || '';
    measurer.textContent = text;
    const w = measurer.getBoundingClientRect().width;
    if (w > maxText) maxText = w;
  }
  measurer.remove();

  // Add padding/borders/suffix allowance (~120px), clamp to viewport
  const extra = 140; // cell + input paddings and term suffix
  const desired = Math.ceil(maxText + extra);
  const min = 380;
  const vw = Math.max(320, window.innerWidth - 32);
  const finalW = Math.min(vw, Math.max(min, desired));
  panel.style.maxWidth = `${finalW}px`;
}

// --- Modal helpers ---
function openVehicleModal(mode){
  const modal = document.getElementById('vehicleModal');
  const title = document.getElementById('vehicleModalTitle');
  if (mode === 'add'){
    title.textContent = 'Add Vehicle';
    // Clear selection so save inserts
    $('#vehicleSelect').value = '';
    $('#dbVehicleName').value = '';
    $('#dbMsrp').value = '';
    $('#dbLocation').value = '';
    $('#dbLocationCounty').textContent = '—';
    $('#dbLocationCoords').textContent = '—';
    state.dbLocationGeo = null;
  } else {
    title.textContent = 'Update Vehicle';
    if (!$('#vehicleSelect').value){
      alert('Select a vehicle to update');
      return;
    }
  }
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeVehicleModal(){
  const modal = document.getElementById('vehicleModal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

// --- Fees UI ---
function addFeeRow(name = '', amount = ''){
  const row = document.createElement('div');
  row.className = 'fee-row';
  row.innerHTML = `
    <input class=\"fee-name\" type=\"text\" placeholder=\"e.g., Doc Fee\" value=\"${name}\" />
    <input class=\"fee-amount\" type=\"text\" inputmode=\"decimal\" enterkeyhint=\"done\" placeholder=\"e.g. $699\" value=\"${amount}\" />
    <button class="remove">Remove</button>
  `;
  row.querySelector('.remove').addEventListener('click', () => { row.remove(); computeAll(); });
  const amt = row.querySelector('.fee-amount');
  attachCurrencyFormatter(amt);
  $('#dealerFeesList').appendChild(row);
}

function addGovFeeRow(name = '', amount = ''){
  const row = document.createElement('div');
  row.className = 'fee-row';
  row.innerHTML = `
    <input class=\"fee-name\" type=\"text\" placeholder=\"e.g., Title Fee\" value=\"${name}\" />
    <input class=\"fee-amount\" type=\"text\" inputmode=\"decimal\" placeholder=\"e.g., $85\" value=\"${amount}\" />
    <button class=\"remove\">Remove</button>
  `;
  row.querySelector('.remove').addEventListener('click', () => { row.remove(); computeAll(); });
  const amt = row.querySelector('.fee-amount');
  attachCurrencyFormatter(amt);
  $('#govFeesList').appendChild(row);
}

// --- Settings ---
function loadHomeAddress(){
  const saved = localStorage.getItem('homeAddress');
  state.homeAddress = saved || HOME_ADDRESS_DEFAULT;
}

// legacy: saveHomeAddress handled via updateHomeBtn prompt now

// --- Wire up ---
window.addEventListener('DOMContentLoaded', async () => {
  initSupabase();
  await loadCountyRates();
  loadHomeAddress();
  await ensureHomeCoords();

  // Inputs (currency formatter for all except finalPrice which supports expressions)
  ['tradeValue','loanPayoff','cashDown'].forEach(id => {
    const el = document.getElementById(id);
    attachCurrencyFormatter(el);
  });
  // Specialized handling for Final Sale Price (supports formulas)
  const fp = document.getElementById('finalPrice');
  const getCurrentMsrp = () => (Number.isFinite(state.selectedVehicle?.msrp) ? state.selectedVehicle.msrp : 0);
  fp.addEventListener('blur', () => {
    const n = parsePriceExpression(fp.value, getCurrentMsrp());
    fp.value = n ? formatCurrency(n) : '';
    computeAll();
  });
  fp.addEventListener('input', () => computeAll());
  fp.addEventListener('keydown', (e)=>{ if (e.key==='Enter'){ e.preventDefault(); fp.blur(); }});
  // If no trade-in value, clear payoff dynamically
  const tradeEl = document.getElementById('tradeValue');
  const payoffEl = document.getElementById('loanPayoff');
  tradeEl.addEventListener('input', () => {
    if (parseCurrency(tradeEl.value) <= 0){
      if (payoffEl.value){ payoffEl.value = ''; }
    }
  });

  $('#apr').addEventListener('input', computeAll);
  $('#apr').addEventListener('keydown', (e)=>{ if (e.key==='Enter'){ e.preventDefault(); e.target.blur(); }});
  $('#term').addEventListener('input', computeAll);
  $('#term').addEventListener('keydown', (e)=>{ if (e.key==='Enter'){ e.preventDefault(); e.target.blur(); }});
  $('#financeTF').addEventListener('change', computeAll);

  // Fees
  $('#addFee').addEventListener('click', () => addFeeRow());
  $('#addGovFee').addEventListener('click', () => addGovFeeRow());

  // Supabase
  // Modal actions for Add/Update vehicle
  $('#saveVehicle').addEventListener('click', async () => { await saveVehicle(); closeVehicleModal(); });
  $('#deleteVehicle').addEventListener('click', deleteVehicle);
  $('#vehicleSelect').addEventListener('change', onVehicleSelected);
  $('#addVehicleBtn').addEventListener('click', () => openVehicleModal('add'));
  $('#updateVehicleBtn').addEventListener('click', () => openVehicleModal('update'));
  $('#modalClose').addEventListener('click', closeVehicleModal);
  $('#modalCancel').addEventListener('click', closeVehicleModal);
  // Enter key inside modal saves
  const vehModal = document.getElementById('vehicleModal');
  vehModal.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter'){
      e.preventDefault();
      await saveVehicle();
      closeVehicleModal();
    }
  });
  // (Removed) Pencil icons to open update dialog
  loadVehicles();

  // Home Address modal (Places-like UX)
  const homeModal = document.getElementById('homeModal');
  const openHomeModal = () => {
    const input = document.getElementById('homeInput');
    if (input){ input.value = state.homeAddress || ''; }
    const zipEl = document.getElementById('homeZip'); if (zipEl) zipEl.textContent = state.homeZip || '—';
    const coordsEl = document.getElementById('homeCoords'); if (coordsEl) coordsEl.textContent = (state.homeCoords && isFinite(state.homeCoords.lat) && isFinite(state.homeCoords.lon)) ? `${state.homeCoords.lat.toFixed(5)}, ${state.homeCoords.lon.toFixed(5)}` : '—';
    state.pendingHomeGeo = null;
    if (homeModal){ homeModal.classList.add('open'); homeModal.setAttribute('aria-hidden','false'); }
  };
  const closeHomeModal = () => { if (homeModal){ homeModal.classList.remove('open'); homeModal.setAttribute('aria-hidden','true'); } };
  const saveHome = async () => {
    const input = document.getElementById('homeInput');
    const raw = (input?.value || '').trim();
    if (!raw && !state.pendingHomeGeo){ closeHomeModal(); return; }
    let geo = state.pendingHomeGeo;
    if (!geo && raw){ try { geo = await geocode(raw); } catch { geo = null; } }
    if (!geo || !isFinite(geo.lat) || !isFinite(geo.lon)){
      alert('Could not resolve location. Please select a suggestion or enter a valid City/ZIP.');
      return;
    }
    // Normalize address string
    const norm = normalizeLocationFromGeo(geo) || raw;
    state.homeAddress = norm;
    localStorage.setItem('homeAddress', norm);
    state.homeCoords = { lat: Number(geo.lat), lon: Number(geo.lon) };
    localStorage.setItem('homeCoords', JSON.stringify(state.homeCoords));
    state.homeZip = geo.zip || null;
    state.homeCity = geo.city || null;
    const zipEl = document.getElementById('homeZip'); if (zipEl) zipEl.textContent = state.homeZip || '—';
    const coordsEl = document.getElementById('homeCoords'); if (coordsEl) coordsEl.textContent = `${state.homeCoords.lat.toFixed(5)}, ${state.homeCoords.lon.toFixed(5)}`;
    updateDistanceUI();
    updateDbMetaUI();
    computeAll();
    closeHomeModal();
  };
  document.getElementById('updateHomeBtn').addEventListener('click', openHomeModal);
  document.getElementById('homeSave').addEventListener('click', saveHome);
  document.getElementById('homeCancel').addEventListener('click', closeHomeModal);
  document.getElementById('homeClose').addEventListener('click', closeHomeModal);

  // Backfill geo for saved vehicles (county/coords) and normalize location strings
  async function backfillVehicleGeo(){
    if (!state.supabase){ alert('Supabase not configured'); return; }
    const proceed = confirm('Backfill county/coordinates for all saved vehicles?');
    if (!proceed) return;
    try {
      const { data, error } = await state.supabase
        .from('vehicles')
        .select('id,name,location,latitude,longitude,county');
      if (error) throw error;
      if (!data || !data.length){ alert('No vehicles found'); return; }
      let updated = 0, skipped = 0, failed = 0;
      for (const v of data){
        try {
          const id = v.id;
          const loc = (v.location || '').trim();
          const haveCoords = Number.isFinite(parseFloat(v.latitude)) && Number.isFinite(parseFloat(v.longitude));
          const haveCounty = !!(v.county && String(v.county).trim());
          let geo = null;
          if (loc){
            try { geo = await geocode(loc); } catch { geo = null; }
            // If still missing county but coords exist, try reverse geocode
            if (geo && (!geo.county || geo.county === '—') && Number.isFinite(geo.lat) && Number.isFinite(geo.lon)){
              try { const rev = await geocodeGoogleReverse(geo.lat, geo.lon); geo = { ...geo, county: rev.county || geo.county, state_code: geo.state_code || rev.state_code, zip: geo.zip || rev.zip, city: geo.city || rev.city }; } catch {}
            }
          }
          const update = {};
          if (!haveCoords && geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lon)){
            update.latitude = Number(geo.lat);
            update.longitude = Number(geo.lon);
          }
          if (!haveCounty && geo && geo.county){ update.county = geo.county; }
          if (geo){
            const norm = normalizeLocationFromGeo(geo);
            if (norm && norm !== loc){ update.location = norm; }
          }
          if (Object.keys(update).length){
            const { error: uerr } = await state.supabase.from('vehicles').update(update).eq('id', id);
            if (uerr) throw uerr;
            updated++;
          } else {
            skipped++;
          }
        } catch(e){
          console.warn('Backfill failed for vehicle', v.id, e);
          failed++;
        }
      }
      await loadVehicles();
      // Refresh UI if currently selected vehicle is impacted
      if ($('#vehicleSelect').value){ onVehicleSelected(); }
      alert(`Backfill complete. Updated: ${updated}, Skipped: ${skipped}, Failed: ${failed}`);
    } catch (e){
      alert('Backfill failed: ' + (e.message || e));
    }
  }
  document.getElementById('backfillGeoBtn').addEventListener('click', backfillVehicleGeo);

  // Geocode DB location as you type (debounced)
  const debouncedDbLoc = debounce(async () => {
    const loc = $('#dbLocation').value.trim();
    if (!loc) {
      state.dbLocationGeo = null;
      $('#dbLocationCounty').textContent = '—';
      $('#dbLocationZip').textContent = '—';
      $('#dbLocationCoords').textContent = '—';
      const cityMeta = document.getElementById('dbCity'); if (cityMeta) cityMeta.textContent = '—';
      const countyMeta = document.getElementById('dbCounty'); if (countyMeta) countyMeta.textContent = '—';
      updateDistanceUI();
      return;
    }
    try {
      const res = await geocode(loc);
// Use ZIP from Google geocode only
  let zipOut = res.zip || '';
  const st = res.state_code || (res.state && /florida/i.test(res.state) ? 'FL' : null);
      state.dbLocationGeo = { ...res, zip: zipOut };
      $('#dbLocationCounty').textContent = res.county || '—';
      $('#dbLocationZip').textContent = zipOut || '—';
      $('#dbLocationCoords').textContent = `${res.lat.toFixed(5)}, ${res.lon.toFixed(5)}`;
      // Also preview in the DB meta section
      const cityMeta = document.getElementById('dbCity'); if (cityMeta) cityMeta.textContent = res.city || '—';
      const countyMeta = document.getElementById('dbCounty'); if (countyMeta) countyMeta.textContent = res.county || '—';
      // If the modal city differs from selected vehicle, keep preview only; save applies it
      // But if a vehicle is already selected, this helps confirm the new location
      updateDistanceUI();
      updateDbMetaUI();
    } catch {
      // If we have no prior geocode to show, clear; otherwise keep last good preview
      if (!state.dbLocationGeo){
        $('#dbLocationCounty').textContent = '—';
        $('#dbLocationZip').textContent = '—';
        $('#dbLocationCoords').textContent = '—';
        const cityMeta = document.getElementById('dbCity'); if (cityMeta) cityMeta.textContent = '—';
        const countyMeta = document.getElementById('dbCounty'); if (countyMeta) countyMeta.textContent = '—';
      }
      updateDistanceUI();
    }
  }, 700);
  if (window.GEOCODE_ON_INPUT === true){
    $('#dbLocation').addEventListener('input', debouncedDbLoc);
  }
  // On blur, normalize the location field to "City, ST ZIP" when resolvable
  $('#dbLocation').addEventListener('blur', async () => {
    const el = $('#dbLocation');
    const raw = el.value.trim();
    if (!raw) return;
    let geo = state.dbLocationGeo;
    if (!geo){
      try { geo = await geocode(raw); } catch { geo = null; }
    }
    if (geo){
      // Use ZIP from Google geocode only
      let zipOut = geo.zip || '';
      const st = geo.state_code || (geo.state && /florida/i.test(geo.state) ? 'FL' : null);
      const parts = [];
      if (geo.city) parts.push(geo.city);
      const tail = [st, zipOut].filter(Boolean).join(' ');
      if (tail) parts.push(tail);
      const norm = parts.join(', ').trim();
      if (norm) el.value = norm;
      // ensure preview notes and distance reflect the latest result
      state.dbLocationGeo = { ...geo, zip: zipOut };
      const cityMeta = document.getElementById('dbCity'); if (cityMeta) cityMeta.textContent = geo.city || '—';
      const countyMeta = document.getElementById('dbCounty'); if (countyMeta) countyMeta.textContent = geo.county || '—';
      document.getElementById('dbLocationCounty').textContent = geo.county || '—';
      document.getElementById('dbLocationZip').textContent = zipOut || '—';
      document.getElementById('dbLocationCoords').textContent = (isFinite(geo.lat) && isFinite(geo.lon)) ? `${Number(geo.lat).toFixed(5)}, ${Number(geo.lon).toFixed(5)}` : '—';
      updateDistanceUI();
      updateDbMetaUI();
    }
  });

  // Load Google Places Autocomplete if key provided
  async function loadGoogleMaps(){
    if (!window.GMAPS_API_KEY || window.google?.maps?.places) return true;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(window.GMAPS_API_KEY)}&libraries=places&v=weekly`;
      s.async = true; s.defer = true;
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
    return true;
  }
  try {
    if (window.ENABLE_GOOGLE_PLACES === true){
      await loadGoogleMaps();
      const locInput = document.getElementById('dbLocation');
      if (window.google?.maps?.places && locInput){
        try {
          const ac = new google.maps.places.Autocomplete(locInput, {
            fields: ['address_components','geometry','name'],
            componentRestrictions: { country: 'us' }
          });
          ac.addListener('place_changed', async () => {
            const p = ac.getPlace();
            if (!p || !p.address_components) return;
            const get = (type, short=false) => {
              const c = p.address_components.find(ac => ac.types.includes(type));
              return c ? (short ? c.short_name : c.long_name) : null;
            };
            const city = get('locality') || get('postal_town') || get('sublocality');
            let county = get('administrative_area_level_2');
            const state_code = get('administrative_area_level_1', true);
            const zip = get('postal_code');
            const lat = p.geometry?.location?.lat?.() ?? null;
            const lon = p.geometry?.location?.lng?.() ?? null;
            // If county is missing but coords available, try reverse geocoding
            if ((!county || county === '—') && isFinite(lat) && isFinite(lon) && window.ENABLE_GOOGLE_GEOCODING !== false){
              try {
                const rev = await geocodeGoogleReverse(lat, lon);
                county = rev.county || county;
              } catch {}
            }
            state.dbLocationGeo = { city, county, state_code, zip, lat, lon };
            // Normalize visible input to City, ST ZIP for consistency
            try {
              const norm = normalizeLocationFromGeo(state.dbLocationGeo);
              if (norm) locInput.value = norm;
            } catch {}
            document.getElementById('dbLocationCounty').textContent = county || '—';
            document.getElementById('dbLocationZip').textContent = zip || '—';
            document.getElementById('dbLocationCoords').textContent = (lat && lon) ? `${lat.toFixed(5)}, ${lon.toFixed(5)}` : '—';
            const cityMeta = document.getElementById('dbCity'); if (cityMeta) cityMeta.textContent = city || '—';
            const countyMeta = document.getElementById('dbCounty'); if (countyMeta) countyMeta.textContent = county || '—';
            const brand = document.getElementById('geoBrand'); if (brand) brand.style.display = 'block';
            updateDistanceUI();
            updateDbMetaUI();
          });
          const brand = document.getElementById('geoBrand'); if (brand) brand.style.display = 'block';
        } catch (e) {
          const brand = document.getElementById('geoBrand');
          if (brand){ brand.style.display = 'block'; brand.textContent = 'Autocomplete disabled (provider error)'; }
        }
      }
      // Home input Places Autocomplete
      const homeInput = document.getElementById('homeInput');
      if (window.google?.maps?.places && homeInput){
        try {
          const acHome = new google.maps.places.Autocomplete(homeInput, {
            fields: ['address_components','geometry','name'],
            componentRestrictions: { country: 'us' }
          });
          acHome.addListener('place_changed', async () => {
            const p = acHome.getPlace();
            if (!p || !p.address_components) return;
            const get = (type, short=false) => {
              const c = p.address_components.find(ac => ac.types.includes(type));
              return c ? (short ? c.short_name : c.long_name) : null;
            };
            const city = get('locality') || get('postal_town') || get('sublocality');
            const state_code = get('administrative_area_level_1', true);
            const zip = get('postal_code');
            const lat = p.geometry?.location?.lat?.() ?? null;
            const lon = p.geometry?.location?.lng?.() ?? null;
            state.pendingHomeGeo = { city, state_code, zip, lat, lon };
            // Normalize visible input
            try { const norm = normalizeLocationFromGeo(state.pendingHomeGeo); if (norm) homeInput.value = norm; } catch {}
            const zipEl = document.getElementById('homeZip'); if (zipEl) zipEl.textContent = zip || '—';
            const coordsEl = document.getElementById('homeCoords'); if (coordsEl) coordsEl.textContent = (lat && lon) ? `${lat.toFixed(5)}, ${lon.toFixed(5)}` : '—';
            const brand = document.getElementById('homeBrand'); if (brand) brand.style.display = 'block';
          });
          const brand = document.getElementById('homeBrand'); if (brand) brand.style.display = 'block';
        } catch (e) {
          const brand = document.getElementById('homeBrand');
          if (brand){ brand.style.display = 'block'; brand.textContent = 'Autocomplete disabled (provider error)'; }
        }
      }
    } else {
      const brand = document.getElementById('geoBrand');
      if (brand){ brand.style.display = 'block'; brand.textContent = 'Geocoding input: manual (Autocomplete off)'; }
    }
  } catch {}

  // County Rates import modal
  const ratesModal = document.getElementById('ratesModal');
  function openRatesModal(){
    ratesModal.classList.add('open'); ratesModal.setAttribute('aria-hidden','false');
    // Prefill meta inputs from current state
    const sRate = state.countyRates?.meta?.stateRate ?? 0.06;
    const cCap = state.countyRates?.meta?.countyCap ?? 5000;
    document.getElementById('stateRateInput').value = String(sRate);
    document.getElementById('countyCapInput').value = String(cCap);
    updateRatesPreview(state.countyRates);
  }
  function closeRatesModal(){ ratesModal.classList.remove('open'); ratesModal.setAttribute('aria-hidden','true'); }
  document.getElementById('importRatesBtn').addEventListener('click', openRatesModal);
  document.getElementById('ratesClose').addEventListener('click', closeRatesModal);
  document.getElementById('ratesCancel').addEventListener('click', closeRatesModal);
  document.getElementById('loadRatesSample').addEventListener('click', () => {
    const sampleTsv = 'County\tTotal Surtax Rate\nBrevard\t1.5%\nOrange\t0.5%\n';
    document.getElementById('ratesInput').value = sampleTsv;
    try {
      const parsed = parseRatesText(sampleTsv);
      state.pendingRatesImport = parsed;
      updateRatesPreview(parsed);
    } catch {}
  });

  // (Removed trade-in link handler; note is computed proactively in computeAll)
  async function parseExcelFile(file){
    if (typeof XLSX === 'undefined') throw new Error('XLSX library not loaded');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (!rows.length) throw new Error('No rows found in sheet');
    // Flexible header detection
    const hdrs = Object.keys(rows[0]);
    const { countyKey, rateKey } = detectHeaderKeys(hdrs);
    if (!countyKey || !rateKey) throw new Error('Could not detect headers. Expected columns like "County" and "Total Surtax Rate".');
    const counties = {};
    for (const r of rows){
      const rawCounty = String(r[countyKey] ?? '').replace(/county$/i,'').trim();
      if (!rawCounty) continue;
      const rateVal = r[rateKey];
      const num = parseRateValue(rateVal);
      if (!isFinite(num)) continue;
      counties[rawCounty] = num;
    }
    if (!Object.keys(counties).length) throw new Error('No county rows parsed');
    return { meta: { stateRate: 0.06, countyCap: 5000 }, counties };
  }
  document.getElementById('ratesFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      let parsed;
      const name = file.name.toLowerCase();
      if (name.endsWith('.xlsx') || name.endsWith('.xls')){
        parsed = await parseExcelFile(file);
      } else {
        const txt = await file.text();
        parsed = parseRatesText(txt);
      }
      state.pendingRatesImport = parsed;
      // Show preview JSON
      document.getElementById('ratesInput').value = JSON.stringify(parsed, null, 2);
      updateRatesPreview(parsed);
    } catch(err){
      alert('Failed to parse file: ' + err.message);
    }
  });
  function normalizeHeader(h){
    return String(h || '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  }
  function detectHeaderKeys(headers){
    const countyAliases = [
      'county', 'county name', 'buyer county', 'destination county', 'county of sale', 'county code', 'countyname', 'jurisdiction'
    ];
    const rateAliases = [
      'total surtax rate', 'total surtax', 'surtax rate', 'discretionary sales surtax', 'discretionary surtax', 'local option surtax', 'local surtax', 'local rate', 'rate', 'total local rate'
    ];
    const norms = headers.map(h => ({ raw: h, norm: normalizeHeader(h) }));
    const countyKey = norms.find(h => countyAliases.some(a => h.norm.includes(a)))?.raw;
    const rateKey = norms.find(h => rateAliases.some(a => h.norm.includes(a)))?.raw;
    return { countyKey, rateKey };
  }
  function parseRateValue(v){
    if (v == null) return NaN;
    if (typeof v === 'number'){
      const n = v;
      if (n <= 0.25) return n; // decimal fraction (<=25%)
      if (n <= 25) return n / 100; // assume percent
      return NaN;
    }
    let s = String(v).trim();
    if (!s) return NaN;
    const hasPct = /%/.test(s);
    s = s.replace(/[^0-9.\-]/g,'');
    let n = parseFloat(s);
    if (!isFinite(n)) return NaN;
    if (hasPct) return n / 100;
    if (n <= 0.25) return n;
    if (n <= 25) return n / 100;
    return NaN;
  }
  function parseRatesText(txt){
    // Try JSON first
    try {
      const obj = JSON.parse(txt);
      if (obj && typeof obj === 'object' && obj.counties) return obj;
    } catch {}
    // Use SheetJS to robustly parse CSV/TSV if available
    if (typeof XLSX !== 'undefined'){
      try {
        const wb = XLSX.read(txt, { type: 'string' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        if (rows.length){
          const hdrs = Object.keys(rows[0]);
          const { countyKey, rateKey } = detectHeaderKeys(hdrs);
          if (!countyKey || !rateKey) throw new Error('Could not detect County/Rate columns');
          const counties = {};
          for (const r of rows){
            const c = String(r[countyKey] ?? '').replace(/county$/i,'').trim();
            if (!c) continue;
            const n = parseRateValue(r[rateKey]);
            if (!isFinite(n)) continue;
            counties[c] = n;
          }
          if (!Object.keys(counties).length) throw new Error('No county rows parsed');
          return { meta: { stateRate: 0.06, countyCap: 5000 }, counties };
        }
      } catch {}
    }
    // Fallback naive TSV/CSV parser
    const delim = (txt.match(/\t/g)?.length || 0) >= (txt.match(/,/g)?.length || 0) ? '\t' : ',';
    const lines = txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) throw new Error('No data to import');
    const header = lines.shift();
    const headers = header.split(new RegExp(delim)).map(h => h.trim());
    const { countyKey, rateKey } = detectHeaderKeys(headers);
    const cIdx = headers.findIndex(h => h === countyKey);
    const rIdx = headers.findIndex(h => h === rateKey);
    if (cIdx === -1 || rIdx === -1) throw new Error('Could not find County/Rate columns');
    const counties = {};
    for (const line of lines){
      const cols = line.split(new RegExp(delim)).map(c => c.trim());
      const c = (cols[cIdx] || '').replace(/county$/i,'').trim();
      if (!c) continue;
      const n = parseRateValue(cols[rIdx]);
      if (!isFinite(n)) continue;
      counties[c] = n;
    }
    if (!Object.keys(counties).length) throw new Error('No county rows parsed');
    return { meta: { stateRate: 0.06, countyCap: 5000 }, counties };
  }

  document.getElementById('saveRates').addEventListener('click', () => {
    try {
      const txt = document.getElementById('ratesInput').value.trim();
      let parsed = state.pendingRatesImport;
      if (!parsed){
        if (!txt) return closeRatesModal();
        parsed = parseRatesText(txt);
      }
      // Override meta from inputs
      const sRateIn = parseFloat(document.getElementById('stateRateInput').value);
      const cCapIn = parseFloat(document.getElementById('countyCapInput').value);
      parsed.meta = {
        stateRate: isFinite(sRateIn) ? sRateIn : (state.countyRates?.meta?.stateRate ?? 0.06),
        countyCap: isFinite(cCapIn) ? cCapIn : (state.countyRates?.meta?.countyCap ?? 5000),
      };
      // Preserve DEFAULT if user didn't include one
      if (!parsed.counties.DEFAULT && state.countyRates?.counties?.DEFAULT){
        parsed.counties.DEFAULT = state.countyRates.counties.DEFAULT;
      }
      state.countyRates = parsed;
      localStorage.setItem('countyRates', JSON.stringify(parsed));
      computeAll();
      closeRatesModal();
      state.pendingRatesImport = null;
    } catch(err){
      alert('Failed to import rates: ' + err.message);
    }
  });

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c]));
  }
  function updateRatesPreview(parsed){
    const el = document.getElementById('ratesPreview');
    if (!el) return;
    if (!parsed || !parsed.counties){ el.innerHTML = ''; return; }
    const entries = Object.entries(parsed.counties);
    const limit = 15;
    let html = '<table class="preview-table"><thead><tr><th>County</th><th>Rate</th></tr></thead><tbody>';
    entries.slice(0, limit).forEach(([name, rate]) => {
      const pct = (parseFloat(rate) * 100);
      const pctStr = isFinite(pct) ? pct.toFixed(2) + '%' : '';
      html += `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(pctStr)}</td></tr>`;
    });
    html += '</tbody></table>';
    html += `<div class="hint">${entries.length > limit ? `Showing ${limit} of ${entries.length} rows` : `Total rows: ${entries.length}`}</div>`;
    el.innerHTML = html;
  }

  // Initial state
  // Start with one fee row to guide usage
  addFeeRow();
  addGovFeeRow();
  computeAll();
  // Recompute width initially and on resize
  computeCalcPanelWidth();
  window.addEventListener('resize', computeCalcPanelWidth);

  // Allow mobile keyboards to submit via Return/Done
  const calcForm = document.getElementById('calcForm');
  if (calcForm){
    calcForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (document.activeElement && typeof document.activeElement.blur === 'function'){
        document.activeElement.blur();
      }
      computeAll();
    });
  }

  // Open Tax Formula modal
  const openFormula = document.getElementById('openTaxFormula');
  const formulaModal = document.getElementById('formulaModal');
  const openFormulaModal = () => {
    if (formulaModal){
      // Populate current rates line
      const sRate = state.countyRates?.meta?.stateRate ?? 0.06;
      const cRate = (typeof state.countyRateUsed === 'number')
        ? state.countyRateUsed
        : getCountyRate(state.vehicleCounty || '').rate;
      const countyLabel = state.selectedVehicle
        ? (state.vehicleCounty || 'Default')
        : 'Default';
      const line = document.getElementById('formulaRatesLine');
      if (line){
        line.textContent = `Using ${ (sRate*100).toFixed(2) }% state + ${ (cRate*100).toFixed(2) }% county (County: ${countyLabel})`;
      }
      formulaModal.classList.add('open');
      formulaModal.setAttribute('aria-hidden','false');
    }
  };
  const closeFormulaModal = () => { if (formulaModal){ formulaModal.classList.remove('open'); formulaModal.setAttribute('aria-hidden','true'); } };
  if (openFormula){ openFormula.addEventListener('click', openFormulaModal); }
  const fc = document.getElementById('formulaClose');
  const fca = document.getElementById('formulaCancel');
  if (fc) fc.addEventListener('click', closeFormulaModal);
  if (fca) fca.addEventListener('click', closeFormulaModal);
});
