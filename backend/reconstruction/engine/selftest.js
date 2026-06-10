/**
 * Engine selftest: reconstructs synthetic turntable datasets of known shapes
 * and verifies geometry, topology and GLB integrity.
 *
 * Run: node backend/reconstruction/engine/selftest.js
 *
 * Scale-invariant geometry checks (the engine normalizes model size):
 * - sphere: mesh volume / bbox volume must be close to pi/6 ~ 0.5236
 * - box:    mesh volume / bbox volume must be close to 1
 */

const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { generateTurntableDataset } = require("./synthetic-dataset");
const { runNativeReconstruction } = require("./index");
const { validateGlbBuffer, parseGlb } = require("./glb-writer");
const { computeSignedVolume, computeBounds, isWatertight } = require("./mesh-post");

const CASES = [
  { shape: "sphere", viewCount: 24, expectedFillRatio: Math.PI / 6, tolerance: 0.08 },
  { shape: "box", viewCount: 24, expectedFillRatio: 1.0, tolerance: 0.12 },
  // Regression: with exactly 6 views the hull bulges to 1.1547x of the
  // silhouette half-width along z and used to get clipped by the voxel grid,
  // silently producing a non-watertight mesh. The bbox is anisotropic here,
  // so the X/Z aspect tolerance is relaxed.
  { shape: "sphere", viewCount: 6, expectedFillRatio: 0.55, tolerance: 0.18, aspectTolerance: 0.3 }
];

function readMeshFromGlb(buffer) {
  const { json, bin } = parseGlb(buffer);
  const primitive = json.meshes[0].primitives[0];
  const readAccessor = (accessorIndex, ArrayType, components) => {
    const accessor = json.accessors[accessorIndex];
    const view = json.bufferViews[accessor.bufferView];
    const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
    return new ArrayType(
      bin.buffer,
      bin.byteOffset + start,
      accessor.count * components
    );
  };
  return {
    positions: Float32Array.from(readAccessor(primitive.attributes.POSITION, Float32Array, 3)),
    indices: Uint32Array.from(readAccessor(primitive.indices, Uint32Array, 1))
  };
}

async function runCase({ shape, viewCount, expectedFillRatio, tolerance, aspectTolerance }, workRoot) {
  const datasetDir = path.join(workRoot, `dataset-${shape}-${viewCount}`);
  const dataset = await generateTurntableDataset({
    outDir: datasetDir,
    shape,
    viewCount,
    imageSize: 320,
    radius: 0.8
  });

  const job = {
    jobId: `selftest-${shape}-${viewCount}`,
    settings: { processingMode: "balanced" },
    selectedFrames: dataset.files.map(filePath => ({
      fileName: path.basename(filePath),
      framePath: filePath
    }))
  };
  const outputPath = path.join(workRoot, `result-${shape}-${viewCount}.glb`);
  const result = await runNativeReconstruction(job, { outputPath });

  const errors = [];
  const glb = await fs.readFile(outputPath);
  const glbValidation = validateGlbBuffer(glb);
  if (!glbValidation.ok) errors.push(`GLB invalid: ${glbValidation.errors.join("; ")}`);

  const mesh = readMeshFromGlb(glb);
  const volume = computeSignedVolume(mesh.positions, mesh.indices);
  const bounds = computeBounds(mesh.positions);
  const bboxVolume = bounds.size[0] * bounds.size[1] * bounds.size[2];
  const fillRatio = volume / bboxVolume;

  if (volume <= 0) errors.push(`Signed volume must be positive (outward orientation), got ${volume}`);
  if (!isWatertight(mesh.indices)) errors.push("Mesh is not watertight");
  if (Math.abs(fillRatio - expectedFillRatio) > tolerance) {
    errors.push(`Fill ratio ${fillRatio.toFixed(4)} differs from expected ${expectedFillRatio.toFixed(4)} by more than ${tolerance}`);
  }
  const aspectXZ = bounds.size[0] / bounds.size[2];
  const aspectLimit = aspectTolerance || 0.1;
  if (Math.abs(aspectXZ - 1) > aspectLimit) {
    errors.push(`X/Z aspect should be ~1 for a turntable-symmetric shape, got ${aspectXZ.toFixed(3)}`);
  }
  if (result.quality === "poor") errors.push(`Quality graded poor: ${result.warnings.join("; ")}`);
  if (!glbValidation.stats.hasColors) errors.push("GLB has no vertex colors");

  return {
    shape: `${shape} (${viewCount} views)`,
    ok: errors.length === 0,
    errors,
    fillRatio: Number(fillRatio.toFixed(4)),
    expectedFillRatio: Number(expectedFillRatio.toFixed(4)),
    triangles: glbValidation.stats.triangleCount,
    vertices: glbValidation.stats.vertexCount,
    watertight: isWatertight(mesh.indices),
    quality: result.quality,
    warnings: result.warnings,
    glbBytes: glb.length
  };
}

async function main() {
  const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pmas-engine-selftest-"));
  let failed = false;
  try {
    for (const testCase of CASES) {
      const started = Date.now();
      const report = await runCase(testCase, workRoot);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      const status = report.ok ? "PASS" : "FAIL";
      console.log(`[${status}] ${report.shape} (${seconds}s) — fill ${report.fillRatio} (expected ~${report.expectedFillRatio}), ` +
        `${report.vertices} verts / ${report.triangles} tris, watertight=${report.watertight}, quality=${report.quality}`);
      if (report.warnings.length) console.log(`       warnings: ${report.warnings.join(" | ")}`);
      if (!report.ok) {
        failed = true;
        report.errors.forEach(error => console.error(`       ERROR: ${error}`));
      }
    }
  } finally {
    await fs.rm(workRoot, { recursive: true, force: true }).catch(() => null);
  }
  if (failed) {
    console.error("Selftest FAILED");
    process.exit(1);
  }
  console.log("Selftest PASSED");
}

main().catch(err => {
  console.error("Selftest crashed:", err);
  process.exit(1);
});
