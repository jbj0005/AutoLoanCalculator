// Supabase project credentials (public anon key; RLS must be enabled)
window.SUPABASE_URL = "https://txndueuqljeujlccngbj.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4bmR1ZXVxbGpldWpsY2NuZ2JqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcwMzI3OTMsImV4cCI6MjA3MjYwODc5M30.ozHVMxQ0qL4mzZ2q2cRkYPduBk927_a7ffd3tOI6Pdc";
// Optional: Google Maps API key (Geocoding/Places). Restrict by referrer and APIs.
window.GMAPS_API_KEY = "AIzaSyC5LXJ43CBBfA5d-zAl03NBXwMVML2FMA8";
// Optional: reCAPTCHA Enterprise Site Key for App Check (Web)
// Create in Google Cloud Console (Web application) and restrict to your Pages origins.
// When provided, the app will fetch a token and pass it to Maps JS as app_check_token.
window.RECAPTCHA_ENTERPRISE_SITE_KEY = "6Lchor8rAAAAABVDVSLH8_lytIn0zBt2P9CxF6M5"; // reCAPTCHA Enterprise site key (public)

// Feature toggles (set to true to enable)
// Disable Google Places Autocomplete by default to avoid input issues in restricted networks.
window.ENABLE_GOOGLE_PLACES = true;
// Allow geocoding via Google REST on blur/save; set false to fully disable network geocoding
window.ENABLE_GOOGLE_GEOCODING = true;
// Avoid geocoding on each keystroke; set true to re-enable live lookup as you type
window.GEOCODE_ON_INPUT = true;
