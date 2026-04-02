(function () {
  "use strict";

  var TELEMETRY_POST_API = "https://www.nasa.gov/wp-json/wp/v2/posts?slug=track-nasas-artemis-ii-mission-in-real-time&_fields=content,date";
  var FALLBACK_EPHEMERIS_URL = "https://www.nasa.gov/wp-content/uploads/2026/03/oem-2026-04-02-post-uss-2-to-ei.zip";

  var EARTH_RADIUS_KM = 6371;
  var MOON_RADIUS_KM = 1737.4;
  var MOON_ORBIT_RADIUS_KM = 384400;
  var MOON_ORBIT_PERIOD_MS = 27.321661 * 24 * 60 * 60 * 1000;

  var REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  var RENDER_INTERVAL_MS = 1000;
  var SLIDER_MAX = 10000;

  var state = {
    model: null,
    sourceZipUrl: "",
    fileName: "",
    telemetryUpdated: "",
    warning: "",
    refreshInFlight: false,
    lastScale: NaN,
    timelineMode: "live",
    manualTimeMs: NaN
  };

  var canvas = document.getElementById("trajectory-canvas");
  var ctx = canvas.getContext("2d");

  var statusEl = document.getElementById("status");
  var sourceLinkEl = document.getElementById("source-link");
  var fileNameEl = document.getElementById("file-name");
  var updatedEl = document.getElementById("telemetry-updated");
  var pointCountEl = document.getElementById("point-count");
  var utcNowEl = document.getElementById("utc-now");
  var missionElapsedEl = document.getElementById("mission-elapsed");
  var earthDistanceEl = document.getElementById("earth-distance");
  var scaleReadoutEl = document.getElementById("scale-readout");
  var missionSliderEl = document.getElementById("mission-slider");
  var liveButtonEl = document.getElementById("live-button");
  var timelineStartEl = document.getElementById("timeline-start");
  var timelineCurrentEl = document.getElementById("timeline-current");
  var timelineEndEl = document.getElementById("timeline-end");

  if (!window.JSZip) {
    setStatus("Error: no se pudo cargar JSZip (CDN).", true);
    return;
  }

  initializeTimelineControls();

  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  refreshTelemetry();
  setInterval(refreshTelemetry, REFRESH_INTERVAL_MS);
  setInterval(render, RENDER_INTERVAL_MS);

  function setStatus(message, isError) {
    statusEl.textContent = message;
    statusEl.classList.toggle("error", Boolean(isError));
  }

  function resizeCanvas() {
    var rect = canvas.getBoundingClientRect();
    var width = Math.max(320, Math.round(rect.width));
    var height = Math.max(260, Math.round(rect.height));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    render();
  }

  function initializeTimelineControls() {
    missionSliderEl.min = "0";
    missionSliderEl.max = String(SLIDER_MAX);
    missionSliderEl.value = "0";
    missionSliderEl.disabled = true;
    liveButtonEl.disabled = true;

    missionSliderEl.addEventListener("input", function () {
      if (!state.model) {
        return;
      }

      state.timelineMode = "manual";
      state.manualTimeMs = sliderToTime(missionSliderEl.valueAsNumber, state.model.startTime, state.model.stopTime);
      render();
    });

    liveButtonEl.addEventListener("click", function () {
      state.timelineMode = "live";
      state.manualTimeMs = NaN;
      render();
    });
  }

  function syncTimelineWithModel(model) {
    missionSliderEl.disabled = false;

    if (state.timelineMode === "manual" && Number.isFinite(state.manualTimeMs)) {
      state.manualTimeMs = clamp(state.manualTimeMs, model.startTime, model.stopTime);
    }
  }

  async function refreshTelemetry() {
    if (state.refreshInFlight) {
      return;
    }

    state.refreshInFlight = true;
    setStatus("Consultando telemetria NASA...", false);

    var zipUrl;
    var usedFallback = false;

    try {
      zipUrl = await discoverLatestZipUrl();
      state.warning = "";
    } catch (err) {
      zipUrl = FALLBACK_EPHEMERIS_URL;
      usedFallback = true;
      state.warning = "No se pudo resolver el link dinamico del post NASA; usando fallback conocido.";
    }

    try {
      var parsed = await downloadAndParseEphemeris(zipUrl);
      state.model = buildModel(parsed.points, parsed.meta);
      state.sourceZipUrl = zipUrl;
      state.fileName = parsed.fileName;
      state.telemetryUpdated = parsed.fileUpdated;

      sourceLinkEl.href = zipUrl;
      sourceLinkEl.textContent = simplifyZipName(zipUrl);
      fileNameEl.textContent = state.fileName;
      updatedEl.textContent = state.telemetryUpdated || "no disponible";
      pointCountEl.textContent = formatNumber(state.model.points.length) + " puntos";
      syncTimelineWithModel(state.model);

      if (usedFallback) {
        setStatus("Telemetria cargada (fallback).", false);
      } else {
        setStatus("Telemetria NASA cargada y actualizada.", false);
      }
      render();
    } catch (err2) {
      var message = "No se pudo descargar/parsear telemetria.";
      if (state.model) {
        message += " Se mantiene la ultima trayectoria valida.";
      }
      setStatus(message, true);
    } finally {
      state.refreshInFlight = false;
    }
  }

  async function discoverLatestZipUrl() {
    var response = await fetch(TELEMETRY_POST_API, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Error al consultar WP API NASA: " + response.status);
    }

    var payload = await response.json();
    var rendered = payload && payload[0] && payload[0].content && payload[0].content.rendered;
    if (!rendered) {
      throw new Error("No se encontro contenido renderizado del post.");
    }

    var match = rendered.match(/https:\/\/www\.nasa\.gov\/wp-content\/uploads\/[^"'\s>]+\.zip(?:\?[^"'\s>]*)?/i);
    if (!match) {
      throw new Error("No se encontro ZIP OEM en el post.");
    }

    var rawUrl = decodeHtmlEntities(match[0]);
    var parsedUrl = new URL(rawUrl);
    parsedUrl.search = "";
    return parsedUrl.toString();
  }

  async function downloadAndParseEphemeris(zipUrl) {
    var response = await fetch(zipUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Error al descargar ZIP OEM: " + response.status);
    }

    var zipBuffer = await response.arrayBuffer();
    var zip = await window.JSZip.loadAsync(zipBuffer);
    var fileName = pickTelemetryFileName(zip);
    if (!fileName) {
      throw new Error("ZIP sin archivos validos.");
    }

    var rawText = await zip.file(fileName).async("string");
    var preText = extractPreBlock(rawText);
    var parsed = parseEphemeris(preText);

    return {
      fileName: fileName,
      fileUpdated: extractFileUpdated(rawText),
      points: parsed.points,
      meta: parsed.meta
    };
  }

  function pickTelemetryFileName(zip) {
    var names = Object.keys(zip.files);
    var i;
    for (i = 0; i < names.length; i += 1) {
      var name = names[i];
      if (zip.files[name].dir) {
        continue;
      }
      if (/\.asc$/i.test(name) || /oem/i.test(name)) {
        return name;
      }
    }

    for (i = 0; i < names.length; i += 1) {
      if (!zip.files[names[i]].dir) {
        return names[i];
      }
    }

    return "";
  }

  function extractPreBlock(text) {
    var match = text.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
    return match ? match[1] : text;
  }

  function extractFileUpdated(text) {
    var match = text.match(/File Last Updated:\s*([^<\n]+)/i);
    return match ? match[1].trim() : "";
  }

  function parseEphemeris(preText) {
    var lines = preText.split(/\r?\n/);
    var points = [];
    var meta = {};

    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i].trim();
      if (!line) {
        continue;
      }

      if (line.indexOf("=") !== -1) {
        var pair = line.split("=");
        if (pair.length >= 2) {
          var key = pair[0].trim();
          var value = pair.slice(1).join("=").trim();
          meta[key] = value;
        }
        continue;
      }

      var parts = line.split(/\s+/);
      if (parts.length < 7 || parts[0].indexOf("T") === -1) {
        continue;
      }

      var t = parseUtc(parts[0]);
      if (!Number.isFinite(t)) {
        continue;
      }

      var nums = [];
      var valid = true;
      for (var p = 1; p <= 6; p += 1) {
        var n = Number(parts[p]);
        if (!Number.isFinite(n)) {
          valid = false;
          break;
        }
        nums.push(n);
      }

      if (!valid) {
        continue;
      }

      points.push({
        t: t,
        x: nums[0],
        y: nums[1],
        z: nums[2],
        vx: nums[3],
        vy: nums[4],
        vz: nums[5]
      });
    }

    points.sort(function (a, b) {
      return a.t - b.t;
    });

    if (points.length < 2) {
      throw new Error("No se encontraron suficientes state vectors en OEM.");
    }

    return { points: points, meta: meta };
  }

  function buildModel(points, meta) {
    var i;
    var maxR = -Infinity;
    var apogeeIndex = 0;

    for (i = 0; i < points.length; i += 1) {
      var r = Math.hypot(points[i].x, points[i].y, points[i].z);
      if (r > maxR) {
        maxR = r;
        apogeeIndex = i;
      }
    }

    var anchor = points[apogeeIndex];

    var hAvg = [0, 0, 0];
    for (i = 0; i < points.length; i += 1) {
      var h = cross3([points[i].x, points[i].y, points[i].z], [points[i].vx, points[i].vy, points[i].vz]);
      hAvg[0] += h[0];
      hAvg[1] += h[1];
      hAvg[2] += h[2];
    }

    var e3 = normalize3(hAvg);
    if (!e3) {
      e3 = [0, 0, 1];
    }

    var anchorVec = [anchor.x, anchor.y, anchor.z];
    var anchorProjected = projectToPlane(anchorVec, e3);

    if (norm3(anchorProjected) < 1e-6) {
      anchorProjected = projectToPlane([points[0].x, points[0].y, points[0].z], e3);
    }

    var e1 = normalize3(anchorProjected);
    if (!e1) {
      e1 = [1, 0, 0];
    }

    var e2 = cross3(e3, e1);
    e2 = normalize3(e2) || [0, 1, 0];

    var points2d = [];
    var minX = Infinity;
    var maxX = -Infinity;
    var minY = Infinity;
    var maxY = -Infinity;

    for (i = 0; i < points.length; i += 1) {
      var rv = [points[i].x, points[i].y, points[i].z];
      var x2 = dot3(rv, e1);
      var y2 = dot3(rv, e2);
      points2d.push({ x: x2, y: y2 });

      if (x2 < minX) {
        minX = x2;
      }
      if (x2 > maxX) {
        maxX = x2;
      }
      if (y2 < minY) {
        minY = y2;
      }
      if (y2 > maxY) {
        maxY = y2;
      }
    }

    var startTime = parseUtc(meta.START_TIME);
    var stopTime = parseUtc(meta.STOP_TIME);

    if (!Number.isFinite(startTime)) {
      startTime = points[0].t;
    }
    if (!Number.isFinite(stopTime)) {
      stopTime = points[points.length - 1].t;
    }

    return {
      points: points,
      points2d: points2d,
      minX: minX,
      maxX: maxX,
      minY: minY,
      maxY: maxY,
      apogeeTime: anchor.t,
      startTime: startTime,
      stopTime: stopTime
    };
  }

  function getCurrentState(model, nowMs) {
    var pts = model.points;
    var pts2d = model.points2d;
    var last = pts.length - 1;

    if (nowMs <= pts[0].t) {
      return {
        index: 0,
        alpha: 0,
        point3d: pts[0],
        point2d: pts2d[0]
      };
    }

    if (nowMs >= pts[last].t) {
      return {
        index: last,
        alpha: 0,
        point3d: pts[last],
        point2d: pts2d[last]
      };
    }

    var low = 0;
    var high = last;

    while (high - low > 1) {
      var mid = (low + high) >> 1;
      if (pts[mid].t <= nowMs) {
        low = mid;
      } else {
        high = mid;
      }
    }

    var p0 = pts[low];
    var p1 = pts[low + 1];
    var tSpan = p1.t - p0.t;
    var alpha = tSpan > 0 ? (nowMs - p0.t) / tSpan : 0;

    var point3d = {
      t: nowMs,
      x: lerp(p0.x, p1.x, alpha),
      y: lerp(p0.y, p1.y, alpha),
      z: lerp(p0.z, p1.z, alpha),
      vx: lerp(p0.vx, p1.vx, alpha),
      vy: lerp(p0.vy, p1.vy, alpha),
      vz: lerp(p0.vz, p1.vz, alpha)
    };

    var a2 = pts2d[low];
    var b2 = pts2d[low + 1];
    var point2d = {
      x: lerp(a2.x, b2.x, alpha),
      y: lerp(a2.y, b2.y, alpha)
    };

    return {
      index: low,
      alpha: alpha,
      point3d: point3d,
      point2d: point2d
    };
  }

  function getApproxMoonPosition(nowMs, apogeeTime) {
    var theta = (nowMs - apogeeTime) * (2 * Math.PI / MOON_ORBIT_PERIOD_MS);
    return {
      x: MOON_ORBIT_RADIUS_KM * Math.cos(theta),
      y: MOON_ORBIT_RADIUS_KM * Math.sin(theta)
    };
  }

  function render() {
    var w = canvas.width;
    var h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    drawBackdrop(w, h);

    var realNowMs = Date.now();

    if (!state.model) {
      utcNowEl.textContent = "--";
      drawCenterText("Esperando telemetria NASA...");
      return;
    }

    var model = state.model;
    var visualNowMs = getVisualizationTime(realNowMs, model);
    var isManual = state.timelineMode === "manual";

    utcNowEl.textContent = formatUtc(visualNowMs) + (isManual ? " (manual)" : " (tiempo real)");

    var current = getCurrentState(model, visualNowMs);
    var moon = getApproxMoonPosition(visualNowMs, model.apogeeTime);

    var bounds = {
      minX: Math.min(model.minX, -EARTH_RADIUS_KM, moon.x - MOON_RADIUS_KM),
      maxX: Math.max(model.maxX, EARTH_RADIUS_KM, moon.x + MOON_RADIUS_KM),
      minY: Math.min(model.minY, -EARTH_RADIUS_KM, moon.y - MOON_RADIUS_KM),
      maxY: Math.max(model.maxY, EARTH_RADIUS_KM, moon.y + MOON_RADIUS_KM)
    };

    var view = createView(bounds, w, h);
    state.lastScale = view.scale;

    drawFullTrajectory(model.points2d, view);
    drawTraveledTrajectory(model.points2d, current, view);
    drawEarthAndMoon(moon, view);
    drawCurrentMarker(current.point2d, view);

    updateReadouts(model, current, visualNowMs, view);
    updateTimelineUi(model, visualNowMs, realNowMs);
  }

  function getVisualizationTime(realNowMs, model) {
    if (state.timelineMode === "manual" && Number.isFinite(state.manualTimeMs)) {
      return clamp(state.manualTimeMs, model.startTime, model.stopTime);
    }

    return realNowMs;
  }

  function updateTimelineUi(model, visualNowMs, realNowMs) {
    timelineStartEl.textContent = "Inicio: " + formatUtc(model.startTime);
    timelineEndEl.textContent = "Fin: " + formatUtc(model.stopTime);
    timelineCurrentEl.textContent = "Visualizado: " + formatUtc(visualNowMs);

    var sliderMs = clamp(visualNowMs, model.startTime, model.stopTime);
    var sliderValue = timeToSlider(sliderMs, model.startTime, model.stopTime);
    missionSliderEl.value = String(sliderValue);

    var canReturnToLive = state.timelineMode !== "live" || Math.abs(realNowMs - visualNowMs) > 1000;
    liveButtonEl.disabled = !canReturnToLive;
  }

  function drawBackdrop(w, h) {
    var grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#081125");
    grad.addColorStop(1, "#03070f");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    var vignette = ctx.createRadialGradient(w * 0.72, h * 0.2, 20, w * 0.5, h * 0.55, Math.max(w, h));
    vignette.addColorStop(0, "rgba(94, 126, 194, 0.12)");
    vignette.addColorStop(1, "rgba(1, 4, 10, 0)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
  }

  function drawCenterText(message) {
    ctx.fillStyle = "#d6e5ff";
    ctx.font = "600 16px 'IBM Plex Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(message, canvas.width / 2, canvas.height / 2);
  }

  function drawEarthAndMoon(moon, view) {
    var earthCenter = worldToScreen(0, 0, view);
    var moonCenter = worldToScreen(moon.x, moon.y, view);
    var earthR = EARTH_RADIUS_KM * view.scale;
    var moonR = MOON_RADIUS_KM * view.scale;

    ctx.save();
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = "rgba(196, 212, 239, 0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(earthCenter.x, earthCenter.y);
    ctx.lineTo(moonCenter.x, moonCenter.y);
    ctx.stroke();
    ctx.restore();

    var earthGlow = ctx.createRadialGradient(earthCenter.x, earthCenter.y, earthR * 0.3, earthCenter.x, earthCenter.y, earthR * 4.2);
    earthGlow.addColorStop(0, "rgba(93, 176, 255, 0.35)");
    earthGlow.addColorStop(1, "rgba(93, 176, 255, 0)");
    ctx.fillStyle = earthGlow;
    ctx.beginPath();
    ctx.arc(earthCenter.x, earthCenter.y, earthR * 4.2, 0, 2 * Math.PI);
    ctx.fill();

    ctx.fillStyle = "#4da3ff";
    ctx.beginPath();
    ctx.arc(earthCenter.x, earthCenter.y, earthR, 0, 2 * Math.PI);
    ctx.fill();

    ctx.fillStyle = "#bfc9d9";
    ctx.beginPath();
    ctx.arc(moonCenter.x, moonCenter.y, moonR, 0, 2 * Math.PI);
    ctx.fill();
  }

  function drawFullTrajectory(points2d, view) {
    ctx.strokeStyle = "rgba(108, 166, 255, 0.55)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();

    for (var i = 0; i < points2d.length; i += 1) {
      var p = worldToScreen(points2d[i].x, points2d[i].y, view);
      if (i === 0) {
        ctx.moveTo(p.x, p.y);
      } else {
        ctx.lineTo(p.x, p.y);
      }
    }
    ctx.stroke();
  }

  function drawTraveledTrajectory(points2d, current, view) {
    ctx.strokeStyle = "rgba(255, 139, 74, 0.95)";
    ctx.lineWidth = 3.25;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();

    var i;
    for (i = 0; i <= current.index; i += 1) {
      var p = worldToScreen(points2d[i].x, points2d[i].y, view);
      if (i === 0) {
        ctx.moveTo(p.x, p.y);
      } else {
        ctx.lineTo(p.x, p.y);
      }
    }

    if (current.alpha > 0 && current.index < points2d.length - 1) {
      var c = worldToScreen(current.point2d.x, current.point2d.y, view);
      ctx.lineTo(c.x, c.y);
    }

    ctx.stroke();
  }

  function drawCurrentMarker(currentPoint2d, view) {
    var p = worldToScreen(currentPoint2d.x, currentPoint2d.y, view);
    var pulse = 7 + Math.sin(Date.now() / 260) * 1.4;

    ctx.strokeStyle = "rgba(255, 232, 168, 0.66)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, pulse, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.fillStyle = "#ffd36d";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4.6, 0, 2 * Math.PI);
    ctx.fill();

    ctx.strokeStyle = "#fff6dd";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4.6, 0, 2 * Math.PI);
    ctx.stroke();
  }

  function updateReadouts(model, current, nowMs, view) {
    var earthDistance = Math.hypot(current.point3d.x, current.point3d.y, current.point3d.z);

    missionElapsedEl.textContent = formatMissionElapsed(nowMs, model.startTime, model.stopTime);
    earthDistanceEl.textContent = formatNumber(Math.round(earthDistance)) + " km";

    if (Number.isFinite(view.scale) && view.scale > 0) {
      var kmPerPixel = 1 / view.scale;
      scaleReadoutEl.textContent = "1 px = " + formatNumber(Math.round(kmPerPixel)) + " km";
    } else {
      scaleReadoutEl.textContent = "--";
    }
  }

  function createView(bounds, width, height) {
    var rangeX = Math.max(1, bounds.maxX - bounds.minX);
    var rangeY = Math.max(1, bounds.maxY - bounds.minY);

    var pad = Math.max(22, Math.round(Math.min(width, height) * 0.065));
    var usableW = Math.max(20, width - 2 * pad);
    var usableH = Math.max(20, height - 2 * pad);
    var scale = Math.min(usableW / rangeX, usableH / rangeY);

    var drawnW = rangeX * scale;
    var drawnH = rangeY * scale;

    var offsetX = (width - drawnW) * 0.5;
    var offsetY = (height - drawnH) * 0.5;

    return {
      minX: bounds.minX,
      maxY: bounds.maxY,
      scale: scale,
      offsetX: offsetX,
      offsetY: offsetY
    };
  }

  function worldToScreen(x, y, view) {
    return {
      x: view.offsetX + (x - view.minX) * view.scale,
      y: view.offsetY + (view.maxY - y) * view.scale
    };
  }

  function dot3(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  function cross3(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }

  function norm3(v) {
    return Math.sqrt(dot3(v, v));
  }

  function normalize3(v) {
    var n = norm3(v);
    if (!Number.isFinite(n) || n < 1e-9) {
      return null;
    }
    return [v[0] / n, v[1] / n, v[2] / n];
  }

  function projectToPlane(v, planeNormal) {
    var d = dot3(v, planeNormal);
    return [
      v[0] - planeNormal[0] * d,
      v[1] - planeNormal[1] * d,
      v[2] - planeNormal[2] * d
    ];
  }

  function parseUtc(isoNoZone) {
    if (!isoNoZone || typeof isoNoZone !== "string") {
      return NaN;
    }

    var text = isoNoZone.trim();
    if (!text) {
      return NaN;
    }

    if (!/Z$/i.test(text)) {
      text += "Z";
    }

    return Date.parse(text);
  }

  function simplifyZipName(zipUrl) {
    try {
      var parsed = new URL(zipUrl);
      var bits = parsed.pathname.split("/");
      return bits[bits.length - 1] || zipUrl;
    } catch (err) {
      return zipUrl;
    }
  }

  function decodeHtmlEntities(text) {
    return text
      .replace(/&#038;/g, "&")
      .replace(/&amp;/g, "&")
      .replace(/\u0026/g, "&");
  }

  function sliderToTime(sliderValue, startMs, stopMs) {
    if (!Number.isFinite(startMs) || !Number.isFinite(stopMs) || stopMs <= startMs) {
      return startMs;
    }

    var safeSliderValue = Number.isFinite(sliderValue) ? sliderValue : 0;
    var normalized = clamp(safeSliderValue, 0, SLIDER_MAX) / SLIDER_MAX;
    return startMs + (stopMs - startMs) * normalized;
  }

  function timeToSlider(timeMs, startMs, stopMs) {
    if (!Number.isFinite(startMs) || !Number.isFinite(stopMs) || stopMs <= startMs) {
      return 0;
    }

    var normalized = (timeMs - startMs) / (stopMs - startMs);
    return Math.round(clamp(normalized, 0, 1) * SLIDER_MAX);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatUtc(ms) {
    if (!Number.isFinite(ms)) {
      return "--";
    }
    return new Date(ms).toISOString().replace(".000Z", "Z");
  }

  function formatMissionElapsed(nowMs, startMs, stopMs) {
    if (!Number.isFinite(startMs) || !Number.isFinite(stopMs)) {
      return "--";
    }

    if (nowMs < startMs) {
      return "T-" + formatDuration(startMs - nowMs);
    }

    if (nowMs > stopMs) {
      return "Completada (duracion: " + formatDuration(stopMs - startMs) + ")";
    }

    return "T+" + formatDuration(nowMs - startMs) + " de " + formatDuration(stopMs - startMs);
  }

  function formatDuration(ms) {
    var totalMinutes = Math.floor(ms / 60000);
    var days = Math.floor(totalMinutes / (24 * 60));
    var hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    var minutes = totalMinutes % 60;

    var parts = [];
    if (days > 0) {
      parts.push(days + "d");
    }
    parts.push(pad2(hours) + "h");
    parts.push(pad2(minutes) + "m");
    return parts.join(" ");
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function formatNumber(n) {
    return new Intl.NumberFormat("es-ES").format(n);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
})();
