/* AutoLoan — app.js (clean single-paste, v3)
   - 0% APR reference: shows cost of financing (payment0, paymentDelta)
   - Amount Financed note text: "Pay Taxes & Fees! You'll save $XX.XX Per Month"
   - APR/TERM placeholders: 6.5% and 72 Months
   - Keeps: 1% default county rate, goal payment, gov/dealer fees, live updates
*/

(() => {
  "use strict";

  /* =========================
     Utilities & state
  ========================= */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const messagesEl = () => document.getElementById("calcMessages");

  const state = {
    selectedVehicle: null,  // { name, msrp }
    homeAddress: null,
    homeCoords: null,
    dbLocationGeo: null,    // { county: "Orange", ... }
    vehicleCounty: "",
    countyRates: null,      // optional external JSON you load elsewhere
    countyRateUsed: 0,
    prevFocus: null,
    data: null,             // set by initDataLayer()
    _applyingGoalDown: false,
    tradeAskTouched: false
  };

  const HOME_ADDRESS_DEFAULT = "";
  const DATA_KEYS = { vehicles: "AutoLoan.vehicles" };

  /* =========================
     Supabase / Data layer
  ========================= */
  function setSupabaseStatus(ready){
    const el = document.getElementById("supabase-status");
    if (!el) return;
    el.textContent = ready ? "Supabase: connected" : "Supabase: offline (local)";
    el.classList.toggle("ok", ready);
    el.classList.toggle("warn", !ready);
  }

  function initDataLayer(){
    const url = window.SUPABASE_URL;
    const key = window.SUPABASE_ANON_KEY;

    // Detailed diagnostics to surface common setup mistakes
    const reasons = [];
    if (!window.supabase?.createClient) reasons.push("supabase-js not loaded (check CDN/script order)");
    if (!url) reasons.push("window.SUPABASE_URL missing (check config.js)");
    if (!key) reasons.push("window.SUPABASE_ANON_KEY missing (check config.js; use anon/publishable key, not service role)");

    const sb = (!reasons.length)
      ? window.supabase.createClient(url, key)
      : null;

    if (!sb) {
      state.data = null;
      setSupabaseStatus(false);
      try {
        console.error("Supabase not configured:", reasons.join("; "));
        console.debug("window.SUPABASE_URL:", url);
        console.debug("window.SUPABASE_ANON_KEY present:", !!key);
      } catch {}
      return;
    }

    state.data = {
      ready: true,
      async listVehicles(){
        try {
          let query = sb.from("vehicles").select("*");
          let { data, error } = await query.order("inserted_at", { ascending: false });
          if (error) {
            console.warn("listVehicles: order by inserted_at failed, falling back to id desc", error);
            ({ data, error } = await sb.from("vehicles").select("*").order("id", { ascending: false }));
            if (error) {
              console.warn("listVehicles: order by id failed, fetching without order", error);
              ({ data, error } = await sb.from("vehicles").select("*"));
            }
          }
          if (error) throw error;
          return data || [];
        } catch (e) {
          console.error("loadVehicles (supabase) failed", e);
          throw e;
        }
      },

      async createVehicle({ name, msrp }){
        const { data, error } = await sb
          .from('vehicles')
          .insert({ name, msrp })
          .select('*')
          .single();
        if (error) throw error;
        return data;
      },

      async updateVehicle({ id, name, msrp }){
        const { data, error } = await sb
          .from('vehicles')
          .update({ name, msrp })
          .eq('id', id)
          .select('*')
          .single();
        if (error) throw error;
        return data;
      },

      async deleteVehicle(id){
        const { error } = await sb
          .from('vehicles')
          .delete()
          .eq('id', id);
        if (error) throw error;
        return true;
      },

      async saveVehicle(v){
        // kept for backward-compat; delegates to createVehicle
        return this.createVehicle(v);
      },

      // --- Scenario data (Supabase) ---
      async listScenarios(){
        const { data, error } = await sb
          .from('scenarios')
          .select('*')
          .order('inserted_at', { ascending: false });
        if (error) throw error;
        return data || [];
      },
      async createScenario({ title, notes, snapshot }){
        // Build safe defaults from current UI
        const vehicleName = snapshot?.vehicleName || (document.getElementById('summaryVehicle')?.textContent || 'Scenario');
        const aprTxt  = document.getElementById('apr')?.value || '6.5%';
        const termTxt = document.getElementById('term')?.value || '72';
        const fallbackTitle = `${vehicleName} — ${aprTxt}/${termTxt} mo`;

        const sel = document.getElementById('vehicleSelect');
        const vehicleId = sel?.selectedOptions?.[0]?.value || null;

        const payload = {
          title: title && title.trim() ? title.trim() : fallbackTitle,
          notes: notes || '',
          snapshot: snapshot || {},
          vehicle_id: vehicleId,       // nullable: link back to vehicles if desired
          vehicle_name: vehicleName,   // denormalized label for quick list views
        };

        const { data, error } = await sb
          .from('scenarios')
          .insert(payload)
          .select('*')
          .single();   // return the inserted row
        if (error) throw error;
        return data;
      },    
    };
    setSupabaseStatus(!!sb);
  }
  // --- Scenario snapshot helpers ---
  function buildScenarioSnapshot(){
    // === Build a complete calculator snapshot for Save/Load Scenario ===
    // local helpers (scoped to this snapshot build)
    const val = (id) => (document.getElementById(id)?.value ?? "");
    const num = (id) => parseCurrency(val(id));
    const checked = (id) => !!document.getElementById(id)?.checked;
    const collectFees = (listId) => Array.from(document.querySelectorAll(`#${listId} .fee-row`)).map(row => ({
      desc: row.querySelector('.fee-desc')?.value || '',
      amount: parseCurrency(row.querySelector('.fee-amount')?.value || '')
    }));

    // vehicle selection
    const sel = document.getElementById('vehicleSelect');
    const opt = sel?.selectedOptions?.[0] || null;
    const vehicleId = opt?.value || null;
    const vehicleName = (document.getElementById('summaryVehicle')?.textContent || opt?.textContent || '')
      .replace(/\s+—\s+\$.*$/, '')
      .trim();

    // current MSRP to evaluate expressions like "msrp - 7500" or "-6%"
    const msrp = getMsrpFromUI();

    return {
      vehicleId,
      vehicleName,
      msrp,
      finalPrice: parsePriceExpression(val('finalPrice'), msrp),
      tradeValue: num('tradeValue'),
      tradeAskPrice: num('tradeAskPrice'),
      loanPayoff: num('loanPayoff'),
      cashDown: num('cashDown'),
      apr: parsePercent(val('apr')) || 6.5,
      term: parseInt(val('term'), 10) || 72,
      financeTF: checked('financeTF'),
      dealerFees: collectFees('dealerFeesList'),
      govFees: collectFees('govFeesList'),
      countyRateOverride: parsePercent(document.getElementById('countyRateInput')?.value || '') || null
    };
  }

  function applyScenarioSnapshot(snap){
    if (!snap) return;
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    const setMoney = (id, n) => { const el = document.getElementById(id); if (el) el.value = n ? fmtCurrency(n) : ''; };

    setMoney('finalPrice', snap.finalPrice);
    setMoney('tradeValue', snap.tradeValue);
    setMoney('tradeAskPrice', snap.tradeAskPrice);
    setMoney('loanPayoff', snap.loanPayoff);
    setMoney('cashDown', snap.cashDown);
    setVal('apr', snap.apr ? fmtPercentPlain(snap.apr) : '');
    setVal('term', snap.term ? String(snap.term) : '');
    const ftf = document.getElementById('financeTF');
    if (ftf) ftf.checked = !!snap.financeTF;

    // rebuild fee rows
    const rebuildFees = (listId, items) => {
      const list = document.getElementById(listId);
      if (!list) return;
      list.innerHTML = '';
      (items || []).forEach(f => addFeeRow(list, { desc: f.desc, amount: f.amount }));
    };
    rebuildFees('dealerFeesList', snap.dealerFees);
    rebuildFees('govFeesList', snap.govFees);

    // optional county override
    if (snap.countyRateOverride != null) {
      setVal('countyRateInput', fmtPercentPlain(snap.countyRateOverride));
    }

    computeAll();
  }

  /* =========================
     Formatting & parsing
  ========================= */
  const USD = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  const PCT = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 2 });

  const fmtCurrency = (n) => Number.isFinite(n) ? USD.format(n) : "";
  const fmtPercentFromDecimal = (v) => Number.isFinite(v) ? PCT.format(v) : "";
  const fmtPercentPlain = (p) => Number.isFinite(p) ? `${(+p).toFixed(2).replace(/\.00$/,'')}%` : "";

  function parseCurrency(str) {
    if (!str) return 0;
    const s = String(str).replace(/[,\s]/g, "").replace(/\$/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  // parse "6" => 6 (%), "6%" => 6, "0.06" => 6
  function parsePercent(str) {
    if (!str) return 0;
    const s = String(str).trim();
    if (/%$/.test(s)) {
      const n = Number(s.replace(/%/,'').trim());
      return Number.isFinite(n) ? n : 0;
    }
    const n = Number(s);
    if (!Number.isFinite(n)) return 0;
    return n <= 1 ? n * 100 : n;
  }

  // Allows "msrp - 1000" or "30000*0.97"
function parsePriceExpression(raw, msrp = 0) {
  if (!raw) return 0;
  let s = String(raw).trim().replace(/,/g, "").replace(/\$/g, "");

  // Shorthand percents relative to MSRP: "+6%" / "-6%"
  if ((/^[-+]\s*\d+(?:\.\d+)?\s*%\s*$/i.test(s)) && msrp > 0) {
    const sign = s.trim().startsWith('-') ? -1 : 1;
    const p = parseFloat(s.replace(/[^0-9.]/g, '')) / 100;
    return msrp * (1 + sign * p);
  }

  // Shorthand dollars relative to MSRP: "+7500" / "-7500"
  if ((/^[-+]\s*\d/.test(s)) && msrp > 0 && !/msrp/i.test(s)) {
    s = `${msrp}${s}`; // e.g., "85000-7500"
  }

  // Expand "msrp - 6%" => "msrp * (1 - 0.06)"
  s = s.replace(/msrp\s*([+\-])\s*(\d+(?:\.\d+)?)\s*%/ig, (_m, op, num) =>
    `(${msrp}) * (1 ${op} ${parseFloat(num)/100})`
  );

  // Replace remaining MSRP tokens with numeric value
  if (/msrp/i.test(s)) s = s.replace(/msrp/ig, String(msrp));

  // Convert standalone percents (e.g., "5%" -> "(0.05)")
  s = s.replace(/(\d+(?:\.\d+)?)%/g, (_m, num) => `(${parseFloat(num)/100})`);

  // Whitelist numeric/expression characters
  if (!/^[0-9+\-*/().\s]*$/.test(s)) return 0;

  try {
    // eslint-disable-next-line no-new-func
    const val = Function(`"use strict";return (${s || 0});`)();
    const n = Number(val);
    return Number.isFinite(n) ? n : 0;
  } catch { return 0; }
}
  /* =========================
     External hooks (safe no-ops)
  ========================= */
  const scheduleSave = (typeof window.scheduleSave === "function") ? window.scheduleSave : () => {};
  const geocode      = (typeof window.geocode === "function")      ? window.geocode      : async (addr) => ({ lat: NaN, lon: NaN, address: addr });
  const getCountyRate= (typeof window.getCountyRate === "function") ? window.getCountyRate: (countyName) => ({ rate: 0, defaulted: true, county: countyName || "DEFAULT" });

  /* =========================
     Toast
  ========================= */
  let msgTimer = null;
  function showCalcMessage(text, kind = "") {
    try {
      const el = messagesEl();
      if (!el) return;
      el.textContent = text || "";
      el.classList.remove("ok", "warn", "err", "computed");
      if (kind) el.classList.add(kind);
      clearTimeout(msgTimer);
      if (text) {
        msgTimer = setTimeout(() => {
          try { el.textContent = ""; el.classList.remove("ok", "warn", "err", "computed"); } catch {}
        }, 4000);
      }
    } catch {}
  }

  /* =========================
     Inert helpers
  ========================= */
  function setPageInert(except) {
    for (const el of Array.from(document.body.children)) {
      if (el === except) continue;
      try { el.inert = true; } catch {}
    }
  }
  function clearPageInert() {
    for (const el of Array.from(document.body.children)) {
      try { el.inert = false; } catch {}
    }
  }

  /* =========================
     Debounce
  ========================= */
  function debounce(fn, ms = 80) {
    let t = 0;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }
  const debouncedComputeAll = debounce(() => computeAll(), 80);

  /* =========================
     Home geocoding (no-op UI)
  ========================= */
  async function ensureHomeCoords() {
    const addr = state.homeAddress || HOME_ADDRESS_DEFAULT;
    if (!addr) { state.homeCoords = null; updateDistanceUI(); return; }
    try {
      const geo = await geocode(addr);
      const lat = Number(geo?.lat), lon = Number(geo?.lon);
      state.homeCoords = (Number.isFinite(lat) && Number.isFinite(lon)) ? { lat, lon } : null;
    } catch { state.homeCoords = null; }
    updateDistanceUI();
  }
  function updateDistanceUI() {
    const el = $("#distanceFromHome");
    if (!el) return;
    el.textContent = "—";
  }

  /* =========================
     Vehicle modal (optional)
  ========================= */
  async function ensureVehiclePAC() {}
  async function openVehicleModal(mode) {
    const modal = document.getElementById("vehicleModal");
    const title = document.getElementById("vehicleModalTitle");
    const nameI = document.getElementById("dbVehicleName");
    const msrpI = document.getElementById("dbMsrp");
    if (!modal || !title) return;

    const sel = document.getElementById('vehicleSelect');
    modal.dataset.mode = (mode === 'update') ? 'update' : 'add';
    modal.dataset.id = '';

    if (mode === 'update') {
      title.textContent = 'Update Vehicle';
      const opt = sel?.selectedOptions?.[0];
      const id = opt?.value || '';
      if (!id) { alert('Select a vehicle to update'); return; }
      modal.dataset.id = id;
      if (nameI) nameI.value = (opt?.textContent || '').replace(/\s+—\s+\$.*$/, '').trim();
      if (msrpI) msrpI.value = opt?.dataset?.msrp ? fmtCurrency(Number(opt.dataset.msrp)) : '';
    } else {
      title.textContent = 'Add Vehicle';
      if (nameI) nameI.value = '';
      if (msrpI) msrpI.value = '';
      if (sel) sel.value = '';
    }

    state.prevFocus = document.activeElement;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    try { setPageInert(modal); } catch {}
    setTimeout(() => { try { ensureVehiclePAC(); } catch {} }, 0);
    const focusEl = document.getElementById('dbVehicleName');
    if (focusEl?.focus) setTimeout(() => focusEl.focus(), 0);
  }

  function closeVehicleModal(){
    const modal = document.getElementById('vehicleModal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    try { clearPageInert(); } catch {}
    try { state.prevFocus?.focus?.(); } catch {}
  }

  /* =========================
     Fee rows: add/sum helpers
  ========================= */
  function sumFeeList(listEl){
    if (!listEl) return 0;
    return $$("input.fee-amount", listEl)
      .map(i => parseCurrency(i.value))
      .filter(Number.isFinite)
      .reduce((a,b)=>a+b, 0);
  }

  function recalcGovFeesTotal(){
    const list = document.getElementById("govFeesList");
    const total = sumFeeList(list);
    const outEl = document.getElementById("govFeesOut") || document.getElementById("govFeesTotal");
    if (outEl) outEl.textContent = fmtCurrency(total);
    return total;
  }

  function addFeeRow(targetList, preset = null){
    const row = document.createElement("div");
    row.className = "fee-row";
    const desc = preset?.desc || "";
    const amt  = preset?.amount ?? "";
    row.innerHTML = `
      <input class="fee-desc" type="text" placeholder="Description" aria-label="Fee description" enterkeyhint="next" value="${desc}" />
      <input class="fee-amount" type="text" inputmode="decimal" placeholder="Enter Amount" aria-label="Fee amount" enterkeyhint="next" value="${Number.isFinite(amt) ? fmtCurrency(amt) : ""}" />
      <button type="button" class="fee-remove" aria-label="Remove fee">✕</button>
    `;
    targetList.appendChild(row);
    attachCurrencyFormatter($(".fee-amount", row));
    // Hitting Enter in the description moves focus to the amount field
    const descEl = $(".fee-desc", row);
    const amtEl  = $(".fee-amount", row);
    if (descEl && amtEl) {
      descEl.addEventListener('keydown', (e)=>{
        if (e.key === 'Enter') { e.preventDefault(); try { descEl.blur(); } catch {}; amtEl.focus?.(); amtEl.select?.(); }
      });
    }
    $(".fee-remove", row)?.addEventListener("click", () => { row.remove(); computeAll(); });
  }

  /* =========================
     Goal payment helper
  ========================= */
  function computeDownForGoal(goalMonthly, inputs) {
    const {
      priceForCalc, tradeValue, payoff, cashDown,
      apr, term, dealerFeesTotal, govFeesTotal,
      countyRate, stateRate, countyCap
    } = inputs;

    const baseBeforeFees = tradeValue > 0 ? Math.max(0, priceForCalc - tradeValue) : priceForCalc;
    const taxableBase    = Math.max(0, baseBeforeFees + dealerFeesTotal);
    const stateTax       = taxableBase * stateRate;
    const countyTax      = Math.min(taxableBase, countyCap) * countyRate;
    const taxes          = stateTax + countyTax;

    const r = (apr / 100 / 12) || 0;
    const n = term || 0;

    const paymentToPV = (p, r, n) => r ? p * (1 - Math.pow(1 + r, -n)) / r : p * n;
    const neededPV    = paymentToPV(goalMonthly, r, n);

    const feesTotal   = dealerFeesTotal + govFeesTotal;
    const baseAmount  = (priceForCalc - tradeValue + payoff) - cashDown;
    const financeTF   = $("#financeTF")?.checked ?? true;

    const targetAmount = financeTF ? (neededPV - (feesTotal + taxes)) : neededPV;
    const extraDown    = Math.max(0, baseAmount - targetAmount);

    return { extraDown, taxes, feesTotal };
  }

  // Payment PMT for principal P at monthly rate i and term n (months).
  // Formula: PMT = P * [ i(1+i)^n / ( (1+i)^n − 1 ) ]
  function pmtFor(P, i, n){
    if (!Number.isFinite(P) || P <= 0 || !Number.isFinite(n) || n <= 0) return 0;
    if (!Number.isFinite(i) || i <= 0) return P / n; // 0% APR case
    const pow = Math.pow(1 + i, n);
    return P * (i * pow) / (pow - 1);
  }

  // Solve monthly rate i (APR% = i*12*100) that yields targetPmt for principal P and term n.
  // Binary search i ∈ [0, 1] (0%..100% per month).
  function solveMonthlyRateForPayment(P, targetPmt, n){
    if (!Number.isFinite(P) || P <= 0 || !Number.isFinite(targetPmt) || targetPmt <= 0 || !Number.isFinite(n) || n <= 0) return null;
    const minPmt = P / n;                // PMT at 0% APR
    if (targetPmt <= minPmt + 1e-9) return 0; // implies APR ≤ 0%
    let lo = 0, hi = 1;
    for (let k = 0; k < 60; k++){
      const mid = (lo + hi) / 2;
      const p = pmtFor(P, mid, n);
      if (p > targetPmt) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  }

  // Solve required term n (months) for payment targetPmt at monthly rate i.
  // Closed form (for i>0): n = -ln(1 - (P*i)/PMT) / ln(1 + i)
  // For i = 0:           n = P / PMT
  function solveTermForPayment(P, targetPmt, i){
    if (!Number.isFinite(P) || P <= 0 || !Number.isFinite(targetPmt) || targetPmt <= 0) return null;
    if (!Number.isFinite(i) || i <= 0){
      const n0 = P / targetPmt;
      return Number.isFinite(n0) && n0 > 0 ? n0 : null;
    }
    const threshold = P * i;             // must have PMT > P*i to amortize
    if (targetPmt <= threshold + 1e-12) return Infinity; // payment too low for current APR
    const n = -Math.log(1 - (threshold / targetPmt)) / Math.log(1 + i);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  /* =========================
     MSRP sourcing
  ========================= */
  function getMsrpFromUI(){
    const msrpEl = document.getElementById("msrp");
    let n = parseCurrency(msrpEl?.value ?? msrpEl?.textContent ?? "");
    if (n > 0) return n;

    const dbMsrpEl = document.getElementById("dbMsrp");
    n = parseCurrency(dbMsrpEl?.value ?? dbMsrpEl?.textContent ?? "");
    if (n > 0) return n;

    const sel = document.getElementById("vehicleSelect");
    const opt = sel?.selectedOptions?.[0];
    const dataMsrp = Number(opt?.dataset?.msrp || opt?.getAttribute?.("data-msrp"));
    if (Number.isFinite(dataMsrp) && dataMsrp > 0) return dataMsrp;

    n = Number(state.selectedVehicle?.msrp);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /* =========================
     Vehicle summary output
  ========================= */

function updateVehicleSummary(){
  const wrap = document.getElementById("vehicleSummary");
  const nameEl = document.getElementById("summaryVehicle");
  const msrpEl = document.getElementById("summaryMsrp");
  if (!wrap) return;
  const v = state.selectedVehicle || {};
  const hasName = !!(v.name && v.name.trim());
  const hasMsrp = Number.isFinite(v.msrp) && v.msrp > 0;

  if (nameEl) nameEl.textContent = hasName ? v.name.trim() : "—";
  if (msrpEl) msrpEl.textContent = hasMsrp ? fmtCurrency(v.msrp) : "—";

  wrap.classList.toggle("computed", !!(hasName || hasMsrp));
}

  /* =========================
     Trade equity output
  ========================= */
  function formatAccounting(n){
    if (!Number.isFinite(n)) return "";
    if (n < 0) return `(${fmtCurrency(Math.abs(n))})`;
    return fmtCurrency(n);
  }
  function updateTradeEquity(tradeValue, payoff){
    const out = document.getElementById("tradeEquity") || document.getElementById("tradeEquityOut");
    if (!out) return;
    const equity = tradeValue - payoff;
    out.textContent = formatAccounting(equity);
    out.classList.remove("delta-pos","delta-neg");
    out.style.color = "";
    if (equity > 0) out.classList.add("delta-pos");
    else if (equity < 0) out.classList.add("delta-neg");
  }

  /* =========================
     County rate manual override
  ========================= */
  function getCountyRateOverrideDecimal(){
    const el = document.getElementById("countyRateInput");
    if (!el) return null;
    const p = parsePercent(el.value);
    if (!p || p < 0) return null;
    return p / 100; // decimal
  }
  function attachPercentFormatter(input){
    if (!input) return;
    input.addEventListener("blur", () => {
      const p = parsePercent(input.value);
      input.value = p ? fmtPercentPlain(p) : "";
      computeAll();
    });
    input.addEventListener("input", debouncedComputeAll);
  }

  /* =========================
     Taxes helper
  ========================= */
  function computeTaxes({ priceForCalc, tradeValue, dealerFeesTotal, stateRate, countyRate, countyCap }) {
    const baseBeforeFees = tradeValue > 0 ? Math.max(0, priceForCalc - tradeValue) : priceForCalc;
    const taxableBase    = Math.max(0, baseBeforeFees + dealerFeesTotal);
    const stateTax       = taxableBase * stateRate;
    const countyTax      = Math.min(taxableBase, countyCap) * countyRate;
    return { baseBeforeFees, taxableBase, stateTax, countyTax, taxes: stateTax + countyTax };
  }

  /* =========================
     Core calculation
  ========================= */
  function computeAll() {
    // Hard-remove deprecated Price Delta to Goal UI if present
    try {
      const pdRow = document.getElementById('priceDeltaForGoalRow');
      if (pdRow && pdRow.remove) pdRow.remove();
      const pdVal = document.getElementById('priceDeltaForGoal');
      // If a stray value node exists outside the row, remove it too
      if (pdVal && (!document.getElementById('priceDeltaForGoalRow')) && pdVal.remove) pdVal.remove();
    } catch {}
    // Inputs
    const fpEl       = $("#finalPrice");
    const tradeEl    = $("#tradeValue");
    const tradeAskEl = $("#tradeAskPrice");
    const payoffEl   = $("#loanPayoff");
    const cashDownEl = $("#cashDown");
    const aprEl      = $("#apr");
    const termEl     = $("#term");
    const goalEl     = $("#goalMonthly");
    const autoApplyGoal = $("#goalAutoApply")?.checked ?? false;

        if (fpEl && /msrp/i.test(fpEl.value || "")) { state._fpDirty = true; }
    const msrp       = getMsrpFromUI();
    const finalPrice = parsePriceExpression(fpEl?.value || fpEl?.textContent || "", msrp);
    let priceForCalc = msrp;
    if (finalPrice > 0) {
      priceForCalc = finalPrice;
    } else if (finalPrice < 0) {
      showCalcMessage("Final Sale Price can't be negative — clamped to $0", "warn");
      priceForCalc = 0; // keep the input text; just clamp for the math
    }
    const tradeValue = parseCurrency(tradeEl?.value ?? "");
    const payoffRaw  = parseCurrency(payoffEl?.value ?? "");
    // If user only enters Payoff (no Trade-in Offer), treat it as negative equity
    const payoff     = payoffRaw;
    let tradeAskPrice = parseCurrency(tradeAskEl?.value ?? "");
    const cashDown   = parseCurrency(cashDownEl?.value ?? "");

    // Trade equity breakdown (positive vs. negative)
    const tradeEquity = (tradeValue || 0) - (payoff || 0);
    const posEquity   = Math.max(0, tradeEquity);
    const negEquity   = Math.max(0, -tradeEquity);
    // Show current negative equity next to the checkbox, if present
    try {
      const negEqSpan = document.getElementById('negEquityValue');
      if (negEqSpan) negEqSpan.textContent = negEquity > 0 ? ` (−${fmtCurrency(negEquity)})` : ' (—)';
    } catch {}

    // APR & TERM with functional defaults if inputs are blank
    const _aprParsed  = parsePercent(aprEl?.value ?? aprEl?.textContent ?? ""); // % number
    const _termParsed = parseInt(termEl?.value ?? termEl?.textContent ?? "0", 10) || 0;
    const aprPercent  = _aprParsed || 6.5;  // default to 6.5% for calc if user left blank
    const term        = _termParsed || 72;  // default to 72 months for calc if user left blank

    // Monthly rate (APR/12) -> #monthlyApr
    const monthlyRateEl =
      document.getElementById("monthlyApr") ||
      document.getElementById("monthlyRatePct") ||
      document.getElementById("monthlyRate");
    if (monthlyRateEl) {
      const monthlyPct = (aprPercent / 12) || 0; // in percent units
      monthlyRateEl.textContent = `${monthlyPct.toFixed(4)}%`;
    }

    // Equity UI
    updateTradeEquity(tradeValue, payoff);

    // Fees
    const dealerFeesTotal = sumFeeList(document.getElementById("dealerFeesList"));
    const govFeesTotal    = recalcGovFeesTotal();
    const feesTotal       = dealerFeesTotal + govFeesTotal;

    // Rates
    const userCountyRate = getCountyRateOverrideDecimal(); // decimal or null
    const inferredCounty = state.dbLocationGeo?.county || state.vehicleCounty || "";
    const autoCounty     = getCountyRate(inferredCounty);

    // Default county rate to 1% when unspecified
    const countyRate     = (userCountyRate ?? (autoCounty.rate || 0.01));
    const defaulted      = userCountyRate == null ? (autoCounty.defaulted && !autoCounty.rate) : false;
    state.countyRateUsed = countyRate;

    const stateRate = state.countyRates?.meta?.stateRate ?? 0.06;
    const countyCap = state.countyRates?.meta?.countyCap ?? 5000;

    // Taxes (with / without trade)
    const tWith    = computeTaxes({ priceForCalc, tradeValue, dealerFeesTotal, stateRate, countyRate, countyCap });
    const tNoTrade = computeTaxes({ priceForCalc, tradeValue: 0, dealerFeesTotal, stateRate, countyRate, countyCap });
    const taxes    = tWith.taxes;

// Tax Savings w/ Trade-in — show under Trade-in Offer label
const taxSavings = Math.max(0, tNoTrade.taxes - taxes);
const taxSavingsEl = document.getElementById("tradeSavingsWith") || document.getElementById("taxSavingsTrade") || document.getElementById("taxSavings");
if (taxSavingsEl) {
  const hasTrade = tradeValue > 0;
  if (hasTrade) {
    // If price not available yet, show $0.00 until it is
    const shown = (priceForCalc > 0) ? taxSavings : 0;
    taxSavingsEl.textContent = `Trade-in Tax Savings: ${fmtCurrency(shown)}`;
    taxSavingsEl.classList.add("computed");
    taxSavingsEl.setAttribute("aria-live", "polite");
  } else {
    // Always show prompt text when no trade value is entered
    taxSavingsEl.textContent = "Enter a Trade-in Offer to see your Tax Savings";
    taxSavingsEl.classList.remove("computed");
    taxSavingsEl.setAttribute("aria-live", "polite");
  }
}
    // (removed Trade-in Tax Value note and computation)

    // Asking vs Offer Delta = Asking - Offer (accounting format; colored text only)
    // Only display when a Trade-in Asking Price is provided by the user
    try {
      const deltaEl = document.getElementById('tradeAskOfferDelta');
      const deltaRow = deltaEl?.closest('.note') || null;
      if (deltaEl) {
        const hasAsk = Number.isFinite(tradeAskPrice) && tradeAskPrice > 0;
        if (hasAsk) {
          // Display requires explicit Asking Price entry
          const askEff = tradeAskPrice;
          const delta = (askEff) - (tradeValue || 0);
          deltaEl.textContent = formatAccounting(delta);
          deltaEl.classList.remove('delta-pos','delta-neg','text-only');
          // Flip accounting colors: Negative (offer > asking) shown as positive/green
          if (delta < 0) deltaEl.classList.add('delta-pos');
          else if (delta > 0) deltaEl.classList.add('delta-neg');
          deltaEl.classList.add('text-only');
          if (deltaRow) { deltaRow.style.display = ''; deltaRow.setAttribute('aria-hidden','false'); }
        } else {
          deltaEl.textContent = '';
          deltaEl.classList.remove('delta-pos','delta-neg','text-only');
          if (deltaRow) { deltaRow.style.display = 'none'; deltaRow.setAttribute('aria-hidden','true'); }
        }
      }
    } catch {}
    // CASH DIFFERENCE / TAXABLE BASE (displayed before Dealer Fees)
    try {
      const cashDiffVal = Math.max(0, (priceForCalc || 0) - (tradeValue || 0));
      const cashDiffOut = document.getElementById('cashDifferenceOut');
      // Show cashDifferenceOut only when a trade value is entered (> 0)
      const showCashDiff = Number.isFinite(tradeValue) && (tradeValue > 0);
      if (cashDiffOut) {
        if (showCashDiff) {
          cashDiffOut.textContent = fmtCurrency(cashDiffVal);
          cashDiffOut.classList.add('computed');
          try { cashDiffOut.style.display = ''; } catch {}
          try { cashDiffOut.setAttribute('aria-hidden', 'false'); } catch {}
        } else {
          cashDiffOut.textContent = '';
          cashDiffOut.classList.remove('computed');
          try { cashDiffOut.style.display = 'none'; } catch {}
          try { cashDiffOut.setAttribute('aria-hidden', 'true'); } catch {}
        }
      }

      const taxableBaseOut = document.getElementById('taxableBaseOut');
      if (taxableBaseOut) {
        taxableBaseOut.textContent = fmtCurrency(tWith.taxableBase);
        taxableBaseOut.classList.add('computed');
      }
    } catch {}
    // Totals
    const totalTaxesFees = taxes + feesTotal;
    const showTaxes = priceForCalc > 0;

    const taxesEl = document.getElementById("taxes");
    if (taxesEl) taxesEl.textContent = showTaxes ? fmtCurrency(taxes) : "—";

    const tb = document.getElementById("taxesBreakdown");
    if (tb) {
      if (showTaxes) {
        tb.textContent = `State Tax ${fmtCurrency(tWith.stateTax)} | County Tax ${fmtCurrency(tWith.countyTax)}`;
        tb.classList.add("computed");
      } else {
        tb.textContent = "Enter a price to compute taxes";
        tb.classList.remove("computed");
      }
    }
    // Show the exact taxable base under Taxes
    const taxableBaseNote = document.getElementById("taxableBaseNote");
    if (taxableBaseNote) {
      if (showTaxes) {
        taxableBaseNote.textContent = `Taxable Base — ${fmtCurrency(tWith.taxableBase)}`;
        taxableBaseNote.classList.add("computed");
      } else {
        taxableBaseNote.textContent = "Taxable Base — —";
        taxableBaseNote.classList.remove("computed");
      }
    }
    const trn = document.getElementById("taxesRatesNote");
    if (trn) {
      trn.textContent = `County Tax Rate = ${fmtPercentFromDecimal(countyRate)}${defaulted ? " (Default 1%)" : inferredCounty ? ` (${inferredCounty})` : ""}`;
    }
    const ttf = document.getElementById("totalTF") || document.getElementById("totalTaxesAndFees");
    if (ttf) ttf.textContent = showTaxes ? fmtCurrency(totalTaxesFees) : "—";

    // SUBTOTAL = Taxable Base + Total Taxes & Fees
    try {
      const subEl = document.getElementById('subtotalOut');
      if (subEl) {
        const subtotalVal = (tWith?.taxableBase || 0) + (totalTaxesFees || 0);
        subEl.textContent = showTaxes ? fmtCurrency(subtotalVal) : "—";
        subEl.classList.add('computed');
      }
    } catch {}

    // Amount financed & monthly
    const financeTF       = document.getElementById('financeTF')?.checked ?? true;
    const financeNegEquity= document.getElementById('financeNegEquity')?.checked ?? true;

    // Base principal includes equity already: (price - trade + payoff) - cashDown
    const baseAmount     = (priceForCalc - tradeValue + payoff) - cashDown;

    // Start from base, optionally roll-in Taxes & Fees
    let amountFinanced   = Math.max(0, financeTF ? baseAmount + taxes + feesTotal : baseAmount);

    // If NOT financing negative equity, remove it from Amount Financed (it will be due upfront)
    if (!financeNegEquity && negEquity > 0) {
      amountFinanced = Math.max(0, amountFinanced - negEquity);
    }

    const r = (aprPercent / 100 / 12) || 0;
    const n = term || 0;
    const pmnt = (principal) => n > 0
      ? (r ? principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1) : principal / n)
      : 0;

    // Current monthly with current APR
    const monthly = pmnt(amountFinanced);

    // 0% APR reference (same principal & term)
    const zeroAprMonthly = n > 0 ? (amountFinanced / n) : 0;
    const financingCostPerMonth = Math.max(0, monthly - zeroAprMonthly);

    // Savings if you DO NOT finance Taxes & Fees and/or Negative Equity
    const totalTF_forSavings = (dealerFeesTotal || 0) + (govFeesTotal || 0) + (taxes || 0);

    // Reconstruct a core principal that excludes BOTH T&F and negative equity regardless of current toggles
    const basePrincipalCore = Math.max(0,
      (amountFinanced || 0)
      - (financeTF ? totalTF_forSavings : 0)
      - (financeNegEquity ? negEquity : 0)
    );

    // A) Savings from not financing Taxes & Fees
    const principal_WithTF = Math.max(0, basePrincipalCore + totalTF_forSavings + (financeNegEquity ? negEquity : 0));
    const principal_NoTF   = Math.max(0, basePrincipalCore + (financeNegEquity ? negEquity : 0));
    const monthly_WithTF   = pmnt(principal_WithTF);
    const monthly_NoTF     = pmnt(principal_NoTF);
    const dontFinanceSavingsTF = Math.max(0, monthly_WithTF - monthly_NoTF);

    // B) Savings from not financing Negative Equity (only meaningful if negEquity > 0)
    const principal_WithNegEq = Math.max(0, basePrincipalCore + (financeTF ? totalTF_forSavings : 0) + negEquity);
    const principal_NoNegEq   = Math.max(0, basePrincipalCore + (financeTF ? totalTF_forSavings : 0));
    const monthly_WithNegEq   = pmnt(principal_WithNegEq);
    const monthly_NoNegEq     = pmnt(principal_NoNegEq);
    const dontFinanceSavingsNegEq = Math.max(0, monthly_WithNegEq - monthly_NoNegEq);

    // Combined monthly savings vs. financing whatever is currently toggled ON
    const combinedSavings = dontFinanceSavingsTF + (negEquity > 0 ? dontFinanceSavingsNegEq : 0);

    // Debug hook (non-UI): quick probe in console when needed
    window.__autoLoanDbg = {
      aprPercent, term, r, n, amountFinanced, priceForCalc, tradeValue, payoff, cashDown,
      dealerFeesTotal, govFeesTotal, taxes, dontFinanceSavingsTF, dontFinanceSavingsNegEq, combinedSavings
    };

    // Baseline monthly (no trade/payoff) — retained for other UI blocks if present
    const baseBeforeFees0 = Math.max(0, (finalPrice && finalPrice > 0 ? finalPrice : msrp));
    const tNoTradeAgain   = computeTaxes({ priceForCalc: baseBeforeFees0, tradeValue: 0, dealerFeesTotal, stateRate, countyRate, countyCap });
    const amountFinanced0 = Math.max(0, financeTF ? (baseBeforeFees0 - 0 + 0 - cashDown) + tNoTradeAgain.taxes + feesTotal
                                                   : (baseBeforeFees0 - 0 + 0 - cashDown));
    const monthlyNoTrade  = pmnt(amountFinanced0);
    const paymentDelta    = Math.max(0, monthlyNoTrade - monthly);

    // Goal Payment: compute extra cash down required to meet target monthly
    const goalMonthly = parseCurrency(goalEl?.value ?? "");
    const goalDownOut = document.getElementById("goalDownNeeded") || document.getElementById("goalDownOut");
    const finalPriceForGoalEl = document.getElementById("finalPriceForGoal");
    // Rows (notes) inside Monthly Affordability cell
    const goalDownRow = document.getElementById('goalDownNeeded')?.closest('.note') || null;
    const goalAprRow  = document.getElementById('goalAprTermNote')?.closest('.note') || null;
    const goalPriceRow= document.getElementById('finalPriceForGoal')?.closest('.note') || null;
    // --- Begin Goal Payment Block ---
    if (goalMonthly > 0 && n > 0) {
      const metGoal = Number.isFinite(monthly) && monthly > 0 && monthly <= goalMonthly;
      // Ensure rows are visible when a goal is set
      [goalDownRow, goalAprRow, goalPriceRow].forEach(row => {
        if (!row) return;
        try { row.style.display = ''; row.setAttribute('aria-hidden','false'); } catch {}
      });
      const pow = Math.pow(1 + r, n);
      const principalNeeded = r ? (goalMonthly * (pow - 1) / (r * pow)) : (goalMonthly * n);

      const currentPrincipal = amountFinanced; // reflects financeTF choice above
      const extraDown = Math.max(0, currentPrincipal - principalNeeded);

      if (goalDownOut) {
        goalDownOut.textContent = extraDown > 0 ? fmtCurrency(extraDown) : '—';
        goalDownOut.classList.toggle("computed", true);
      }

      // Compute Final Sale Price required to achieve monthlyPayment = goalMonthly
      let priceForGoal = NaN;
      if (!financeTF) {
        // Principal excludes Taxes & Fees
        priceForGoal = principalNeeded + tradeValue - payoff + cashDown;
      } else {
        // Principal includes Taxes & Fees (piecewise due to county cap)
        // taxableBase = (price - tradeValue) + dealerFeesTotal  [assumes positive base region]
        // Case A: taxableBase <= countyCap  -> slope S1 = 1 + stateRate + countyRate
        // Case B: taxableBase >= countyCap  -> slope S2 = 1 + stateRate (county term saturated)
        const S1 = 1 + stateRate + countyRate;
        const S2 = 1 + stateRate;
        const K1 = payoff - cashDown + feesTotal
                 - (1 + stateRate + countyRate) * tradeValue
                 + (stateRate + countyRate) * dealerFeesTotal;
        const K2 = payoff - cashDown + feesTotal
                 - (1 + stateRate) * tradeValue
                 + (stateRate) * dealerFeesTotal
                 + (countyRate * countyCap);
        const capThreshold = countyCap + tradeValue - dealerFeesTotal; // price at which taxableBase crosses the cap

        const x1 = (principalNeeded - K1) / S1; // candidate under cap
        const x2 = (principalNeeded - K2) / S2; // candidate over cap

        // Choose the consistent solution
        const x1Valid = (x1 <= capThreshold);
        const x2Valid = (x2 >= capThreshold);
        priceForGoal = x1Valid ? x1 : x2Valid ? x2 : x1; // fall back to x1 if neither strictly valid
      }

      if (finalPriceForGoalEl) {
        finalPriceForGoalEl.textContent = (Number.isFinite(priceForGoal) && priceForGoal > 0)
          ? fmtCurrency(priceForGoal)
          : "—";
        finalPriceForGoalEl.classList.add("computed");
      }

      // Additional note: what APR / TERM would be required to meet goalMonthly
      try {
        const noteEl = document.getElementById('goalAprTermNote');
        if (noteEl) {
          const P   = amountFinanced;  // current principal
          const tgt = goalMonthly;     // target monthly payment
          const nCur = n;              // current term (months)
          const iCur = r;              // current monthly rate (APR/12)

          if (noteEl) {
            const P   = amountFinanced;  // current principal
            const tgt = goalMonthly;     // target monthly payment
            const nCur = n;              // current term (months)
            const iCur = r;              // current monthly rate (APR/12)

            // Required APR at current TERM (returning monthly rate). If 0, APR is 0%.
            const iNeeded = solveMonthlyRateForPayment(P, tgt, nCur);
            const aprPctNeeded = (iNeeded == null || iNeeded === Infinity || iNeeded < 0)
              ? null
              : (iNeeded * 12 * 100);

            // Required TERM at current APR (months). Infinity means payment too low; null = not determinable.
            const nNeededRaw = solveTermForPayment(P, tgt, iCur);
            const nNeededMo = (nNeededRaw === Infinity || nNeededRaw == null || !(Number.isFinite(nNeededRaw)))
              ? null
              : Math.ceil(nNeededRaw);

            const aprPart  = (aprPctNeeded == null)
              ? null
              : aprPctNeeded;
            const termNeeded = (nNeededMo == null) ? null : nNeededMo;

            const warnText = 'Out of Range - Try Different Affordability Amount';
            const outOfRange = (aprPart != null && aprPart <= 0) || (nCur > 96) || (termNeeded != null && termNeeded > 96);

            const noteWrap = noteEl.closest('.note');
            if (outOfRange) {
              noteEl.textContent = warnText;
              noteEl.classList.remove('computed');
              if (noteWrap) noteWrap.classList.add('warn');
            } else {
              const aprPartStr  = (aprPart == null) ? 'APR ~—' : `APR ~${fmtPercentPlain(aprPart)}`;
              const termPartStr = (termNeeded == null) ? '~— months' : `~${termNeeded} months`;
              // Concise note for APR/TERM adjustments (value-only; label is in HTML)
              noteEl.textContent = `${aprPartStr} @ ${nCur} months, OR ${termPartStr} @ ${fmtPercentPlain(aprPercent)}`;
              noteEl.classList.add('computed');
              if (noteWrap) noteWrap.classList.remove('warn');
            }
          }
        }
      } catch {}

      // If goal is met, override all Monthly Affordability notes with a congrats message
      try {
        if (metGoal) {
          const congrats = `Congrats! You\'ve Met Your Affordability Goal by `;
          const delta = Math.max(0, goalMonthly - monthly);
          const amtHTML = `<span class="delta-pos text-only">${fmtCurrency(delta)}</span>`;

          const downEl = document.getElementById('goalDownNeeded');
          if (downEl) { downEl.innerHTML = `${congrats}${amtHTML}`; downEl.classList.add('computed'); }

          const aprNote = document.getElementById('goalAprTermNote');
          if (aprNote) {
            aprNote.innerHTML = `${congrats}${amtHTML}`;
            aprNote.classList.add('computed');
            const wrap = aprNote.closest('.note');
            if (wrap) wrap.classList.remove('warn');
          }

          const priceEl = document.getElementById('finalPriceForGoal');
          if (priceEl) { priceEl.innerHTML = `${congrats}${amtHTML}`; priceEl.classList.add('computed'); }
        }
      } catch {}
      // Show single congrats note and hide strategy notes when goal is met
      try {
        const goalCongratsRow = document.getElementById('goalCongratsRow');
        const delta = Math.max(0, goalMonthly - monthly);
        if (metGoal && goalCongratsRow) {
          goalCongratsRow.innerHTML = `Congrats! You\'ve Met Your Affordability Goal by <span class="delta-pos text-only">${fmtCurrency(delta)}</span>`;
          goalCongratsRow.style.display = '';
          goalCongratsRow.setAttribute('aria-hidden','false');
          [goalDownRow, goalAprRow, goalPriceRow].forEach(row => {
            if (!row) return;
            try { row.style.display = 'none'; row.setAttribute('aria-hidden','true'); } catch {}
          });
        } else if (goalCongratsRow) {
          goalCongratsRow.style.display = 'none';
          goalCongratsRow.setAttribute('aria-hidden','true');
        }
      } catch {}
      if (autoApplyGoal && !state._applyingGoalDown) {
        state._applyingGoalDown = true;
        const newDown = Math.max(0, cashDown + extraDown);
        if (cashDownEl) cashDownEl.value = newDown ? fmtCurrency(newDown) : "";
        computeAll();
        state._applyingGoalDown = false;
        return;
      }
    } else {
      if (goalDownOut) goalDownOut.textContent = "";
      if (finalPriceForGoalEl) { finalPriceForGoalEl.textContent = ""; finalPriceForGoalEl.classList.remove("computed"); }
      const noteEl = document.getElementById("goalAprTermNote");
      if (noteEl) { noteEl.textContent = ""; noteEl.classList.remove("computed"); }
      // Hide rows when no goal value is set
      [goalDownRow, goalAprRow, goalPriceRow].forEach(row => {
        if (!row) return;
        try { row.style.display = 'none'; row.setAttribute('aria-hidden','true'); row.classList.remove('warn','computed'); } catch {}
      });
      try {
        const c = document.getElementById('goalCongratsRow');
        if (c) { c.style.display='none'; c.setAttribute('aria-hidden','true'); }
      } catch {}
    }
    // ---------- Outputs ----------
    (document.getElementById("amountFinanced")  ) && (document.getElementById("amountFinanced").textContent   = fmtCurrency(amountFinanced));
    (document.getElementById("monthlyPayment")  ) && (document.getElementById("monthlyPayment").textContent   = fmtCurrency(monthly));
    (document.getElementById("monthly")         ) && (document.getElementById("monthly").textContent          = fmtCurrency(monthly)); // legacy
    (document.getElementById("dealerFeesTotal") ) && (document.getElementById("dealerFeesTotal").textContent  = fmtCurrency(dealerFeesTotal));
    (document.getElementById("govFeesOut")      ) && (document.getElementById("govFeesOut").textContent       = fmtCurrency(govFeesTotal));

    const outTheDoor = priceForCalc + feesTotal + taxes;
    const dueToday   = financeTF ? Math.max(0, cashDown) : Math.max(0, cashDown + feesTotal + taxes);
    (document.getElementById("outTheDoor")   ) && (document.getElementById("outTheDoor").textContent   = fmtCurrency(outTheDoor));
    (document.getElementById("cashDueToday") ) && (document.getElementById("cashDueToday").textContent = fmtCurrency(dueToday));

    // Cash Due at Signing — includes any UNFINANCED negative equity
    let dueAtSigning = Math.max(0, !financeTF ? (cashDown + totalTaxesFees) : cashDown);
    if (!financeNegEquity && negEquity > 0) dueAtSigning += negEquity;
    const dueAtEl = document.getElementById("cashDueAtSigning");
    if (dueAtEl) dueAtEl.textContent = fmtCurrency(dueAtSigning);

    // Savings vs MSRP
    const savingsEl = document.getElementById("savings");
    if (savingsEl) {
      if (msrp > 0 && priceForCalc > 0) {
        const savings = msrp - priceForCalc;
        savingsEl.textContent = savings > 0
          ? `You saved ${fmtCurrency(savings)} off MSRP`
          : savings < 0
            ? `Above MSRP by ${fmtCurrency(Math.abs(savings))}`
            : `Price equals MSRP`;
        savingsEl.classList.add("computed");
      } else {
        savingsEl.textContent = "";
        savingsEl.classList.remove("computed");
      }
    }

    // 0% APR reference & cost of financing
    const p0El = document.getElementById("payment0");        // shows 0% APR monthly
    const pdEl = document.getElementById("paymentDelta");    // shows cost of financing per month
    if (p0El) p0El.textContent = fmtCurrency(zeroAprMonthly);
    if (pdEl) pdEl.textContent = financingCostPerMonth > 0 ? fmtCurrency(financingCostPerMonth) : fmtCurrency(0);

    // Per-row savings: show inline near each toggle
    const pmtSavingsEl = document.getElementById("pmtSavings");
    if (pmtSavingsEl) { pmtSavingsEl.textContent = ""; pmtSavingsEl.classList.remove('computed'); }

    const tfSavingsEl = document.getElementById('pmtSavingsTF');
    if (tfSavingsEl) {
      const hasTF = Number.isFinite(dontFinanceSavingsTF) && dontFinanceSavingsTF > 0;
      if (hasTF) {
        const msg = financeTF
          ? `Save ${fmtCurrency(dontFinanceSavingsTF)} /mo`
          : `Saving ${fmtCurrency(dontFinanceSavingsTF)} /mo`;
        tfSavingsEl.textContent = msg;
        tfSavingsEl.style.display = '';
        tfSavingsEl.setAttribute('aria-hidden', 'false');
      } else {
        tfSavingsEl.textContent = '';
        tfSavingsEl.style.display = 'none';
        tfSavingsEl.setAttribute('aria-hidden', 'true');
      }
      tfSavingsEl.classList.remove('computed');
    }

    const neSavingsEl = document.getElementById('pmtSavingsNegEq');
    if (neSavingsEl) {
      const hasNE = (negEquity > 0) && Number.isFinite(dontFinanceSavingsNegEq) && dontFinanceSavingsNegEq > 0;
      if (hasNE) {
        const msg = financeNegEquity
          ? `Save ${fmtCurrency(dontFinanceSavingsNegEq)} /mo`
          : `Saving ${fmtCurrency(dontFinanceSavingsNegEq)} /mo`;
        neSavingsEl.textContent = msg;
        neSavingsEl.style.display = '';
        neSavingsEl.setAttribute('aria-hidden', 'false');
      } else {
        neSavingsEl.textContent = '';
        neSavingsEl.style.display = 'none';
        neSavingsEl.setAttribute('aria-hidden', 'true');
      }
      neSavingsEl.classList.remove('computed');
    }

    // Keep vehicle summary in sync with latest MSRP/name
    try { updateVehicleSummary(); } catch {}

    showCalcMessage("", "");
  }

  function resetCalculator(){
    const $id = (id) => document.getElementById(id);

    // Inputs to clear (keep vehicle selection intact)
    ["finalPrice","tradeValue","loanPayoff","cashDown","goalMonthly","apr","term","tradeAskPrice"].forEach((id)=>{
      const el = $id(id);
      if (el) { el.value = ""; el.placeholder = ""; }
    });

    // Dynamic fee lists
    ["dealerFeesList","govFeesList"].forEach((id)=>{
      const list = $id(id);
      if (list) list.innerHTML = "";
    });

    // Outputs/notes
    const outs = {
      amountFinanced: "- -",
      monthlyPayment: "- -",
      payment0: "- -",
      paymentDelta: "- -",
      taxes: "- -",
      totalTF: "- -",
      subtotalOut: "- -",
      monthlyApr: "—",
      amountFinancedNote: "",
      goalDownNeeded: "",
      savings: "",
      cashDueAtSigning: "- -",
      finalPriceForGoal: "- -",
    };
    Object.entries(outs).forEach(([id,val])=>{ const el = $id(id); if (el) el.textContent = val; });

    // Restore Trade-in prompt
    const ts = $id("tradeSavingsWith");
    if (ts) { ts.textContent = "Enter a Trade-in Offer to see your Tax Savings"; ts.classList.remove("computed"); }

    // Default Finance Taxes & Fees to checked
    const financeTF = $id("financeTF");
    if (financeTF) financeTF.checked = true;
    const financeNegEq = $id('financeNegEquity');
    if (financeNegEq) financeNegEq.checked = true;

    // Clear messages
    const msgs = $id("calcMessages");
    if (msgs) msgs.innerHTML = "";

    // Reset state flags
    state.finalPriceWasExpr = false;
    state.finalPriceExprRaw = null;
    state.cashDownTouched = false;
    state.tradeAskTouched = false;
    state._recalcAfterAutoDown = false;
    if (Array.isArray(state.dealerFees)) state.dealerFees.length = 0;
    if (Array.isArray(state.govFees)) state.govFees.length = 0;

    // Recompute from clean slate
    try { computeAll(); } catch(e) { console.error(e); }
  }
  /* =========================
     Event wiring
  ========================= */

  function focusNextInput(fromEl){
    try{
      const root = fromEl?.closest('form') || document;
      const fields = Array.from(root.querySelectorAll('input, select, textarea'))
        .filter(el => !el.disabled && el.type !== 'hidden' && el.getAttribute('aria-hidden') !== 'true')
        .filter(el => !/^(checkbox|radio|button|submit|file)$/i.test(el.type || ''))
        .filter(el => el.offsetParent !== null); // visible-ish
      const idx = fields.indexOf(fromEl);
      for (let i = idx + 1; i < fields.length; i++){
        const target = fields[i];
        if (target){
          target.focus?.();
          try { if (target.select) target.select(); } catch {}
          break;
        }
      }
    } catch {}
  }

  function attachEnterAdvance(el){
    if (!el) return;
    el.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter'){
        e.preventDefault();
        try { e.currentTarget.blur(); } catch {}
        try { focusNextInput(e.currentTarget); } catch {}
        try { scheduleSave(); } catch {}
      }
    });
  }
  function attachCurrencyFormatter(input) {
    if (!input) return;
    // No live currency formatting on input; just recompute
    input.addEventListener("input", debouncedComputeAll);
    // Enter advances to next input
    attachEnterAdvance(input);
input.addEventListener("blur", () => {
  if (input.id === "finalPrice") {
    const raw = input.value;
    const msrp = getMsrpFromUI();
    const usedExpr = /msrp/i.test(raw || "") || /^\s*[+\-]/.test(raw || "") || /%/.test(raw || "");
    const v = parsePriceExpression(raw, msrp);
    if (usedExpr) {
      state.finalPriceWasExpr = true;
      state.finalPriceExprRaw = raw;   // save the original text so we can re-evaluate on vehicle change
    } else {
      state.finalPriceWasExpr = false;
      state.finalPriceExprRaw = null;
    }
    input.value = v ? fmtCurrency(v) : "";  // latch evaluated value into the field
  } else {
    const n = parseCurrency(input.value);
    input.value = n ? fmtCurrency(n) : "";
  }
  computeAll();
  scheduleSave();
});
  }

  function attachPercentFormatter(input){
    if (!input) return;
    input.addEventListener("blur", () => {
      const p = parsePercent(input.value);
      input.value = p ? fmtPercentPlain(p) : "";
      computeAll();
      try { scheduleSave(); } catch {}
    });
    input.addEventListener("input", debouncedComputeAll);
    attachEnterAdvance(input);
  }

  // Ensure enter/return key hint shows on mobile numeric keypads
  function ensureEnterKeyHints(){
    try{
      const all = document.querySelectorAll('input');
      all.forEach(el => {
        if (!el || el.type === 'hidden') return;
        const isNumeric = /^(numeric|decimal)$/i.test(el.getAttribute('inputmode') || '') || /^(tel|search|text)$/i.test(el.type || '');
        if (isNumeric && !el.hasAttribute('enterkeyhint')) {
          // Default to 'done'; fee rows prefer 'next'
          let hk = (el.classList.contains('fee-desc') || el.classList.contains('fee-amount')) ? 'next' : 'done';
          if (el.id === 'apr' || el.id === 'term') hk = 'next';
          try { el.setAttribute('enterkeyhint', hk); } catch {}
        }
        // Always keep type="text" for numeric inputs to keep Return key visible
        if (/^(numeric|decimal)$/i.test(el.getAttribute('inputmode') || '') && el.type === 'number') {
          try { el.type = 'text'; } catch {}
        }
      });
    } catch {}
  }
  // Taxable Base info modal
  document.getElementById('openTaxInfo')?.addEventListener('click', (e)=>{
    e.preventDefault();
    const m = document.getElementById('taxInfoModal');
    if (!m) return;
    m.classList.add('open');
    m.setAttribute('aria-hidden', 'false');
    try { setPageInert(m); } catch {}
  });

  const closeTaxInfo = (e)=>{
    e?.preventDefault?.();
    const m = document.getElementById('taxInfoModal');
    if (!m) return;
    m.classList.remove('open');
    m.setAttribute('aria-hidden', 'true');
    try { clearPageInert(); } catch {}
  };
  document.getElementById('taxInfoClose')?.addEventListener('click', closeTaxInfo);
  document.getElementById('taxInfoCancel')?.addEventListener('click', closeTaxInfo);

  // Optional: close on overlay click or ESC to match other modals
  (function enhanceTaxInfoModal(){
    const m = document.getElementById('taxInfoModal');
    if (!m) return;
    // close on ESC
    document.addEventListener('keydown', function onEsc(ev){
      if (m.classList.contains('open') && (ev.key === 'Escape' || ev.key === 'Esc')) {
        closeTaxInfo(ev);
      }
    });
    // close if clicking outside dialog
    m.addEventListener('click', (ev)=>{
      const dlg = m.querySelector('.modal-dialog');
      if (!dlg) return;
      if (!dlg.contains(ev.target)) closeTaxInfo(ev);
    });
  })();

  function wireInputs(){
  // ---- Basic inputs -> live recompute ----
  const onInput = debouncedComputeAll;
  const onChange = () => computeAll();

  // Numeric/currency/percent inputs we care about
  const ids = [
    'finalPrice','tradeValue','loanPayoff','cashDown','tradeAskPrice',
    'apr','term','goalMonthly','countyRateInput'
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', onInput);
    el.addEventListener('change', onChange);
  });

  // Finance Taxes & Fees toggle
  document.getElementById('financeTF')?.addEventListener('change', onChange);
  document.getElementById('financeNegEquity')?.addEventListener('change', onChange);

  // Goal helpers
  document.getElementById('goalAutoApply')?.addEventListener('change', onChange);

  // Delegate: fee lists recompute on edit
  const feeInputHandler = (ev)=>{
    if (ev.target.classList.contains('fee-amount') || ev.target.classList.contains('fee-desc')) {
      debouncedComputeAll();
    }
  };
  document.getElementById('dealerFeesList')?.addEventListener('input', feeInputHandler);
  document.getElementById('govFeesList')?.addEventListener('input', feeInputHandler);

  // Vehicle select -> update state + summary + compute
  const vehicleSel = document.getElementById('vehicleSelect');
  vehicleSel?.addEventListener('change', ()=>{
    const opt = vehicleSel.selectedOptions?.[0];
    const name = (opt?.textContent || '').replace(/\s+—\s+\$.*$/, '').trim();
    const msrp = Number(opt?.dataset?.msrp || opt?.getAttribute('data-msrp')) || 0;
    state.selectedVehicle = { name, msrp };
    updateVehicleSummary();
    computeAll();
    // If Final Price expression references MSRP, re-run compute to reflect new MSRP
    try {
      const v = (document.getElementById('finalPrice')?.value || '').toUpperCase();
      if (v.includes('MSRP')) computeAll();
    } catch {}
  });

  // Clear calculator button
  document.getElementById('clearCalc')?.addEventListener('click', (e)=>{
    e.preventDefault();
    if (typeof resetCalculator === 'function') resetCalculator();
    computeAll();
  });

  // ---------------------------
  // Modals: Taxable Base info
  // ---------------------------
  document.getElementById('openTaxInfo')?.addEventListener('click', (e)=>{
    e.preventDefault();
    const m = document.getElementById('taxInfoModal');
    if (!m) return;
    m.classList.add('open');
    m.setAttribute('aria-hidden', 'false');
    try { setPageInert(m); } catch {}
  });
  const closeTaxInfo = (e)=>{
    e?.preventDefault?.();
    const m = document.getElementById('taxInfoModal');
    if (!m) return;
    m.classList.remove('open');
    m.setAttribute('aria-hidden', 'true');
    try { clearPageInert(); } catch {}
  };
  document.getElementById('taxInfoClose')?.addEventListener('click', closeTaxInfo);
  document.getElementById('taxInfoCancel')?.addEventListener('click', closeTaxInfo);
  // Accessibility niceties: ESC/overlay close
  (function enhanceTaxInfoModal(){
    const m = document.getElementById('taxInfoModal');
    if (!m) return;
    document.addEventListener('keydown', function onEsc(ev){
      if (m.classList.contains('open') && (ev.key === 'Escape' || ev.key === 'Esc')) closeTaxInfo(ev);
    });
    m.addEventListener('click', (ev)=>{
      const dlg = m.querySelector('.modal-dialog');
      if (dlg && !dlg.contains(ev.target)) closeTaxInfo(ev);
    });
  })();

  // ---------------------------
  // Scenarios: Save / Load
  // ---------------------------
  document.getElementById('saveScenarioBtn')?.addEventListener('click', (e)=>{
    e.preventDefault();
    const m = document.getElementById('saveScenarioModal');
    if (!m) return;
    const sel = document.getElementById('vehicleSelect');
    const opt = sel?.selectedOptions?.[0] || null;
    const vehicleName = (document.getElementById('summaryVehicle')?.textContent || opt?.textContent || 'Scenario')
      .replace(/\s+—\s+\$.*$/, '')
      .trim();
    const aprTxt  = document.getElementById('apr')?.value || '6.5%';
    const termTxt = document.getElementById('term')?.value || '72';
    const title   = `${vehicleName} — ${aprTxt}/${termTxt} mo`;
    const titleEl = document.getElementById('scenarioTitle');
    if (titleEl) titleEl.value = title;
    const notesEl = document.getElementById('scenarioNotes');
    if (notesEl) notesEl.value = '';
    m.classList.add('open');
    m.setAttribute('aria-hidden', 'false');
    try { setPageInert(m); } catch {}
  });
  const closeSaveScenario = (e)=>{
    e?.preventDefault?.();
    const m = document.getElementById('saveScenarioModal');
    if (!m) return;
    m.classList.remove('open');
    m.setAttribute('aria-hidden', 'true');
    try { clearPageInert(); } catch {}
  };
  document.getElementById('saveScenarioClose')?.addEventListener('click', closeSaveScenario);
  document.getElementById('saveScenarioCancel')?.addEventListener('click', closeSaveScenario);
  document.getElementById('saveScenarioConfirm')?.addEventListener('click', async (e)=>{
    e.preventDefault();
    try{
      const title = document.getElementById('scenarioTitle')?.value?.trim() || '';
      const notes = document.getElementById('scenarioNotes')?.value || '';
      const snapshot = buildScenarioSnapshot();
      await state.data?.createScenario?.({ title, notes, snapshot });
      closeSaveScenario();
      showCalcMessage('Scenario saved', 'ok');
    } catch(err){
      console.error('createScenario failed', err);
      showCalcMessage('Failed to save scenario', 'err');
    }
  });

  document.getElementById('loadScenarioBtn')?.addEventListener('click', async (e)=>{
    e.preventDefault();
    const m = document.getElementById('loadScenarioModal');
    if (!m) return;
    const list = document.getElementById('scenarioList');
    if (list) list.innerHTML = '<div class="note">Loading…</div>';
    try {
      const rows = await state.data?.listScenarios?.() || [];
      if (list) {
        if (!rows.length) {
          list.innerHTML = '<div class="note">No saved scenarios yet.</div>';
        } else {
          list.innerHTML = '';
          rows.forEach(r => {
            const div = document.createElement('div');
            div.className = 'list-row';
            const dt = r.inserted_at ? new Date(r.inserted_at) : null;
            const when = dt ? dt.toLocaleString() : '';
            const title = (r.title || r.vehicle_name || 'Untitled');
            div.innerHTML = `
              <div class="list-row-main">
                <div class="list-title">${title}</div>
                <div class="list-sub">${when}</div>
                ${r.notes ? `<div class="list-notes">${String(r.notes).replace(/[<>]/g,'')}</div>` : ''}
              </div>
              <div class="list-row-actions">
                <button class="btn small" data-id="${r.id}">Load</button>
              </div>`;
            list.appendChild(div);
          });
          // one-time delegate within handler scope so it sees `rows`
          list.addEventListener('click', (ev)=>{
            const btn = ev.target.closest('button[data-id]');
            if (!btn) return;
            const id = btn.getAttribute('data-id');
            const row = rows.find(x=>String(x.id)===String(id));
            if (row) {
              try { applyScenarioSnapshot(row.snapshot); } catch(e) { console.error(e); }
            }
            closeLoadScenario();
          }, { once: true });
        }
      }
    } catch(err){
      console.error('listScenarios failed', err);
      if (list) list.innerHTML = '<div class="note err">Failed to load scenarios.</div>';
    }
    m.classList.add('open');
    m.setAttribute('aria-hidden', 'false');
    try { setPageInert(m); } catch {}
  });

  const closeLoadScenario = (e)=>{
    e?.preventDefault?.();
    const m = document.getElementById('loadScenarioModal');
    if (!m) return;
    m.classList.remove('open');
    m.setAttribute('aria-hidden', 'true');
    try { clearPageInert(); } catch {}
  };
  document.getElementById('loadScenarioClose')?.addEventListener('click', closeLoadScenario);
  document.getElementById('loadScenarioCancel')?.addEventListener('click', closeLoadScenario);

  // After wiring up everything, ensure option lists are set, then compute once
  ensureOptionLists();
  computeAll();
}
  function ensureOptionLists(){
    // TERM via datalist with labeled options; Safari-friendly type/text + list binding
    const termInput = document.getElementById("term");
    const termDatalist = document.getElementById("termOptions");
    if (termInput) {
      termInput.setAttribute("type", "text"); // datalist UX
      termInput.setAttribute("placeholder", "72 Months"); // ← requested placeholder
    }
    if (termInput && termDatalist) {
      const presets = [
        { m: 36, label: "36Mo / 3Yrs" },
        { m: 48, label: "48Mo / 4Yrs" },
        { m: 60, label: "60Mo / 5Yrs" },
        { m: 72, label: "72Mo / 6Yrs" },
        { m: 84, label: "84Mo / 7Yrs" },
        { m: 96, label: "96Mo / 8Yrs" },
      ];
      // Goal Monthly: placeholder + dynamic width to avoid clipping
    const goalInput = document.getElementById("goalMonthly");
    if (goalInput) {
      // Ensure requested placeholder copy
      goalInput.placeholder = "Set Your Ideal Monthly Payment";

      // Dynamically size to fit the placeholder (and enforce a sensible minimum)
      const ch = Math.max((goalInput.placeholder || "").length, 18);
      goalInput.style.minWidth = `${ch}ch`; // prevents clipping in modern browsers
      goalInput.size = ch;                  // improves width behavior in some engines
    }

      termDatalist.innerHTML = presets.map(p => `<option value="${p.m}" label="${p.label}"></option>`).join("");
      termInput.setAttribute("list", "termOptions");
      termInput.addEventListener("blur", () => {
        let v = parseInt(termInput.value || "0", 10);
        if (!Number.isFinite(v) || v < 0) v = 0;
        termInput.value = v ? String(v) : "";
        computeAll();
      });
      termInput.addEventListener("input", debouncedComputeAll);
    }

    // APR presets via datalist (optional)
    const aprInput = document.getElementById("apr");
    const aprDatalist = document.getElementById("aprOptions");
    if (aprInput) {
      aprInput.setAttribute("type", "text");
      aprInput.setAttribute("placeholder", "6.5%"); // ← requested placeholder
    }
    if (aprInput && aprDatalist) {
      const aprs = [2.9, 3.9, 4.9, 5.9, 6.9, 7.9];
      aprDatalist.innerHTML = aprs.map(n => `<option value="${n}%"></option>`).join("");
      aprInput.setAttribute("list", "aprOptions");
    }

    // Label tweak for Finance Taxes & Fees
    const financeLbl = document.getElementById("financeTFLabel") || document.querySelector('label[for="financeTF"]');
    if (financeLbl) financeLbl.textContent = "Check to Finance Taxes & Fees";
  }

  function wireInputs() {
    (function(){
      const cd = document.getElementById("cashDown");
      if (!cd) return;
      const markTouched = () => { state.cashDownTouched = true; };
      cd.addEventListener("input", markTouched);
      cd.addEventListener("change", markTouched);
      cd.addEventListener("blur", markTouched);
    })();
    (function(){
      const ta = document.getElementById('tradeAskPrice');
      if (!ta) return;
      const markTouched = () => { state.tradeAskTouched = true; };
      ta.addEventListener('input', markTouched);
      ta.addEventListener('change', markTouched);
      ta.addEventListener('blur', markTouched);
    })();
    // Currency-like inputs
    ["finalPrice", "tradeValue", "loanPayoff", "cashDown", "goalMonthly", "msrp", "tradeAskPrice"]
      .map(id => document.getElementById(id))
      .forEach(el => attachCurrencyFormatter(el));

    // Percent inputs
    attachPercentFormatter(document.getElementById("apr"));
    attachPercentFormatter(document.getElementById("countyRateInput")); // optional override

    // TERM live recompute (also handled in ensureOptionLists)
    const termEl2 = document.getElementById("term");
    termEl2?.addEventListener("input", debouncedComputeAll);
    attachEnterAdvance(termEl2);
    // Final Sale Price — realtime recompute (supports formula typing)
    (function(){
  const fp = document.getElementById("finalPrice");
  if (!fp) return;
const onFPChange = () => {
  try {
    const val = fp.value || "";
    const usedExpr = /msrp/i.test(val) || /^\s*[+\-]/.test(val) || /%/.test(val);
    state._fpDirty = true;
    if (usedExpr) {
      state.finalPriceWasExpr = true;
      state.finalPriceExprRaw = val;
    }
    computeAll();
  } catch(e) { console.error(e); }
};
  fp.addEventListener("input", onFPChange);
  fp.addEventListener("change", onFPChange);
  fp.addEventListener("blur", onFPChange);
  fp.addEventListener("keyup", (e) => { if (e.key === "Enter") onFPChange(); });
  })();
    // Checkboxes/selects
    // Default: Finance Taxes & Fees starts checked
    const financeTFBox = document.getElementById("financeTF");
    if (financeTFBox) { financeTFBox.checked = true; }
    const financeNegEqBox = document.getElementById('financeNegEquity');
    if (financeNegEqBox) { financeNegEqBox.checked = true; financeNegEqBox.addEventListener('change', computeAll); }
    document.getElementById("financeTF")?.addEventListener("change", computeAll);
    document.getElementById("goalAutoApply")?.addEventListener("change", computeAll);

    // Vehicle select updates MSRP
    document.getElementById("vehicleSelect")?.addEventListener("change", (e) => {      const opt  = e.currentTarget.selectedOptions?.[0];
      const msrp = Number(opt?.dataset?.msrp || 0);
      const name = (opt?.textContent || "").trim();
      if (name || msrp > 0) state.selectedVehicle = { name, msrp: Number.isFinite(msrp) ? msrp : 0 };
      updateVehicleSummary();

      // If the Final Price was entered as an MSRP-based expression, re-evaluate for the new vehicle MSRP
      try {
        const msrpNow = Number.isFinite(Number(state.selectedVehicle?.msrp)) ? Number(state.selectedVehicle.msrp) : getMsrpFromUI();
        if (state.finalPriceWasExpr && state.finalPriceExprRaw && msrpNow > 0) {
          const fpEl = document.getElementById("finalPrice");
          const evaluated = parsePriceExpression(state.finalPriceExprRaw, msrpNow);
          if (fpEl) fpEl.value = evaluated ? fmtCurrency(evaluated) : "";
        }
      } catch {}

      computeAll();});

    // Dealer fees
    const dealerList = document.getElementById("dealerFeesList");
    document.getElementById("addFee")?.addEventListener("click", () => { if (dealerList) { addFeeRow(dealerList); try{ensureEnterKeyHints();}catch{} computeAll(); } });
    dealerList?.addEventListener("input", debouncedComputeAll);

    // Dealer fee presets (desc only; user supplies amount)
    const dealerSelect = document.getElementById("dealerFeePreset");
    dealerSelect?.addEventListener("change", (e) => {
      const opt = e.currentTarget.selectedOptions?.[0];
      if (!opt || !dealerList) return;
      const desc = (opt.textContent || opt.value || "").trim() || "Dealer Fee";
      addFeeRow(dealerList, { desc }); // amount left blank for user to enter
      e.currentTarget.selectedIndex = 0;
      try { ensureEnterKeyHints(); } catch {}
      // Move focus directly to the amount field for quick entry
      const lastAmt = $$(".fee-amount", dealerList).slice(-1)[0];
      if (lastAmt) { lastAmt.focus?.(); lastAmt.select?.(); }
      computeAll();
    });

    // Gov fees + presets
    const govList = document.getElementById("govFeesList");
    document.getElementById("addGovFee")?.addEventListener("click", () => { if (govList) { addFeeRow(govList); try{ensureEnterKeyHints();}catch{} computeAll(); } });
    govList?.addEventListener("input", debouncedComputeAll);

    const govSelect = document.getElementById("govFeePreset");
    govSelect?.addEventListener("change", (e) => {
      const opt = e.currentTarget.selectedOptions?.[0];
      if (!opt || !govList) return;

      const tryVals = [opt.dataset.amount, opt.getAttribute("data-amount"), opt.value, opt.textContent];
      let amount = 0;
      for (const v of tryVals) {
        const num = parseCurrency(v);
        if (Number.isFinite(num) && num > 0) { amount = num; break; }
      }
      const desc = (opt.textContent || opt.value || "").trim() || "Gov't Fee";

      if (amount > 0) {
        addFeeRow(govList, { desc, amount });
        e.currentTarget.selectedIndex = 0; // reset
        $$(".fee-amount", govList).slice(-1)[0]?.focus?.();
        computeAll();
      }
    });

    // Add Vehicle
    document.getElementById('addVehicleBtn')?.addEventListener('click', (e)=>{
      e.preventDefault();
      openVehicleModal('add');
    });

    // Update Vehicle
    document.getElementById('updateVehicleBtn')?.addEventListener('click', (e)=>{
      e.preventDefault();
      openVehicleModal('update');
    });

    // Delete Vehicle
    document.getElementById('deleteVehicle')?.addEventListener('click', async (e)=>{
      e.preventDefault();
      const sel = document.getElementById('vehicleSelect');
      const id = sel?.value;
      if (!id) { alert('Select a vehicle first.'); return; }
      if (!confirm('Delete this vehicle?')) return;
      try {
        await state.data.deleteVehicle(id);
        await loadVehiclesAndRender();
        if (sel) sel.value = '';
        const sName = document.getElementById('summaryVehicle');
        const sMsrp = document.getElementById('summaryMsrp');
        if (sName) sName.textContent = '—';
        if (sMsrp) sMsrp.textContent = '—';
        state.selectedVehicle = null;
        computeAll();
      } catch(err){
        console.error('deleteVehicle failed', err);
        alert('Failed to delete vehicle.');
      }
    });

    // Modal controls
    document.getElementById('modalClose')?.addEventListener('click', (e)=>{ e.preventDefault(); closeVehicleModal(); });
    document.getElementById('modalCancel')?.addEventListener('click', (e)=>{ e.preventDefault(); closeVehicleModal(); });
    document.getElementById('saveVehicle')?.addEventListener('click', async (e)=>{
      e.preventDefault();
      const modal = document.getElementById('vehicleModal');
      const mode = modal?.dataset.mode || 'add';
      const id   = modal?.dataset.id || '';
      const nameI = document.getElementById('dbVehicleName');
      const msrpI = document.getElementById('dbMsrp');
      const name  = nameI?.value?.trim();
      const msrp  = msrpI?.value ? parseCurrency(msrpI.value) : null;
      if (!name) { alert('Please enter a vehicle name.'); return; }
      try {
        if (mode === 'update') {
          if (!id) { alert('Missing vehicle id'); return; }
          await state.data.updateVehicle({ id, name, msrp });
        } else {
          await state.data.createVehicle({ name, msrp });
        }
        closeVehicleModal();
        await loadVehiclesAndRender();
        // Reselect the updated/created row if possible
        const sel = document.getElementById('vehicleSelect');
        if (sel) {
          if (mode === 'update' && id) sel.value = String(id);
          if (mode === 'add' && name) {
            const opt = Array.from(sel.options).find(o => (o.textContent || '').startsWith(name));
            if (opt) sel.value = opt.value;
          }
          sel.dispatchEvent(new Event('change'));
        }
      } catch(err){
        console.error('saveVehicle failed', err);
        alert('Failed to save vehicle.');
      }
    });

    // Clear button resets the calculator cleanly
    document.getElementById("clearCalc")?.addEventListener("click", (e) => {
      e.preventDefault();
      resetCalculator();
    });

    ensureOptionLists();
    window.addEventListener("resize", debounce(() => computeAll(), 120));
  }

  /* =========================
     Vehicles: fetch + render
  ========================= */
  function renderVehicles(vehicles){
    const sel = document.getElementById("vehicleSelect");
    if (!sel) return;

    sel.innerHTML = "";
    const hasRows = Array.isArray(vehicles) && vehicles.length > 0;
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = hasRows ? "Choose a vehicle…" : (state.data?.ready
      ? "No vehicles found (check RLS/policies)"
      : "No vehicles found (using local cache)");
    opt0.disabled = !hasRows; // allow selection only when there are rows
    opt0.selected = true;
    sel.appendChild(opt0);

    if (!hasRows) return;

    for (const v of vehicles){
      const o = document.createElement('option');
      const label = [v.year, v.make, v.model].filter(Boolean).join(' ') || v.name || 'Vehicle';
      const msrp  = Number(v.msrp ?? v.price ?? 0);
      o.textContent = msrp > 0 ? `${label} — ${fmtCurrency(msrp)}` : label;
      const idVal = (v.id != null) ? String(v.id) : label.toLowerCase().replace(/\s+/g, '-');
      o.value = idVal;
      o.dataset.id = idVal;
      o.dataset.msrp = String(Number.isFinite(msrp) ? msrp : 0);
      sel.appendChild(o);
    }
  }

  async function loadVehiclesAndRender(){
    try {
      let vehicles = [];
      if (state.data?.listVehicles) vehicles = await state.data.listVehicles();

      if ((!vehicles || vehicles.length === 0) && state.data?.ready) {
        console.warn("Supabase returned 0 rows for 'vehicles'. If this is unexpected, verify: (1) table name = 'public.vehicles', (2) RLS enabled with a SELECT policy for anon, (3) API schema exposure, (4) CORS/API URL & key.");
      }

      // Offline fallback demo seed if no rows and no Supabase
      if ((!vehicles || vehicles.length === 0) && !state.data?.ready){
        vehicles = [
          { id: "demo-1", name: "Demo Sedan", year: 2022, make: "Acme", model: "S", msrp: 29995 },
          { id: "demo-2", name: "Demo SUV",   year: 2023, make: "Acme", model: "X", msrp: 38995 }
        ];
        try {
          const existing = JSON.parse(localStorage.getItem("AutoLoan.vehicles") || "[]");
          if (existing.length === 0) localStorage.setItem("AutoLoan.vehicles", JSON.stringify(vehicles));
          else vehicles = existing;
        } catch {}
      }

      renderVehicles(Array.isArray(vehicles) ? vehicles : []);
    } catch (e){
      console.error("loadVehiclesAndRender failed", e);
      renderVehicles([]);
    }
  }

  /* =========================
     Init
  ========================= */
  document.addEventListener("DOMContentLoaded", async () => {
    try { initDataLayer(); } catch {}
    try { wireInputs(); } catch {}
    try { ensureEnterKeyHints(); } catch {}
    try {
      const form = document.getElementById('calcForm');
      form?.addEventListener('submit', (e)=>{
        e.preventDefault();
        try { const el = document.activeElement; el?.blur?.(); focusNextInput(el); } catch {}
        try { scheduleSave(); } catch {}
        try { computeAll(); } catch {}
      });
    } catch {}
    try { await ensureHomeCoords(); } catch {}
    try { await loadVehiclesAndRender(); } catch {}
    computeAll();
  });

  // Public API (optional)
  window.AutoLoan = Object.assign(window.AutoLoan || {}, {
    computeAll,
    openVehicleModal,
    ensureHomeCoords,
    setPageInert,
    clearPageInert
  });
})();
