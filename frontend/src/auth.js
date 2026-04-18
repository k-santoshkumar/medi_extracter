// We use the same Supabase URL and ANON KEY provided for your backend
const SUPABASE_URL = "https://rfrrqpftkyhrkdgiugog.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmcnJxcGZ0a3locmtkZ2l1Z29nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0OTEzMzgsImV4cCI6MjA5MjA2NzMzOH0.aGee8PqSjXC4AenFr142Vzy0y-Cb3pxonJmeGIEXjzg";

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
  
  // Robust detection for Capacitor Native App (Android/iOS)
  const isNative = window.Capacitor?.isNative || 
                   window.location.protocol === 'capacitor:' || 
                   window.location.hostname === 'localhost';
                   
  const targetRedirect = isNative ? "com.ksk.medextract://" : window.location.origin;

  console.log("Auth redirecting to:", targetRedirect);

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: targetRedirect,
      skipBrowserRedirect: false
    }
  });
  if (error) showErr(error.message);
});

$("logoutBtn")?.addEventListener("click", async () => {
  await supabase.auth.signOut();
});

// Run Init
checkSession();

// Handle Deep Links for Capacitor (Android/iOS)
if (window.Capacitor?.Plugins?.App) {
  window.Capacitor.Plugins.App.addListener('appUrlOpen', ({ url }) => {
    console.log("App opened with URL:", url);
    // Supabase needs to handle this URL to extract the session
    if (url.includes("#access_token") || url.includes("access_token=")) {
      // Small trick: We redirect the webview to the hash to let Supabase parse it
      const hash = url.split("#")[1];
      if (hash) {
        window.location.hash = hash;
      }
    }
  });
}
