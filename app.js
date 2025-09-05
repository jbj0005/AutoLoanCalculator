/* Auto Loan Calculator - Mobile-Friendly, GitHub Pages ready
 * Core logic and lightweight UI wiring
 */

// --- Configuration / Defaults ---
const HOME_ADDRESS_DEFAULT = ""; // no personal default; user can set ZIP or address
const COUNTY_DATA_URL = "data/county_tax_fl.json";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"; // Geocoding (light use only)

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
  userCountyRate: null,
  supabase: null,
  selectedVehicle: null,
  dbLocationGeo: null,
  pendingRatesImport: null
};

// --- DOM Helpers ---
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const messagesEl = () => document.getElementById('calcMessages');

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
async function geocode(address){
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('q', address);
  const res = await fetch(url.toString(), {
    headers: { 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error('Geocoding failed');
  const data = await res.json();
  if (!data || !data.length) throw new Error('Address not found');
  const item = data[0];
  const county = item?.address?.county || item?.address?.state_district || null;
  const zip = item?.address?.postcode || null;
  const city = item?.address?.city || item?.address?.town || item?.address?.village || item?.address?.hamlet || item?.address?.municipality || item?.address?.locality || null;
  return { lat: parseFloat(item.lat), lon: parseFloat(item.lon), county, zip, city };
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
    state.vehicleCoords = null;
    state.vehicleCounty = null;
    state.vehicleZip = null;
    state.vehicleCity = null;
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
  if (!geo && location){ try { geo = await geocode(location); } catch{} }

  if (selected){
    const { error } = await state.supabase.from('vehicles')
      .update({ name, msrp, location, latitude: geo?.lat ?? null, longitude: geo?.lon ?? null, county: geo?.county ?? null })
      .eq('id', selected);
    if (error){ alert('Update failed: ' + error.message); return; }
  } else {
    const { data, error } = await state.supabase.from('vehicles')
      .insert({ name, msrp, location, latitude: geo?.lat ?? null, longitude: geo?.lon ?? null, county: geo?.county ?? null })
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
  $('#calcVehicleName').textContent = '—';
  $('#calcMsrp').textContent = '—';
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
    const vNameEl = document.getElementById('calcVehicleName');
    const msrpEl = document.getElementById('calcMsrp');
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
  $('#calcVehicleName').textContent = name || '—';
  $('#calcMsrp').textContent = msrp ? formatCurrency(parseCurrency(msrp)) : '—';
  // Reflect selection in DB form for convenient updates
  $('#dbVehicleName').value = name || '';
  $('#dbMsrp').value = msrp ? formatCurrency(parseCurrency(msrp)) : '';
  $('#dbLocation').value = location || '';
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
  const finalPrice = parseCurrency($('#finalPrice').value);
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
    // No vehicle selected: prompt or use stored user rate (default 1%)
    let stored = state.userCountyRate;
    if (stored == null){
      const ls = localStorage.getItem('userCountyRate');
      if (ls != null){
        const n = parseFloat(ls);
        if (!isNaN(n)) stored = n;
      }
    }
    if (stored == null){
      const inp = prompt('Enter County Sales Tax Rate (%)', '1');
      let num = parseFloat((inp || '1').replace(/[^0-9.\-]/g,''));
      if (!isFinite(num) || num < 0) num = 1;
      stored = num / 100;
      localStorage.setItem('userCountyRate', String(stored));
    }
    state.userCountyRate = stored;
    countyRate = stored;
    countyRateSource = 'user';
  }
  state.countyRateUsed = countyRate;

  const stateRate = state.countyRates?.meta?.stateRate ?? 0.06;
  const countyCap = state.countyRates?.meta?.countyCap ?? 5000;
  // Florida: Tax base is selling price less trade-in allowance (if any),
  // plus taxable dealer fees. Government fees are NOT taxable.
  const hasTrade = tradeValue > 0;
  const baseBeforeFees = hasTrade ? Math.max(0, finalPrice - tradeValue) : finalPrice;
  const taxableBase = Math.max(0, baseBeforeFees + dealerFeesTotal);
  const stateTax = taxableBase * stateRate;
  const countyTax = Math.min(taxableBase, countyCap) * countyRate;
  const taxes = stateTax + countyTax;
  const showTaxes = (finalPrice || tradeValue);
  $('#taxes').textContent = showTaxes ? formatCurrency(taxes) : '—';
  const tb = document.getElementById('taxesBreakdown');
  if (tb){ tb.textContent = showTaxes ? `State: ${formatCurrency(stateTax)} • County: ${formatCurrency(countyTax)}` : '—'; }
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
      trn.textContent = `County: User Selected - ${cPct}`;
    }
  }
  // Total Taxes & Fees (dealer + gov + taxes)
  const totalTF = dealerFeesTotal + govFeesTotal + taxes;
  const totalTFEl = document.getElementById('totalTF');
  if (totalTFEl){ totalTFEl.textContent = (finalPrice || tradeValue || dealerFeesTotal || govFeesTotal) ? formatCurrency(totalTF) : '—'; }

  // Amount Financed
  // Formula used:
  // amount = finalPrice - tradeValue + payoff + (financeTF ? (govFees + dealerFees + taxes) : 0) - cashDown
  const feesTotal = govFeesTotal + dealerFeesTotal;
  const baseAmount = (finalPrice - tradeValue + payoff) - cashDown;
  const amountWithTF = Math.max(0, baseAmount + (feesTotal + taxes));
  const amountWithoutTF = Math.max(0, baseAmount);
  const amountFinanced = financeTF ? amountWithTF : amountWithoutTF;
  $('#amountFinanced').textContent = (finalPrice || tradeValue || payoff || govFeesTotal || dealerFeesTotal || taxes || cashDown) ? formatCurrency(amountFinanced) : '—';

  // APR monthly and Payments
  const monthlyRate = apr / 100 / 12;
  $('#monthlyApr').textContent = apr ? `${numberFmt4.format(apr/12)}%` : '—';
  const pmt = calcPayment(amountFinanced, monthlyRate, term);
  const pmt0 = calcPayment(amountFinanced, 0, term);
  // Savings on monthly payment if not financing taxes & fees
  const pmtWith = calcPayment(amountWithTF, monthlyRate, term);
  const pmtWithout = calcPayment(amountWithoutTF, monthlyRate, term);
  const pmtSavings = Math.max(0, pmtWith - pmtWithout);
  const pmtSavingsEl = document.getElementById('pmtSavings');
  if (pmtSavingsEl){ pmtSavingsEl.textContent = (term && (feesTotal || taxes)) ? `${formatCurrency(pmtSavings)}/mo` : '—'; }
  $('#monthlyPayment').textContent = (amountFinanced && term) ? formatCurrency(pmt) : '—';
  $('#payment0').textContent = (amountFinanced && term) ? formatCurrency(pmt0) : '—';
  const delta = pmt - pmt0;
  $('#paymentDelta').textContent = (amountFinanced && term) ? `${formatCurrency(delta)}/mo` : '—';

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
  if (!state.homeCoords || !state.vehicleCoords){ dEl.textContent = '—'; return; }
  const d = haversineMi(state.homeCoords, state.vehicleCoords);
  dEl.textContent = d ? `${numberFmt.format(d)} mi` : '—';
}

function updateDbMetaUI(){
  const cityEl = $('#dbCity');
  const countyEl = $('#dbCounty');
  if (cityEl) cityEl.textContent = state.vehicleCity || '—';
  if (countyEl) countyEl.textContent = state.vehicleCounty || '—';
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

  const taxesNote = document.getElementById('taxesNote');
  const itemsToMeasure = inputs.slice();
  if (taxesNote) itemsToMeasure.push(taxesNote);

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
    <input class=\"fee-amount\" type=\"text\" inputmode=\"decimal\" placeholder=\"e.g., $999\" value=\"${amount}\" />
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

  // Inputs
  ['finalPrice','tradeValue','loanPayoff','cashDown'].forEach(id => {
    const el = document.getElementById(id);
    attachCurrencyFormatter(el);
  });
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

  // Update home address via prompt
  const updateHome = async () => {
    const current = state.homeAddress || '';
    const val = prompt('Update Home (ZIP or Address)', current);
    if (val && val.trim()){
      const addr = val.trim();
      localStorage.setItem('homeAddress', addr);
      state.homeAddress = addr;
      localStorage.removeItem('homeCoords');
      state.homeCoords = null;
      await ensureHomeCoords();
      updateDistanceUI();
      updateDbMetaUI();
      computeAll();
    }
  };
  document.getElementById('updateHomeBtn').addEventListener('click', updateHome);

  // Geocode DB location as you type (debounced)
  const debouncedDbLoc = debounce(async () => {
    const loc = $('#dbLocation').value.trim();
    if (!loc) { state.dbLocationGeo = null; $('#dbLocationCounty').textContent = '—'; $('#dbLocationCoords').textContent = '—'; return; }
    try {
      const res = await geocode(loc);
      state.dbLocationGeo = res;
      $('#dbLocationCounty').textContent = res.county || '—';
      $('#dbLocationCoords').textContent = `${res.lat.toFixed(5)}, ${res.lon.toFixed(5)}`;
    } catch {
      state.dbLocationGeo = null;
      $('#dbLocationCounty').textContent = '—';
      $('#dbLocationCoords').textContent = '—';
    }
  }, 700);
  $('#dbLocation').addEventListener('input', debouncedDbLoc);

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
});
