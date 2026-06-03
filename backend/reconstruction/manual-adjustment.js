const fs = require("fs/promises");
const path = require("path");

const DEFAULT_ADJUSTMENT_VALUES = Object.freeze({
  rotationX: 0,
  rotationY: 0,
  rotationZ: 0,
  positionX: 0,
  positionY: 0,
  positionZ: 0,
  scale: 1
});

function getJobAdjustmentDir(job) {
  return path.resolve(__dirname, "../tmp/jobs", job.jobId, "adjustment");
}

function normalizeAdjustmentValues(values = {}) {
  const source = values && typeof values === "object" ? values : {};
  const normalized = {};
  for (const key of Object.keys(DEFAULT_ADJUSTMENT_VALUES)) {
    const fallback = DEFAULT_ADJUSTMENT_VALUES[key];
    const value = Number(source[key]);
    normalized[key] = Number.isFinite(value) ? value : fallback;
  }
  normalized.scale = Math.max(0.01, Math.min(100, normalized.scale));
  return normalized;
}

async function applyManualAdjustment(job, values = {}) {
  const adjustmentValues = normalizeAdjustmentValues(values);
  const sourcePath = job.alignedModelPath || job.cleanedMeshPath || "";
  const adjustedModelPath = path.join(getJobAdjustmentDir(job), "adjusted.glb");
  const warnings = [];

  try {
    await fs.mkdir(path.dirname(adjustedModelPath), { recursive: true });
    await fs.copyFile(sourcePath, adjustedModelPath);
    // TODO: Apply real GLB transform matrix to nodes when a GLB scene editing layer is added.
    warnings.push("Manual adjustment сохранён как metadata; GLB transform будет применяться real-ready exporter layer.");
    return {
      adjustmentApplied: true,
      adjustmentValues,
      adjustedModelPath,
      adjustmentWarnings: warnings
    };
  } catch (err) {
    return {
      adjustmentApplied: false,
      adjustmentValues,
      adjustedModelPath: sourcePath,
      adjustmentWarnings: ["Manual adjustment не удалось применить; используется aligned/cleaned GLB.", err.message]
    };
  }
}

function skipManualAdjustment(job) {
  return {
    adjustmentApplied: false,
    adjustmentValues: normalizeAdjustmentValues(job.adjustmentValues),
    adjustedModelPath: "",
    adjustmentWarnings: ["Manual adjustment пропущен пользователем; требуется ручная проверка перед измерениями."]
  };
}

module.exports = {
  DEFAULT_ADJUSTMENT_VALUES,
  normalizeAdjustmentValues,
  applyManualAdjustment,
  skipManualAdjustment
};
