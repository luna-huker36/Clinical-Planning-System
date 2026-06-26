const { ERROR_CODES } = require("./constants");
const { ApiError } = require("./errors");

const DEFAULT_RECONSTRUCTION_SETTINGS = Object.freeze({
  processingMode: "balanced",
  inputTypePreference: "auto",
  maxFrames: 40,
  frameExtractionRate: 1,
  cleanupStrength: "medium",
  targetModelQuality: "preview",
  saveIntermediateFiles: false,
  realHeightMm: null
});

const REAL_HEIGHT_MM_RANGE = Object.freeze({ min: 50, max: 3000 });

const ALLOWED = Object.freeze({
  processingMode: new Set(["fast", "balanced", "quality"]),
  inputTypePreference: new Set(["auto", "photos", "video"]),
  maxFrames: new Set([20, 40, 60]),
  frameExtractionRate: new Set([0.5, 1, 2]),
  cleanupStrength: new Set(["low", "medium", "high"]),
  targetModelQuality: new Set(["preview", "planning"])
});

function normalizeBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function normalizeRealHeightMm(value) {
  if (value === null || value === undefined || value === "") return DEFAULT_RECONSTRUCTION_SETTINGS.realHeightMm;
  return Number(value);
}

function normalizeReconstructionSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  return {
    processingMode: source.processingMode || DEFAULT_RECONSTRUCTION_SETTINGS.processingMode,
    inputTypePreference: source.inputTypePreference || DEFAULT_RECONSTRUCTION_SETTINGS.inputTypePreference,
    maxFrames: Number(source.maxFrames ?? DEFAULT_RECONSTRUCTION_SETTINGS.maxFrames),
    frameExtractionRate: Number(source.frameExtractionRate ?? DEFAULT_RECONSTRUCTION_SETTINGS.frameExtractionRate),
    cleanupStrength: source.cleanupStrength || DEFAULT_RECONSTRUCTION_SETTINGS.cleanupStrength,
    targetModelQuality: source.targetModelQuality || DEFAULT_RECONSTRUCTION_SETTINGS.targetModelQuality,
    saveIntermediateFiles: normalizeBoolean(
      source.saveIntermediateFiles,
      DEFAULT_RECONSTRUCTION_SETTINGS.saveIntermediateFiles
    ),
    realHeightMm: normalizeRealHeightMm(source.realHeightMm)
  };
}

function validateReconstructionSettings(settings = {}) {
  const normalized = normalizeReconstructionSettings(settings);
  const errors = [];

  if (!ALLOWED.processingMode.has(normalized.processingMode)) errors.push("processingMode must be fast, balanced, or quality.");
  if (!ALLOWED.inputTypePreference.has(normalized.inputTypePreference)) errors.push("inputTypePreference must be auto, photos, or video.");
  if (!ALLOWED.maxFrames.has(normalized.maxFrames)) errors.push("maxFrames must be 20, 40, or 60.");
  if (!ALLOWED.frameExtractionRate.has(normalized.frameExtractionRate)) errors.push("frameExtractionRate must be 0.5, 1, or 2.");
  if (!ALLOWED.cleanupStrength.has(normalized.cleanupStrength)) errors.push("cleanupStrength must be low, medium, or high.");
  if (!ALLOWED.targetModelQuality.has(normalized.targetModelQuality)) errors.push("targetModelQuality must be preview or planning.");
  if (typeof normalized.saveIntermediateFiles !== "boolean") errors.push("saveIntermediateFiles must be boolean.");
  if (normalized.realHeightMm !== null &&
    (!Number.isFinite(normalized.realHeightMm) ||
      normalized.realHeightMm < REAL_HEIGHT_MM_RANGE.min ||
      normalized.realHeightMm > REAL_HEIGHT_MM_RANGE.max)) {
    errors.push(`realHeightMm must be null or a number between ${REAL_HEIGHT_MM_RANGE.min} and ${REAL_HEIGHT_MM_RANGE.max}.`);
  }

  return {
    ok: errors.length === 0,
    errors,
    settings: normalized
  };
}

function assertValidReconstructionSettings(settings = {}) {
  const validation = validateReconstructionSettings(settings);
  if (!validation.ok) {
    throw new ApiError(400, ERROR_CODES.validationFailed, validation.errors.join(" "));
  }
  return validation.settings;
}

module.exports = {
  DEFAULT_RECONSTRUCTION_SETTINGS,
  normalizeReconstructionSettings,
  validateReconstructionSettings,
  assertValidReconstructionSettings
};
