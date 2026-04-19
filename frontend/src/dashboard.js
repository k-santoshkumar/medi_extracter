// ── Config ─────────────────────────────────────────────────────────
const API_BASE = "https://medi-extracter.onrender.com";

// Inject Supabase Auth Token into all fetch calls automatically
const originalFetch = window.fetch;
window.fetch = async function () {
  let [resource, config] = arguments;
  if (typeof resource === 'string' && resource.startsWith(API_BASE)) {
    config = config || {};
    config.headers = config.headers || {};
    if (window.supabaseSession) {
      config.headers["Authorization"] = `Bearer ${window.supabaseSession.access_token}`;
    }
  }
  return originalFetch(resource, config);
};

// ── State ──────────────────────────────────────────────────────────
let trendChartInstance = null;
let allTrends = [];
let pendingReportData = null;

// ── DOM Helpers ────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const show = (el) => { if (el) el.style.display = ""; };
const hide = (el) => { if (el) el.style.display = "none"; };

// ── Toast ──────────────────────────────────────────────────────────
function showToast(msg, type = "info") {
  const toast = $("toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  setTimeout(() => { toast.className = "toast"; }, 3500);
}

// ── Theme Management ──────────────────────────────────────────────
function initTheme() {
  const savedTheme = localStorage.getItem("theme") || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  setTheme(savedTheme);
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
  
  // Update toggle icons
  const sunIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-11.314l.707.707m11.314 11.314l.707.707M12 8a4 4 0 100 8 4 4 0 000-8z"/></svg>`;
  const moonIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
  
  const icon = theme === "light" ? moonIcon : sunIcon;
  if ($("themeToggleMobile")) $("themeToggleMobile").innerHTML = icon;
  if ($("themeToggleDesktop")) $("themeToggleDesktop").innerHTML = icon;
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  setTheme(current === "light" ? "dark" : "light");
}

$("themeToggleMobile")?.addEventListener("click", toggleTheme);
$("themeToggleDesktop")?.addEventListener("click", toggleTheme);

// ── Unified Navigation (Sidebar & Bottom Nav) ──────────────────────
function navigate(sectionId) {
  const sectionIdLower = sectionId.toLowerCase();
  
  // Update sections
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  const targetSection = $(`section${sectionId}`);
  if (targetSection) targetSection.classList.add("active");

  // Update nav items (Sidebar)
  document.querySelectorAll(".nav-item").forEach(n => {
    n.classList.toggle("active", n.dataset.section === sectionIdLower);
  });

  // Update nav items (Bottom Nav)
  document.querySelectorAll(".bottom-nav-item").forEach(n => {
    n.classList.toggle("active", n.dataset.section === sectionIdLower);
  });

  // View-specific loaders
  if (sectionIdLower === "trends") setTimeout(loadTrendsGrid, 50);
  if (sectionIdLower === "reports") loadReports();
  if (sectionIdLower === "dashboard") loadDashboard();

  // Scroll to top on section change
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Attach listeners to both Sidebar and Bottom Nav
document.querySelectorAll(".nav-item, .bottom-nav-item").forEach(item => {
  item.addEventListener("click", (e) => {
    e.preventDefault();
    const section = item.dataset.section;
    if (section === "profile") {
        showToast("Profile settings coming soon!", "info");
        return;
    }
    const sectionCapitalized = section.charAt(0).toUpperCase() + section.slice(1);
    navigate(sectionCapitalized);
  });
});

// ── Demo Mode ──────────────────────────────────────────────────────
async function runDemoFlow() {
  navigate("Upload");
  showToast("Starting Demo: Simulating Medical Extraction...", "info");
  
  // Create a dummy file for the UI
  const dummyFile = { name: "demo_blood_report.pdf" };
  
  // Trigger the visual progress
  $("progressFileName").textContent = dummyFile.name;
  $("progressStatus").textContent   = "AI extracting data…";
  const bar = $("progressBar");
  if (bar) {
    bar.style.width = "0%";
    show($("uploadProgress"));
    
    // Animate teal bar
    setTimeout(() => bar.style.width = "45%", 500);
    setTimeout(() => bar.style.width = "85%", 1500);
  }

  // Simulated extraction delay
  await new Promise(r => setTimeout(r, 2500));
  
  if (bar) bar.style.width = "100%";
  $("progressStatus").textContent = "✓ Analysis Complete";

  // Mock extracted data
  const mockReport = {
    patient_name: "John Doe (Demo)",
    report_date: "10-24-2025",
    lab_name: "Advanced Bio-Diagnostics",
    doctor_name: "Dr. Sarah Smith",
    biomarkers: [
      { id: 101, marker_name: "Hemoglobin", original_name: "Hgb", value: "14.2", unit: "g/dL", reference_range: "13.5 - 17.5" },
      { id: 102, marker_name: "HbA1c", original_name: "Glycohemoglobin", value: "5.4", unit: "%", reference_range: "< 5.7" },
      { id: 103, marker_name: "Creatinine", original_name: "Serum Creat", value: "0.92", unit: "mg/dL", reference_range: "0.70 - 1.30" },
      { id: 104, marker_name: "Glucose", original_name: "Fasting Blood Sugar", value: "92", unit: "mg/dL", reference_range: "70 - 99" }
    ]
  };

  setTimeout(() => {
    hide($("uploadProgress"));
    showToast("✓ Demo Success: Data extracted using Bio-Teal logic", "success");
    renderPreview(mockReport);
    show($("previewCard"));
  }, 800);
}

$("runDemoBtn")?.addEventListener("click", runDemoFlow);

// ── Action Buttons ──────────────────────────────────────────────────
$("logoutBtnMobile")?.addEventListener("click", () => window.supabaseClient.auth.signOut());
$("browseBtn")?.addEventListener("click",  () => $("fileInput").click());
$("cameraBtn")?.addEventListener("click",  () => $("cameraInput").click());
$("fileInput")?.addEventListener("change", (e) => handleFileUpload(e.target.files[0]));
$("cameraInput")?.addEventListener("change", (e) => handleFileUpload(e.target.files[0]));

// ── File Upload & Extraction ───────────────────────────────────────
async function handleFileUpload(file) {
  if (!file) return;

  const allowed = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
  if (!allowed.includes(file.type)) {
    showToast("Unsupported file type. Use PDF, JPG, or PNG.", "error");
    return;
  }

  // UI Progress Setup (Simple for now, can be expanded)
  showToast("Uploading and extracting data...", "info");
  
  try {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${API_BASE}/api/v1/upload`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || "Upload failed");
    }

    const result = await response.json();
    showToast("✓ Extraction complete!", "success");
    
    // Refresh and return to dashboard
    loadDashboard();
    navigate("Dashboard");

  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

// ── Preview Extracted Data ─────────────────────────────────────────
function renderPreview(report) {
  pendingReportData = report;

  // Meta section
  $("previewMeta").innerHTML = [
    { label: "Patient",    value: report.patient_name  || "N/A" },
    { label: "Date",       value: report.report_date   || "N/A" },
    { label: "Lab",        value: report.lab_name      || "N/A" },
    { label: "Doctor",     value: report.doctor_name   || "N/A" },
  ].map(m => `
    <div class="meta-item">
      <span class="meta-label" style="font-size:0.65rem; font-weight:700; color:var(--text-3); text-transform:uppercase;">${m.label}</span>
      <span class="meta-value" style="font-size:0.9rem; font-weight:600; color:var(--text-1);">${m.value}</span>
    </div>
  `).join("");

  // Biomarker table
  const tbody = $("previewBody");
  tbody.innerHTML = "";

  if (!report.biomarkers || report.biomarkers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-3);padding:28px">No biomarkers extracted</td></tr>`;
    return;
  }

  report.biomarkers.forEach(bm => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="padding:12px 16px;">
        <div style="font-weight:700; color:var(--text-1);">${escHtml(bm.marker_name)}</div>
        <div style="font-size:0.7rem; color:var(--text-3);">${escHtml(bm.original_name)}</div>
      </td>
      <td style="padding:12px 16px;">
        <input class="inline-edit" data-id="${bm.id}" value="${escHtml(bm.value)}"
               style="background:var(--bg-input); border:1px solid var(--border); border-radius:6px; color:var(--text-1); font-size:0.85rem; width:80px; padding:4px 8px; outline:none;" />
      </td>
      <td style="padding:12px 16px; color:var(--text-2); font-size:0.8rem;">${escHtml(bm.unit || "—")}</td>
      <td style="padding:12px 16px; color:var(--text-3); font-size:0.75rem;">${escHtml(bm.reference_range || "—")}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Confirm and Save
$("confirmBtn")?.addEventListener("click", async () => {
    showToast("Report saved to your medical history", "success");
    hide($("previewCard"));
    navigate("Dashboard");
    loadDashboard();
});

// ── Dashboard Loading ──────────────────────────────────────────────
async function loadDashboard() {
  try {
    const res = await fetch(`${API_BASE}/api/v1/dashboard/stats`);
    if (!res.ok) throw new Error("Failed to load stats");
    const stats = await res.json();
    
    renderStats(stats);
    renderVitals(stats.latest_vitals || []);
    
    $("patientSubtitle").textContent = stats.patient_name
      ? `Tracking: ${stats.patient_name}`
      : "Start by uploading a medical record";

  } catch (err) {
    console.error("Dashboard error:", err);
  }
}

function renderStats(stats) {
  const grid = $("statsGrid");
  if (!grid) return;
  grid.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Reports</div>
      <div class="stat-value">${stats.total_reports}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Markers</div>
      <div class="stat-value">${stats.total_markers}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Tracked</div>
      <div class="stat-value">${stats.trends?.length || 0}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Latest</div>
      <div class="stat-value" style="font-size:1rem">${stats.latest_report_date || "—"}</div>
    </div>
  `;
}

function renderVitals(vitals) {
  const grid = $("vitalsGrid");
  if (!grid) return;

  if (vitals.length === 0) {
    grid.innerHTML = `<p style="grid-column:1/-1; color:var(--text-3); text-align:center; padding:20px;">No markers found yet.</p>`;
    return;
  }

  grid.innerHTML = vitals.slice(0, 8).map(v => `
    <div class="vital-card">
      <div class="vital-name">${escHtml(v.marker_name)}</div>
      <div class="vital-value">${escHtml(v.value)} <span style="font-size:0.7rem; font-weight:400;">${escHtml(v.unit || "")}</span></div>
    </div>
  `).join("");
}

// ── Reports Loading ────────────────────────────────────────────────
async function loadReports() {
  const list = $("reportsList");
  if (!list) return;
  try {
    const res = await fetch(`${API_BASE}/api/v1/reports`);
    const reports = await res.json();

    if (!reports.length) {
      list.innerHTML = `<p style="text-align:center; padding:40px; color:var(--text-3);">No reports uploaded yet.</p>`;
      return;
    }

    list.innerHTML = reports.map(r => `
      <div class="report-card" style="background:var(--bg-panel); padding:16px; border-radius:12px; margin-bottom:12px; border:1px solid var(--border);">
        <div style="font-weight:700; margin-bottom:4px;">${escHtml(r.patient_name || r.filename)}</div>
        <div style="font-size:0.8rem; color:var(--text-2); display:flex; justify-content:space-between;">
           <span>${escHtml(r.report_date)}</span>
           <span style="color:var(--accent)">View Details →</span>
        </div>
      </div>
    `).join("");

  } catch (err) {
    list.innerHTML = `<p>Error loading reports.</p>`;
  }
}

// ── Trends Grid ─────────────────────────────────────────────────────
async function loadTrendsGrid() {
    const grid = $("trendsGrid");
    if (!grid) return;
    grid.innerHTML = `<p style="text-align:center; padding:40px; color:var(--text-3);">AI-powered trend analysis is loading...</p>`;
}

// ── Utility ─────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── Init ─────────────────────────────────────────────────────────────
window.loadDashboard = loadDashboard;
window.loadReports = loadReports;

initTheme();
loadDashboard();
