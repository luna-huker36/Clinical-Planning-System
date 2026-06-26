/**
 * Конвертер OBJ (+MTL с текстурным атласом) -> GLB.
 * Заточен под вывод OpenMVS TextureMesh: один материал, одна текстура,
 * треугольники/полигоны с v/vt. Использует glb-writer движка.
 *
 * Использование: node obj2glb.js input.obj output.glb
 */

const fs = require("fs");
const path = require("path");
const jpeg = require("jpeg-js");
const { PNG } = require("pngjs");
const { buildGlb } = require("../engine/glb-writer");

function fail(message) {
  console.error(message);
  process.exit(1);
}

const [, , objPath, outPath] = process.argv;
if (!objPath || !outPath) fail("Использование: node obj2glb.js input.obj output.glb");

const objDir = path.dirname(objPath);
const objText = fs.readFileSync(objPath, "utf8");

// --- разбор OBJ ---
const positionsRaw = [];
const uvsRaw = [];
const faces = [];
let mtlFile = null;

for (const line of objText.split("\n")) {
  const parts = line.trim().split(/\s+/);
  if (parts[0] === "v") {
    positionsRaw.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
  } else if (parts[0] === "vt") {
    uvsRaw.push([Number(parts[1]), Number(parts[2])]);
  } else if (parts[0] === "f") {
    const verts = parts.slice(1).map(token => {
      const [v, vt] = token.split("/").map(s => (s === "" ? NaN : Number(s)));
      return { v: v - 1, vt: Number.isFinite(vt) ? vt - 1 : -1 };
    });
    // триангуляция веером для полигонов
    for (let i = 1; i + 1 < verts.length; i += 1) {
      faces.push([verts[0], verts[i], verts[i + 1]]);
    }
  } else if (parts[0] === "mtllib") {
    mtlFile = parts.slice(1).join(" ");
  }
}
if (!positionsRaw.length || !faces.length) fail("OBJ пуст или не распознан.");

// --- текстура из MTL ---
let texturePngBuffer = null;
if (mtlFile) {
  const mtlPath = path.join(objDir, mtlFile);
  if (fs.existsSync(mtlPath)) {
    const mapLine = fs.readFileSync(mtlPath, "utf8").split("\n")
      .map(l => l.trim()).find(l => l.startsWith("map_Kd"));
    if (mapLine) {
      const texFile = mapLine.split(/\s+/).slice(1).join(" ");
      const texPath = path.join(objDir, texFile);
      if (fs.existsSync(texPath)) {
        const raw = fs.readFileSync(texPath);
        if (/\.png$/i.test(texFile)) {
          texturePngBuffer = raw;
        } else if (/\.jpe?g$/i.test(texFile)) {
          // GLB-writer ждёт PNG — перекодируем атлас
          const decoded = jpeg.decode(raw, { useTArray: true, maxMemoryUsageInMB: 4096, maxResolutionInMP: 200 });
          const png = new PNG({ width: decoded.width, height: decoded.height, colorType: 6 });
          png.data = Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.length);
          texturePngBuffer = PNG.sync.write(png);
        }
      }
    }
  }
}

// --- разворачивание в уникальные пары (v, vt) ---
const pairIndex = new Map();
const positions = [];
const uvs = [];
const indices = [];
const hasUv = uvsRaw.length > 0 && texturePngBuffer;

for (const tri of faces) {
  for (const { v, vt } of tri) {
    const key = hasUv ? `${v}/${vt}` : String(v);
    let idx = pairIndex.get(key);
    if (idx == null) {
      idx = positions.length / 3;
      pairIndex.set(key, idx);
      const p = positionsRaw[v];
      positions.push(p[0], p[1], p[2]);
      if (hasUv) {
        const t = vt >= 0 ? uvsRaw[vt] : [0, 0];
        // OBJ хранит V снизу вверх, glTF — сверху вниз
        uvs.push(t[0], 1 - t[1]);
      }
    }
    indices.push(idx);
  }
}

// --- нормали (площадно-взвешенные) ---
const vertexCount = positions.length / 3;
const normals = new Float32Array(vertexCount * 3);
for (let t = 0; t < indices.length; t += 3) {
  const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
  const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
  const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
  const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  for (const i of [a, b, c]) {
    normals[i * 3] += nx;
    normals[i * 3 + 1] += ny;
    normals[i * 3 + 2] += nz;
  }
}
for (let i = 0; i < vertexCount; i += 1) {
  const len = Math.hypot(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]) || 1;
  normals[i * 3] /= len;
  normals[i * 3 + 1] /= len;
  normals[i * 3 + 2] /= len;
}

const glb = buildGlb({
  positions: Float32Array.from(positions),
  normals,
  colors: null,
  uvs: hasUv ? Float32Array.from(uvs) : null,
  texturePng: hasUv ? texturePngBuffer : null,
  indices: Uint32Array.from(indices),
  name: "colmap-openmvs-scan",
  generator: "PMAS COLMAP+OpenMVS pipeline"
});
fs.writeFileSync(outPath, glb);
console.log(`GLB: ${outPath} (${glb.length} bytes, ${vertexCount} verts, ${indices.length / 3} tris, texture=${Boolean(hasUv)})`);
