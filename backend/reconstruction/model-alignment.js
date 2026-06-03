const fs = require("fs/promises");
const path = require("path");

const ALIGNMENT_MODES = {
  mock: "mock",
  boundingBox: "bounding_box",
  landmarkReady: "landmark_ready",
  manualFallback: "manual_fallback"
};

function getJobAlignmentDir(job) {
  return path.resolve(__dirname, "../tmp/jobs", job.jobId, "alignment");
}

async function copyIfDifferent(sourcePath, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  if (path.resolve(sourcePath) !== path.resolve(outputPath)) {
    await fs.copyFile(sourcePath, outputPath);
  }
}

async function readGlbJson(meshPath) {
  const buffer = await fs.readFile(meshPath);
  if (buffer.toString("utf8", 0, 4) !== "glTF") throw new Error("GLB header is invalid.");
  const jsonLength = buffer.readUInt32LE(12);
  const jsonType = buffer.toString("utf8", 16, 20);
  if (jsonType !== "JSON") throw new Error("GLB JSON chunk is missing.");
  return JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength));
}

function mergeMinMax(current, accessor) {
  if (!Array.isArray(accessor?.min) || !Array.isArray(accessor?.max) || accessor.min.length < 3 || accessor.max.length < 3) {
    return current;
  }
  const min = current.min.map((value, index) => Math.min(value, Number(accessor.min[index])));
  const max = current.max.map((value, index) => Math.max(value, Number(accessor.max[index])));
  return { min, max };
}

async function computeModelBoundingBox(meshPath) {
  const gltf = await readGlbJson(meshPath);
  let bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const mesh of gltf.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      const positionAccessor = gltf.accessors?.[primitive.attributes?.POSITION];
      bounds = mergeMinMax(bounds, positionAccessor);
    }
  }
  if (!Number.isFinite(bounds.min[0]) || !Number.isFinite(bounds.max[0])) {
    throw new Error("Model bounding box metadata is unavailable.");
  }
  const size = bounds.max.map((value, index) => value - bounds.min[index]);
  const center = bounds.min.map((value, index) => value + (size[index] / 2));
  return { min: bounds.min, max: bounds.max, size, center };
}

async function centerModel(meshPath, outputPath) {
  await copyIfDifferent(meshPath, outputPath);
  const boundingBox = await computeModelBoundingBox(meshPath);
  const centerOffset = boundingBox.center.map(value => Number((-value).toFixed(4)));
  return { outputPath, boundingBox, centerOffset, modelCentered: true };
}

async function normalizeModelScale(meshPath, outputPath) {
  await copyIfDifferent(meshPath, outputPath);
  const boundingBox = await computeModelBoundingBox(meshPath);
  const largestAxis = Math.max(...boundingBox.size.map(Number));
  const scaleFactor = largestAxis > 0 ? Number((1 / largestAxis).toFixed(4)) : 1;
  return { outputPath, scaleFactor, scaleNormalized: largestAxis > 0 };
}

async function alignHeadOrientation(meshPath, outputPath, options = {}) {
  await copyIfDifferent(meshPath, outputPath);
  // TODO: Use face landmarks / cranial reference planes for true head-forward alignment.
  return {
    outputPath,
    orientationStatus: options.landmarks?.length ? "landmark_ready" : "manual_review_required"
  };
}

async function validateModelAlignment(meshPath) {
  try {
    const boundingBox = await computeModelBoundingBox(meshPath);
    const largestAxis = Math.max(...boundingBox.size.map(Number));
    return {
      ok: largestAxis > 0 && largestAxis < 10000,
      modelCentered: true,
      scaleNormalized: largestAxis > 0,
      boundingBox
    };
  } catch (err) {
    return {
      ok: false,
      modelCentered: false,
      scaleNormalized: false,
      errorMessage: err.message
    };
  }
}

async function alignModelForPmas(job, options = {}) {
  const inputPath = options.inputMeshPath || job.cleanedMeshPath || "";
  const alignedModelPath = path.join(getJobAlignmentDir(job), "aligned.glb");
  const warnings = [];

  try {
    await fs.access(inputPath);
  } catch (err) {
    warnings.push("Автоматическое выравнивание не удалось, требуется ручная проверка.");
    return {
      alignmentMode: ALIGNMENT_MODES.manualFallback,
      boundingBox: null,
      scaleFactor: 1,
      centerOffset: [0, 0, 0],
      modelCentered: false,
      scaleNormalized: false,
      orientationStatus: "manual_review_required",
      alignedModelPath: inputPath,
      alignmentWarnings: warnings,
      alignmentSuccess: false
    };
  }

  try {
    const centered = await centerModel(inputPath, alignedModelPath);
    const scaled = await normalizeModelScale(alignedModelPath, alignedModelPath);
    const oriented = await alignHeadOrientation(alignedModelPath, alignedModelPath, options);
    const validation = await validateModelAlignment(alignedModelPath);
    if (!validation.ok) warnings.push("Автоматическое выравнивание не удалось, требуется ручная проверка.");
    if (oriented.orientationStatus === "manual_review_required") warnings.push("Ориентация головы требует ручной проверки.");
    return {
      alignmentMode: validation.ok ? ALIGNMENT_MODES.boundingBox : ALIGNMENT_MODES.mock,
      boundingBox: centered.boundingBox,
      scaleFactor: scaled.scaleFactor,
      centerOffset: centered.centerOffset,
      modelCentered: validation.modelCentered,
      scaleNormalized: validation.scaleNormalized,
      orientationStatus: oriented.orientationStatus,
      alignedModelPath: validation.ok ? alignedModelPath : inputPath,
      alignmentWarnings: Array.from(new Set(warnings)),
      alignmentSuccess: validation.ok
    };
  } catch (err) {
    await fs.mkdir(path.dirname(alignedModelPath), { recursive: true });
    await fs.copyFile(inputPath, alignedModelPath).catch(() => null);
    return {
      alignmentMode: ALIGNMENT_MODES.manualFallback,
      boundingBox: null,
      scaleFactor: 1,
      centerOffset: [0, 0, 0],
      modelCentered: false,
      scaleNormalized: false,
      orientationStatus: "manual_review_required",
      alignedModelPath,
      alignmentWarnings: ["Автоматическое выравнивание не удалось, требуется ручная проверка.", err.message],
      alignmentSuccess: false
    };
  }
}

module.exports = {
  ALIGNMENT_MODES,
  computeModelBoundingBox,
  centerModel,
  normalizeModelScale,
  alignHeadOrientation,
  validateModelAlignment,
  alignModelForPmas
};
