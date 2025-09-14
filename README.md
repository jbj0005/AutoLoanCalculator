# Auto Loan Calculator (GitHub Pages) — v0.4.2

Live site: https://jbj0005.github.io/AutoLoanCalculator/

Mobile-friendly auto loan calculator with an optional Supabase-backed vehicle list (Name + MSRP only). Designed with an Excel-like layout that adapts to small screens.

Live-ready for GitHub Pages: static HTML/CSS/JS only.

## Highlights (v0.4.0)

- New “MONTHLY AFFORDABILITY” cell with goal monthly input and dynamic notes
- Congratulatory message when goal is met; hides strategy notes
- APR and TERM controls merged into Monthly Payment cell with aligned labels
- Inline savings shown next to “Finance Taxes & Fees?” and “Finance Negative Equity?”
- Trade-in UI: “Trade-in Offer” label, optional “Trade-in Asking Price”, and “Asking vs. Offer Delta” (color-only accounting style)
- Dealer Fee presets (desc only) and responsive fee rows
- Inputs are flex-resizable; placeholders standardized to “Enter Amount”
- Enter/Return advances to next field; mobile keyboards show Done/Next
- Removed “Trade-in Tax Value” note

## Features

- Excel-style 8-column paired layout (labels + values)
- Savings vs. MSRP, trade-in equity (positive/negative)
- Dealer fees (add multiple line items)
- FL taxes: 6% state + county surtax on first $5,000
- County rates loaded from `data/county_tax_fl.json` with default fallback
- “Finance Taxes & Fees?” option rolls them into loan amount
- Cash down input; dynamic payment calculation (PMT)
- 0% APR reference payment (faint)
- Vehicle database (Supabase): save/load vehicles with Name and MSRP only

## Quick Start (Local)

1. Open `index.html` in a browser.
2. Use the calculator. Database features show "Supabase not configured" until set.

Tip: On mobile, add to home screen for an app-like experience.

## Deploy to GitHub Pages

Two options are supported:

- No‑secrets (recommended, simple): commit a public `.env.production` with your publishable/anon keys.
- Secrets‑based (optional): provide secrets to the workflow instead of committing `.env.production`.

### A) No‑secrets deploy (committed env)

1) Fill `./.env.production` with your publishable/anon key and URL:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxx or anon JWT (not service_role)
```

2) Push to `main`. The workflow builds with Vite and deploys `dist/` to Pages.

3) Your site will be available at `https://<you>.github.io/<repo>/`.
   - For this repo: https://jbj0005.github.io/AutoLoanCalculator/

Verification (CI): In the Actions run → job `build` → step “Preflight – read .env.production (no secrets)”, you’ll see:
- `VITE_SUPABASE_URL present: yes`
- `Supabase key: segments(dots)=… length(chars)=…` (JWT-like or publishable)

### B) Secrets‑based deploy (optional)

If you prefer not to commit env, add repo secrets and variables, then push:
- Secrets → `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- Variable (optional) → `VITE_BASE=/YourRepoName/`

Notes
- Never use `service_role` in the browser. The workflow blocks it.
- You can also set `window.SUPABASE_URL` / `window.SUPABASE_ANON_KEY` inline in `index.html`; Vite env takes precedence.

## Environment Setup

Use a local `.env` file (Vite-style) for API keys and feature flags. An example is included.

1) Copy `.env.example` to `.env` and fill values:

```
VITE_SUPABASE_URL=your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_ENABLE_GOOGLE_PLACES=false
VITE_ENABLE_GOOGLE_GEOCODING=true
VITE_GEOCODE_ON_INPUT=true
```

2) The app reads `import.meta.env.*` (when built with Vite) and falls back to `window.*` if running as static files.

3) Do not commit secrets. The public anon key is safe for client use when RLS is configured.

## Supabase Setup (Optional, for Vehicle DB)

1. Create a new Supabase project.
2. Create the `vehicles` table:

```
create table public.vehicles (
  id bigint generated always as identity primary key,
  name text not null,
  msrp numeric,
  inserted_at timestamptz default now()
);

alter table public.vehicles enable row level security;

-- Public read
create policy "Public read" on public.vehicles
for select to anon
using (true);

-- Public insert (you can tighten later)
create policy "Public insert" on public.vehicles
for insert to anon
with check (true);
```

3. Get your Project URL and anon key. Put them in `.env` (preferred) or set them on `window` before `config.js` loads.

4. You can serve locally with Vite to use `.env` automatically:

```
npm install
npm run dev
```

For GitHub Pages (static hosting), either bake env values at build time or set `window.SUPABASE_URL` and `window.SUPABASE_ANON_KEY` via an inline `<script>` before `config.js`.

5. In the app, use the Vehicle Database section to save/load vehicles.

Note: As of v0.2.0, all location/geocoding and distance features were removed to focus strictly on calculator functionality.

## County Tax Rates

- File: `data/county_tax_fl.json`
- Format:

```
{
  "meta": { "stateRate": 0.06, "countyCap": 5000 },
  "counties": { "Brevard": 0.015, "DEFAULT": 0.01 }
}
```

- Defaults to 1% (first $5,000) if county is unknown.
- Update this file as rates change or expand with more counties for offline accuracy.

## Removed in v0.2.0

## Changes in v0.2.1
- Fix: Add/Gov fee buttons no longer submit the form or cause layout shifts.
- Fix: Prevent duplicate `calcForm` declaration error in `app.js`.
- Fix: Ensure `config.js` loads before `app.js` so Supabase initialization shows Connected.

See full history in `CHANGELOG.md`.

## Releasing
- Prepare notes (optional): add `RELEASE_NOTES/vX.Y.Z.md`.
- Bump and commit (no tag): `scripts/release.sh v0.2.2`
- Bump and tag (auto-creates GitHub Release via workflow): `scripts/release.sh v0.2.2 --tag`
  - This pushes the commit and tag to `origin`.
  - The Release workflow will publish the Release using your notes if present.
  - The Changelog workflow will update `CHANGELOG.md` after the Release is published.

- All Google/Geocoding/App Check code
- Home Address modal and distance calculation
- Vehicle location/city/county fields and logic

## Calculation Details

- Savings: `MSRP - Final Sale Price` (shown when positive).
- Trade Equity: `Trade-in Offer - Loan Payoff` (negative = negative equity).
- Taxes (Florida): `6% * taxableBase + countyRate * min(taxableBase, $5,000)` where `taxableBase = max(Final Price - Trade-in Offer, 0)`.
- Amount Financed:

```
amount = Final Price - Trade-in Value + Payoff
        + (Finance Taxes & Fees ? (Taxes + Dealer Fees + Gov Fees) : 0)
        - Cash Down
```

- Payment (PMT): `r*PV / (1 - (1+r)^-n)`; r=monthly rate (APR/12), PV=amount financed, n=term.
- 0% APR: `PV / n` shown as a light reference value.

If you want the exact formula you described strictly (ignoring positive equity in the finance box), say the word and I can switch it.

## Files

- `index.html` – UI layout and elements
- `styles.css` – Mobile-first styling
- `app.js` – Logic: parsing, math, Supabase, UI (geocoding removed)
- `config.js` – Supabase URL and anon key (copy from `config.example.js`)
- `data/county_tax_fl.json` – Offline county rates

## Troubleshooting

- Supabase status shows "not configured": fill `config.js` and redeploy.
- County shows unknown: either geocoding didn’t find the county or it’s not in the table; edit the JSON or set county manually by saving a vehicle with a location that resolves.
- Payments look off: ensure APR is annual percent and term is in months. Check that fees/taxes are included if you toggled that option.

## License / Disclaimer

For personal use. No warranty. Tax and fee calculations are estimates; verify with your dealer and local tax authority.
