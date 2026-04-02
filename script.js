// ============================================================
// Artemis II — Real-time Trajectory Visualization
// Data source: NASA/JPL Horizons API (target -1024)
// Coordinates: Ecliptic J2000 geocentric, km
// ============================================================

(() => {
    'use strict';

    // ── DOM references ──
    const canvas = document.getElementById('trajectoryCanvas');
    const ctx = canvas.getContext('2d');
    const metValue = document.getElementById('metValue');
    const phaseValue = document.getElementById('phaseValue');
    const distEarthValue = document.getElementById('distEarthValue');
    const distMoonValue = document.getElementById('distMoonValue');
    const progressValue = document.getElementById('progressValue');
    const progressFill = document.getElementById('progressFill');
    const scaleLabel = document.getElementById('scaleLabel');
    const timeSlider = document.getElementById('timeSlider');
    const timeDisplay = document.getElementById('timeDisplay');
    const btnLive = document.getElementById('btnLive');
    const btnZoomIn = document.getElementById('btnZoomIn');
    const btnZoomOut = document.getElementById('btnZoomOut');
    const btnReset = document.getElementById('btnReset');
    const liveIndicator = document.getElementById('liveIndicator');
    const chkGravity = document.getElementById('chkGravity');
    const chkGravField = document.getElementById('chkGravField');

    // ── Constants ──
    const EARTH_RADIUS_KM = 6371;
    const MOON_RADIUS_KM = 1737;
    const LAUNCH_JD = 2461131.0; // Approximate: 2026-Apr-01 12:00 UTC  
    const DATA_START_JD = ORION_TRAJECTORY[0][0];
    const DATA_END_JD = ORION_TRAJECTORY[ORION_TRAJECTORY.length - 1][0];
    const MISSION_DURATION_DAYS = DATA_END_JD - LAUNCH_JD;

    // Gravitational parameters (km³/s²)
    const GM_EARTH = 398600.4418;
    const GM_MOON = 4902.8;
    // Reference acceleration for normalization: surface gravity of Earth
    const G_SURFACE_EARTH = GM_EARTH / (EARTH_RADIUS_KM * EARTH_RADIUS_KM);

    // Off-screen canvases for gravity visualizations
    const GRAV_DOWNSCALE = 5;
    const gravCanvas = document.createElement('canvas');
    const gravCtx = gravCanvas.getContext('2d');
    const FIELD_DOWNSCALE = 4;
    const fieldCanvas = document.createElement('canvas');
    const fieldCtx = fieldCanvas.getContext('2d');

    // ── State ──
    let state = {
        width: 0,
        height: 0,
        dpr: window.devicePixelRatio || 1,
        // View transform (pan/zoom)
        offsetX: 0,
        offsetY: 0,
        zoom: 1,
        baseScale: 1, // pixels per km, computed from viewport
        // Interaction
        isDragging: false,
        dragStartX: 0,
        dragStartY: 0,
        dragOffsetX: 0,
        dragOffsetY: 0,
        // Time
        isLive: true,
        viewJD: 0, // Julian Date being viewed
        // Stars
        stars: [],
        // Animation
        animFrame: null,
    };

    // ── Utility: JD ↔ Date ──
    function nowToJD() {
        const now = new Date();
        return (now.getTime() / 86400000) + 2440587.5;
    }

    function jdToDate(jd) {
        return new Date((jd - 2440587.5) * 86400000);
    }

    function formatMET(jd) {
        const totalSec = Math.max(0, (jd - LAUNCH_JD) * 86400);
        const d = Math.floor(totalSec / 86400);
        const h = Math.floor((totalSec % 86400) / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = Math.floor(totalSec % 60);
        return `${d}d ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }

    function formatDateTime(jd) {
        const d = jdToDate(jd);
        const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
        return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')} UTC`;
    }

    function formatNumber(n) {
        return n.toLocaleString('es-ES', { maximumFractionDigits: 0 });
    }

    // ── Interpolation ──
    function interpolateTrajectory(traj, jd) {
        if (jd <= traj[0][0]) return { x: traj[0][1], y: traj[0][2], z: traj[0][3] };
        if (jd >= traj[traj.length-1][0]) {
            const last = traj[traj.length-1];
            return { x: last[1], y: last[2], z: last[3] };
        }
        // Binary search
        let lo = 0, hi = traj.length - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (traj[mid][0] <= jd) lo = mid;
            else hi = mid;
        }
        const t = (jd - traj[lo][0]) / (traj[hi][0] - traj[lo][0]);
        return {
            x: traj[lo][1] + t * (traj[hi][1] - traj[lo][1]),
            y: traj[lo][2] + t * (traj[hi][2] - traj[lo][2]),
            z: traj[lo][3] + t * (traj[hi][3] - traj[lo][3]),
        };
    }

    function findCurrentTrajectoryIndex(traj, jd) {
        if (jd <= traj[0][0]) return 0;
        if (jd >= traj[traj.length-1][0]) return traj.length - 1;
        let lo = 0, hi = traj.length - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (traj[mid][0] <= jd) lo = mid;
            else hi = mid;
        }
        return lo;
    }

    // ── Coordinate transform (km → canvas pixels) ──
    function kmToScreen(xKm, yKm) {
        const scale = state.baseScale * state.zoom;
        const cx = state.width / 2 + state.offsetX;
        const cy = state.height / 2 + state.offsetY;
        return {
            x: cx + xKm * scale,
            y: cy - yKm * scale // Flip Y for screen coords
        };
    }

    // ── Generate stars ──
    function generateStars() {
        state.stars = [];
        for (let i = 0; i < 400; i++) {
            state.stars.push({
                x: Math.random(),
                y: Math.random(),
                r: Math.random() * 1.2 + 0.3,
                a: Math.random() * 0.5 + 0.2,
                twinkleSpeed: Math.random() * 0.003 + 0.001,
                twinklePhase: Math.random() * Math.PI * 2,
            });
        }
    }

    // ── Phase detection ──
    function getMissionPhase(jd) {
        const day = jd - LAUNCH_JD;
        if (day < 0) return { name: "Pre-lanzamiento", color: "#94a3b8" };
        if (day < 0.5) return { name: "Órbita terrestre", color: "#38bdf8" };
        if (day < 1.0) return { name: "Inyección translunar", color: "#a78bfa" };
        if (day < 4.5) return { name: "Tránsito a la Luna", color: "#22d3ee" };
        if (day < 6.0) return { name: "Sobrevuelo lunar", color: "#fbbf24" };
        if (day < 8.5) return { name: "Retorno a la Tierra", color: "#4ade80" };
        if (day < 9.5) return { name: "Aproximación final", color: "#fb923c" };
        return { name: "Reentrada", color: "#f87171" };
    }

    // ── Gravity field rendering (pixel-based) ──
    function drawGravityField(earthScreenPos, moonScreenPos, scale) {
        const gw = Math.ceil(state.width / GRAV_DOWNSCALE);
        const gh = Math.ceil(state.height / GRAV_DOWNSCALE);
        gravCanvas.width = gw;
        gravCanvas.height = gh;

        const imgData = gravCtx.createImageData(gw, gh);
        const pixels = imgData.data;

        // Pre-compute screen positions in downscaled coords
        const exS = earthScreenPos.x / GRAV_DOWNSCALE;
        const eyS = earthScreenPos.y / GRAV_DOWNSCALE;
        const mxS = moonScreenPos.x / GRAV_DOWNSCALE;
        const myS = moonScreenPos.y / GRAV_DOWNSCALE;

        // km per pixel at this downscale
        const kmPerPx = GRAV_DOWNSCALE / scale;

        // Minimum radius in pixels to avoid division by zero (surface)
        const earthMinPx = EARTH_RADIUS_KM / kmPerPx;
        const moonMinPx = MOON_RADIUS_KM / kmPerPx;

        // Gamma compression exponent: makes 1/r² visible at distance
        // raw = (R/r)², visual = raw^gamma where gamma < 1 compresses range
        const GAMMA = 0.35;
        // Max opacity at surface
        const MAX_ALPHA_EARTH = 0.70;
        const MAX_ALPHA_MOON = 0.55;
        // Cutoff: stop rendering below this visual intensity
        const CUTOFF = 0.008;

        for (let py = 0; py < gh; py++) {
            for (let px = 0; px < gw; px++) {
                const idx = (py * gw + px) * 4;

                // Distance to Earth center in pixels
                const dxE = px - exS;
                const dyE = py - eyS;
                const distEpx = Math.sqrt(dxE * dxE + dyE * dyE);

                // Distance to Moon center in pixels
                const dxM = px - mxS;
                const dyM = py - myS;
                const distMpx = Math.sqrt(dxM * dxM + dyM * dyM);

                // Earth gravity contribution
                let earthIntensity = 0;
                if (distEpx > earthMinPx * 0.8) {
                    const rKm = Math.max(distEpx * kmPerPx, EARTH_RADIUS_KM);
                    const rawG = GM_EARTH / (rKm * rKm);
                    const normalized = rawG / G_SURFACE_EARTH; // 1.0 at surface
                    earthIntensity = Math.pow(normalized, GAMMA) * MAX_ALPHA_EARTH;
                }

                // Moon gravity contribution
                let moonIntensity = 0;
                if (distMpx > moonMinPx * 0.8) {
                    const rKm = Math.max(distMpx * kmPerPx, MOON_RADIUS_KM);
                    const rawG = GM_MOON / (rKm * rKm);
                    const normalizedMoon = rawG / G_SURFACE_EARTH; // normalized to Earth surface
                    moonIntensity = Math.pow(normalizedMoon, GAMMA) * MAX_ALPHA_MOON;
                }

                // Skip if both negligible
                if (earthIntensity < CUTOFF && moonIntensity < CUTOFF) continue;

                // Earth color: blue (50, 120, 255)
                // Moon color: amber (255, 190, 80)
                const eR = 50, eG = 120, eB = 255;
                const mR = 255, mG = 190, mB = 80;

                // Combine: additive blend
                const r = Math.min(255, eR * earthIntensity + mR * moonIntensity);
                const g = Math.min(255, eG * earthIntensity + mG * moonIntensity);
                const b = Math.min(255, eB * earthIntensity + mB * moonIntensity);
                const a = Math.min(255, (earthIntensity + moonIntensity) * 255);

                pixels[idx]     = r;
                pixels[idx + 1] = g;
                pixels[idx + 2] = b;
                pixels[idx + 3] = a;
            }
        }

        gravCtx.putImageData(imgData, 0, 0);

        // Draw the gravity field onto main canvas, scaled up
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(gravCanvas, 0, 0, gw, gh, 0, 0, state.width, state.height);
        ctx.restore();
    }

    // ── Gravity field HEATMAP rendering ──
    function drawGravityFieldMap(earthScreenPos, moonScreenPos, moonPosKm, scale) {
        const ds = FIELD_DOWNSCALE;
        const fw = Math.ceil(state.width / ds);
        const fh = Math.ceil(state.height / ds);
        fieldCanvas.width = fw;
        fieldCanvas.height = fh;

        const imgData = fieldCtx.createImageData(fw, fh);
        const pixels = imgData.data;

        // Screen positions in downscaled coords
        const exS = earthScreenPos.x / ds;
        const eyS = earthScreenPos.y / ds;
        const mxS = moonScreenPos.x / ds;
        const myS = moonScreenPos.y / ds;

        const kmPerPx = ds / scale;

        // Compute Earth-Moon distance for L1 calculation
        const emDist = Math.sqrt(moonPosKm.x * moonPosKm.x + moonPosKm.y * moonPosKm.y + moonPosKm.z * moonPosKm.z);

        // Log scale bounds — tuned to show the full interesting range
        // At Earth surface: g ≈ 0.00982 km/s², log10 ≈ -2.008
        // At Moon orbit distance from Earth: g ≈ 2.7e-6, log10 ≈ -5.57
        // At deep space (far from both): g ≈ 1e-8, log10 ≈ -8
        const LOG_MIN = -7.5;  // deep space
        const LOG_MAX = -2.0;  // near surface
        const LOG_RANGE = LOG_MAX - LOG_MIN;

        // Equilibrium contour detection threshold
        const CONTOUR_WIDTH = 0.08; // how close ratio must be to 0.5 to glow

        // Color palette:
        // Earth-dominated: blue shades
        // Moon-dominated: amber/orange shades  
        // Equilibrium: bright cyan/white

        for (let py = 0; py < fh; py++) {
            for (let px = 0; px < fw; px++) {
                const idx = (py * fw + px) * 4;

                // Distance to Earth in km
                const dxE = (px - exS) * kmPerPx;
                const dyE = (py - eyS) * kmPerPx;
                const rEarth = Math.sqrt(dxE * dxE + dyE * dyE);

                // Distance to Moon in km
                const dxM = (px - mxS) * kmPerPx;
                const dyM = (py - myS) * kmPerPx;
                const rMoon = Math.sqrt(dxM * dxM + dyM * dyM);

                // Skip pixels inside bodies
                if (rEarth < EARTH_RADIUS_KM * 0.8 || rMoon < MOON_RADIUS_KM * 0.8) continue;

                // Gravitational acceleration magnitudes
                const rE = Math.max(rEarth, EARTH_RADIUS_KM);
                const rM = Math.max(rMoon, MOON_RADIUS_KM);
                const gEarth = GM_EARTH / (rE * rE);
                const gMoon = GM_MOON / (rM * rM);
                const gTotal = gEarth + gMoon;

                // Log-normalized intensity (0 to 1)
                const logG = Math.log10(gTotal);
                let intensity = (logG - LOG_MIN) / LOG_RANGE;
                intensity = Math.max(0, Math.min(1, intensity));

                if (intensity < 0.01) continue;

                // Dominance ratio: 1 = Earth, 0 = Moon
                const ratio = gEarth / gTotal;

                // Distance from equilibrium (0 at perfect balance)
                const eqDist = Math.abs(ratio - 0.5);

                // Equilibrium highlight — bright where forces balance
                const eqGlow = Math.max(0, 1.0 - eqDist / CONTOUR_WIDTH);

                // Base colors by dominance
                let r, g, b;
                if (ratio > 0.5) {
                    // Earth-dominated: blue
                    const t = (ratio - 0.5) * 2; // 0 at boundary, 1 at full Earth
                    r = Math.round(30 + 20 * (1 - t));
                    g = Math.round(80 + 60 * (1 - t));
                    b = Math.round(180 + 75 * t);
                } else {
                    // Moon-dominated: amber/orange
                    const t = (0.5 - ratio) * 2; // 0 at boundary, 1 at full Moon
                    r = Math.round(200 + 55 * t);
                    g = Math.round(150 + 40 * (1 - t));
                    b = Math.round(50 - 30 * t);
                }

                // Blend in equilibrium glow (bright cyan-white)
                if (eqGlow > 0) {
                    const eq = eqGlow * eqGlow; // sharpen the glow
                    r = Math.round(r + (240 - r) * eq);
                    g = Math.round(g + (255 - g) * eq);
                    b = Math.round(b + (250 - b) * eq);
                }

                // Apply intensity as alpha, boosted with sqrt for visibility
                const alpha = Math.pow(intensity, 0.65) * 0.88;

                pixels[idx]     = r;
                pixels[idx + 1] = g;
                pixels[idx + 2] = b;
                pixels[idx + 3] = Math.round(alpha * 255);
            }
        }

        fieldCtx.putImageData(imgData, 0, 0);

        // Draw onto main canvas
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(fieldCanvas, 0, 0, fw, fh, 0, 0, state.width, state.height);
        ctx.restore();

        // ── Mark L1 Lagrange point ──
        // L1 is between Earth and Moon where gravitational pulls balance
        // Approximate: r_L1 from Moon ≈ emDist * (GM_Moon / (3*GM_Earth))^(1/3)
        if (emDist > 10000) {
            const r_L1_moon = emDist * Math.pow(GM_MOON / (3 * GM_EARTH), 1/3);
            const r_L1_earth = emDist - r_L1_moon;
            // L1 position in km (along Earth→Moon line)
            const dirX = moonPosKm.x / emDist;
            const dirY = moonPosKm.y / emDist;
            const l1X = dirX * r_L1_earth;
            const l1Y = dirY * r_L1_earth;
            const l1Screen = kmToScreen(l1X, l1Y);

            // Draw L1 marker
            ctx.beginPath();
            ctx.arc(l1Screen.x, l1Screen.y, 4 * state.dpr, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(240, 255, 250, 0.9)';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(l1Screen.x, l1Screen.y, 8 * state.dpr, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(240, 255, 250, 0.4)';
            ctx.lineWidth = 1 * state.dpr;
            ctx.stroke();
            ctx.font = `bold ${10 * state.dpr}px 'Inter', sans-serif`;
            ctx.fillStyle = 'rgba(240, 255, 250, 0.85)';
            ctx.textAlign = 'center';
            ctx.fillText('L1', l1Screen.x, l1Screen.y - 12 * state.dpr);

            // Also mark L2 (behind Moon)
            const r_L2_moon = emDist * Math.pow(GM_MOON / (3 * GM_EARTH), 1/3);
            const l2X = moonPosKm.x + dirX * r_L2_moon;
            const l2Y = moonPosKm.y + dirY * r_L2_moon;
            const l2Screen = kmToScreen(l2X, l2Y);

            ctx.beginPath();
            ctx.arc(l2Screen.x, l2Screen.y, 3 * state.dpr, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(240, 255, 250, 0.7)';
            ctx.fill();
            ctx.font = `bold ${9 * state.dpr}px 'Inter', sans-serif`;
            ctx.fillStyle = 'rgba(240, 255, 250, 0.6)';
            ctx.textAlign = 'center';
            ctx.fillText('L2', l2Screen.x, l2Screen.y - 10 * state.dpr);
        }
    }

    // ── Resize handler ──
    function resize() {
        const rect = canvas.parentElement.getBoundingClientRect();
        state.width = rect.width * state.dpr;
        state.height = rect.height * state.dpr;
        canvas.width = state.width;
        canvas.height = state.height;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';

        // Calculate base scale so the full trajectory fits with padding
        // Find max extent of trajectory
        let maxExtent = 0;
        for (const p of ORION_TRAJECTORY) {
            const ext = Math.sqrt(p[1]*p[1] + p[2]*p[2]);
            if (ext > maxExtent) maxExtent = ext;
        }
        for (const p of MOON_TRAJECTORY) {
            const ext = Math.sqrt(p[1]*p[1] + p[2]*p[2]);
            if (ext > maxExtent) maxExtent = ext;
        }
        
        const viewSize = Math.min(state.width, state.height);
        state.baseScale = (viewSize * 0.4) / maxExtent;
    }

    // ── Drawing ──
    function draw() {
        const w = state.width;
        const h = state.height;
        const scale = state.baseScale * state.zoom;

        // Clear
        ctx.fillStyle = '#0a0e1a';
        ctx.fillRect(0, 0, w, h);

        // Stars
        const time = Date.now() * 0.001;
        if (!(chkGravField && chkGravField.checked)) {
            // Only draw stars when gravity field map is off (it covers them anyway)
            for (const star of state.stars) {
                const twinkle = 0.5 + 0.5 * Math.sin(time * star.twinkleSpeed * 1000 + star.twinklePhase);
                ctx.beginPath();
                ctx.arc(star.x * w, star.y * h, star.r * state.dpr, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(200, 210, 230, ${star.a * twinkle})`;
                ctx.fill();
            }
        }

        // Determine current JD
        const currentJD = state.viewJD;

        // Current index in trajectory
        const currentIdx = findCurrentTrajectoryIndex(ORION_TRAJECTORY, currentJD);

        // ── Pre-compute positions ──
        const earthScreen = kmToScreen(0, 0);
        const moonPosGrav = interpolateTrajectory(MOON_TRAJECTORY, currentJD);
        const moonScreenGrav = kmToScreen(moonPosGrav.x, moonPosGrav.y);

        // ── Draw gravity field heatmap (behind everything) ──
        if (chkGravField && chkGravField.checked) {
            drawGravityFieldMap(earthScreen, moonScreenGrav, moonPosGrav, scale);
        }

        // ── Draw gravity influence glow ──
        if (chkGravity && chkGravity.checked) {
            drawGravityField(earthScreen, moonScreenGrav, scale);
        }

        // ── Draw grid circles (distance rings) ──
        const ringDistances = [50000, 100000, 200000, 300000, 400000];
        ctx.setLineDash([4 * state.dpr, 6 * state.dpr]);
        for (const dist of ringDistances) {
            const r = dist * scale;
            if (r < 15 || r > Math.max(w, h) * 2) continue;
            ctx.beginPath();
            ctx.arc(earthScreen.x, earthScreen.y, r, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(100, 116, 139, ${Math.min(0.18, 25 / r)})`;
            ctx.lineWidth = 1 * state.dpr;
            ctx.stroke();
            
            // Label
            if (r > 30) {
                const labelText = `${formatNumber(dist)} km`;
                ctx.font = `${9 * state.dpr}px 'JetBrains Mono', monospace`;
                ctx.fillStyle = `rgba(100, 116, 139, ${Math.min(0.4, 40 / r + 0.15)})`;
                ctx.textAlign = 'left';
                ctx.fillText(labelText, earthScreen.x + r + 5 * state.dpr, earthScreen.y - 3 * state.dpr);
            }
        }
        ctx.setLineDash([]);

        // ── Draw Moon orbit arc (to show the Moon's path) ──
        ctx.beginPath();
        for (let i = 0; i < MOON_TRAJECTORY.length; i++) {
            const p = kmToScreen(MOON_TRAJECTORY[i][1], MOON_TRAJECTORY[i][2]);
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = 'rgba(176, 176, 176, 0.12)';
        ctx.lineWidth = 1 * state.dpr;
        ctx.setLineDash([3 * state.dpr, 5 * state.dpr]);
        ctx.stroke();
        ctx.setLineDash([]);

        // ── Draw FUTURE trajectory (after current position) ──
        if (currentIdx < ORION_TRAJECTORY.length - 1) {
            ctx.beginPath();
            const startP = interpolateTrajectory(ORION_TRAJECTORY, currentJD);
            const sp = kmToScreen(startP.x, startP.y);
            ctx.moveTo(sp.x, sp.y);
            for (let i = currentIdx + 1; i < ORION_TRAJECTORY.length; i++) {
                const p = kmToScreen(ORION_TRAJECTORY[i][1], ORION_TRAJECTORY[i][2]);
                ctx.lineTo(p.x, p.y);
            }
            ctx.strokeStyle = 'rgba(100, 116, 139, 0.35)';
            ctx.lineWidth = 1.5 * state.dpr;
            ctx.setLineDash([4 * state.dpr, 4 * state.dpr]);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // ── Draw PAST trajectory (completed, from start to current) ──
        if (currentIdx > 0) {
            // Outer glow
            ctx.beginPath();
            for (let i = 0; i <= currentIdx; i++) {
                const p = kmToScreen(ORION_TRAJECTORY[i][1], ORION_TRAJECTORY[i][2]);
                if (i === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            }
            const curPos = interpolateTrajectory(ORION_TRAJECTORY, currentJD);
            const cp = kmToScreen(curPos.x, curPos.y);
            ctx.lineTo(cp.x, cp.y);
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
            ctx.lineWidth = 6 * state.dpr;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();

            // Main line
            ctx.beginPath();
            for (let i = 0; i <= currentIdx; i++) {
                const p = kmToScreen(ORION_TRAJECTORY[i][1], ORION_TRAJECTORY[i][2]);
                if (i === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            }
            ctx.lineTo(cp.x, cp.y);
            
            // Gradient along the path
            const startPt = kmToScreen(ORION_TRAJECTORY[0][1], ORION_TRAJECTORY[0][2]);
            const grad = ctx.createLinearGradient(startPt.x, startPt.y, cp.x, cp.y);
            grad.addColorStop(0, 'rgba(56, 189, 248, 0.4)');
            grad.addColorStop(0.7, 'rgba(56, 189, 248, 0.8)');
            grad.addColorStop(1, '#38bdf8');
            ctx.strokeStyle = grad;
            ctx.lineWidth = 2.5 * state.dpr;
            ctx.stroke();
        }

        // ── Draw time markers along the trajectory (every ~12 hours) ──
        const markerInterval = 48; // every 48 intervals of 15min = 12 hours
        ctx.font = `${8 * state.dpr}px 'JetBrains Mono', monospace`;
        for (let i = markerInterval; i < ORION_TRAJECTORY.length - 1; i += markerInterval) {
            const p = kmToScreen(ORION_TRAJECTORY[i][1], ORION_TRAJECTORY[i][2]);
            const dayNum = Math.floor((ORION_TRAJECTORY[i][0] - LAUNCH_JD) + 0.5);
            
            // Small tick
            ctx.beginPath();
            ctx.arc(p.x, p.y, 2.5 * state.dpr, 0, Math.PI * 2);
            const isPast = i <= currentIdx;
            ctx.fillStyle = isPast ? 'rgba(56, 189, 248, 0.6)' : 'rgba(100, 116, 139, 0.4)';
            ctx.fill();
            
            // Date label
            ctx.fillStyle = isPast ? 'rgba(56, 189, 248, 0.5)' : 'rgba(100, 116, 139, 0.35)';
            ctx.textAlign = 'center';
            ctx.fillText(`Día ${dayNum}`, p.x, p.y - 8 * state.dpr);
        }

        // ── Draw Earth ──
        const earthR = Math.max(EARTH_RADIUS_KM * scale, 4 * state.dpr);
        
        // Atmosphere glow
        const earthGlow = ctx.createRadialGradient(
            earthScreen.x, earthScreen.y, earthR * 0.5,
            earthScreen.x, earthScreen.y, earthR * 3
        );
        earthGlow.addColorStop(0, 'rgba(74, 158, 255, 0.15)');
        earthGlow.addColorStop(0.5, 'rgba(74, 158, 255, 0.05)');
        earthGlow.addColorStop(1, 'rgba(74, 158, 255, 0)');
        ctx.beginPath();
        ctx.arc(earthScreen.x, earthScreen.y, earthR * 3, 0, Math.PI * 2);
        ctx.fillStyle = earthGlow;
        ctx.fill();

        // Earth body
        const earthBody = ctx.createRadialGradient(
            earthScreen.x - earthR * 0.2, earthScreen.y - earthR * 0.2, earthR * 0.1,
            earthScreen.x, earthScreen.y, earthR
        );
        earthBody.addColorStop(0, '#5ba3f5');
        earthBody.addColorStop(0.5, '#2d7dd2');
        earthBody.addColorStop(1, '#1a4d8a');
        ctx.beginPath();
        ctx.arc(earthScreen.x, earthScreen.y, earthR, 0, Math.PI * 2);
        ctx.fillStyle = earthBody;
        ctx.fill();

        // Earth label
        ctx.font = `bold ${11 * state.dpr}px 'Inter', sans-serif`;
        ctx.fillStyle = '#4a9eff';
        ctx.textAlign = 'center';
        ctx.fillText('🌍 Tierra', earthScreen.x, earthScreen.y + earthR + 16 * state.dpr);

        // ── Draw Moon ──
        const moonPos = interpolateTrajectory(MOON_TRAJECTORY, currentJD);
        const moonScreen = kmToScreen(moonPos.x, moonPos.y);
        const moonR = Math.max(MOON_RADIUS_KM * scale, 3 * state.dpr);

        // Moon glow
        const moonGlow = ctx.createRadialGradient(
            moonScreen.x, moonScreen.y, moonR * 0.5,
            moonScreen.x, moonScreen.y, moonR * 2.5
        );
        moonGlow.addColorStop(0, 'rgba(200, 200, 210, 0.1)');
        moonGlow.addColorStop(1, 'rgba(200, 200, 210, 0)');
        ctx.beginPath();
        ctx.arc(moonScreen.x, moonScreen.y, moonR * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = moonGlow;
        ctx.fill();

        // Moon body
        const moonBody = ctx.createRadialGradient(
            moonScreen.x - moonR * 0.2, moonScreen.y - moonR * 0.2, moonR * 0.1,
            moonScreen.x, moonScreen.y, moonR
        );
        moonBody.addColorStop(0, '#d0d0d8');
        moonBody.addColorStop(0.6, '#a8a8b0');
        moonBody.addColorStop(1, '#707078');
        ctx.beginPath();
        ctx.arc(moonScreen.x, moonScreen.y, moonR, 0, Math.PI * 2);
        ctx.fillStyle = moonBody;
        ctx.fill();

        // Moon label
        ctx.font = `bold ${11 * state.dpr}px 'Inter', sans-serif`;
        ctx.fillStyle = '#b0b0b0';
        ctx.textAlign = 'center';
        ctx.fillText('🌙 Luna', moonScreen.x, moonScreen.y + moonR + 16 * state.dpr);

        // ── Draw Orion spacecraft (current position) ──
        const orionPos = interpolateTrajectory(ORION_TRAJECTORY, currentJD);
        const orionScreen = kmToScreen(orionPos.x, orionPos.y);
        
        // Outer glow pulse
        const pulseSize = 1 + 0.3 * Math.sin(time * 2);
        const orionGlowR = 18 * state.dpr * pulseSize;
        const orionGlow = ctx.createRadialGradient(
            orionScreen.x, orionScreen.y, 2 * state.dpr,
            orionScreen.x, orionScreen.y, orionGlowR
        );
        orionGlow.addColorStop(0, 'rgba(251, 191, 36, 0.4)');
        orionGlow.addColorStop(0.5, 'rgba(251, 191, 36, 0.1)');
        orionGlow.addColorStop(1, 'rgba(251, 191, 36, 0)');
        ctx.beginPath();
        ctx.arc(orionScreen.x, orionScreen.y, orionGlowR, 0, Math.PI * 2);
        ctx.fillStyle = orionGlow;
        ctx.fill();

        // Inner solid dot
        ctx.beginPath();
        ctx.arc(orionScreen.x, orionScreen.y, 5 * state.dpr, 0, Math.PI * 2);
        ctx.fillStyle = '#fbbf24';
        ctx.fill();
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.6)';
        ctx.lineWidth = 1.5 * state.dpr;
        ctx.stroke();

        // Ring
        ctx.beginPath();
        ctx.arc(orionScreen.x, orionScreen.y, 10 * state.dpr * pulseSize, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(251, 191, 36, ${0.25 * pulseSize})`;
        ctx.lineWidth = 1 * state.dpr;
        ctx.stroke();

        // Label
        ctx.font = `bold ${11 * state.dpr}px 'Inter', sans-serif`;
        ctx.fillStyle = '#fbbf24';
        ctx.textAlign = 'center';
        ctx.fillText('Orion', orionScreen.x, orionScreen.y - 16 * state.dpr);

        // ── Distance line to Earth (optional, subtle) ──
        ctx.beginPath();
        ctx.moveTo(orionScreen.x, orionScreen.y);
        ctx.lineTo(earthScreen.x, earthScreen.y);
        ctx.strokeStyle = 'rgba(74, 158, 255, 0.08)';
        ctx.lineWidth = 1 * state.dpr;
        ctx.setLineDash([3 * state.dpr, 6 * state.dpr]);
        ctx.stroke();
        ctx.setLineDash([]);

        // ── Update scale bar ──
        const scaleBarPx = 80 * state.dpr;
        const scaleBarKm = scaleBarPx / scale;
        // Round to nice number
        const niceScales = [1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000];
        let niceKm = niceScales[0];
        for (const ns of niceScales) {
            if (ns <= scaleBarKm * 1.5) niceKm = ns;
        }
        scaleLabel.textContent = `${formatNumber(niceKm)} km`;

        // ── Update telemetry panel ──
        updateTelemetry(currentJD, orionPos, moonPos);
    }

    // ── Telemetry update ──
    function updateTelemetry(jd, orionPos, moonPos) {
        // MET
        metValue.textContent = formatMET(jd);

        // Phase
        const phase = getMissionPhase(jd);
        phaseValue.textContent = phase.name;
        phaseValue.style.color = phase.color;

        // Distance to Earth
        const distEarth = Math.sqrt(orionPos.x**2 + orionPos.y**2 + orionPos.z**2);
        distEarthValue.textContent = formatNumber(Math.round(distEarth)) + ' km';

        // Distance to Moon
        const dx = orionPos.x - moonPos.x;
        const dy = orionPos.y - moonPos.y;
        const dz = orionPos.z - moonPos.z;
        const distMoon = Math.sqrt(dx*dx + dy*dy + dz*dz);
        distMoonValue.textContent = formatNumber(Math.round(distMoon)) + ' km';

        // Progress
        const progress = Math.max(0, Math.min(100, ((jd - LAUNCH_JD) / MISSION_DURATION_DAYS) * 100));
        progressValue.textContent = progress.toFixed(1) + '%';
        progressFill.style.width = progress + '%';

        // Time display
        timeDisplay.textContent = formatDateTime(jd);
    }

    // ── Animation loop ──
    function animate() {
        // Update viewJD
        if (state.isLive) {
            state.viewJD = nowToJD();
            // Clamp to data range
            if (state.viewJD < DATA_START_JD) state.viewJD = DATA_START_JD;
            if (state.viewJD > DATA_END_JD) state.viewJD = DATA_END_JD;
            // Update slider to match
            const t = (state.viewJD - DATA_START_JD) / (DATA_END_JD - DATA_START_JD);
            timeSlider.value = Math.round(t * 1000);
        }

        draw();
        state.animFrame = requestAnimationFrame(animate);
    }

    // ── Input handlers ──
    
    // Mouse wheel zoom
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
        
        // Zoom toward mouse position
        const rect = canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left) * state.dpr;
        const my = (e.clientY - rect.top) * state.dpr;
        const cx = state.width / 2 + state.offsetX;
        const cy = state.height / 2 + state.offsetY;
        
        const oldZoom = state.zoom;
        state.zoom = Math.max(0.15, Math.min(50, state.zoom * zoomFactor));
        
        const zoomChange = state.zoom / oldZoom;
        state.offsetX = mx - state.width/2 - (mx - cx) * zoomChange;
        state.offsetY = my - state.height/2 - (my - cy) * zoomChange;
    }, { passive: false });

    // Pan (mouse drag)
    canvas.addEventListener('mousedown', (e) => {
        state.isDragging = true;
        state.dragStartX = e.clientX * state.dpr;
        state.dragStartY = e.clientY * state.dpr;
        state.dragOffsetX = state.offsetX;
        state.dragOffsetY = state.offsetY;
    });

    window.addEventListener('mousemove', (e) => {
        if (!state.isDragging) return;
        const dx = e.clientX * state.dpr - state.dragStartX;
        const dy = e.clientY * state.dpr - state.dragStartY;
        state.offsetX = state.dragOffsetX + dx;
        state.offsetY = state.dragOffsetY + dy;
    });

    window.addEventListener('mouseup', () => {
        state.isDragging = false;
    });

    // Touch support
    let lastTouchDist = 0;
    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            state.isDragging = true;
            state.dragStartX = e.touches[0].clientX * state.dpr;
            state.dragStartY = e.touches[0].clientY * state.dpr;
            state.dragOffsetX = state.offsetX;
            state.dragOffsetY = state.offsetY;
        } else if (e.touches.length === 2) {
            lastTouchDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
        }
        e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        if (e.touches.length === 1 && state.isDragging) {
            const dx = e.touches[0].clientX * state.dpr - state.dragStartX;
            const dy = e.touches[0].clientY * state.dpr - state.dragStartY;
            state.offsetX = state.dragOffsetX + dx;
            state.offsetY = state.dragOffsetY + dy;
        } else if (e.touches.length === 2) {
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const zoomFactor = dist / lastTouchDist;
            state.zoom = Math.max(0.15, Math.min(50, state.zoom * zoomFactor));
            lastTouchDist = dist;
        }
        e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('touchend', () => {
        state.isDragging = false;
    });

    // Button controls
    btnZoomIn.addEventListener('click', () => {
        state.zoom = Math.min(50, state.zoom * 1.4);
    });

    btnZoomOut.addEventListener('click', () => {
        state.zoom = Math.max(0.15, state.zoom / 1.4);
    });

    btnReset.addEventListener('click', () => {
        state.zoom = 1;
        state.offsetX = 0;
        state.offsetY = 0;
    });

    // Time slider
    timeSlider.addEventListener('input', () => {
        state.isLive = false;
        liveIndicator.classList.add('inactive');
        liveIndicator.querySelector('span:last-child').textContent = 'HISTÓRICO';
        btnLive.classList.remove('active');
        
        const t = timeSlider.value / 1000;
        state.viewJD = DATA_START_JD + t * (DATA_END_JD - DATA_START_JD);
    });

    btnLive.addEventListener('click', () => {
        state.isLive = true;
        liveIndicator.classList.remove('inactive');
        liveIndicator.querySelector('span:last-child').textContent = 'EN VIVO';
        btnLive.classList.add('active');
    });

    // Window resize
    window.addEventListener('resize', () => {
        state.dpr = window.devicePixelRatio || 1;
        resize();
    });

    // ── Initialization ──
    function init() {
        resize();
        generateStars();
        state.viewJD = nowToJD();
        if (state.viewJD < DATA_START_JD) state.viewJD = DATA_START_JD;
        if (state.viewJD > DATA_END_JD) state.viewJD = DATA_END_JD;
        btnLive.classList.add('active');
        animate();
    }

    init();
})();
