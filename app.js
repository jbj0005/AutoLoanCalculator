/* Auto Loan Calculator - Mobile-Friendly, GitHub Pages ready
 * Core logic and lightweight UI wiring
 */

// --- Configuration / Defaults ---
const HOME_ADDRESS_DEFAULT = "4240 Miami Ave Melbourne, FL 32904";
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
  supabase: null,
  selectedVehicle: null,
  dbLocationGeo: null
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
  if (!state.homeZip || !state.homeCity){
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
  if (!state.supabase){ selectEl.innerHTML = '<option value="">-- none --</option>'; return; }
  const { data, error } = await state.supabase
    .from('vehicles')
    .select('id,name,msrp,location,latitude,longitude,county')
    .order('name');
  if (error){ console.warn(error); return; }
  selectEl.innerHTML = '<option value="">-- none --</option>' +
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
  if (!opt || !opt.value) return;
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
  const payoff = parseCurrency($('#loanPayoff').value);
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
  const { rate: countyRate } = getCountyRate(countyName);
  state.countyRateUsed = countyRate;

  const stateRate = state.countyRates?.meta?.stateRate ?? 0.06;
  const countyCap = state.countyRates?.meta?.countyCap ?? 5000;
  const taxableBase = Math.max(0, finalPrice - tradeValue);
  const stateTax = taxableBase * stateRate;
  const countyTax = Math.min(taxableBase, countyCap) * countyRate;
  const taxes = stateTax + countyTax;
  const showTaxes = (finalPrice || tradeValue);
  $('#taxes').textContent = showTaxes ? formatCurrency(taxes) : '—';
  const tb = document.getElementById('taxesBreakdown');
  if (tb){ tb.textContent = showTaxes ? `State: ${formatCurrency(stateTax)} • County: ${formatCurrency(countyTax)}` : '—'; }

  // Amount Financed
  // Formula used:
  // amount = finalPrice - tradeValue + payoff + (financeTF ? (govFees + dealerFees + taxes) : 0) - cashDown
  const feesTotal = govFeesTotal + dealerFeesTotal;
  const amountFinanced = Math.max(0, (finalPrice - tradeValue + payoff) + (financeTF ? (feesTotal + taxes) : 0) - cashDown);
  $('#amountFinanced').textContent = (finalPrice || tradeValue || payoff || govFeesTotal || dealerFeesTotal || taxes || cashDown) ? formatCurrency(amountFinanced) : '—';

  // APR monthly and Payments
  const monthlyRate = apr / 100 / 12;
  $('#monthlyApr').textContent = apr ? formatPercent(apr/12) : '—';
  const pmt = calcPayment(amountFinanced, monthlyRate, term);
  const pmt0 = calcPayment(amountFinanced, 0, term);
  $('#monthlyPayment').textContent = (amountFinanced && term) ? formatCurrency(pmt) : '—';
  $('#payment0').textContent = (amountFinanced && term) ? formatCurrency(pmt0) : '—';
  const delta = pmt - pmt0;
  $('#paymentDelta').textContent = (amountFinanced && term) ? `${formatCurrency(delta)}/mo` : '—';

  // Distance
  updateDistanceUI();
  updateDbMetaUI();
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
    const current = state.homeAddress || HOME_ADDRESS_DEFAULT;
    const val = prompt('Update Home Address', current);
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

  // Initial state
  // Start with one fee row to guide usage
  addFeeRow();
  addGovFeeRow();
  computeAll();
});
