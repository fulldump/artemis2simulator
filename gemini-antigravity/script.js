const canvas = document.getElementById('spaceMap');
const ctx = canvas.getContext('2d');

let width, height;
let view = { x: 0, y: 0, scale: 1 };
const EARTH_R = 6371;
const MOON_R = 1737;
const MOON_DIST = 384400;

// Configuración de la simulación
const TOTAL_MISSION_HOURS = 240; // 10 días
let currentElapsedHours = 18.4; // Menos de 24h
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let viewStart = { x: 0, y: 0 };

// Puntos clave de la trayectoria de retorno libre (escala en km)
const keyPoints = [
    {x: 0, y: 6500},
    {x: 80000, y: 30000},
    {x: 180000, y: 40000},
    {x: 280000, y: 25000},
    {x: 350000, y: 15000},
    {x: 384400, y: 8000},   // Pasando sobre la Luna
    {x: 396000, y: 0},      // Lado oscuro, punto más lejano
    {x: 384400, y: -8000},  // Pasando bajo la Luna
    {x: 350000, y: -15000},
    {x: 280000, y: -25000},
    {x: 180000, y: -40000},
    {x: 80000, y: -30000},
    {x: 0, y: -6500}
];

// Generar una trayectoria suave usando Catmull-Rom
function getCatmullRomPoint(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    const f0 = -0.5 * t3 + t2 - 0.5 * t;
    const f1 = 1.5 * t3 - 2.5 * t2 + 1.0;
    const f2 = -1.5 * t3 + 2.0 * t2 + 0.5 * t;
    const f3 = 0.5 * t3 - 0.5 * t2;
    return {
        x: p0.x * f0 + p1.x * f1 + p2.x * f2 + p3.x * f3,
        y: p0.y * f0 + p1.y * f1 + p2.y * f2 + p3.y * f3
    };
}

const trajectory = [];
const STEPS_PER_SEGMENT = 100;

for (let i = 0; i < keyPoints.length - 1; i++) {
    const p0 = i === 0 ? keyPoints[0] : keyPoints[i - 1];
    const p1 = keyPoints[i];
    const p2 = keyPoints[i + 1];
    const p3 = i + 2 < keyPoints.length ? keyPoints[i + 2] : keyPoints[keyPoints.length - 1];

    for (let t = 0; t <= 1; t += 1/STEPS_PER_SEGMENT) {
        trajectory.push(getCatmullRomPoint(p0, p1, p2, p3, t));
    }
}

// Inicialización de la vista
function initView() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    // Escala para ajustar todo el recorrido (450,000 km en X)
    const requiredWidthKm = 450000;
    view.scale = (width * 0.8) / requiredWidthKm;
    
    // Centrar la vista entre la Tierra y la Luna
    view.x = width / 2 - (MOON_DIST / 2) * view.scale;
    view.y = height / 2;
}

window.addEventListener('resize', initView);
initView();

// Interacción del mapa (Pan & Zoom)
canvas.addEventListener('mousedown', e => {
    isDragging = true;
    dragStart = { x: e.clientX, y: e.clientY };
    viewStart = { x: view.x, y: view.y };
});

window.addEventListener('mouseup', () => isDragging = false);
window.addEventListener('mousemove', e => {
    if (isDragging) {
        view.x = viewStart.x + (e.clientX - dragStart.x);
        view.y = viewStart.y + (e.clientY - dragStart.y);
    }
});

canvas.addEventListener('wheel', e => {
    const zoomFactor = 1.1;
    const mouseX = e.clientX;
    const mouseY = e.clientY;
    
    // Calcular posición del ratón en el espacio del mapa
    const mapX = (mouseX - view.x) / view.scale;
    const mapY = (mouseY - view.y) / view.scale;

    if (e.deltaY < 0) {
        view.scale *= zoomFactor;
    } else {
        view.scale /= zoomFactor;
    }

    // Ajustar offset para hacer zoom donde está el ratón
    view.x = mouseX - mapX * view.scale;
    view.y = mouseY - mapY * view.scale;
});

// Controles de la UI
document.getElementById('btn-zoom-in').addEventListener('click', () => { view.scale *= 1.5; });
document.getElementById('btn-zoom-out').addEventListener('click', () => { view.scale /= 1.5; });
document.getElementById('btn-reset').addEventListener('click', () => { initView(); });

// Función para formatear el número
const formatNum = num => Math.round(num).toLocaleString('es-ES');

// Bucle principal
function animate() {
    // Incremento artificial de tiempo para que se vea que es "en vivo" pero lentamente (10x tiempo real)
    currentElapsedHours += (1 / 3600) * 10 * (1/60); // Asumiendo 60fps
    
    if (currentElapsedHours > TOTAL_MISSION_HOURS) currentElapsedHours = TOTAL_MISSION_HOURS;
    
    const progressPerc = currentElapsedHours / TOTAL_MISSION_HOURS;
    const currentIndex = Math.min(Math.floor(progressPerc * trajectory.length), trajectory.length - 1);
    const pos = trajectory[currentIndex];

    // Cálculos de telemetría simulada
    const distEarth = Math.sqrt(pos.x ** 2 + pos.y ** 2);
    const distMoon = Math.sqrt((pos.x - MOON_DIST) ** 2 + pos.y ** 2);
    
    // Velocidad (simplemente distancia entre puntos / tiempo, muy aproximado)
    let vel = 0;
    if (currentIndex < trajectory.length - 1) {
        const nextPos = trajectory[currentIndex + 1];
        const distToNext = Math.sqrt((nextPos.x - pos.x)**2 + (nextPos.y - pos.y)**2);
        const timeToNextSec = (TOTAL_MISSION_HOURS * 3600) / trajectory.length;
        vel = (distToNext / timeToNextSec) * 3600; // km/h
    }

    // Actualizar UI
    document.getElementById('vel').innerHTML = `${formatNum(vel)} <span class="unit">km/h</span>`;
    document.getElementById('dist-earth').innerHTML = `${formatNum(distEarth)} <span class="unit">km</span>`;
    document.getElementById('dist-moon').innerHTML = `${formatNum(distMoon)} <span class="unit">km</span>`;
    document.getElementById('progress-bar').style.width = `${(progressPerc * 100).toFixed(1)}%`;
    document.getElementById('progress-text').innerText = `${(progressPerc * 100).toFixed(1)}%`;
    
    const h = Math.floor(currentElapsedHours);
    const m = Math.floor((currentElapsedHours * 60) % 60);
    const s = Math.floor((currentElapsedHours * 3600) % 60);
    document.getElementById('met').innerText = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;

    // Dibujar
    ctx.clearRect(0, 0, width, height);

    // Fondo estelar simulado
    ctx.fillStyle = "#ffffff";
    for(let i=0; i<100; i++) {
        const x = (Math.sin(i*721) * 10000 + view.x/5) % width;
        const y = (Math.cos(i*311) * 10000 + view.y/5) % height;
        const size = (i%3)*0.5 + 0.5;
        // Ajustar al módulo correcto para coordenadas negativas
        if (x>0 && y>0) {
            ctx.globalAlpha = 0.3 + 0.7 * Math.abs(Math.sin(Date.now()*0.001 + i));
            ctx.beginPath();
            ctx.arc(x, y, size, 0, 2 * Math.PI);
            ctx.fill();
        }
    }
    ctx.globalAlpha = 1.0;

    // Aplicar transformaciones de cámara
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.scale, view.scale);

    // 1. Dibujar trayectoria futura (tenue)
    ctx.beginPath();
    ctx.strokeStyle = "rgba(138, 155, 189, 0.3)";
    ctx.lineWidth = 1 / view.scale; // Mantener grosor visual de 1px independiente del zoom
    ctx.setLineDash([5000, 5000]); // Línea punteada a escala de km
    for (let i = currentIndex; i < trajectory.length; i++) {
        if (i === currentIndex) ctx.moveTo(trajectory[i].x, trajectory[i].y);
        else ctx.lineTo(trajectory[i].x, trajectory[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Dibujar trayectoria pasada (brillante y gruesa)
    ctx.beginPath();
    ctx.strokeStyle = "#00e0ff";
    ctx.lineWidth = 3 / view.scale;
    ctx.shadowColor = "#00e0ff";
    ctx.shadowBlur = 10;
    for (let i = 0; i <= currentIndex; i++) {
        if (i === 0) ctx.moveTo(trajectory[i].x, trajectory[i].y);
        else ctx.lineTo(trajectory[i].x, trajectory[i].y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 3. Dibujar la Tierra
    ctx.beginPath();
    ctx.arc(0, 0, EARTH_R, 0, 2 * Math.PI);
    ctx.fillStyle = "#3273f6"; // Azul terráqueo
    ctx.fill();
    ctx.lineWidth = 100 / view.scale;
    ctx.strokeStyle = "rgba(50, 115, 246, 0.4)";
    ctx.stroke(); // Halo atmosférico

    // Textos de etiquetas
    ctx.font = `${14 / view.scale}px Space Grotesk`;
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText("LA TIERRA", 0 - EARTH_R, -EARTH_R - 5000);

    // 4. Dibujar la Luna
    ctx.beginPath();
    ctx.arc(MOON_DIST, 0, MOON_R, 0, 2 * Math.PI);
    ctx.fillStyle = "#a8a9ad";
    ctx.fill();
    ctx.fillText("LA LUNA", MOON_DIST - MOON_R, -MOON_R - 5000);

    // 5. Dibujar la Cápsula (Orion)
    ctx.beginPath();
    const capsuleSize = Math.max(800, 5 / view.scale); // Al menos 5px visualmente o 800km para no desaparecer
    ctx.arc(pos.x, pos.y, capsuleSize, 0, 2 * Math.PI);
    ctx.fillStyle = "#ff4757"; // Rojo brillante
    ctx.fill();
    
    // Halo pulsante para la cápsula
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, capsuleSize * (1 + 0.5 * Math.sin(Date.now() * 0.005)), 0, 2 * Math.PI);
    ctx.strokeStyle = "rgba(255, 71, 87, 0.5)";
    ctx.lineWidth = capsuleSize * 0.2;
    ctx.stroke();
    
    // Etiqueta de la nave
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${14 / view.scale}px Space Grotesk`;
    ctx.fillText("ORION", pos.x + capsuleSize*2, pos.y + capsuleSize);

    ctx.restore();

    requestAnimationFrame(animate);
}

// Iniciar simulación
animate();
