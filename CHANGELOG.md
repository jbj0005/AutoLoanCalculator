# Changelog

## v0.4.2 - 2025-09-14
- Build/Deploy: Add no‑secrets GitHub Pages workflow path that reads `.env.production` from the repo (publishable/anon keys only)
- CI: Print Supabase key diagnostics (segments/length) and block `service_role` only
- Deploy: Compute `VITE_BASE` from repo name when not provided
- Supabase: Add safe window fallbacks in `index.html` and fix production URL
- Version: Bump header/version pill and `APP_VERSION` to V0.4.2

[Compare changes](https://github.com/jbj0005/AutoLoanCalculator/compare/v0.4.1...v0.4.2)

## v0.4.1 - 2025-09-11
- UX: Only show “Asking vs. Offer Delta” when an Asking Price is entered
- UX: Dealer Fee preset selection moves focus to the amount field
- UX: Muted all note styles so none appear overly bright
- Mobile: Keep input raw while typing; format currency on blur
- Trade-in: Use Loan Payoff behind the scenes when Asking Price is blank
- Structure: Add vars.js for centralized defaults/limits; app.js reads from it

[Compare changes](https://github.com/jbj0005/AutoLoanCalculator/compare/v0.4.0...v0.4.1)

## v0.4.0 - 2025-09-11
- New: “MONTHLY AFFORDABILITY” cell with goal monthly input and strategy notes
- New: Congratulatory note when goal is met (hides strategy notes)
- UX: APR and TERM controls merged into Monthly Payment cell with aligned labels; removed “Months” suffix
- UX: Inline savings next to “Finance Taxes & Fees?” and “Finance Negative Equity?”; single summary note removed
- UX: “CASH DUE AT SIGNING” amount moved into the label line
- Trade-in: Rename “Trade-in Value” → “Trade-in Offer”; add optional “Trade-in Asking Price” and “Asking vs. Offer Delta” (color-only accounting). Remove “Trade-in Tax Value” note
- Fees: Add Dealer Fee presets (desc only) and make fee rows responsive
- Inputs: Standardize currency placeholders to “Enter Amount”; remove live typing formatter (still formats on blur)
- Mobile: Ensure Return/Next key shows (enterkeyhint), Enter saves and advances, prevent unintended submits
- Limits: APR/TERM out-of-range warning for affordability note; wraps long text

[Compare changes](https://github.com/jbj0005/AutoLoanCalculator/compare/v0.2.1...v0.4.0)

## v0.2.1 - 2025-09-06
- Fix: Add/Gov fee buttons no longer submit the form or cause layout shifts in the calculator.
- Fix: Remove duplicate `calcForm` declaration that caused a SyntaxError in some browsers.
- Fix: Ensure `config.js` loads before `app.js` so Supabase initializes and shows Connected.

[Compare changes](https://github.com/jbj0005/AutoLoanCalculator/compare/v0.2.0...v0.2.1)
