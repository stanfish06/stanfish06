const dataFile = "contributions.json";
const previewFile = "grid.svg";

const previewWeeks = 52;
const cellSize = 14;
const cellGap = 2;
const cellRadius = 2;
const cornerRadius = 24;
const color1 = "#11262D";
const color2 = "#DFFF00";

const glassBlur = 3;
const glassRefraction = 40;
const glassBezel = 20;
const glassSaturate = 1.5;
const glassTint = "#ffffff";
const glassTintOpacity = 0.12;
const rimOpacity = 0.55;
const rimGlowOpacity = 0.35;
const rimGlowWidth = 10;

const waveInterval = 6;
const waveDuration = 3;
const waveSigmaLeft = 90;
const waveSigmaRight = 30;

export type Day = { date: string; weekday: number; count: number; level: number };

function mix(a: string, b: string, t: number): string {
    const ca = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
    const cb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
    const [r, g, bl] = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
    return `rgb(${r}, ${g}, ${bl})`;
}

function gaussAlpha(d: number, sigma: number): number {
    const floor = Math.exp(-4.5);
    const g = Math.exp(-(d * d) / (2 * sigma ** 2));
    return 1 - Math.max(0, g - floor) / (1 - floor);
}

function glassMap(w: number, h: number, radius: number, bezel: number): Uint8Array {
    const rgb = new Uint8Array(w * h * 3);
    const hx = w / 2;
    const hy = h / 2;
    const r = Math.min(radius, hx, hy);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const px = x + 0.5 - hx;
            const py = y + 0.5 - hy;
            const qx = Math.abs(px) - (hx - r);
            const qy = Math.abs(py) - (hy - r);
            let sd: number, nx: number, ny: number;
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
            const i = (y * w + x) * 3;
            rgb[i] = Math.round(128 - nx * m * 127);
            rgb[i + 1] = Math.round(128 - ny * m * 127);
            rgb[i + 2] = 128;
        }
    }
    return rgb;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff;
    for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
    const body = new Uint8Array(4 + data.length);
    body.set(new TextEncoder().encode(type), 0);
    body.set(data, 4);
    const chunk = new Uint8Array(12 + data.length);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, data.length);
    chunk.set(body, 4);
    view.setUint32(8 + data.length, crc32(body));
    return chunk;
}

async function encodePng(w: number, h: number, rgb: Uint8Array): Promise<string> {
    const raw = new Uint8Array(h * (w * 3 + 1));
    for (let y = 0; y < h; y++) raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
    const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"));
    const idat = new Uint8Array(await new Response(stream).arrayBuffer());
    const ihdr = new Uint8Array(13);
    const view = new DataView(ihdr.buffer);
    view.setUint32(0, w);
    view.setUint32(4, h);
    ihdr.set([8, 2, 0, 0, 0], 8);
    const parts = [
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk("IHDR", ihdr),
        pngChunk("IDAT", idat),
        pngChunk("IEND", new Uint8Array()),
    ];
    const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
        png.set(p, offset);
        offset += p.length;
    }
    let binary = "";
    for (let i = 0; i < png.length; i += 0x8000) binary += String.fromCharCode(...png.subarray(i, i + 0x8000));
    return btoa(binary);
}

function bandStops(): { width: number; stops: string[] } {
    const width = 3 * waveSigmaLeft + 3 * waveSigmaRight;
    const stops = Array.from({ length: 25 }, (_, i) => {
        const sigma = i < 12 ? waveSigmaLeft : waveSigmaRight;
        const d = (i / 12 - 1) * 3 * sigma;
        const offset = (3 * waveSigmaLeft + d) / width;
        const opacity = 1 - gaussAlpha(d, sigma);
        return `<stop offset="${offset.toFixed(4)}" stop-color="#000" stop-opacity="${opacity.toFixed(3)}"/>`;
    });
    return { width, stops };
}

export async function buildPreview(weeks: Day[][]): Promise<string> {
    const recent = weeks.slice(-previewWeeks);
    const offset = previewWeeks - recent.length;
    const step = cellSize + cellGap;
    const width = previewWeeks * step - cellGap;
    const height = 7 * step - cellGap;
    const rects = recent.flatMap((week, w) =>
        week.map((day) => {
            const x = (w + offset) * step;
            const y = day.weekday * step;
            const fill = mix(color1, color2, day.level / 4);
            return `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="${cellRadius}" fill="${fill}"/>`;
        })
    );
    const map = await encodePng(width, height, glassMap(width, height, cornerRadius, glassBezel));
    const band = bandStops();
    const from = -3 * waveSigmaRight - 3 * waveSigmaLeft;
    const to = width;
    const sweepEnd = (waveDuration / waveInterval).toFixed(4);
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
        `<defs>`,
        `<clipPath id="c"><rect width="${width}" height="${height}" rx="${cornerRadius}"/></clipPath>`,
        `<g id="cells">`,
        ...rects,
        `</g>`,
        `<filter id="liquid" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}" color-interpolation-filters="sRGB">`,
        `<feGaussianBlur in="SourceGraphic" stdDeviation="${glassBlur}" result="blur"/>`,
        `<feImage href="data:image/png;base64,${map}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" result="map"/>`,
        `<feDisplacementMap in="blur" in2="map" scale="${glassRefraction}" xChannelSelector="R" yChannelSelector="G" result="bent"/>`,
        `<feColorMatrix in="bent" type="saturate" values="${glassSaturate}"/>`,
        `</filter>`,
        `<filter id="glow" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="${
            rimGlowWidth / 2
        }"/></filter>`,
        `<linearGradient id="band" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${band.width}" y2="0">`,
        ...band.stops,
        `</linearGradient>`,
        `<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">`,
        `<rect width="${width}" height="${height}" fill="#fff"/>`,
        `<rect width="${band.width}" height="${height}" fill="url(#band)">`,
        `<animateTransform attributeName="transform" type="translate" values="${from} 0; ${to} 0; ${to} 0" keyTimes="0; ${sweepEnd}; 1" calcMode="spline" keySplines="0.45 0 0.55 1; 0 0 1 1" dur="${waveInterval}s" repeatCount="indefinite"/>`,
        `</rect>`,
        `</mask>`,
        `</defs>`,
        `<g clip-path="url(#c)">`,
        `<use href="#cells"/>`,
        `<g mask="url(#m)">`,
        `<use href="#cells" filter="url(#liquid)"/>`,
        `<rect width="${width}" height="${height}" fill="${glassTint}" fill-opacity="${glassTintOpacity}"/>`,
        `<rect width="${width}" height="${height}" rx="${cornerRadius}" fill="none" stroke="#fff" stroke-opacity="${rimGlowOpacity}" stroke-width="${rimGlowWidth}" filter="url(#glow)"/>`,
        `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${
            cornerRadius - 0.5
        }" fill="none" stroke="#fff" stroke-opacity="${rimOpacity}"/>`,
        `</g>`,
        `</g>`,
        `</svg>`,
    ].join("\n");
}

if (import.meta.main) {
    const data = JSON.parse(await Deno.readTextFile(dataFile)) as { weeks: Day[][] };
    await Deno.writeTextFile(previewFile, (await buildPreview(data.weeks)) + "\n");
    console.log(`Wrote ${previewFile} from ${dataFile}`);
}
