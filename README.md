# Auto Loan Calculator (GitHub Pages)

Live site: https://jbj0005.github.io/AutoLoanCalculator/

Mobile-friendly auto loan calculator with optional Supabase-backed vehicle list. Designed with an Excel-like, 8-column paired layout that adapts to small screens.

Live-ready for GitHub Pages: static HTML/CSS/JS only.

## Features

- Excel-style 8-column paired layout (labels + values)
- Savings vs. MSRP, trade-in equity (positive/negative)
- Dealer fees (add multiple line items)
- FL taxes: 6% state + county surtax on first $5,000
- County rates loaded from `data/county_tax_fl.json` with default fallback
- “Finance Taxes & Fees?” option rolls them into loan amount
- Cash down input; dynamic payment calculation (PMT)
- 0% APR reference payment (faint)
- Vehicle database (Supabase): save/load vehicles with name, MSRP, location
- Distance-from-home calculation via light geocoding (Nominatim)

## Quick Start (Local)

1. Open `index.html` in a browser.
2. Use the calculator. Database features show "Supabase not configured" until set.

Tip: On mobile, add to home screen for an app-like experience.

## Deploy to GitHub Pages

1. Push this project to your repository (e.g. `AutoLoanCalculator`).
2. In GitHub: Settings → Pages → Build and deployment → Source = Deploy from branch. Choose `main` and root (`/`).
3. Wait for Pages to build. Your app will be available at `https://<you>.github.io/<repo>/`.
   - For this repo: https://jbj0005.github.io/AutoLoanCalculator/

## Supabase Setup (Optional, for Vehicle DB)

1. Create a new Supabase project.
2. Create the `vehicles` table:

```
create table public.vehicles (
  id bigint generated always as identity primary key,
  name text not null,
  msrp numeric,
  price numeric,
  location text,
  latitude double precision,
  longitude double precision,
  county text,
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

3. Get your Project URL and anon key. Copy `config.example.js` → `config.js` and fill in:

```
window.SUPABASE_URL = "https://YOUR_PROJECT_ID.supabase.co";
window.SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
```

4. Commit `config.js` so GitHub Pages can access it (anon key is OK for client reads/writes when RLS is enabled).

5. In the app, use the Vehicle Database section to save/load vehicles.

## County Tax Rates

- File: `data/county_tax_fl.json`
- Format:

```
{
  "meta": { "stateRate": 0.06, "countyCap": 5000 },
  "counties": { "Brevard": 0.015, "DEFAULT": 0.01 }
}
```

- Defaults to 1% (first $5,000) if county is unknown and shows: "Rate Unknown - Default 1% Used".
- Update this file as rates change or expand with more counties for offline accuracy.

## Distance From Home

- Optionally set your Home ZIP or full address using the "Update Home Address" button in the Vehicle card.
- The address is geocoded and cached locally in your browser; clear or update it anytime.
- Vehicle location is geocoded when you type in the modal or when saving a vehicle.
- Distance uses the Haversine formula (great-circle distance).

Note: Geocoding uses OpenStreetMap Nominatim for light, personal use. For heavier usage, bring your own geocoding provider + key.

## Calculation Details

- Savings: `MSRP - Final Sale Price` (shown when positive).
- Trade Equity: `Trade-in Value - Loan Payoff` (negative = negative equity).
- Taxes (Florida): `6% * taxableBase + countyRate * min(taxableBase, $5,000)` where `taxableBase = max(Final Price - Trade-in Value, 0)`.
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
- `app.js` – Logic: parsing, math, geocoding, Supabase, UI
- `config.js` – Supabase URL and anon key (copy from `config.example.js`)
- `data/county_tax_fl.json` – Offline county rates

## Troubleshooting

- Supabase status shows "not configured": fill `config.js` and redeploy.
- County shows unknown: either geocoding didn’t find the county or it’s not in the table; edit the JSON or set county manually by saving a vehicle with a location that resolves.
- Payments look off: ensure APR is annual percent and term is in months. Check that fees/taxes are included if you toggled that option.

## License / Disclaimer

For personal use. No warranty. Tax and fee calculations are estimates; verify with your dealer and local tax authority.
