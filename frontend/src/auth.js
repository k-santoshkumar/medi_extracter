// We use the same Supabase URL and ANON KEY provided for your backend
const SUPABASE_URL = "https://rfrrqpftkyhrkdgiugog.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_0cPnZA34zrWa9IgbISuI1w_qb7TM_AO";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.supabaseClient = supabase; 
window.supabaseSession = null;

const $ = (id) => document.getElementById(id);
const authContainer = $("authContainer");
const appContainer = $("appContainer");
const authError = $("authError");

function showErr(msg) {
  if(!authError) return;
  authError.textContent = msg;
  authError.style.display = "block";
}
function hideErr() {
  if(authError) authError.style.display = "none";
}

async function checkSession() {
  const { data: { session }, error } = await supabase.auth.getSession();
  handleSession(session);

  // Setup auth state listener
  supabase.auth.onAuthStateChange((event, session) => {
    handleSession(session);
  });
}

function handleSession(session) {
  window.supabaseSession = session;
  if (session) {
    authContainer.style.display = "none";
    appContainer.style.display = "flex";
    
    // Automatically fetch user reports once logged in
    if(window.loadDashboard) window.loadDashboard();
    if(window.loadReports) window.loadReports();
  } else {
    authContainer.style.display = "flex";
    appContainer.style.display = "none";
  }
}

$("loginBtn")?.addEventListener("click", async () => {
  hideErr();
  const email = $("authEmail").value;
  const password = $("authPassword").value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) showErr(error.message);
});

$("registerBtn")?.addEventListener("click", async () => {
  hideErr();
  const email = $("authEmail").value;
  const password = $("authPassword").value;
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) showErr(error.message);
  else showErr("Success! You can now log in (or check email if confirmation enabled).");
});

$("googleAuthBtn")?.addEventListener("click", async () => {
  hideErr();
  
  // Detect if app is running natively via Capacitor (which usually serves from http://localhost on Android)
  const isNative = window.location.origin === "http://localhost" && /Android/i.test(navigator.userAgent);
  const targetRedirect = isNative ? "com.ksk.medextract://" : window.location.origin;

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: targetRedirect
    }
  });
  if (error) showErr(error.message);
});

$("logoutBtn")?.addEventListener("click", async () => {
  await supabase.auth.signOut();
});

// Run Init
checkSession();
