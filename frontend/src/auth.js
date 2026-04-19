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

// Views
const viewLogin = $("viewLogin");
const viewRegister = $("viewRegister");
const viewVerify = $("viewVerify");
const socialDivider = $("socialDivider");
const googleAuthBtn = $("googleAuthBtn");

function showErr(msg) {
  if(!authError) return;
  authError.textContent = msg;
  authError.style.display = "block";
}
function hideErr() {
  if(authError) authError.style.display = "none";
}

function setBtnLoading(btnId, isLoading) {
  const btn = $(btnId);
  if (!btn) return;
  if (isLoading) {
    btn.disabled = true;
    btn.dataset.originalText = btn.innerHTML;
    btn.innerHTML = `<span class="spinner-small"></span> Processing...`;
  } else {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.originalText || btn.innerHTML;
  }
}

function switchView(viewName) {
  hideErr();
  viewLogin.style.display = viewName === 'login' ? 'block' : 'none';
  viewRegister.style.display = viewName === 'register' ? 'block' : 'none';
  viewVerify.style.display = viewName === 'verify' ? 'block' : 'none';
  
  const isAuth = viewName === 'login' || viewName === 'register';
  socialDivider.style.display = isAuth ? 'flex' : 'none';
  googleAuthBtn.style.display = isAuth ? 'flex' : 'none';
}

// Navigation Listeners
$("toRegister")?.addEventListener("click", (e) => { e.preventDefault(); switchView('register'); });
$("toLogin")?.addEventListener("click", (e) => { e.preventDefault(); switchView('login'); });
$("backToLoginBtn")?.addEventListener("click", () => switchView('login'));

// Password Validation
const regPassword = $("regPassword");
const pwStrength = $("pwStrength");

regPassword?.addEventListener("input", () => {
  const val = regPassword.value;
  let strength = "";
  if (val.length >= 8) {
    strength = "pw-strength-weak";
    if (/[A-Z]/.test(val) && /[0-9]/.test(val)) strength = "pw-strength-medium";
    if (/[^A-Za-z0-9]/.test(val)) strength = "pw-strength-strong";
  }
  pwStrength.className = "pw-strength-meter " + strength;
});

async function checkSession() {
  // 1. Check for incoming tokens in the URL immediately
  if (window.location.hash || window.location.search) {
    await handleAuthCallback(window.location.href);
  }

  // 2. Initial Session Check
  const { data: { session } } = await supabase.auth.getSession();
  handleSession(session);

  // 3. Reactive listener for all auth changes
  supabase.auth.onAuthStateChange((event, session) => {
    console.log("Supabase Auth Event:", event);
    handleSession(session);
  });
}

function handleSession(session) {
  window.supabaseSession = session;
  if (session) {
    authContainer.style.display = "none";
    appContainer.style.display = "flex";
    if(window.loadDashboard) window.loadDashboard();
    if(window.loadReports) window.loadReports();
  } else {
    authContainer.style.display = "flex";
    appContainer.style.display = "none";
  }
}

// --- Action Handlers ---

$("loginBtn")?.addEventListener("click", async () => {
  hideErr();
  const email = $("authEmail").value;
  const password = $("authPassword").value;
  if (!email || !password) return showErr("Please enter both email and password.");

  setBtnLoading("loginBtn", true);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  setBtnLoading("loginBtn", false);
  
  if (error) showErr(error.message);
});

$("registerBtn")?.addEventListener("click", async () => {
  hideErr();
  const fullName = $("regFullName").value;
  const email = $("regEmail").value;
  const password = $("regPassword").value;
  const confirmPw = $("regConfirmPassword").value;
  const terms = $("regTerms").checked;

  if (!fullName || !email || !password) return showErr("All fields are required.");
  if (password !== confirmPw) return showErr("Passwords do not match.");
  if (password.length < 8) return showErr("Password must be at least 8 characters.");
  if (!terms) return showErr("Please agree to the terms.");

  setBtnLoading("registerBtn", true);
  const { data, error } = await supabase.auth.signUp({ 
    email, 
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: getRedirectUrl()
    }
  });
  setBtnLoading("registerBtn", false);

  if (error) {
    showErr(error.message);
  } else if (!data.session) {
    $("verifyEmailDisplay").textContent = email;
    switchView('verify');
  }
});

$("googleAuthBtn")?.addEventListener("click", async () => {
  hideErr();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: getRedirectUrl(),
      skipBrowserRedirect: false
    }
  });
  if (error) showErr(error.message);
});

$("resendEmailBtn")?.addEventListener("click", async () => {
  const email = $("regEmail").value;
  setBtnLoading("resendEmailBtn", true);
  const { error } = await supabase.auth.resend({
    type: 'signup', email, options: { emailRedirectTo: getRedirectUrl() }
  });
  setBtnLoading("resendEmailBtn", false);
  if (error) showErr(error.message);
  else alert("Verification email sent!");
});

$("logoutBtn")?.addEventListener("click", async () => {
  await supabase.auth.signOut();
});

// --- Helper Functions ---

function getRedirectUrl() {
  const isNative = window.Capacitor?.isNative || 
                   window.location.protocol === 'capacitor:' || 
                   window.location.hostname === 'localhost';
  return isNative ? "com.ksk.medextract://callback" : window.location.origin;
}

async function handleAuthCallback(url) {
  console.log("Auth Callback Triggered:", url);
  const hash = url.split('#')[1];
  if (!hash) return;

  // Manually parse the hash to ensure Supabase picks it up immediately
  const params = new URLSearchParams(hash);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');

  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });
    if (error) console.error("Error setting session:", error.message);
  } else {
    // Fallback: set hash and let the client try to parse it
    window.location.hash = hash;
  }
}

// Run Initialization
checkSession();

// Handle Deep Links for Android/iOS
if (window.Capacitor?.Plugins?.App) {
  window.Capacitor.Plugins.App.addListener('appUrlOpen', async ({ url }) => {
    await handleAuthCallback(url);
  });
}
