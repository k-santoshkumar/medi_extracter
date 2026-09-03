import { PublicClientApplication } from "@azure/msal-browser";

const tenantId = import.meta.env.VITE_AZURE_TENANT_ID;
const clientId = import.meta.env.VITE_AZURE_CLIENT_ID;
const apiScope = import.meta.env.VITE_AZURE_API_SCOPE;
const googleDomainHint = import.meta.env.VITE_AZURE_GOOGLE_DOMAIN_HINT || "Google";

const msal = tenantId && clientId ? new PublicClientApplication({
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri: window.location.origin,
  },
  cache: { cacheLocation: "sessionStorage", storeAuthStateInCookie: false },
}) : null;

window.authSession = null;

const $ = (id) => document.getElementById(id);
const authContainer = $("authContainer");
const appContainer = $("appContainer");
const authError = $("authError");
const viewLogin = $("viewLogin");
const viewRegister = $("viewRegister");
const viewVerify = $("viewVerify");
const socialDivider = $("socialDivider");
const googleAuthBtn = $("googleAuthBtn");

function showErr(message) {
  if (!authError) return;
  authError.textContent = message;
  authError.style.display = "block";
}

function hideErr() {
  if (authError) authError.style.display = "none";
}

function setBtnLoading(buttonId, loading) {
  const button = $(buttonId);
  if (!button) return;
  if (loading) {
    button.disabled = true;
    button.dataset.originalText = button.innerHTML;
    button.innerHTML = `<span class="spinner-small"></span> Processing...`;
  } else {
    button.disabled = false;
    button.innerHTML = button.dataset.originalText || button.innerHTML;
  }
}

function switchAuthView(view) {
  hideErr();
  viewLogin.style.display = view === "login" ? "block" : "none";
  viewRegister.style.display = view === "register" ? "block" : "none";
  viewVerify.style.display = view === "verify" ? "block" : "none";
  const showSocial = view === "login" || view === "register";
  socialDivider.style.display = showSocial ? "flex" : "none";
  googleAuthBtn.style.display = showSocial ? "flex" : "none";
}

function handleSession(session) {
  window.authSession = session;
  if (session) {
    authContainer.style.display = "none";
    appContainer.style.display = "flex";
    window.loadDashboard?.();
    window.loadReports?.();
  } else {
    authContainer.style.display = "flex";
    appContainer.style.display = "none";
  }
}

async function acquireApiToken(account) {
  try {
    const result = await msal.acquireTokenSilent({ account, scopes: [apiScope] });
    handleSession({ access_token: result.accessToken, account });
  } catch (error) {
    if (error.name !== "InteractionRequiredAuthError") throw error;
    const result = await msal.acquireTokenPopup({ account, scopes: [apiScope] });
    handleSession({ access_token: result.accessToken, account });
  }
}

async function signIn(extraQueryParameters = {}) {
  const result = await msal.loginPopup({ scopes: [apiScope], extraQueryParameters });
  await acquireApiToken(result.account);
}

async function checkSession() {
  if (!msal || !apiScope) {
    showErr("Azure sign-in is not configured for this environment.");
    return;
  }

  await msal.initialize();
  const redirectResult = await msal.handleRedirectPromise();
  if (redirectResult?.account) {
    await acquireApiToken(redirectResult.account);
    return;
  }
  const account = msal.getAllAccounts()[0];
  if (account) {
    try {
      await acquireApiToken(account);
    } catch (error) {
      console.error("Azure token acquisition failed:", error);
      handleSession(null);
    }
  } else {
    handleSession(null);
  }
}

$("toRegister")?.addEventListener("click", (event) => {
  event.preventDefault();
  switchAuthView("register");
});
$("toLogin")?.addEventListener("click", (event) => {
  event.preventDefault();
  switchAuthView("login");
});
$("backToLoginBtn")?.addEventListener("click", () => switchAuthView("login"));

$("loginBtn")?.addEventListener("click", async () => {
  hideErr();
  setBtnLoading("loginBtn", true);
  try {
    await signIn();
  } catch (error) {
    showErr(error.message || "Azure sign-in failed.");
  } finally {
    setBtnLoading("loginBtn", false);
  }
});

$("registerBtn")?.addEventListener("click", async () => {
  hideErr();
  if (!$("regTerms")?.checked) {
    showErr("Please agree to the Terms of Service and Privacy Policy.");
    return;
  }
  setBtnLoading("registerBtn", true);
  try {
    await signIn();
  } catch (error) {
    showErr(error.message || "Azure account setup failed.");
  } finally {
    setBtnLoading("registerBtn", false);
  }
});

$("googleAuthBtn")?.addEventListener("click", async () => {
  hideErr();
  setBtnLoading("googleAuthBtn", true);
  try {
    await signIn({ domain_hint: googleDomainHint });
  } catch (error) {
    showErr(error.message || "Azure sign-in failed.");
  } finally {
    setBtnLoading("googleAuthBtn", false);
  }
});

$("resendEmailBtn")?.addEventListener("click", () => {
  showErr("Account verification is managed by Microsoft Entra ID.");
});

async function signOut() {
  if (msal) await msal.logoutPopup({ account: msal.getAllAccounts()[0] });
  handleSession(null);
}

$("logoutBtn")?.addEventListener("click", signOut);
$("logoutBtnMobile")?.addEventListener("click", signOut);

checkSession();
