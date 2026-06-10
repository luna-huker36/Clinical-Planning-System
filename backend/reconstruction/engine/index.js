/**
 * PMAS Native Reconstruction Engine (Visual Hull).
 *
 * Pure-JS photogrammetry-lite: photos (or extracted video frames) shot around
 * an object are segmented into silhouettes, carved into a voxel visual hull
 * on a turntable camera rig, meshed with Surface Nets, smoothed, colored from
 * the source photos and exported as a binary glTF (GLB).
 */

const fs = require("fs/promises");
const path = require("path");
const { decodeImageFile, downscaleImage } = require("./image-utils");
const { extractSilhouette } = require("./silhouette");
const { buildTurntableRig } = require("./camera-rig");
const { carveVoxels } = require("./voxel-carving");
const { extractSurface } = require("./surface-nets");
const {
  taubinSmooth,
  computeVertexNormals,
  ensureOutwardOrientation,
  centerAndScale,
  isWatertight
} = require("./mesh-post");
const { assignVertexColors } = require("./vertex-colors");
const { buildGlb } = require("./glb-writer");

const ENGINE_NAME = "PMAS Native Reconstruction Engine (Visual Hull)";
const TARGET_MODEL_HEIGHT = 0.25;
const MIN_FRAME_COVERAGE = 0.015;
const MAX_FRAME_COVERAGE = 0.85;
const PROFILE_BY_MODE = Object.freeze({
  fast: { dims: 104, workSize: 224, smoothIterations: 8 },
  balanced: { dims: 136, workSize: 288, smoothIterations: 10 },
  quality: { dims: 176, workSize: 352, smoothIterations: 12 }
});

function resolveProfile(settings = {}) {
  const profile = { ...(PROFILE_BY_MODE[settings.processingMode] || PROFILE_BY_MODE.balanced) };
  if (settings.targetModelQuality === "planning") profile.dims += 16;
  return profile;
}

function selectFramePaths(job) {
  return Array.from(job.selectedFrames || [])
    .map(frame => ({ fileName: String(frame.fileName || ""), framePath: frame.framePath }))
    .filter(frame => frame.framePath)
    .sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true }));
}

function gradeQuality({ usableFrames, watertight, averageCoverage }) {
  if (usableFrames >= 12 && watertight && averageCoverage >= 0.04 && averageCoverage <= 0.7) return "good";
  if (usableFrames >= 5) return "medium";
  return "poor";
}

/**
 * Run the full reconstruction for a job.
 *
 * @param {object} job reconstruction job (needs selectedFrames with framePath)
 * @param {{outputPath: string, settings?: object, onProgress?: function}} options
 * @returns {Promise<{rawMeshPath, engineName, warnings, quality, stats}>}
 */
async function runNativeReconstruction(job, options = {}) {
  const outputPath = options.outputPath;
  if (!outputPath) throw new Error("Native engine requires an explicit GLB output path.");
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
  const profile = resolveProfile(options.settings || job.settings || {});

  const framePaths = selectFramePaths(job);
  if (!framePaths.length) throw new Error("Нет кадров для реконструкции.");

  // 1. Load photos and extract silhouettes (progress 0 -> 0.15).
  const warnings = new Set();
  const silhouettes = [];
  const images = [];
  let decodeFailures = 0;
  let rejectedFrames = 0;
  let firstDecodeError = "";
  for (let i = 0; i < framePaths.length; i += 1) {
    try {
      const image = downscaleImage(await decodeImageFile(framePaths[i].framePath), profile.workSize);
      const silhouette = extractSilhouette(image);
      // Border contact on 3+ sides means the "object" is most likely the
      // background (inverted segmentation) or a heavily cropped frame.
      const borderTouches =
        (silhouette.bbox.minX <= 1 ? 1 : 0) + (silhouette.bbox.minY <= 1 ? 1 : 0) +
        (silhouette.bbox.maxX >= image.width - 2 ? 1 : 0) +
        (silhouette.bbox.maxY >= image.height - 2 ? 1 : 0);
      const usable = silhouette.coverage >= MIN_FRAME_COVERAGE &&
        silhouette.coverage <= MAX_FRAME_COVERAGE && borderTouches < 3;
      if (usable) {
        silhouette.sourceIndex = i;
        silhouettes.push(silhouette);
        images.push(image);
      } else {
        rejectedFrames += 1;
      }
      silhouette.warnings.forEach(warning => warnings.add(warning));
    } catch (err) {
      decodeFailures += 1;
      if (!firstDecodeError) firstDecodeError = err.message;
    }
    onProgress(0.15 * ((i + 1) / framePaths.length));
  }
  if (decodeFailures) warnings.add(`Не удалось прочитать кадров: ${decodeFailures}`);
  if (rejectedFrames) warnings.add(`Кадров отклонено по качеству силуэта: ${rejectedFrames}`);
  if (!silhouettes.length) {
    if (decodeFailures === framePaths.length) {
      throw new Error(`Не удалось прочитать ни один кадр (${decodeFailures}). ` +
        `Поддерживаются JPG/PNG (HEIC не поддерживается). Первая ошибка: ${firstDecodeError}`);
    }
    throw new Error("Ни на одном кадре не удалось выделить объект — проверьте контраст с фоном.");
  }
  if (silhouettes.length <= 6) {
    warnings.add(`Мало ракурсов (${silhouettes.length}) — форма будет грубой; снимите 15–30 кадров вокруг объекта.`);
  }

  // 2. Visual hull carving (0.15 -> 0.7).
  const captureDirection = (options.settings && options.settings.rotationDirection) ||
    process.env.PMAS_CAPTURE_DIRECTION || "ccw";
  const rig = buildTurntableRig(silhouettes, {
    totalFrames: framePaths.length,
    direction: captureDirection === "cw" ? "cw" : "ccw"
  });
  const grid = await carveVoxels(rig, {
    dims: profile.dims,
    onProgress: fraction => onProgress(0.15 + 0.55 * fraction)
  });
  if (!grid.insideCount) {
    throw new Error("Силуэты кадров несовместимы — пустой объём. Снимайте объект по кругу с одного уровня.");
  }

  // 3. Meshing and post-processing (0.7 -> 0.9). Yield between the heavy
  // synchronous stages so status polling and cancel stay responsive.
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const rawMesh = extractSurface(grid);
  if (!rawMesh.triangleCount) throw new Error("Не удалось построить поверхность по вокселям.");
  onProgress(0.75);
  await tick();
  const smoothedPositions = taubinSmooth(rawMesh.positions, rawMesh.indices, profile.smoothIterations);
  await tick();
  const oriented = ensureOutwardOrientation(smoothedPositions, rawMesh.indices);
  const normals = computeVertexNormals(smoothedPositions, oriented.indices);
  onProgress(0.9);
  await tick();

  // 4. Colors from photos, normalize placement, export GLB (0.9 -> 1).
  const colors = assignVertexColors(smoothedPositions, normals, rig, images);
  await tick();
  const placed = centerAndScale(smoothedPositions, TARGET_MODEL_HEIGHT);
  const glb = buildGlb({
    positions: placed.positions,
    normals,
    colors,
    indices: oriented.indices,
    name: `pmas-scan-${job.jobId || "model"}`,
    generator: ENGINE_NAME
  });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, glb);
  onProgress(1);

  const averageCoverage = silhouettes.reduce((sum, s) => sum + s.coverage, 0) / silhouettes.length;
  const watertight = isWatertight(oriented.indices);
  const stats = {
    inputFrames: framePaths.length,
    usableFrames: silhouettes.length,
    voxelGrid: profile.dims,
    insideVoxels: grid.insideCount,
    vertexCount: rawMesh.vertexCount,
    triangleCount: rawMesh.triangleCount,
    watertight,
    averageSilhouetteCoverage: Number(averageCoverage.toFixed(4)),
    glbBytes: glb.length
  };
  return {
    rawMeshPath: outputPath,
    engineName: ENGINE_NAME,
    warnings: Array.from(warnings),
    quality: gradeQuality({ usableFrames: silhouettes.length, watertight, averageCoverage }),
    stats
  };
}

module.exports = {
  ENGINE_NAME,
  runNativeReconstruction,
  resolveProfile
};
