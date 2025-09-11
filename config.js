// Supabase project credentials (public anon key; RLS must be enabled)
window.SUPABASE_URL = "https://txndueuqljeujlccngbj.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4bmR1ZXVxbGpldWpsY2NuZ2JqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcwMzI3OTMsImV4cCI6MjA3MjYwODc5M30.ozHVMxQ0qL4mzZ2q2cRkYPduBk927_a7ffd3tOI6Pdc";
// App version (shown in header)
// config.js
window.APP_VERSION = 'V0.4.0';
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

// ===== Supabase boot (UMD) + Data API =====
(function bootSupabaseWithRetry(){
  const MAX_MS = 3000;   // total time to wait for UMD + keys
  const STEP   = 120;    // poll interval
  const start  = Date.now();

  function finishWithEmptyApi(){
    window.state = window.state || {};
    window.state.data = window.state.data || {};
  }

  async function tryBoot(){
    // 1) Wait until the UMD global AND keys are present
    const hasUmd = (typeof supabase !== 'undefined');
    const hasKeys = !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY);

    if (!hasUmd || !hasKeys) {
      if ((Date.now() - start) < MAX_MS) return setTimeout(tryBoot, STEP);
      console.error('[supabase] Not configured — check SUPABASE_URL/ANON_KEY and the UMD <script> order');
      return finishWithEmptyApi();
    }

    // 2) Create client once
    try {
      if (!window.supabase) {
        window.supabase = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
      }
    } catch (e) {
      console.error('[supabase] createClient failed', e);
      return finishWithEmptyApi();
    }

    if (!window.supabase) {
      if ((Date.now() - start) < MAX_MS) return setTimeout(tryBoot, STEP);
      console.error('[supabase] Not configured — unable to create client');
      return finishWithEmptyApi();
    }

    const db = window.supabase;

    // ---- Vehicles CRUD ----
    async function listVehicles(){
      const { data, error } = await db
        .from('vehicles')
        .select('*')
        .order('inserted_at', { ascending: false });
      if (error) throw error;
      return data || [];
    }
    async function createVehicle(row){
      const { data, error } = await db.from('vehicles').insert(row).select().single();
      if (error) throw error; return data;
    }
    async function updateVehicle(id, patch){
      const { data, error } = await db.from('vehicles').update(patch).eq('id', id).select().single();
      if (error) throw error; return data;
    }
    async function deleteVehicle(id){
      const { error } = await db.from('vehicles').delete().eq('id', id);
      if (error) throw error; return true;
    }

    // ---- Scenarios CRUD ----
    async function listScenarios(){
      const { data, error } = await db
        .from('scenarios')
        .select('*')
        .order('inserted_at', { ascending: false });
      if (error) throw error; return data || [];
    }
    async function createScenario({ title, notes, snapshot }){
      const { data, error } = await db.from('scenarios').insert({ title, notes, snapshot }).select().single();
      if (error) throw error; return data;
    }
    async function getScenario(id){
      const { data, error } = await db.from('scenarios').select('*').eq('id', id).single();
      if (error) throw error; return data;
    }
    async function deleteScenario(id){
      const { error } = await db.from('scenarios').delete().eq('id', id);
      if (error) throw error; return true;
    }

    // 3) Expose to app
    window.dataApi = {
      listVehicles, createVehicle, updateVehicle, deleteVehicle,
      listScenarios, createScenario, getScenario, deleteScenario,
    };
    window.state = window.state || {};
    window.state.data = window.dataApi;
  }

  tryBoot();
})();
