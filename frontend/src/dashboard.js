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
let currentFileUrl = null;

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

// ── Haptic Feedback Utility ───────────────────────────────────────
async function triggerHaptic(type = "light") {
  if (window.Capacitor?.Plugins?.Haptics) {
    try {
      const { Haptics, ImpactStyle } = window.Capacitor.Plugins;
      if (type === "heavy") await Haptics.impact({ style: ImpactStyle.Heavy });
      else if (type === "success") await Haptics.notification({ type: 'SUCCESS' });
      else await Haptics.impact({ style: ImpactStyle.Light });
    } catch (e) { /* Haptics not supported */ }
  }
}

// ── Unified Navigation (Sidebar & Bottom Nav) ──────────────────────
function navigate(sectionId) {
  triggerHaptic("light");
  const sectionIdLower = sectionId.toLowerCase();
  
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  const targetSection = $(`section${sectionId}`);
  if (targetSection) targetSection.classList.add("active");

  document.querySelectorAll(".nav-item").forEach(n => {
    n.classList.toggle("active", n.dataset.section === sectionIdLower);
  });

  document.querySelectorAll(".bottom-nav-item").forEach(n => {
    n.classList.toggle("active", n.dataset.section === sectionIdLower);
  });

  if (sectionIdLower === "trends") setTimeout(loadTrendsGrid, 50);
  if (sectionIdLower === "reports") loadReports();
  if (sectionIdLower === "dashboard") loadDashboard();

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

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

  if (currentFileUrl) URL.revokeObjectURL(currentFileUrl);
  currentFileUrl = URL.createObjectURL(file);
  
  showToast("AI is analyzing your report...", "info");
  
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
    triggerHaptic("success");
    showToast("✓ Extraction complete!", "success");
    
    renderPreview(result.extracted, file.type);
    show($("previewCard"));
    $("previewCard").scrollIntoView({ behavior: 'smooth' });

  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

// ── Preview Extracted Data ─────────────────────────────────────────
function renderPreview(report, fileType) {
  pendingReportData = report;

  const imgPreview = $("imagePreview");
  const pdfPlaceholder = $("pdfPlaceholder");
  
  if (fileType.startsWith("image/")) {
    imgPreview.src = currentFileUrl;
    show(imgPreview);
    hide(pdfPlaceholder);
  } else {
    hide(imgPreview);
    show(pdfPlaceholder);
  }

  $("previewMeta").innerHTML = [
    { label: "Patient",    value: report.patient_name  || "N/A" },
    { label: "Date",       value: report.report_date   || "N/A" },
    { label: "Lab",        value: report.lab_name      || "N/A" },
    { label: "Doctor",     value: report.doctor_name   || "N/A" }
  ].map(m => `
    <div class="meta-item">
      <span class="meta-label" style="font-size:0.65rem; font-weight:700; color:var(--text-3); text-transform:uppercase;">${m.label}</span>
      <span class="meta-value" style="font-size:0.9rem; font-weight:600; color:var(--text-1);">${m.value}</span>
    </div>
  `).join("");

  const tbody = $("previewBody");
  tbody.innerHTML = "";

  if (!report.biomarkers || report.biomarkers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-3);padding:28px">No biomarkers extracted</td></tr>`;
    return;
  }

  report.biomarkers.forEach(bm => {
    const isLow = bm.confidence === "low";
    const tr = document.createElement("tr");
    if (isLow) tr.className = "confidence-low";
    
    tr.innerHTML = `
      <td style="padding:12px 16px;">
        <div class="marker-name" style="font-weight:700; color:var(--text-1);">${escHtml(bm.marker_name)}</div>
        <div style="font-size:0.7rem; color:var(--text-3);">${escHtml(bm.original_name)}</div>
      </td>
      <td style="padding:12px 16px;">
        <input class="inline-edit" value="${escHtml(bm.value)}"
               style="background:var(--bg-input); border:1px solid var(--border); border-radius:6px; color:var(--text-1); font-size:0.85rem; width:70px; padding:4px 8px; outline:none;" />
      </td>
      <td style="padding:12px 16px; color:var(--text-2); font-size:0.8rem;">${escHtml(bm.unit || "—")}</td>
      <td style="padding:12px 16px; color:var(--text-3); font-size:0.75rem;">${escHtml(bm.reference_range || "—")}</td>
    `;
    tbody.appendChild(tr);
  });
}

$("confirmBtn")?.addEventListener("click", async () => {
    showToast("Report saved to your medical history", "success");
    hide($("previewCard"));
    navigate("Dashboard");
    loadDashboard();
});

// ── Dashboard Loading ──────────────────────────────────────────────
async function loadDashboard() {
  const statsGrid = $("statsGrid");
  const vitalsGrid = $("vitalsGrid");
  
  if (statsGrid) statsGrid.innerHTML = Array(4).fill('<div class="skeleton" style="height:110px; border-radius:16px;"></div>').join('');
  if (vitalsGrid) vitalsGrid.innerHTML = Array(6).fill('<div class="skeleton" style="height:80px; border-radius:16px;"></div>').join('');
  
  try {
    const res = await fetch(`${API_BASE}/api/v1/dashboard/stats`);
    if (!res.ok) throw new Error("Failed to load stats");
    const stats = await res.json();
    
    await new Promise(r => setTimeout(r, 400));
    
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
    hide($("healthSummaryCard"));
    return;
  }

  let outOfRangeCount = 0;
  grid.innerHTML = vitals.slice(0, 10).map(v => {
    let statusTag = "";
    if (v.reference_range && v.reference_range !== "N/A") {
        const val = parseFloat(v.value);
        const range = v.reference_range.match(/(\d+\.?\d*)\s*-\s*(\d+\.?\d*)/);
        if (range && !isNaN(val)) {
            const min = parseFloat(range[1]);
            const max = parseFloat(range[2]);
            if (val < min || val > max) {
                outOfRangeCount++;
                statusTag = `<span style="background:var(--red); color:white; font-size:0.6rem; padding:2px 6px; border-radius:4px; margin-left:8px;">CAUTION</span>`;
            }
        }
    }

    return `
      <div class="vital-card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div class="vital-name">${escHtml(v.marker_name)}</div>
            ${statusTag}
        </div>
        <div class="vital-value">${escHtml(v.value)} <span style="font-size:0.7rem; font-weight:400; color:var(--text-3);">${escHtml(v.unit || "")}</span></div>
      </div>
    `;
  }).join("");

  const summaryCard = $("healthSummaryCard");
  const summaryText = $("healthSummaryText");
  if (summaryCard && summaryText) {
      show(summaryCard);
      if (outOfRangeCount > 0) {
          summaryText.textContent = `Your latest report shows ${outOfRangeCount} biomarker${outOfRangeCount > 1 ? 's' : ''} outside standard reference ranges. Please review with your physician.`;
          summaryCard.style.background = "rgba(244, 63, 94, 0.1)";
          summaryCard.style.borderColor = "var(--red)";
      } else {
          summaryText.textContent = "All your latest biomarkers are within standard reference ranges. Great job maintaining your health trends!";
          summaryCard.style.background = "var(--accent-glow)";
          summaryCard.style.borderColor = "var(--accent)";
      }
  }
}

// ── Reports Loading ────────────────────────────────────────────────
async function loadReports() {
  const list = $("reportsList");
  if (!list) return;

  list.innerHTML = Array(3).fill('<div class="skeleton" style="height:70px; margin-bottom:12px; border-radius:12px;"></div>').join('');

  try {
    const res = await fetch(`${API_BASE}/api/v1/reports`);
    const reports = await res.json();
    await new Promise(r => setTimeout(r, 300));

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
