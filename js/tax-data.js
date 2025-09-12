(function(){
  if (window.__taxDataLoaded) return; window.__taxDataLoaded = true;

  const FALLBACKS = {
    stateRate: (window.CONSTS?.DEFAULTS?.STATE_TAX_RATE ?? 0.06),
    countyCap: (window.CONSTS?.DEFAULTS?.COUNTY_CAP ?? 5000),
    countyRate: (window.CONSTS?.DEFAULTS?.COUNTY_RATE_FALLBACK ?? 0.01)
  };

  // Synchronous lookup used by app.js; defaults to 1%
  window.getCountyRate = function(countyName){
    return { rate: FALLBACKS.countyRate, defaulted: true, county: countyName || "DEFAULT" };
  };

  // Seed meta so computeAll() has state rate and cap
  function seedMeta(){
    try{
      window.state = window.state || {};
      window.state.countyRates = { meta: { stateRate: FALLBACKS.stateRate, countyCap: FALLBACKS.countyCap } };
    } catch {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', seedMeta, { once: true });
  } else {
    seedMeta();
  }
})();
