// ─────────────── FIREBASE CONFIG ───────────────
const firebaseConfig = {
  apiKey: "AIzaSyBLQdD3IkCKS1wmifPJ_XkjbpSdt4Khc00",
  authDomain: "iot-smart-irrigation-sys-b8388.firebaseapp.com",
  databaseURL:
    "https://iot-smart-irrigation-sys-b8388-default-rtdb.firebaseio.com",
  projectId: "iot-smart-irrigation-sys-b8388",
  storageBucket: "iot-smart-irrigation-sys-b8388.firebasestorage.app",
  messagingSenderId: "383586652569",
  appId: "1:383586652569:web:b4b85a884d58ba5e994308",
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ─────────────── STATE ───────────────
let lastSeenTimestamp = null;
let connectionLostAt = null;
let offlineGaps = []; // [{from, to, durationMin}]
let pumpRunning = false;
let commandPending = false;
const notifications = []; // { time, type, message }
let prevPumpState = null; // track pump state changes for notifications

function addNotification(type, message) {
  // type: "pump_on" | "pump_off" | "auto_irrigation" | "offline_sync" | "reservoir"
  notifications.unshift({ time: new Date(), type, message });
  if (notifications.length > 30) notifications.pop();
  renderNotifications();
}

function renderNotifications() {
  const container = document.getElementById("offlineGaps");
  if (!container) return;
  if (notifications.length === 0) {
    container.innerHTML = '<p class="no-gaps">No notifications yet.</p>';
    return;
  }
  const icons = {
    pump_on: "💧",
    pump_off: "🔴",
    auto_irrigation: "🤖",
    offline_sync: "📂",
    reservoir: "⚠",
    info: "ℹ️",
  };
  container.innerHTML = notifications
    .slice(0, 10)
    .map((n) => {
      const t = n.time.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      return `<div class="gap-entry">
      <div class="gap-icon">${icons[n.type] || "ℹ️"}</div>
      <div class="gap-detail">
        <div class="gap-time">${t}</div>
        <div class="gap-note">${n.message}</div>
      </div>
    </div>`;
    })
    .join("");
}

function trackLiveUpdate() {
  // Just mark we received data
  lastSeenTimestamp = Date.now();
}

// ─────────────── CHART SETUP ───────────────
const MAX_CHART_POINTS = 60;
const chartLabels = [],
  soilData = [],
  tempData = [],
  humData = [];

const ctx = document.getElementById("sensorChart").getContext("2d");
const chart = new Chart(ctx, {
  type: "line",
  data: {
    labels: chartLabels,
    datasets: [
      {
        label: "Soil Moisture %",
        data: soilData,
        borderColor: "#4ade80",
        backgroundColor: "rgba(74,222,128,0.07)",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.4,
        fill: true,
        yAxisID: "y",
      },
      {
        label: "Temperature °C",
        data: tempData,
        borderColor: "#fb923c",
        backgroundColor: "rgba(251,146,60,0.05)",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.4,
        fill: false,
        yAxisID: "y1",
      },
      {
        label: "Humidity %",
        data: humData,
        borderColor: "#60a5fa",
        backgroundColor: "rgba(96,165,250,0.06)",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.4,
        fill: false,
        yAxisID: "y",
      },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 },
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#1e293b",
        borderColor: "#334155",
        borderWidth: 1,
        titleColor: "#94a3b8",
        bodyColor: "#e2e8f0",
        titleFont: { family: "JetBrains Mono, monospace", size: 10 },
        bodyFont: { family: "JetBrains Mono, monospace", size: 11 },
        callbacks: {
          label: (ctx) => {
            const unit = ctx.datasetIndex === 1 ? "°C" : "%";
            return ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}${unit}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { color: "#1e293b" },
        ticks: {
          color: "#475569",
          font: { family: "JetBrains Mono, monospace", size: 9 },
          maxTicksLimit: 10,
        },
      },
      y: {
        min: 0,
        max: 100,
        grid: { color: "#1e293b" },
        ticks: {
          color: "#475569",
          font: { family: "JetBrains Mono, monospace", size: 9 },
          callback: (v) => v + "%",
        },
      },
      y1: {
        position: "right",
        min: 0,
        max: 50,
        grid: { display: false },
        ticks: {
          color: "#475569",
          font: { family: "JetBrains Mono, monospace", size: 9 },
          callback: (v) => v + "°",
        },
      },
    },
  },
});

// ─────────────── HELPERS ───────────────
function formatTime(ts) {
  if (!ts) return "—";
  // NTP format: "20260409_154111"
  if (typeof ts === "string" && ts.length === 15 && ts.includes("_")) {
    const d = ts.slice(0, 8),
      t = ts.slice(9);
    return `${d.slice(6, 8)}/${d.slice(4, 6)} ${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;
  }
  // Millis/uptime fallback - show as "Uptime Xs" not a fake clock time
  const n = parseInt(ts);
  if (!isNaN(n) && n < 1000000) {
    const h = Math.floor(n / 3600),
      m = Math.floor((n % 3600) / 60),
      s = n % 60;
    return `Uptime ${h > 0 ? h + "h " : ""}${m}m ${s}s`;
  }
  // Unix ms
  if (!isNaN(n)) return new Date(n * 1000).toLocaleTimeString("en-GB");
  return String(ts);
}

function formatTimeShort(ts) {
  const full = formatTime(ts);
  return full.includes("/") ? full.split(" ")[1] : full;
}

function formatUptime(seconds) {
  if (!seconds) return "-";
  const d = Math.floor(seconds / 86400),
    h = Math.floor((seconds % 86400) / 3600),
    m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  return `${h}h ${m}m`;
}

function fmtDur(sec) {
  if (!sec) return "-";
  const m = Math.floor(sec / 60),
    s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function getSoilLabel(v) {
  return v < 20
    ? "🔴 Very Dry"
    : v < 40
      ? "🟡 Dry"
      : v < 65
        ? "🟢 Good"
        : "🔵 Wet";
}
function getSoilColor(v) {
  return v < 20
    ? "var(--red)"
    : v < 40
      ? "var(--amber)"
      : v < 65
        ? "var(--green)"
        : "var(--blue)";
}
function getTempLabel(v) {
  return v < 18
    ? "❄ Cool"
    : v < 28
      ? "🌤 Comfortable"
      : v < 35
        ? "☀ Warm"
        : "🔥 Hot";
}
function getHumLabel(v) {
  return v < 30
    ? "💨 Very Dry Air"
    : v < 55
      ? "👍 Normal"
      : v < 75
        ? "💧 Humid"
        : "🌧 Very Humid";
}
function getTriggerTag(trigger) {
  if (!trigger || trigger === "NONE")
    return { cls: "trigger-none", label: "-" };
  if (trigger.includes("MANUAL"))
    return { cls: "trigger-manual", label: "Manual" };
  if (trigger.includes("FLC") && trigger.includes("ET"))
    return { cls: "trigger-et", label: "Auto (FLC+ET)" };
  if (trigger.includes("FLC"))
    return { cls: "trigger-flc", label: "Auto (FLC)" };
  return { cls: "trigger-flc", label: trigger };
}

function flash(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("value-flash");
  setTimeout(() => el.classList.remove("value-flash"), 500);
}

function setTag(id, text, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = "tag " + cls;
}

function updateStat(valId, value, barId, pct, label, color) {
  const el = document.getElementById(valId);
  if (!el) return;
  if (el.textContent !== value) {
    el.textContent = value;
    el.classList.add("value-flash");
    setTimeout(() => el.classList.remove("value-flash"), 500);
  }
  el.style.color = color;
  const bar = document.getElementById(barId);
  if (bar) {
    bar.style.width = Math.min(100, Math.max(0, pct)) + "%";
    bar.style.background = color;
  }
  const lbl = document.getElementById(valId.replace("Val", "Label"));
  if (lbl) {
    lbl.textContent = label;
    lbl.style.color = color;
  }
}

function pushChartPoint(label, soil, temp, hum) {
  if (chartLabels.length >= MAX_CHART_POINTS) {
    chartLabels.shift();
    soilData.shift();
    tempData.shift();
    humData.shift();
  }
  chartLabels.push(label);
  soilData.push(parseFloat(soil.toFixed(1)));
  tempData.push(parseFloat(temp.toFixed(1)));
  humData.push(parseFloat(hum.toFixed(1)));
  chart.update("none"); // skip animation for real-time updates
}

// ─────────────── OFFLINE GAP DETECTION ───────────────

function renderOfflineGaps() {
  const container = document.getElementById("offlineGaps");
  if (!container) return;
  if (offlineGaps.length === 0) {
    container.innerHTML =
      '<p class="no-gaps">✅ No connectivity gaps detected this session.</p>';
    return;
  }
  container.innerHTML = offlineGaps
    .slice(-5)
    .reverse()
    .map((g) => {
      const from = new Date(g.from).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const to = new Date(g.to).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const durMin = Math.floor(g.durationSec / 60);
      const durSec = g.durationSec % 60;
      const durLabel = durMin > 0 ? `${durMin}m ${durSec}s` : `${durSec}s`;
      return `<div class="gap-entry">
      <div class="gap-icon">📴</div>
      <div class="gap-detail">
        <div class="gap-time">Offline ${from} => ${to}</div>
        <div class="gap-note">System was running offline for <strong>${durLabel}</strong>. Sensor data was logged to SD card during this period and will sync when reconnected.</div>
      </div>
      <div class="gap-dur">${durLabel}</div>
    </div>`;
    })
    .join("");
}

// ─────────────── FIREBASE LISTENERS ───────────────

// Live sensor data
db.ref("/sensors/latest").on("value", (snap) => {
  const liveDot = document.getElementById("liveDot");
  if (liveDot) {
    liveDot.style.transform = "scale(1.6)";
    liveDot.style.opacity = "1";
    setTimeout(() => {
      liveDot.style.transform = "scale(1)";
    }, 300);
  }

  const d = snap.val();
  if (!d) return;

  trackLiveUpdate();

  const soil = parseFloat(d.soilMoisture) || 0;
  const temp = parseFloat(d.temperature) || 0;
  const hum = parseFloat(d.humidity) || 0;
  const pump = d.pumpStatus || "OFF";
  const resEmpty = d.reservoirEmpty || false;
  const ts = formatTimeShort(d.timestamp);

  // Update stat cards
  updateStat(
    "soilVal",
    soil.toFixed(1) + "%",
    "soilBar",
    soil,
    getSoilLabel(soil),
    getSoilColor(soil),
  );
  updateStat(
    "tempVal",
    temp.toFixed(1) + "°C",
    "tempBar",
    (temp / 50) * 100,
    getTempLabel(temp),
    "var(--amber)",
  );
  updateStat(
    "humVal",
    hum.toFixed(0) + "%",
    "humBar",
    hum,
    getHumLabel(hum),
    "var(--blue)",
  );

  // Soil advice
  const advice = document.getElementById("soilAdvice");
  if (advice) {
    if (soil < 25)
      advice.textContent = "Soil is very dry - irrigation likely needed soon.";
    else if (soil < 45)
      advice.textContent =
        "Soil moisture is low - system will irrigate if temperature rises.";
    else if (soil < 70)
      advice.textContent =
        "Moisture level is healthy - no irrigation needed right now.";
    else
      advice.textContent = "Soil is well-saturated - pump will not activate.";
  }

  const pumpReasonLabel = document.getElementById("pumpReasonLabel");
  if (pumpReasonLabel && !pumpRunning) {
    if (soil >= 50)
      pumpReasonLabel.textContent = "Soil sufficient - no irrigation needed";
    else pumpReasonLabel.textContent = "idle";
  }

  // Pump badge
  pumpRunning = pump === "ON";
  const badge = document.getElementById("pumpBadge");
  const pText = document.getElementById("pumpText");
  if (badge && pText) {
    badge.className = pumpRunning ? "pump-badge on" : "pump-badge off";
    pText.textContent = pumpRunning ? "RUNNING" : "OFF";
  }

  if (prevPumpState !== null && prevPumpState !== pump) {
    if (pump === "ON") {
      addNotification("pump_on", `💧 Pump turned ON`);
    } else {
      addNotification("pump_off", `🔴 Pump turned OFF`);
    }
  }
  prevPumpState = pump;

  // Pump detail message
  const pumpDetail = document.getElementById("pumpDetail");
  const lastTrigger = window._lastPumpTrigger || null;
  if (pumpDetail) {
    if (pumpRunning) {
      const reason = lastTrigger
        ? `Started by: ${lastTrigger}`
        : "Pump is actively delivering water.";
      pumpDetail.textContent = reason;
      pumpDetail.style.color = "var(--green)";
    } else {
      pumpDetail.textContent = "Pump is idle - monitoring continues.";
      pumpDetail.style.color = "";
    }
  }

  const psl = document.getElementById("pumpStatusLabel");
  const prl = document.getElementById("pumpReasonLabel");
  if (psl) {
    psl.textContent = pumpRunning ? "ON 🟢" : "OFF 🔴";
    psl.style.color = pumpRunning ? "var(--green)" : "var(--red)";
  }
  if (prl) prl.textContent = pumpRunning ? lastTrigger || "active" : "idle";

  // Sync manual control buttons with pump state
  const startBtn = document.getElementById("btnStart");
  const stopBtn = document.getElementById("btnStop");
  if (!commandPending) {
    if (startBtn) startBtn.disabled = pumpRunning || resEmpty || soil >= 50;
    if (stopBtn) stopBtn.disabled = !pumpRunning;
  }
  // Reservoir
  const warn = document.getElementById("reservoirWarn");
  if (warn)
    resEmpty ? warn.classList.add("show") : warn.classList.remove("show");

  // Volume
  const vol = parseFloat(d.totalVolumeToday) || 0;
  //const volEls = ["volToday","statToday","statTodayB"];
  //volEls.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = vol.toFixed(2) + " L"; });

  // Footer
  const footer = document.getElementById("footerUpdate");
  if (footer) footer.textContent = `Last update: ${ts}`;

  // Chart
  const now = new Date();
  const label =
    now.getHours().toString().padStart(2, "0") +
    ":" +
    now.getMinutes().toString().padStart(2, "0");
  pushChartPoint(label, soil, temp, hum);

  // Avg moisture
  const avg =
    soilData.length > 0
      ? (soilData.reduce((a, b) => a + b, 0) / soilData.length).toFixed(0) + "%"
      : "-";
  ["avgMoisture", "statAvgMoist"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = avg;
  });

  // Interval report update
  updateIntervalReport(soil, temp, hum, vol);
});

// System status
db.ref("/system/status").on("value", (snap) => {
  const d = snap.val();
  if (!d) return;

  const el_lastSync = document.getElementById("lastSync");
  const el_uptime = document.getElementById("uptime");
  const el_rssi = document.getElementById("wifiRssi");

  if (el_lastSync) el_lastSync.textContent = formatTime(d.lastSync) || "-";
  if (el_uptime) el_uptime.textContent = formatUptime(d.uptime);

  // RSSI with quality label
  if (el_rssi && d.wifiRSSI) {
    const rssi = d.wifiRSSI;
    const quality =
      rssi > -50
        ? "Excellent"
        : rssi > -65
          ? "Good"
          : rssi > -75
            ? "Fair"
            : "Weak";
    el_rssi.textContent = `${rssi} dBm (${quality})`;
    el_rssi.style.color =
      rssi > -65 ? "var(--green)" : rssi > -75 ? "var(--amber)" : "var(--red)";
  }

  // Connection badge
  const badge = document.getElementById("connBadge");
  const connText = document.getElementById("connText");
  const connMode = document.getElementById("connMode");

  if (d.online) {
    if (badge) badge.className = "conn-badge online";
    if (connText) connText.textContent = "Online - Syncing to Cloud";
    setTag("connMode", "Online", "tag-green");
    setTag(
      "sdStatus",
      d.sdStatus ? "Active" : "Not Installed / Failed",
      d.sdStatus ? "tag-green" : "tag-amber",
    );
    const sdSyncRow = document.getElementById("sdSyncFiles");
    if (sdSyncRow) {
      const sdRowEl = sdSyncRow.closest(".health-row");
      if (sdRowEl) sdRowEl.style.display = d.sdStatus ? "" : "none";
    }

    // Update live dot
    const liveDot = document.getElementById("liveDot");
    if (liveDot) liveDot.style.background = "var(--green)";
    const liveText = document.getElementById("liveText");
    if (liveText) liveText.textContent = "Live · Cloud connected";
  } else {
    if (badge) badge.className = "conn-badge offline";
    if (connText) connText.textContent = "Offline - Data saved to SD card";
    setTag("connMode", "Offline", "tag-red");
    const liveDot = document.getElementById("liveDot");
    if (liveDot) liveDot.style.background = "var(--amber)";
    const liveText = document.getElementById("liveText");
    if (liveText) liveText.textContent = "Offline · SD card logging";
  }

  const pumpMeta = document.getElementById("pumpMeta");
  if (pumpMeta) pumpMeta.textContent = `Pump state: ${d.pumpStatus || "OFF"}`;

  // Show pump stop reason on dashboard
  const stopReason = d.lastPumpStopReason;
  const pumpDetail = document.getElementById("pumpDetail");
  if (pumpDetail && stopReason === "TIMEOUT") {
    pumpDetail.innerHTML =
      "⚠ Pump auto-stopped (safety timeout) - auto-irrigation paused 25 seconds.";
    pumpDetail.style.color = "var(--amber)";
  } else if (pumpDetail && (!stopReason || stopReason === "NONE")) {
    pumpDetail.style.color = ""; // reset to default
  }
});

// Irrigation events
db.ref("/irrigation/events")
  .limitToLast(20)
  .on("value", (snap) => {
    const events = [];
    snap.forEach((child) => events.unshift({ key: child.key, ...child.val() }));

    if (events.length > 0) {
      const latest = events[0];
      const tag = getTriggerTag(latest.trigger || "");
      const when = formatTime(latest.startTime || latest.key);
      // Only notify if it's a new event (compare key)
      if (window._lastEventKey !== latest.key) {
        window._lastEventKey = latest.key;
        addNotification(
          latest.trigger?.includes("MANUAL") ? "pump_on" : "auto_irrigation",
          `Irrigation event - ${tag.label} - started ${when}, ran ${fmtDur(latest.duration)}, delivered ${(latest.volume || 0).toFixed(2)}L`,
        );
      }
    }

    const tbody = document.getElementById("eventLog");
    if (!tbody) return;

    if (events.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="5" style="color:var(--text-muted);font-size:12px;padding:16px 0;text-align:center">No irrigation events recorded yet.</td></tr>';
      return;
    }

    tbody.innerHTML = events
      .slice(0, 8)
      .map((ev) => {
        const trigger = ev.trigger || "-";
        const dur = fmtDur(ev.duration);
        const vol =
          ev.volume != null ? parseFloat(ev.volume).toFixed(2) + " L" : "-";
        const time = formatTime(ev.startTime || ev.key);
        const tag = getTriggerTag(trigger);
        const result =
          ev.result || (ev.reservoirEmpty ? "Tank Empty" : "Completed");
        const statusClass =
          result === "Completed"
            ? "trigger-tag status-done"
            : "trigger-tag tag-amber";
        const statusText = result;
        return `<tr>
      <td>${time}</td>
      <td>${dur}</td>
      <td>${vol}</td>
      <td><span class="trigger-tag ${tag.cls}">${tag.label}</span></td>
      <td><span class="${statusClass}">${statusText}</span></td>
    </tr>`;
      })
      .join("");

    // Update interval summary too
    updateEventSummary(events);
  });

// System Notifications - show ALL events (pump on/off, auto/manual, dashboard commands):
db.ref("/system/alerts/latest").on("value", (snap) => {
  const d = snap.val();
  if (!d || !d.timestamp) return;
  if (window._lastAlertTs === d.timestamp) return;
  window._lastAlertTs = d.timestamp;

  if (d.type === "auto_irrigation_start") {
    addNotification(
      "auto_irrigation",
      `🤖 Auto-irrigation triggered - Soil: ${d.soil}%, delivering ${(d.volume * 1000).toFixed(0)}ml`,
    );
  }
});

// Listen for offline-synced sensor history and mark them
// ─────────────── OFFLINE SD-CARD SYNC ───────────────
const _renderedOfflinePeriods = new Set();

db.ref("/offline_sync").on("value", async (snap) => {
  const periods = [];
  snap.forEach((child) => {
    const v = child.val();
    if (v && v.from && v.to) periods.push({ key: child.key, ...v });
  });

  // System Health row
  const el = document.getElementById("sdSyncFiles");
  if (el) {
    el.textContent = periods.length === 0
      ? "No offline periods synced."
      : `${periods.length} offline period(s) synced from SD-CARD.`;
  }

  if (periods.length === 0) return;

  // Badge
  const badge = document.getElementById("offlineSyncBadge");
  if (badge) {
    const total = periods.reduce((s, p) => s + (p.records || 0), 0);
    badge.textContent = `${periods.length} period(s) · ${total} records recovered`;
    badge.style.background = "#0f3460";
    badge.style.color = "#60a5fa";
  }

  // Period pills
  const pillsEl = document.getElementById("offlinePeriodPills");
  if (pillsEl) {
    pillsEl.innerHTML = periods.map((p) => `
      <span style="font-size:11px;padding:4px 10px;border-radius:20px;background:#1e293b;color:var(--text-secondary);border:1px solid #334155">
        📴 <strong>${formatTime(p.from)}</strong> → <strong>${formatTime(p.to)}</strong>
        &nbsp;·&nbsp; ${p.records || "?"} records
      </span>`).join("");
  }

  // Notify once per new period
  periods.forEach((p) => {
    if (!_renderedOfflinePeriods.has(p.key)) {
      _renderedOfflinePeriods.add(p.key);
      addNotification(
        "offline_sync",
        `📂 SD-CARD offline data recovered - ${formatTime(p.from)} to ${formatTime(p.to)} (${p.records || "?"} records)`
      );
    }
  });

  // Fetch all offline sensor history records tagged SD_OFFLINE
  const histSnap = await db.ref("/sensors/history")
    .orderByChild("source")
    .equalTo("SD_OFFLINE")
    .once("value");

  const rows = [];
  histSnap.forEach((child) => {
    rows.push({ key: child.key, ...child.val() });
  });

  // Sort oldest first
  rows.sort((a, b) => String(a.key).localeCompare(String(b.key)));

  const tbody = document.getElementById("offlineSyncBody");
  if (!tbody) return;

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--text-muted);font-size:12px;padding:16px 0;text-align:center">
      Offline periods recorded but sensor history entries not found.</td></tr>`;
    return;
  }

  // Match each row to its period for the "Period" column
  function matchPeriod(ts) {
    return periods.find((p) => ts >= p.from && ts <= p.to) || null;
  }

  tbody.innerHTML = rows.map((r, i) => {
    const soil = parseFloat(r.soilMoisture);
    const temp = parseFloat(r.temperature);
    const hum  = parseFloat(r.humidity);
    const period = matchPeriod(r.key);

    const soilColor = getSoilColor(soil);
    const soilLabel = getSoilLabel(soil);

    const periodLabel = period
      ? `${formatTime(period.from)} → ${formatTime(period.to)}`
      : "_";

    return `<tr>
      <td style="color:var(--text-muted);font-size:11px">${i + 1}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:11px">${formatTime(r.key)}</td>
      <td><span style="color:${soilColor};font-weight:600">${soil.toFixed(1)}%</span>
          <span style="font-size:10px;color:var(--text-muted);margin-left:4px">${soilLabel}</span></td>
      <td>${temp.toFixed(1)}°C</td>
      <td>${hum.toFixed(0)}%</td>
      <td style="font-size:11px;color:var(--text-secondary)">${periodLabel}</td>
    </tr>`;
  }).join("");
});

// ─────────────── INTERVAL REPORT ───────────────
const hourlyBuckets = {}; // { "HH": { soilSum, tempSum, humSum, count, waterL } }

function updateIntervalReport(soil, temp, hum, waterL) {
  const hour = new Date().getHours().toString().padStart(2, "0") + ":00";
  if (!hourlyBuckets[hour])
    hourlyBuckets[hour] = {
      soilSum: 0,
      tempSum: 0,
      humSum: 0,
      count: 0,
      waterL: 0,
    };
  hourlyBuckets[hour].soilSum += soil;
  hourlyBuckets[hour].tempSum += temp;
  hourlyBuckets[hour].humSum += hum;
  hourlyBuckets[hour].waterL = waterL; // cumulative for the day
  hourlyBuckets[hour].count++;

  const tbody = document.getElementById("intervalTable");
  if (!tbody) return;
  const rows = Object.entries(hourlyBuckets)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 6);
  tbody.innerHTML = rows
    .map(([hr, b]) => {
      const avgSoil = (b.soilSum / b.count).toFixed(0);
      const avgTemp = (b.tempSum / b.count).toFixed(1);
      const avgHum = (b.humSum / b.count).toFixed(0);
      return `<tr>
      <td>${hr}</td>
      <td>${avgSoil}%</td>
      <td>${avgTemp}°C</td>
      <td>${avgHum}%</td>
      <td>${b.waterL.toFixed(2)} L</td>
    </tr>`;
    })
    .join("");
}

function updateEventSummary(events) {
  const totalEvents = events.length;
  const totalVol = events.reduce((s, e) => s + (parseFloat(e.volume) || 0), 0);
  const manualCount = events.filter((e) =>
    (e.trigger || "").includes("MANUAL"),
  ).length;
  const autoCount = totalEvents - manualCount;

  const el = document.getElementById("eventSummary");
  if (el)
    el.innerHTML = `
    <span class="summary-pill">Total events: <strong>${totalEvents}</strong></span>
    <span class="summary-pill">Auto-triggered: <strong>${autoCount}</strong></span>
    <span class="summary-pill">Manual: <strong>${manualCount}</strong></span>
    <span class="summary-pill">Total water used: <strong>${totalVol.toFixed(2)} L</strong></span>
  `;
}

// ─────────────── MANUAL CONTROL ───────────────
function sendCommand(cmd) {
  if (commandPending) return;
  commandPending = true;

  const startBtn = document.getElementById("btnStart");
  const stopBtn = document.getElementById("btnStop");
  if (startBtn) startBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = true;

  const liveText = document.getElementById("liveText");

  if (cmd === "START") {
    // Block if soil moisture is already sufficient
    const soilEl = document.getElementById("soilVal");
    const currentSoil = parseFloat(soilEl?.textContent) || 0;
    if (currentSoil >= 50) {
      alert(
        `⚠ Irrigation blocked!\nSoil moisture is ${currentSoil.toFixed(1)}% — already at or above 50% threshold.\nNo water needed right now.`,
      );
      commandPending = false;
      if (startBtn) startBtn.disabled = false;
      if (stopBtn) stopBtn.disabled = false;
      return;
    }
    // Ask user for target volume
    const input = prompt(
      "How many litres do you want to deliver?\n(e.g. 0.5L - leave blank for 1.0L default)",
    );

    // If user pressed Cancel, abort - don't send anything
    if (input === null) {
      commandPending = false;
      if (startBtn) startBtn.disabled = false;
      if (stopBtn) stopBtn.disabled = false;
      return;
    }

    const vol = parseFloat(input);
    const targetVol = !isNaN(vol) && vol > 0 && vol <= 20 ? vol : 1.0;

    if (liveText)
      liveText.textContent = `Sending START command (${targetVol}L)...`;

    window._lastPumpTrigger = cmd === "START" ? "Dashboard (Manual)" : null;

    // Write both the command and the volume atomically
    db.ref("/control")
      .update({
        manualPump: "START",
        manualVolume: targetVol,
      })
      .then(() => {
        console.log("[Dashboard] START sent, volume:", targetVol);
        // Optimistic UI - show PENDING state
        const badge = document.getElementById("pumpBadge");
        const pText = document.getElementById("pumpText");
        if (badge && pText) {
          badge.className = "pump-badge on";
          pText.textContent = "STARTING...";
        }
        addNotification(
          "pump_on",
          `💧 Manual irrigation command sent - delivering ${targetVol}L`,
        );
        if (liveText)
          liveText.textContent = `START sent — delivering ${targetVol}L...`;
        setTimeout(() => {
          commandPending = false;
          if (stopBtn) stopBtn.disabled = false;
          if (startBtn) startBtn.disabled = true; // keep disabled while pump runs
          if (liveText) liveText.textContent = "Live · Cloud connected";
        }, 5000);
      })
      .catch((err) => {
        console.error("[Dashboard] START failed:", err);
        commandPending = false;
        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = false;
        if (liveText)
          liveText.textContent = "⚠ Command failed — check connection";
      });
  } else {
    // STOP command
    if (liveText) liveText.textContent = "Sending STOP command...";
    db.ref("/control/manualPump")
      .set("STOP")
      .then(() => {
        console.log("[Dashboard] STOP sent");
        if (liveText)
          liveText.textContent = "STOP sent — waiting for device...";
        setTimeout(() => {
          commandPending = false;
          if (stopBtn) stopBtn.disabled = false;
          if (startBtn) startBtn.disabled = false;
          if (liveText) liveText.textContent = "Live · Cloud connected";
        }, 5000);
      })
      .catch((err) => {
        console.error("[Dashboard] STOP failed:", err);
        commandPending = false;
        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = false;
        if (liveText)
          liveText.textContent = "⚠ Command failed — check connection";
      });
  }
}

// Initialise gap display
renderOfflineGaps();
