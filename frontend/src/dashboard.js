// ── Config ─────────────────────────────────────────────────────────
const API_BASE = "https://medi-extracter.onrender.com";

// ── State ──────────────────────────────────────────────────────────
let trendChartInstance = null;
let allTrends = [];
let pendingReportData = null;  // Holds extracted data before user confirms

// ── DOM Helpers ────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const show = (el) => { if (el) el.style.display = ""; };
const hide = (el) => { if (el) el.style.display = "none"; };

// ── Toast ──────────────────────────────────────────────────────────
function showToast(msg, type = "info") {
  const toast = $("toast");
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  setTimeout(() => { toast.className = "toast"; }, 3500);
}

// ── Navigation ─────────────────────────────────────────────────────
function navigate(sectionId) {
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  $(`section${sectionId}`).classList.add("active");
  $(`nav${sectionId}`)?.classList.add("active");
  closeSidebar();
}

document.querySelectorAll(".nav-item").forEach(item => {
  item.addEventListener("click", (e) => {
    e.preventDefault();
    const section = item.dataset.section;
    const sectionMap = { dashboard: "Dashboard", reports: "Reports", trends: "Trends", upload: "Upload" };
    navigate(sectionMap[section]);
  });
});

// ── Sidebar (Mobile) ───────────────────────────────────────────────
const sidebar = document.querySelector(".sidebar");
const overlay = document.createElement("div");
overlay.className = "overlay";
document.body.appendChild(overlay);

function openSidebar()  { sidebar.classList.add("open"); overlay.classList.add("active"); }
function closeSidebar() { sidebar.classList.remove("open"); overlay.classList.remove("active"); }

$("hamburger")?.addEventListener("click", openSidebar);
$("sidebarClose")?.addEventListener("click", closeSidebar);
overlay.addEventListener("click", closeSidebar);

// ── Upload Triggers ────────────────────────────────────────────────
$("uploadBtnDesktop")?.addEventListener("click", () => navigate("Upload"));
$("uploadBtnMobile")?.addEventListener("click",  () => navigate("Upload"));
$("navUpload")?.addEventListener("click", () => navigate("Upload"));

$("browseBtn")?.addEventListener("click",  () => $("fileInput").click());
$("cameraBtn")?.addEventListener("click",  () => $("cameraInput").click());
$("fileInput")?.addEventListener("change", (e) => handleFileUpload(e.target.files[0]));
$("cameraInput")?.addEventListener("change", (e) => handleFileUpload(e.target.files[0]));

// Drag & drop
const uploadArea = $("uploadArea");
uploadArea?.addEventListener("dragover",  (e) => { e.preventDefault(); uploadArea.classList.add("drag-over"); });
uploadArea?.addEventListener("dragleave", ()  => uploadArea.classList.remove("drag-over"));
uploadArea?.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadArea.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file) handleFileUpload(file);
});

// ── File Upload & Extraction ───────────────────────────────────────
async function handleFileUpload(file) {
  if (!file) return;

  const allowed = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
  if (!allowed.includes(file.type)) {
    showToast("Unsupported file type. Use PDF, JPG, or PNG.", "error");
    return;
  }

  // Show progress
  $("progressFileName").textContent = file.name;
  $("progressStatus").textContent   = "Extracting…";
  $("progressBar").style.width      = "10%";
  hide($("previewCard"));
  show($("uploadProgress"));

  // Animate progress bar (fake progress for UX)
  let pct = 10;
  const progressInterval = setInterval(() => {
    if (pct < 85) { pct += Math.random() * 8; $("progressBar").style.width = `${Math.min(pct, 85)}%`; }
  }, 400);

  try {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${API_BASE}/api/v1/upload`, {
      method: "POST",
      body: formData,
    });

    clearInterval(progressInterval);

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || "Upload failed");
    }

    const report = await response.json();
    $("progressBar").style.width  = "100%";
    $("progressStatus").textContent = "✓ Done!";

    // Show preview for verification
    setTimeout(() => {
      renderPreview(report);
      show($("previewCard"));
      showToast("Extraction complete! Please verify the data.", "success");
    }, 500);

  } catch (err) {
    clearInterval(progressInterval);
    $("progressStatus").textContent = "Failed";
    $("progressBar").style.background = "var(--red)";
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
    { label: "Biomarkers", value: `${report.biomarkers?.length || 0} found` },
  ].map(m => `
    <div class="meta-item">
      <span class="meta-label">${m.label}</span>
      <span class="meta-value">${m.value}</span>
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
      <td><strong>${escHtml(bm.marker_name)}</strong><br>
          <span style="font-size:0.72rem;color:var(--text-3)">${escHtml(bm.original_name)}</span></td>
      <td>
        <input class="inline-edit" data-id="${bm.id}" value="${escHtml(bm.value)}"
               style="background:transparent;border:none;color:var(--text-1);font-size:0.85rem;font-family:inherit;width:90px;border-bottom:1px dashed var(--border);outline:none;padding:2px 0;transition:border-color 0.2s"
               onfocus="this.style.borderColor='var(--accent)'"
               onblur="this.style.borderColor='var(--border)'" />
      </td>
      <td style="color:var(--text-2)">${escHtml(bm.unit || "—")}</td>
      <td style="color:var(--text-2)">${escHtml(bm.reference_range || "—")}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Confirm button just refreshes the dashboard (data is already saved)
$("confirmBtn")?.addEventListener("click", async () => {
  // Persist any inline edits
  const edits = document.querySelectorAll(".inline-edit");
  const updates = [];
  edits.forEach(input => {
    updates.push(fetch(`${API_BASE}/api/v1/biomarkers/${input.dataset.id}?value=${encodeURIComponent(input.value)}`, {
      method: "PUT"
    }));
  });

  await Promise.all(updates);

  hide($("uploadProgress"));
  hide($("previewCard"));
  navigate("Dashboard");
  showToast("Report saved successfully!", "success");
  loadDashboard();
  loadReports();
});

// ── Dashboard ──────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const res = await fetch(`${API_BASE}/api/v1/dashboard/stats`);
    if (!res.ok) throw new Error("Failed to load stats");
    const stats = await res.json();
    allTrends = stats.trends || [];

    renderStats(stats);
    renderVitals(stats.latest_vitals || {});
    populateMarkerSelect(allTrends);

    $("patientSubtitle").textContent = stats.patient_name
      ? `Tracking health for ${stats.patient_name}`
      : "Upload your first medical record to get started";

  } catch (err) {
    console.error("Dashboard error:", err);
    renderStatsEmpty();
  }
}

function renderStats(stats) {
  const latestDate = stats.latest_report_date || "—";
  $("statsGrid").innerHTML = `
    <div class="stat-card">
      <div class="stat-icon blue">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
      </div>
      <div class="stat-label">Total Reports</div>
      <div class="stat-value">${stats.total_reports}</div>
      <div class="stat-sub">Uploaded records</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon teal">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
        </svg>
      </div>
      <div class="stat-label">Biomarkers</div>
      <div class="stat-value">${stats.total_markers}</div>
      <div class="stat-sub">Data points extracted</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon green">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
      </div>
      <div class="stat-label">Tracked Markers</div>
      <div class="stat-value">${stats.trends?.length || 0}</div>
      <div class="stat-sub">Unique biomarkers</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon amber">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
      </div>
      <div class="stat-label">Latest Report</div>
      <div class="stat-value" style="font-size:1.1rem">${latestDate}</div>
      <div class="stat-sub">Most recent date</div>
    </div>
  `;
}

function renderStatsEmpty() {
  $("statsGrid").innerHTML = `
    <div class="stat-card"><div class="stat-label">Total Reports</div><div class="stat-value">0</div></div>
    <div class="stat-card"><div class="stat-label">Biomarkers</div><div class="stat-value">0</div></div>
    <div class="stat-card"><div class="stat-label">Tracked Markers</div><div class="stat-value">0</div></div>
    <div class="stat-card"><div class="stat-label">Latest Report</div><div class="stat-value" style="font-size:1rem">—</div></div>
  `;
}

function renderVitals(vitals) {
  const grid = $("vitalsGrid");
  const keys = Object.keys(vitals);

  if (keys.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
        <p>No vitals yet. Upload a medical record to get started.</p>
      </div>`;
    return;
  }

  grid.innerHTML = keys.slice(0, 12).map(marker => {
    const v = vitals[marker];
    return `
      <div class="vital-card">
        <div class="vital-name">${escHtml(marker)}</div>
        <div class="vital-value">${escHtml(v.value)}</div>
        ${v.unit ? `<div class="vital-unit">${escHtml(v.unit)}</div>` : ""}
        <div class="vital-date">${escHtml(v.date || "")}</div>
      </div>
    `;
  }).join("");
}

// ── Marker Select & Main Chart ──────────────────────────────────────
function populateMarkerSelect(trends) {
  const sel = $("markerSelect");
  sel.innerHTML = `<option value="">Select a marker…</option>`;
  trends.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.marker_name;
    opt.textContent = t.marker_name + (t.unit ? ` (${t.unit})` : "");
    sel.appendChild(opt);
  });
}

$("markerSelect")?.addEventListener("change", (e) => {
  const marker = e.target.value;
  if (!marker) { $("chartEmpty").classList.remove("hidden"); return; }
  const trend = allTrends.find(t => t.marker_name === marker);
  if (trend) { renderTrendChart("trendChart", trend); $("chartEmpty").classList.add("hidden"); }
});

function renderTrendChart(canvasId, trend) {
  const ctx = $(canvasId).getContext("2d");
  if (trendChartInstance) trendChartInstance.destroy();

  const labels = trend.data.map(d => d.report_date);
  const values = trend.data.map(d => parseFloat(d.value) || 0);

  trendChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: trend.marker_name,
        data: values,
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59,130,246,0.1)",
        borderWidth: 2.5,
        pointBackgroundColor: "#3b82f6",
        pointRadius: 5,
        pointHoverRadius: 7,
        fill: true,
        tension: 0.4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1c2333",
          borderColor: "rgba(255,255,255,0.08)",
          borderWidth: 1,
          titleColor: "#f0f6fc",
          bodyColor: "#8b949e",
          padding: 12,
          callbacks: {
            label: (ctx) => ` ${ctx.parsed.y} ${trend.unit || ""}`,
          }
        }
      },
      scales: {
        x: {
          grid: { color: "rgba(255,255,255,0.05)" },
          ticks: { color: "#484f58", font: { size: 11, family: "Inter" } },
        },
        y: {
          grid: { color: "rgba(255,255,255,0.05)" },
          ticks: { color: "#484f58", font: { size: 11, family: "Inter" } },
        }
      }
    }
  });
}

// ── All Trends Grid ─────────────────────────────────────────────────
async function loadTrendsGrid() {
  const grid = $("trendsGrid");
  if (!allTrends.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <p>No trend data yet. Upload more than one report for the same patient to see trends.</p></div>`;
    return;
  }

  grid.innerHTML = "";
  allTrends.forEach((trend, i) => {
    const card = document.createElement("div");
    card.className = "chart-card";
    card.innerHTML = `
      <div class="chart-header">
        <h3 class="card-section-title" style="margin:0;font-size:0.9rem">${escHtml(trend.marker_name)}
          ${trend.unit ? `<span style="font-size:0.72rem;color:var(--text-2);font-weight:400">${escHtml(trend.unit)}</span>` : ""}
        </h3>
        <span style="font-size:0.75rem;color:var(--text-2)">${trend.data.length} readings</span>
      </div>
      <div style="position:relative;height:160px">
        <canvas id="miniChart${i}"></canvas>
      </div>
    `;
    grid.appendChild(card);
    renderMiniChart(`miniChart${i}`, trend);
  });
}

function renderMiniChart(canvasId, trend) {
  const ctx = $(canvasId).getContext("2d");
  const labels = trend.data.map(d => d.report_date);
  const values = trend.data.map(d => parseFloat(d.value) || 0);
  const colors = ["#3b82f6","#06b6d4","#22c55e","#f59e0b","#a855f7","#ec4899"];
  const color  = colors[Math.floor(Math.random() * colors.length)];

  new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: color,
        backgroundColor: `${color}18`,
        borderWidth: 2,
        pointRadius: 3,
        fill: true,
        tension: 0.4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
      scales: {
        x: { display: false },
        y: { display: false }
      }
    }
  });
}

// ── Reports List ────────────────────────────────────────────────────
async function loadReports() {
  const list = $("reportsList");
  try {
    const res = await fetch(`${API_BASE}/api/v1/reports`);
    const reports = await res.json();

    if (!reports.length) {
      list.innerHTML = `
        <div class="empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <p>No reports yet. <a href="#" onclick="navigate('Upload')" style="color:var(--accent)">Upload your first record</a></p>
        </div>`;
      return;
    }

    list.innerHTML = reports.map(r => `
      <div class="report-card" id="report-${r.id}">
        <div class="report-info">
          <div class="report-name">${escHtml(r.patient_name || r.filename)}</div>
          <div class="report-meta">
            <span>📅 ${escHtml(r.report_date || "Unknown date")}</span>
            <span>🏥 ${escHtml(r.lab_name || "Unknown lab")}</span>
            <span>👨‍⚕️ ${escHtml(r.doctor_name || "—")}</span>
            <span>🔬 ${r.biomarkers?.length || 0} markers</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span class="report-badge">${escHtml(r.filename?.split(".").pop()?.toUpperCase() || "PDF")}</span>
          <button class="btn-danger" onclick="deleteReport(${r.id})">Delete</button>
        </div>
      </div>
    `).join("");

  } catch (err) {
    list.innerHTML = `<div class="empty-state"><p>Failed to load reports. Is the backend running?</p></div>`;
  }
}

async function deleteReport(id) {
  if (!confirm("Delete this report and all its biomarkers?")) return;
  try {
    await fetch(`${API_BASE}/api/v1/reports/${id}`, { method: "DELETE" });
    $(`report-${id}`)?.remove();
    showToast("Report deleted.", "success");
    loadDashboard();
  } catch (err) {
    showToast("Could not delete report.", "error");
  }
}

// ── Section change hooks ────────────────────────────────────────────
document.querySelectorAll(".nav-item").forEach(item => {
  item.addEventListener("click", (e) => {
    const section = item.dataset.section;
    if (section === "trends")  setTimeout(loadTrendsGrid, 50);
    if (section === "reports") loadReports();
  });
});

// ── Utility ─────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── Init ─────────────────────────────────────────────────────────────
loadDashboard();
loadReports();
