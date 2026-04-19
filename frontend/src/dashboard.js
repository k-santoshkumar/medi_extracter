// ── Config ─────────────────────────────────────────────────────────
const API_BASE = window.location.origin.includes("localhost") || window.location.origin.includes("127.0.0.1")
  ? "http://localhost:8000" 
  : "https://medi-extracter.onrender.com";

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

// ── Utility: Image Compression ────────────────────────────────────
async function compressImage(file, maxWidth = 1280) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          const compressedFile = new File([blob], file.name, {
            type: 'image/jpeg',
            lastModified: Date.now()
          });
          resolve(compressedFile);
        }, 'image/jpeg', 0.85);
      };
    };
  });
}

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

$("fileInput")?.addEventListener("change", (e) => stageFiles(e.target.files));
$("cameraInput")?.addEventListener("change", (e) => stageFiles(e.target.files));

// ── Sequential Queue Logic ──────────────────────────────────────────
async function stageFiles(files) {
  if (!files || files.length === 0) return;
  
  show($("pendingUpload"));
  hide($("uploadArea"));
  hide($("previewCard"));

  for (const file of files) {
    const id = Math.random().toString(36).substr(2, 9);
    uploadQueue.push({ id, file, status: 'staged', result: null });
    renderQueueItem({ id, file, status: 'staged' });
  }

  updateQueueHeader();
  if (!isProcessing) processQueue();
}

function renderQueueItem(item) {
  const list = $("queueList");
  const card = document.createElement("div");
  card.id = `queue-item-${item.id}`;
  card.className = "stat-card";
  card.style = "display:flex; align-items:center; justify-content:space-between; margin-bottom:0px; border-color:var(--border); padding:12px 16px;";
  
  const isImage = item.file.type.startsWith("image/");
  const icon = isImage 
    ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`
    : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

  card.innerHTML = `
    <div style="display:flex; align-items:center; gap:12px;">
      <div style="background:var(--bg-input); color:var(--text-3); padding:8px; border-radius:10px;">${icon}</div>
      <div>
        <div style="font-weight:700; color:var(--text-1); font-size:0.85rem; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.file.name}</div>
        <div class="status-text" style="font-size:0.7rem; color:var(--text-3);">Waiting...</div>
      </div>
    </div>
    <div class="status-indicator">
       <div class="spinner-small" style="display:none"></div>
       <div class="check-mark" style="display:none; color:var(--green); font-weight:800;">✓</div>
    </div>
  `;
  list.appendChild(card);
}

async function processQueue() {
  const item = uploadQueue.find(i => i.status === 'staged');
  if (!item) {
    isProcessing = false;
    showToast(`Processed ${completedCount} reports!`, "success");
    return;
  }

  isProcessing = true;
  item.status = 'processing';
  updateItemStatusUI(item.id, 'Analyzing...', true);

  try {
    let fileToUpload = item.file;
    if (item.file.type.startsWith("image/") && item.file.size > 1024 * 1024) {
      updateItemStatusUI(item.id, 'Optimizing...', true);
      fileToUpload = await compressImage(item.file);
    }

    const formData = new FormData();
    formData.append("file", fileToUpload);

    const response = await fetch(`${API_BASE}/api/v1/upload`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      let detail = "Failed";
      try {
        const err = await response.json();
        detail = err.detail || detail;
      } catch (e) {}
      throw new Error(detail);
    }

    const result = await response.json();
    
    if (result.extraction_error) {
        item.status = 'partial';
        updateItemStatusUI(item.id, 'Saved (Manual)', false, true);
        showToast(`Report saved, but AI couldn't read all details.`, "info");
    } else {
        item.status = 'done';
        updateItemStatusUI(item.id, 'Complete', false, true);
        showToast("✓ Extraction complete!", "success");
    }
    
    item.result = result;
    completedCount++;
    triggerHaptic("success");

    // Preview the latest result
    renderPreview(result.extracted, fileToUpload.type);
    show($("previewCard"));
    $("previewCard").scrollIntoView({ behavior: 'smooth' });

  } catch (err) {
    console.error("Queue item failed:", err);
    item.status = 'error';
    updateItemStatusUI(item.id, 'Failed', false, false, true);
    showToast(`Upload failed: ${err.message}`, "error");
  }

  updateQueueHeader();
  processQueue(); // Loop to next
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

  if (!vitals || !Array.isArray(vitals) || vitals.length === 0) {
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
      } else {
          summaryText.textContent = "All your latest biomarkers are within standard reference ranges. Great job maintaining your health trends!";
          summaryCard.style.background = "var(--accent-glow)";
          summaryCard.style.borderColor = "var(--accent)";
      }
      }
  }
}

function updateItemStatusUI(id, text, showSpinner = false, isDone = false, isError = false) {
  const card = $(`queue-item-${id}`);
  if (!card) return;
  card.querySelector(".status-text").textContent = text;
  card.querySelector(".spinner-small").style.display = showSpinner ? "block" : "none";
  card.querySelector(".check-mark").style.display = isDone ? "block" : "none";
  
  if (isDone) {
    const isPartial = text.includes("Manual");
    card.style.borderColor = isPartial ? "#f59e0b" : "var(--green)";
    card.style.background = isPartial ? "rgba(245, 158, 11, 0.05)" : "var(--accent-glow)";
    if (isPartial) card.querySelector(".check-mark").style.color = "#f59e0b";
  }
  if (isError) {
    card.style.borderColor = "var(--red)";
    card.querySelector(".status-text").style.color = "var(--red)";
  }
}

function updateQueueHeader() {
  if ($("queueProgress")) {
    $("queueProgress").textContent = `${completedCount}/${uploadQueue.length} Complete`;
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
