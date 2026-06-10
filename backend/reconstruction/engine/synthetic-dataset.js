"use strict";

/**
 * Synthetic turntable dataset generator for the visual-hull engine selftest.
 *
 * Renders ray-traced shaded primitives (sphere / box) on a pure white
 * background using an orthographic turntable camera, and writes each view
 * as a PNG via pngjs.
 *
 * Camera convention (MUST stay in sync with the reconstruction engine):
 *   - View k has azimuth theta = k * 2*PI / viewCount.
 *   - World is Y-up, camera looks at the origin, orthographic projection.
 *   - right   = ( cos(theta), 0, -sin(theta))
 *   - up      = ( 0,          1,  0         )
 *   - forward = (-sin(theta), 0, -cos(theta))   (direction TOWARD object)
 *   - cameraPos = 3 * (sin(theta), 0, cos(theta))
 *   - Pixel (px, py): u = ((px + 0.5)/imageSize * 2 - 1) * extent,
 *                     v = (1 - (py + 0.5)/imageSize * 2) * extent,
 *     ray origin p0 = cameraPos + right*u + up*v, ray direction = forward,
 *     extent = 1.0.
 */

const fsp = require("fs/promises");
const path = require("path");
const { PNG } = require("pngjs");

const SUPPORTED_SHAPES = Object.freeze(["sphere", "box"]);
const CAMERA_DISTANCE = 3;
const EXTENT = 1.0;
const BOX_HALF_EXTENT_FACTOR = 0.7;
const AMBIENT = 0.3;
const DIFFUSE = 0.7;
const ALBEDO = Object.freeze([215, 140, 95]);
const LIGHT_DIR = Object.freeze([
  1 / Math.sqrt(3),
  1 / Math.sqrt(3),
  1 / Math.sqrt(3),
]);
const PARALLEL_EPS = 1e-12;

/**
 * Validates options for generateTurntableDataset, returning a frozen,
 * fully-defaulted copy. Throws Error with a clear message on bad input.
 * @param {object} opts
 * @returns {{outDir: string, shape: string, viewCount: number, imageSize: number, radius: number}}
 */
function validateOptions(opts) {
  if (opts === null || typeof opts !== "object") {
    throw new Error("generateTurntableDataset: options object is required");
  }
  const { outDir, shape = "sphere", viewCount = 16, imageSize = 256, radius = 0.8 } = opts;
  if (typeof outDir !== "string" || outDir.length === 0) {
    throw new Error("generateTurntableDataset: outDir must be a non-empty string");
  }
  if (!SUPPORTED_SHAPES.includes(shape)) {
    throw new Error(
      `generateTurntableDataset: shape must be one of ${SUPPORTED_SHAPES.join(", ")} (got "${shape}")`
    );
  }
  if (!Number.isInteger(viewCount) || viewCount < 1) {
    throw new Error(`generateTurntableDataset: viewCount must be a positive integer (got ${viewCount})`);
  }
  if (!Number.isInteger(imageSize) || imageSize < 2) {
    throw new Error(`generateTurntableDataset: imageSize must be an integer >= 2 (got ${imageSize})`);
  }
  if (typeof radius !== "number" || !Number.isFinite(radius) || radius <= 0) {
    throw new Error(`generateTurntableDataset: radius must be a positive finite number (got ${radius})`);
  }
  return Object.freeze({ outDir, shape, viewCount, imageSize, radius });
}

/**
 * Ray-sphere intersection against a sphere centered at the origin.
 * @param {Float64Array} p0 - ray origin [x, y, z]
 * @param {Float64Array} dir - unit ray direction [x, y, z]
 * @param {number} radius - sphere radius
 * @returns {{t: number, normal: Float64Array} | null} nearest positive hit
 */
function intersectSphere(p0, dir, radius) {
  const b = p0[0] * dir[0] + p0[1] * dir[1] + p0[2] * dir[2];
  const c = p0[0] * p0[0] + p0[1] * p0[1] + p0[2] * p0[2] - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sqrtDisc = Math.sqrt(disc);
  const tNear = -b - sqrtDisc;
  const tFar = -b + sqrtDisc;
  const t = tNear > 0 ? tNear : tFar > 0 ? tFar : -1;
  if (t < 0) return null;
  const normal = new Float64Array([
    (p0[0] + t * dir[0]) / radius,
    (p0[1] + t * dir[1]) / radius,
    (p0[2] + t * dir[2]) / radius,
  ]);
  return { t, normal };
}

/**
 * Ray-box intersection (slab method) against an axis-aligned cube centered
 * at the origin with the given half-extent. Computes the hit-face normal.
 * @param {Float64Array} p0 - ray origin [x, y, z]
 * @param {Float64Array} dir - unit ray direction [x, y, z]
 * @param {number} halfExtent - cube half-extent
 * @returns {{t: number, normal: Float64Array} | null} nearest positive hit
 */
function intersectBox(p0, dir, halfExtent) {
  let tNear = -Infinity;
  let tFar = Infinity;
  let nearAxis = -1;
  let nearSign = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const o = p0[axis];
    const d = dir[axis];
    if (Math.abs(d) < PARALLEL_EPS) {
      if (o < -halfExtent || o > halfExtent) return null;
      continue;
    }
    const invD = 1 / d;
    let t0 = (-halfExtent - o) * invD;
    let t1 = (halfExtent - o) * invD;
    if (t0 > t1) {
      const tmp = t0;
      t0 = t1;
      t1 = tmp;
    }
    if (t0 > tNear) {
      tNear = t0;
      nearAxis = axis;
      nearSign = d > 0 ? -1 : 1;
    }
    if (t1 < tFar) tFar = t1;
    if (tNear > tFar) return null;
  }
  if (nearAxis < 0 || tNear <= 0 || tFar <= 0) return null;
  const normal = new Float64Array(3);
  normal[nearAxis] = nearSign;
  return { t: tNear, normal };
}

/**
 * Lambert shading: albedo * (ambient + diffuse * max(0, dot(n, l))).
 * @param {Float64Array} normal - unit surface normal
 * @returns {Uint8Array} [r, g, b] in 0..255
 */
function shadeLambert(normal) {
  const nDotL =
    normal[0] * LIGHT_DIR[0] + normal[1] * LIGHT_DIR[1] + normal[2] * LIGHT_DIR[2];
  const intensity = AMBIENT + DIFFUSE * Math.max(0, nDotL);
  const rgb = new Uint8Array(3);
  for (let i = 0; i < 3; i += 1) {
    rgb[i] = Math.min(255, Math.max(0, Math.round(ALBEDO[i] * intensity)));
  }
  return rgb;
}

/**
 * Renders one orthographic turntable view as RGBA pixels.
 * @param {string} shape - "sphere" or "box"
 * @param {number} radius - dataset radius parameter
 * @param {number} viewIndex - 0-based view index
 * @param {number} viewCount - total number of views
 * @param {number} imageSize - square image size in pixels
 * @returns {Uint8Array} RGBA pixel data, length 4 * imageSize * imageSize
 */
function renderView(shape, radius, viewIndex, viewCount, imageSize) {
  const theta = (viewIndex * 2 * Math.PI) / viewCount;
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  const right = new Float64Array([cosT, 0, -sinT]);
  const up = new Float64Array([0, 1, 0]);
  const forward = new Float64Array([-sinT, 0, -cosT]);
  const cameraPos = new Float64Array([
    CAMERA_DISTANCE * sinT,
    0,
    CAMERA_DISTANCE * cosT,
  ]);
  const boxHalfExtent = radius * BOX_HALF_EXTENT_FACTOR;
  const pixels = new Uint8Array(4 * imageSize * imageSize);
  pixels.fill(255);
  const p0 = new Float64Array(3);
  for (let py = 0; py < imageSize; py += 1) {
    const v = (1 - ((py + 0.5) / imageSize) * 2) * EXTENT;
    for (let px = 0; px < imageSize; px += 1) {
      const u = (((px + 0.5) / imageSize) * 2 - 1) * EXTENT;
      p0[0] = cameraPos[0] + right[0] * u + up[0] * v;
      p0[1] = cameraPos[1] + right[1] * u + up[1] * v;
      p0[2] = cameraPos[2] + right[2] * u + up[2] * v;
      const hit =
        shape === "sphere"
          ? intersectSphere(p0, forward, radius)
          : intersectBox(p0, forward, boxHalfExtent);
      if (hit === null) continue;
      const rgb = shadeLambert(hit.normal);
      const offset = 4 * (py * imageSize + px);
      pixels[offset] = rgb[0];
      pixels[offset + 1] = rgb[1];
      pixels[offset + 2] = rgb[2];
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

/**
 * Generates a synthetic turntable photo dataset: viewCount orthographic
 * views of a shaded primitive on a white background, written as PNG files
 * named view-0001.png, view-0002.png, ... inside outDir (created
 * recursively).
 *
 * @param {object} opts
 * @param {string} opts.outDir - output directory (created if missing)
 * @param {("sphere"|"box")} [opts.shape="sphere"] - primitive to render
 * @param {number} [opts.viewCount=16] - number of turntable views
 * @param {number} [opts.imageSize=256] - square image size in pixels
 * @param {number} [opts.radius=0.8] - shape radius (box uses radius * 0.7 half-extent)
 * @returns {Promise<{files: string[], shape: string, viewCount: number, imageSize: number, radius: number}>}
 *   absolute file paths in view order plus the resolved dataset parameters
 */
async function generateTurntableDataset(opts) {
  const { outDir, shape, viewCount, imageSize, radius } = validateOptions(opts);
  const absoluteOutDir = path.resolve(outDir);
  try {
    await fsp.mkdir(absoluteOutDir, { recursive: true });
  } catch (err) {
    throw new Error(
      `generateTurntableDataset: failed to create outDir "${absoluteOutDir}": ${err.message}`
    );
  }
  const files = [];
  for (let viewIndex = 0; viewIndex < viewCount; viewIndex += 1) {
    const pixels = renderView(shape, radius, viewIndex, viewCount, imageSize);
    const png = new PNG({ width: imageSize, height: imageSize });
    png.data.set(pixels);
    const fileName = `view-${String(viewIndex + 1).padStart(4, "0")}.png`;
    const filePath = path.join(absoluteOutDir, fileName);
    try {
      await fsp.writeFile(filePath, PNG.sync.write(png));
    } catch (err) {
      throw new Error(
        `generateTurntableDataset: failed to write "${filePath}": ${err.message}`
      );
    }
    files.push(filePath);
  }
  return { files, shape, viewCount, imageSize, radius };
}

module.exports = { generateTurntableDataset };
