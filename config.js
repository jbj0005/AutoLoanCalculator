// Supabase project credentials (public anon key; RLS must be enabled)
// Prefer Vite env vars when available; fall back to window values or placeholders.
const VENV = (typeof import !== 'undefined' && typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};
window.SUPABASE_URL = VENV.VITE_SUPABASE_URL || window.SUPABASE_URL || "";
window.SUPABASE_ANON_KEY = VENV.VITE_SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY || "";

// App version (shown in header)
window.APP_VERSION = window.APP_VERSION || 'V0.4.1';

// Optional: Google Maps API keys/toggles via env with safe fallbacks
window.GMAPS_API_KEY = VENV.VITE_GMAPS_API_KEY || window.GMAPS_API_KEY || "";

// Feature toggles (set to true to enable)
// Disable Google Places Autocomplete by default to avoid input issues in restricted networks.
window.ENABLE_GOOGLE_PLACES = (VENV.VITE_ENABLE_GOOGLE_PLACES ?? window.ENABLE_GOOGLE_PLACES ?? false) === true || String(VENV.VITE_ENABLE_GOOGLE_PLACES).toLowerCase() === 'true';
// Allow geocoding via Google REST on blur/save; set false to fully disable network geocoding
window.ENABLE_GOOGLE_GEOCODING = (VENV.VITE_ENABLE_GOOGLE_GEOCODING ?? window.ENABLE_GOOGLE_GEOCODING ?? true) === true || String(VENV.VITE_ENABLE_GOOGLE_GEOCODING).toLowerCase() === 'true';
// Avoid geocoding on each keystroke; set true to re-enable live lookup as you type
window.GEOCODE_ON_INPUT = (VENV.VITE_GEOCODE_ON_INPUT ?? window.GEOCODE_ON_INPUT ?? true) === true || String(VENV.VITE_GEOCODE_ON_INPUT).toLowerCase() === 'true';

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

    // 2) Create client once (handle UMD namespace vs client)
    try {
      const hasClient = !!(window.supabase && typeof window.supabase.from === 'function');
      if (!hasClient) {
        window.supabase = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
      }
    } catch (e) {
      console.error('[supabase] createClient failed', e);
      return finishWithEmptyApi();
    }

    if (!window.supabase || typeof window.supabase.from !== 'function') {
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
    // ---- Fee Sets (public select) ----
    async function listGovFeeSets(filters = {}){
      let q = db.from('gov_fee_sets').select('*').order('label', { ascending: true });
      if (filters.applies_state_code) q = q.eq('applies_state_code', filters.applies_state_code);
      if (filters.applies_county_fips) q = q.eq('applies_county_fips', filters.applies_county_fips);
      const { data, error } = await q;
      if (error) throw error; return data || [];
    }
    async function listDealerFeeSets(filters = {}){
      let q = db.from('dealer_fee_sets').select('*').order('label', { ascending: true });
      if (filters.applies_state_code) q = q.eq('applies_state_code', filters.applies_state_code);
      const { data, error } = await q;
      if (error) throw error; return data || [];
    }

    window.dataApi = {
      listVehicles, createVehicle, updateVehicle, deleteVehicle,
      listScenarios, createScenario, getScenario, deleteScenario,
      listGovFeeSets, listDealerFeeSets,
    };
    window.state = window.state || {};
    window.state.data = window.dataApi;
  }

  tryBoot();
})();
