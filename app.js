/* AutoLoan — app.js (clean single-paste)
   - Real-time calculations on all inputs
   - Supabase -> localStorage fallback + header status
   - Dealer fees (#addFee) + Gov fees presets (#govFeePreset) with live sums
   - Trade equity accounting style with red/green + Tax Savings w/ Trade-in
   - County tax manual override (#countyRateInput, optional)
   - Total Taxes & Fees + Savings notes + "Don't Finance…" note
   - APR/TERM datalist support; Monthly rate (APR/12) -> #monthlyApr to 4 decimals
   - Null-safe wiring throughout
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
    dbLocationGeo: null,    // { county: "Orange", ... } if available
    vehicleCounty: "",      // user-selected county fallback
    countyRates: null,      // if you load county_tax_fl.json into this
    countyRateUsed: 0,
    prevFocus: null,
    data: null              // set by initDataLayer()
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
        const { data, error } = await sb.from("vehicles").select("*").order("created_at", { ascending: false });
        if (error) throw error;
        return data || [];
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
    if (/msrp/i.test(s)) s = s.replace(/msrp/ig, String(msrp));
    if (!/^[0-9+\-*/().\s]*$/.test(s)) return 0; // whitelist
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
          try {
            el.textContent = "";
            el.classList.remove("ok", "warn", "err", "computed");
          } catch {}
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
    const stateTax       = taxableBase * stateRate;      // fixed: removed stray label
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

    const msrp         = getMsrpFromUI();
    const finalPrice   = parsePriceExpression(fpEl?.value || fpEl?.textContent || "", msrp);
    const priceForCalc = (finalPrice && finalPrice > 0) ? finalPrice : msrp;
    if (fpEl && finalPrice < 0) { showCalcMessage("Final Sale Price can't be negative", "warn"); fpEl.value = ""; }

    const tradeValue = parseCurrency(tradeEl?.value ?? "");
    const payoffRaw  = parseCurrency(payoffEl?.value ?? "");
    const payoff     = tradeValue > 0 ? payoffRaw : 0;
    const cashDown   = parseCurrency(cashDownEl?.value ?? "");

    const aprPercent = parsePercent(aprEl?.value ?? aprEl?.textContent ?? ""); // % number
    const term       = parseInt(termEl?.value ?? termEl?.textContent ?? "0", 10) || 0;

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
    const countyRate     = (userCountyRate ?? autoCounty.rate) || 0;
    const defaulted      = userCountyRate == null ? autoCounty.defaulted : false;
    state.countyRateUsed = countyRate;

    const stateRate = state.countyRates?.meta?.stateRate ?? 0.06;
    const countyCap = state.countyRates?.meta?.countyCap ?? 5000;

    // Taxes (with / without trade)
    const tWith    = computeTaxes({ priceForCalc, tradeValue, dealerFeesTotal, stateRate, countyRate, countyCap });
    const tNoTrade = computeTaxes({ priceForCalc, tradeValue: 0, dealerFeesTotal, stateRate, countyRate, countyCap });
    const taxes    = tWith.taxes;

    // Tax Savings w/ Trade-in
    const taxSavings = Math.max(0, tNoTrade.taxes - taxes);
    const taxSavingsEl = document.getElementById("taxSavingsTrade") || document.getElementById("taxSavings");
    if (taxSavingsEl && priceForCalc > 0) {
      taxSavingsEl.textContent = taxSavings > 0 ? `Tax Savings w/ Trade-in: ${fmtCurrency(taxSavings)}` : "";
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
      const label = userCountyRate != null ? fmtPercentFromDecimal(countyRate) : `${(countyRate * 100).toFixed(2)}%`;
      trn.textContent = `County Tax Rate = ${label}${defaulted ? " (Default)" : inferredCounty ? ` (${inferredCounty})` : ""}`;
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

    const monthly = pmnt(amountFinanced);

    // "Don't finance Taxes & Fees" scenario
    const amountFinanced_NoTF = Math.max(0, baseAmount);
    const monthly_NoTF        = pmnt(amountFinanced_NoTF);
    const dontFinanceSavings  = Math.max(0, monthly - monthly_NoTF);

    // Baseline monthly (no trade/payoff)
    const baseBeforeFees0 = Math.max(0, (finalPrice && finalPrice > 0 ? finalPrice : msrp));
    const tNoTradeAgain   = computeTaxes({ priceForCalc: baseBeforeFees0, tradeValue: 0, dealerFeesTotal, stateRate, countyRate, countyCap });
    const amountFinanced0 = Math.max(0, financeTF ? (baseBeforeFees0 - 0 + 0 - cashDown) + tNoTradeAgain.taxes + feesTotal
                                                   : (baseBeforeFees0 - 0 + 0 - cashDown));
    const monthlyNoTrade  = pmnt(amountFinanced0);
    const paymentDelta    = Math.max(0, monthlyNoTrade - monthly);

    // Outputs
    (document.getElementById("amountFinanced")  ) && (document.getElementById("amountFinanced").textContent   = fmtCurrency(amountFinanced));
    (document.getElementById("monthlyPayment")  ) && (document.getElementById("monthlyPayment").textContent   = fmtCurrency(monthly));
    (document.getElementById("monthly")         ) && (document.getElementById("monthly").textContent          = fmtCurrency(monthly)); // compatibility
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

    // Payment savings card (if present)
    const p0El = document.getElementById("payment0");
    const pdEl = document.getElementById("paymentDelta");
    const pmtSavingsEl = document.getElementById("pmtSavings");
    if (p0El) p0El.textContent = fmtCurrency(monthlyNoTrade);
    if (pdEl) pdEl.textContent = paymentDelta > 0 ? `-${fmtCurrency(paymentDelta)}` : fmtCurrency(0);
    if (pmtSavingsEl) {
      if (paymentDelta > 0) {
        pmtSavingsEl.textContent = `Payment down by ${fmtCurrency(paymentDelta)} due to trade/taxes`;
        pmtSavingsEl.classList.add("computed");
      } else {
        pmtSavingsEl.textContent = "";
        pmtSavingsEl.classList.remove("computed");
      }
    }

    // Amount financed note
    const afNote = document.getElementById("amountFinancedNote");
    if (afNote) {
      afNote.textContent = dontFinanceSavings > 0
        ? `Don't Finance Taxes & Fees - Save "${fmtCurrency(dontFinanceSavings)}/mo"!`
        : "";
    }

    showCalcMessage("", "");
  }

  /* =========================
     Event wiring
  ========================= */
  function attachCurrencyFormatter(input) {
    if (!input) return;
    input.addEventListener("blur", () => {
      const n = parseCurrency(input.value);
      input.value = n ? fmtCurrency(n) : "";
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
    // Label text
    const financeLbl = document.getElementById("financeTFLabel") || document.querySelector('label[for="financeTF"]');
    if (financeLbl) financeLbl.textContent = "Check Box to Finance Taxes & Fees";

    // TERM via datalist (36/48/60/72) + custom ≥ 0
    const termInput = document.getElementById("term");
    const termDatalist = document.getElementById("termOptions");
    if (termInput && termDatalist) {
      const presets = [36, 48, 60, 72];
      termDatalist.innerHTML = presets.map(n => `<option value="${n}"></option>`).join("");
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
    if (aprInput && aprDatalist) {
      const aprs = [2.9, 3.9, 4.9, 5.9, 6.9, 7.9];
      aprDatalist.innerHTML = aprs.map(n => `<option value="${n}%"></option>`).join("");
    }
  }

  function wireInputs() {
    // Currency-like inputs
    ["finalPrice", "tradeValue", "loanPayoff", "cashDown", "goalMonthly", "msrp"]
      .map(id => document.getElementById(id))
      .forEach(el => attachCurrencyFormatter(el));

    // Percent inputs
    attachPercentFormatter(document.getElementById("apr"));
    attachPercentFormatter(document.getElementById("countyRateInput")); // optional override

    // TERM live recompute
    document.getElementById("term")?.addEventListener("input", debouncedComputeAll);

    // Checkboxes/selects
    document.getElementById("financeTF")?.addEventListener("change", computeAll);
    document.getElementById("goalAutoApply")?.addEventListener("change", computeAll);

    // Vehicle select updates MSRP
    document.getElementById("vehicleSelect")?.addEventListener("change", (e) => {
      const opt  = e.currentTarget.selectedOptions?.[0];
      const msrp = Number(opt?.dataset?.msrp || 0);
      const name = (opt?.textContent || "").trim();
      if (name || msrp > 0) state.selectedVehicle = { name, msrp: Number.isFinite(msrp) ? msrp : 0 };
      computeAll();
    });

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

      // Try data-amount, value, or text content (supports "$85" etc.)
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
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = vehicles.length ? "Choose a vehicle…" : "No vehicles found";
    opt0.disabled = !vehicles.length;
    opt0.selected = true;
    sel.appendChild(opt0);

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
      console.error("loadVehicles failed", e);
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