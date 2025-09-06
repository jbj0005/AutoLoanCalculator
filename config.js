// Supabase project credentials (public anon key; RLS must be enabled)
window.SUPABASE_URL = "https://txndueuqljeujlccngbj.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4bmR1ZXVxbGpldWpsY2NuZ2JqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcwMzI3OTMsImV4cCI6MjA3MjYwODc5M30.ozHVMxQ0qL4mzZ2q2cRkYPduBk927_a7ffd3tOI6Pdc";
// App version (shown in header)
window.APP_VERSION = "v0.2.1";
// Optional: Google Maps API key (Geocoding/Places). Restrict by referrer and APIs.
// Google integrations removed
window.GMAPS_API_KEY = "";

// Feature toggles (set to true to enable)
// Disable Google Places Autocomplete by default to avoid input issues in restricted networks.
window.ENABLE_GOOGLE_PLACES = false; // PAC mounts lazily; disable eager attach/legacy fallback
// Allow geocoding via Google REST on blur/save; set false to fully disable network geocoding
window.ENABLE_GOOGLE_GEOCODING = true;
// Avoid geocoding on each keystroke; set true to re-enable live lookup as you type
window.GEOCODE_ON_INPUT = true;
