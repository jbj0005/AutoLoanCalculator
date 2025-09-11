// Centralized app constants and defaults
// Loaded before app.js; accessible via window.CONSTS
(function(){
  window.CONSTS = Object.freeze({
    DEFAULTS: {
      APR_PERCENT: 6.5,
      TERM_MONTHS: 72,
      STATE_TAX_RATE: 0.06,
      COUNTY_CAP: 5000,
      COUNTY_RATE_FALLBACK: 0.01, // 1%
    },
    LIMITS: {
      MAX_TERM_MONTHS: 96,
      MIN_APR_PERCENT: 0,
    },
  });
})();

