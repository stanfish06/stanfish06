const color1 = "#11262D";
const color2 = "#DFFF00";
const dataUrl = "contributions.json";
const weekCount = 52;
const colorBy = "level";
const maxTiltX = 1.5;
const maxTiltY = 6;
const maxZ = 60;
const glassBlur = 3;
const glassRefraction = 40;
const glassBezel = 20;
const glassSaturate = 1.5;
const glassTint = "rgba(255, 255, 255, 0.12)";
const glassRim = "inset 0 0 0 1px rgba(255, 255, 255, 0.55), inset 0 2px 10px rgba(255, 255, 255, 0.35)";
const revealSigma = 40;
const revealFollow = 0.12;
const revealFade = 0.2;
const waveInterval = 6;
const waveDuration = 3;
const waveSigmaLeft = 90;
const waveSigmaRight = 30;
const rippleDuration = 2;
const rippleMaxRadius = 280;
const rippleFadePower = 0.5;
const rippleSigmaInner = 30;
const rippleSigmaOuter = 15;
const bumpDepth = 6;
const bumpDuration = 0.45;
const bumpOvershoot = 0.3;
const grid = document.getElementById("grid");
const out = grid.parentElement;
const glass = document.getElementById("glass");
const glassCells = document.getElementById("glassCells");

glass.style.setProperty("--glass-tint", glassTint);
glass.style.setProperty("--glass-rim", glassRim);

function buildGlassMap(w, h, radius, bezel) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(w, h);
    const hx = w / 2;
    const hy = h / 2;
    const r = Math.min(radius, hx, hy);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const px = x + 0.5 - hx;
            const py = y + 0.5 - hy;
            const qx = Math.abs(px) - (hx - r);
            const qy = Math.abs(py) - (hy - r);
            let sd, nx, ny;
            if (qx > 0 && qy > 0) {
                const l = Math.hypot(qx, qy);
                sd = l - r;
                nx = (qx / l) * Math.sign(px);
                ny = (qy / l) * Math.sign(py);
            } else if (qx > qy) {
                sd = qx - r;
                nx = Math.sign(px);
                ny = 0;
            } else {
                sd = qy - r;
                nx = 0;
                ny = Math.sign(py);
            }
            const t = Math.max(0, 1 + sd / bezel);
            const m = t * t;
            const i = (y * w + x) * 4;
            img.data[i] = 128 - nx * m * 127;
            img.data[i + 1] = 128 - ny * m * 127;
            img.data[i + 2] = 128;
            img.data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
}

function setupGlass() {
    const w = grid.offsetWidth;
    const h = grid.offsetHeight;
    const radius = parseFloat(getComputedStyle(grid).borderTopLeftRadius);
    const filter = document.getElementById("liquid");
    const map = document.getElementById("glassMap");
    for (const el of [filter, map]) {
        el.setAttribute("x", 0);
        el.setAttribute("y", 0);
        el.setAttribute("width", w);
        el.setAttribute("height", h);
    }
    map.setAttribute("href", buildGlassMap(w, h, radius, glassBezel));
    document.getElementById("glassBlurFx").setAttribute("stdDeviation", glassBlur);
    document.getElementById("glassDisplace").setAttribute("scale", glassRefraction);
    document.getElementById("glassSaturateFx").setAttribute("values", glassSaturate);
}

const reveal = { x: 0, y: 0, s: 0, tx: 0, ty: 0, ts: 0, frame: 0, last: 0 };
const wave = { start: 0 };
let ripples = [];

function gaussAlpha(d, sigma, s) {
    const floor = Math.exp(-4.5);
    const g = Math.exp(-(d * d) / (2 * sigma ** 2));
    return 1 - (s * Math.max(0, g - floor)) / (1 - floor);
}

function revealMask(x, y, s) {
    const stops = Array.from({ length: 13 }, (_, i) => {
        const r = (i / 12) * 3 * revealSigma;
        return `rgba(0, 0, 0, ${gaussAlpha(r, revealSigma, s).toFixed(3)}) ${r.toFixed(1)}px`;
    }).join(", ");
    return `radial-gradient(circle at ${x}px ${y}px, ${stops})`;
}

function waveMask(x) {
    const stops = Array.from({ length: 25 }, (_, i) => {
        const sigma = i < 12 ? waveSigmaLeft : waveSigmaRight;
        const d = (i / 12 - 1) * 3 * sigma;
        return `rgba(0, 0, 0, ${gaussAlpha(d, sigma, 1).toFixed(3)}) ${(x + d).toFixed(1)}px`;
    }).join(", ");
    return `linear-gradient(to right, ${stops})`;
}

function wavePosition(now) {
    const t = Math.min(1, Math.max(0, (now - wave.start) / (waveDuration * 1000)));
    if (t >= 1) wave.start = 0;
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const from = -3 * waveSigmaRight;
    const to = grid.offsetWidth + 3 * waveSigmaLeft;
    return from + e * (to - from);
}

function rippleMask(ripple, now) {
    const t = Math.min(1, Math.max(0, (now - ripple.start) / (rippleDuration * 1000)));
    if (t >= 1) ripple.done = true;
    const radius = rippleMaxRadius * (1 - (1 - t) ** 2);
    const strength = (1 - t) ** rippleFadePower;
    const stops = Array.from({ length: 25 }, (_, i) => {
        const sigma = i < 12 ? rippleSigmaInner : rippleSigmaOuter;
        const d = (i / 12 - 1) * 3 * sigma;
        return `rgba(0, 0, 0, ${gaussAlpha(d, sigma, strength).toFixed(3)}) ${(radius + d).toFixed(1)}px`;
    }).join(", ");
    return `radial-gradient(circle at ${ripple.x}px ${ripple.y}px, ${stops})`;
}

function easeStep(dt, tau) {
    return tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
}

function stepReveal(now) {
    const dt = reveal.last ? (now - reveal.last) / 1000 : 0;
    reveal.last = now;
    const kp = easeStep(dt, revealFollow);
    const ks = easeStep(dt, revealFade);
    reveal.x += (reveal.tx - reveal.x) * kp;
    reveal.y += (reveal.ty - reveal.y) * kp;
    reveal.s += (reveal.ts - reveal.s) * ks;
    const settled =
        Math.abs(reveal.tx - reveal.x) < 0.1 &&
        Math.abs(reveal.ty - reveal.y) < 0.1 &&
        Math.abs(reveal.ts - reveal.s) < 0.001;
    if (settled) {
        reveal.x = reveal.tx;
        reveal.y = reveal.ty;
        reveal.s = reveal.ts;
    }
    const layers = [];
    if (reveal.s > 0) layers.push(revealMask(reveal.x, reveal.y, reveal.s));
    if (wave.start) layers.push(waveMask(wavePosition(now)));
    for (const ripple of ripples) layers.push(rippleMask(ripple, now));
    ripples = ripples.filter((ripple) => !ripple.done);
    const mask = layers.length ? layers.join(", ") : "none";
    glass.style.maskImage = mask;
    glass.style.webkitMaskImage = mask;
    glass.style.maskComposite = "intersect";
    glass.style.webkitMaskComposite = "source-in";
    const done = settled && !wave.start && !ripples.length;
    reveal.frame = done ? 0 : requestAnimationFrame(stepReveal);
    if (done) reveal.last = 0;
}

function kickReveal() {
    if (!reveal.frame) reveal.frame = requestAnimationFrame(stepReveal);
}

function setReveal(x, y) {
    if (x === null) {
        reveal.ts = 0;
    } else {
        if (reveal.s < 0.01) {
            reveal.x = x;
            reveal.y = y;
        }
        reveal.tx = x;
        reveal.ty = y;
        reveal.ts = 1;
    }
    kickReveal();
}

setInterval(() => {
    wave.start = performance.now();
    kickReveal();
}, waveInterval * 1000);

out.addEventListener("click", (e) => {
    const rect = out.getBoundingClientRect();
    ripples.push({ x: e.clientX - rect.left, y: e.clientY - rect.top, start: performance.now(), done: false });
    kickReveal();
    grid.animate(
        [
            { translate: "0 0 0", easing: "ease-out" },
            { translate: `0 0 ${-bumpDepth}px`, offset: 0.25, easing: "ease-in-out" },
            { translate: `0 0 ${bumpDepth * bumpOvershoot}px`, offset: 0.6, easing: "ease-in-out" },
            { translate: "0 0 0" },
        ],
        { duration: bumpDuration * 1000 },
    );
});

function hexToRgb(hex) {
    const n = parseInt(hex.replace("#", ""), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function colorBetween(colorA, colorB, t) {
    const a = hexToRgb(colorA);
    const b = hexToRgb(colorB);
    const [r, g, bl] = a.map((v, i) => Math.round(v + (b[i] - v) * t));
    return `rgb(${r}, ${g}, ${bl})`;
}

async function loadWeeks() {
    try {
        const res = await fetch(dataUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()).weeks;
    } catch (err) {
        console.warn(`Could not load ${dataUrl}, using random colors:`, err);
        return null;
    }
}

async function buildCells() {
    const weeks = await loadWeeks();
    const recent = weeks ? weeks.slice(-weekCount) : null;
    const offset = recent ? weekCount - recent.length : 0;
    const maxCount = recent ? Math.max(1, ...recent.flat().map((day) => day.count)) : 1;
    for (let w = 0; w < weekCount; w++) {
        for (let d = 0; d < 7; d++) {
            const cell = document.createElement("div");
            cell.className = "cell";
            if (!recent) {
                cell.style.background = colorBetween(color1, color2, Math.random());
            } else {
                const day = recent[w - offset]?.find((entry) => entry.weekday === d);
                if (day) {
                    const t = colorBy === "count" ? day.count / maxCount : day.level / 4;
                    cell.style.background = colorBetween(color1, color2, t);
                    cell.dataset.date = day.date;
                    cell.dataset.count = day.count;
                } else {
                    cell.classList.add("empty");
                }
            }
            grid.appendChild(cell);
        }
    }
    glassCells.append(...Array.from(grid.querySelectorAll(":scope > .cell"), (cell) => cell.cloneNode()));
    setupGlass();
}

buildCells();

out.addEventListener("mousemove", (e) => {
    const rect = out.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    setReveal(e.clientX - rect.left, e.clientY - rect.top);
    const dist = Math.hypot(nx, ny);
    if (dist === 0) {
        grid.style.transform = "";
        return;
    }
    const scale = Math.min(1, 1 / dist);
    const tx = nx * maxTiltX * scale;
    const ty = ny * maxTiltY * scale;
    const tiltDeg = Math.hypot(tx, ty);
    if (tiltDeg === 0) {
        grid.style.transform = "";
        return;
    }
    const dx = tx / tiltDeg;
    const dy = ty / tiltDeg;
    const reach = (grid.offsetWidth / 2) * Math.abs(dx) + (grid.offsetHeight / 2) * Math.abs(dy);
    const tilt = (tiltDeg * Math.PI) / 180;
    const angle = Math.min(tilt, Math.asin(Math.min(1, maxZ / reach)));
    grid.style.transform = `rotate3d(${-dy}, ${dx}, 0, ${angle}rad)`;
});

out.addEventListener("mouseleave", () => {
    grid.style.transform = "";
    setReveal(null, null);
});
