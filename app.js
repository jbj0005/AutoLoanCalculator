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
    _applyingGoalDown: false
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
    const sb  = window.supabase?.createClient && url && key
      ? window.supabase.createClient(url, key)
      : null;

    state.data = sb ? {
      ready: true,
      async listVehicles(){
        // Prefer newest-first by inserted_at; fall back if column is missing
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
      async saveVehicle(v){
        const { data, error } = await sb.from("vehicles").insert(v).select().single();
        if (error) throw error;
        return data;
      }
    } : {
      ready: false,
      async listVehicles(){
        try { return JSON.parse(localStorage.getItem(DATA_KEYS.vehicles) || "[]"); }
        catch { return []; }
      },
      async saveVehicle(v){
        const list = await this.listVehicles();
        list.unshift({ id: crypto?.randomUUID?.() || Date.now(), ...v });
        localStorage.setItem(DATA_KEYS.vehicles, JSON.stringify(list));
        return list[0];
      }
    };

    setSupabaseStatus(!!sb);
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
    if (!modal || !title) return;

    if (mode === "add") {
      title.textContent = "Add Vehicle";
      $("#vehicleSelect") && ($("#vehicleSelect").value = "");
      $("#dbVehicleName") && ($("#dbVehicleName").value = "");
      $("#dbMsrp") && ($("#dbMsrp").value = "");
    } else {
      title.textContent = "Update Vehicle";
      if (!$("#vehicleSelect")?.value) { alert("Select a vehicle to update"); return; }
    }

    state.prevFocus = document.activeElement;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    try { setPageInert(modal); } catch {}
    setTimeout(() => { try { ensureVehiclePAC(); } catch {} }, 0);
    const focusEl = document.getElementById("dbVehicleName");
    if (focusEl?.focus) setTimeout(() => focusEl.focus(), 0);
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
      <input class="fee-desc" type="text" placeholder="Description" aria-label="Fee description" value="${desc}" />
      <input class="fee-amount" type="text" inputmode="decimal" placeholder="$0.00" aria-label="Fee amount" value="${Number.isFinite(amt) ? fmtCurrency(amt) : ""}" />
      <button type="button" class="fee-remove" aria-label="Remove fee">✕</button>
    `;
    targetList.appendChild(row);
    attachCurrencyFormatter($(".fee-amount", row));
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
    // Inputs
    const fpEl       = $("#finalPrice");
    const tradeEl    = $("#tradeValue");
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
    const payoff     = tradeValue > 0 ? payoffRaw : 0;
    const cashDown   = parseCurrency(cashDownEl?.value ?? "");

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

// Tax Savings w/ Trade-in — show under Trade-in Value label
const taxSavings = Math.max(0, tNoTrade.taxes - taxes);
const taxSavingsEl = document.getElementById("tradeSavingsWith") || document.getElementById("taxSavingsTrade") || document.getElementById("taxSavings");
if (taxSavingsEl) {
  const hasTrade = tradeValue > 0;
  if (hasTrade) {
    // If price not available yet, show $0.00 until it is
    const shown = (priceForCalc > 0) ? taxSavings : 0;
    taxSavingsEl.textContent = `Trade-in Tax Savings - ${fmtCurrency(shown)}`;
    taxSavingsEl.classList.add("computed");
    taxSavingsEl.setAttribute("aria-live", "polite");
  } else {
    // Always show prompt text when no trade value is entered
    taxSavingsEl.textContent = "Enter a Trade-in Value to see your Tax Savings";
    taxSavingsEl.classList.remove("computed");
    taxSavingsEl.setAttribute("aria-live", "polite");
  }
}
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
    const trn = document.getElementById("taxesRatesNote");
    if (trn) {
      trn.textContent = `County Tax Rate = ${fmtPercentFromDecimal(countyRate)}${defaulted ? " (Default 1%)" : inferredCounty ? ` (${inferredCounty})` : ""}`;
    }
    const ttf = document.getElementById("totalTF") || document.getElementById("totalTaxesAndFees");
    if (ttf) ttf.textContent = showTaxes ? fmtCurrency(totalTaxesFees) : "—";

    // Amount financed & monthly
    const financeTF      = $("#financeTF")?.checked ?? true;
    const baseAmount     = (priceForCalc - tradeValue + payoff) - cashDown;
    const amountFinanced = Math.max(0, financeTF ? baseAmount + taxes + feesTotal : baseAmount);

    const r = (aprPercent / 100 / 12) || 0;
    const n = term || 0;
    const pmnt = (principal) => n > 0
      ? (r ? principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1) : principal / n)
      : 0;

    // Current monthly with current APR
    const monthly = pmnt(amountFinanced);

    // Auto-suggest Cash Down = 10% of Monthly Payment (until user edits)
    try {
      const cdEl = document.getElementById("cashDown");
      if (cdEl && !state?.cashDownTouched) {
        const tenPct = Math.max(0, (monthly || 0) * 0.10);
        if (tenPct > 0) {
          cdEl.placeholder = fmtCurrency(tenPct);
          if (!cdEl.value) {
            cdEl.value = fmtCurrency(tenPct);
            if (!state._recalcAfterAutoDown) {
              state._recalcAfterAutoDown = true;
              computeAll();
              state._recalcAfterAutoDown = false;
              return; // let the second pass propagate the new cashDown
            }
          }
        }
      }
    } catch {}

    // 0% APR reference (same principal & term)
    const zeroAprMonthly = n > 0 ? (amountFinanced / n) : 0;
    const financingCostPerMonth = Math.max(0, monthly - zeroAprMonthly);

    // "Don't finance Taxes & Fees" scenario (recommend paying T&F upfront)
    const amountFinanced_NoTF = Math.max(0, baseAmount);
    const monthly_NoTF        = pmnt(amountFinanced_NoTF);
    const dontFinanceSavings  = Math.max(0, monthly - monthly_NoTF);

    // Debug hook (non-UI): quick probe in console when needed
    window.__autoLoanDbg = {
      aprPercent, term, r, n, amountFinanced, priceForCalc, tradeValue, payoff, cashDown,
      dealerFeesTotal, govFeesTotal, taxes, dontFinanceSavings
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
    if (goalMonthly > 0 && n > 0) {
      // Invert PMT to get principal from desired payment
      const pow = Math.pow(1 + r, n);
      const principalNeeded = r ? (goalMonthly * (pow - 1) / (r * pow)) : (goalMonthly * n);

      const currentPrincipal = amountFinanced; // reflects financeTF choice above
      const extraDown = Math.max(0, currentPrincipal - principalNeeded);

      if (goalDownOut) goalDownOut.textContent = `Additional Cash Down Needed - ${fmtCurrency(extraDown)}`;
      if (goalDownOut && goalDownOut.classList) {
        goalDownOut.classList.toggle("computed", extraDown > 0);
      }

      if (autoApplyGoal && !state._applyingGoalDown) {
        state._applyingGoalDown = true;
        const newDown = Math.max(0, cashDown + extraDown);
        if (cashDownEl) cashDownEl.value = newDown ? fmtCurrency(newDown) : "";
        computeAll();
        state._applyingGoalDown = false;
        return;
      }
    } else if (goalDownOut) {
      goalDownOut.textContent = "";
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

    // Recommendation: Pay T&F upfront — new phrasing
    const pmtSavingsEl = document.getElementById("pmtSavings");
    if (pmtSavingsEl) {
      if (dontFinanceSavings > 0) {
        pmtSavingsEl.textContent = `You'll save ${fmtCurrency(dontFinanceSavings)} Per Month!`;
        pmtSavingsEl.classList.add("computed");
      } else {
        pmtSavingsEl.textContent = "";
        pmtSavingsEl.classList.remove("computed");
      }
    }

    // Amount financed note — show savings ONLY when NOT financing T&F
    const afNote = document.getElementById("amountFinancedNote");
    if (afNote) {
      if (!financeTF && dontFinanceSavings > 0) {
        afNote.textContent = `You're Saving ${fmtCurrency(dontFinanceSavings)} Per Month`;
      } else {
        afNote.textContent = ""; // no note when financing is checked
      }
    }
    // Keep vehicle summary in sync with latest MSRP/name
    try { updateVehicleSummary(); } catch {}

    showCalcMessage("", "");
  }

  function resetCalculator(){
    const $id = (id) => document.getElementById(id);

    // Inputs to clear (keep vehicle selection intact)
    ["finalPrice","tradeValue","loanPayoff","cashDown","goalMonthly","apr","term"].forEach((id)=>{
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
      monthlyApr: "—",
      amountFinancedNote: "",
      goalDownNeeded: "",
      savings: ""
    };
    Object.entries(outs).forEach(([id,val])=>{ const el = $id(id); if (el) el.textContent = val; });

    // Restore Trade-in prompt
    const ts = $id("tradeSavingsWith");
    if (ts) { ts.textContent = "Enter a Trade-in Value to see your Tax Savings"; ts.classList.remove("computed"); }

    // Default Finance Taxes & Fees to checked
    const financeTF = $id("financeTF");
    if (financeTF) financeTF.checked = true;

    // Clear messages
    const msgs = $id("calcMessages");
    if (msgs) msgs.innerHTML = "";

    // Reset state flags
    state.finalPriceWasExpr = false;
    state.finalPriceExprRaw = null;
    state.cashDownTouched = false;
    state._recalcAfterAutoDown = false;
    if (Array.isArray(state.dealerFees)) state.dealerFees.length = 0;
    if (Array.isArray(state.govFees)) state.govFees.length = 0;

    // Recompute from clean slate
    try { computeAll(); } catch(e) { console.error(e); }
  }
  /* =========================
     Event wiring
  ========================= */
  function attachCurrencyFormatter(input) {
    if (!input) return;
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
    input.addEventListener("input", debouncedComputeAll);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
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
    if (financeLbl) financeLbl.textContent = "Check Box to Finance Taxes & Fees";
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
    // Currency-like inputs
    ["finalPrice", "tradeValue", "loanPayoff", "cashDown", "goalMonthly", "msrp"]
      .map(id => document.getElementById(id))
      .forEach(el => attachCurrencyFormatter(el));

    // Percent inputs
    attachPercentFormatter(document.getElementById("apr"));
    attachPercentFormatter(document.getElementById("countyRateInput")); // optional override

    // TERM live recompute (also handled in ensureOptionLists)
    document.getElementById("term")?.addEventListener("input", debouncedComputeAll);
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
    document.getElementById("addFee")?.addEventListener("click", () => { if (dealerList) { addFeeRow(dealerList); computeAll(); } });
    dealerList?.addEventListener("input", debouncedComputeAll);

    // Gov fees + presets
    const govList = document.getElementById("govFeesList");
    document.getElementById("addGovFee")?.addEventListener("click", () => { if (govList) { addFeeRow(govList); computeAll(); } });
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
      const o = document.createElement("option");
      const label = [v.year, v.make, v.model].filter(Boolean).join(" ") || v.name || "Vehicle";
      const msrp  = Number(v.msrp ?? v.price ?? 0);
      o.textContent = msrp > 0 ? `${label} — ${fmtCurrency(msrp)}` : label;
      o.value = v.id ?? label.toLowerCase().replace(/\s+/g, "-");
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