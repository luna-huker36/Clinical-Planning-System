const fs = require("fs/promises");
const path = require("path");
const jpeg = require("jpeg-js");
const { PNG } = require("pngjs");

const MAX_SELECTED_FRAMES = 60;
const MIN_GOOD_FRAMES = 15;
const BLUR_THRESHOLD = 8;
const MIN_BRIGHTNESS = 45;
const MAX_BRIGHTNESS = 215;
const MIN_CONTRAST = 18;

function getExtension(filePath) {
  return path.extname(String(filePath || "")).replace(".", "").toLowerCase();
}

function decodeImage(buffer, extension) {
  if (extension === "jpg" || extension === "jpeg") {
    const decoded = jpeg.decode(buffer, { useTArray: true });
    return { width: decoded.width, height: decoded.height, data: decoded.data };
  }
  if (extension === "png") {
    const decoded = PNG.sync.read(buffer);
    return { width: decoded.width, height: decoded.height, data: decoded.data };
  }
  throw new Error("Unsupported frame image format.");
}

function luminanceAt(data, index) {
  return (0.299 * data[index]) + (0.587 * data[index + 1]) + (0.114 * data[index + 2]);
}

function analyzePixels(decoded) {
  const { width, height, data } = decoded;
  const pixelCount = width * height;
  let sum = 0;
  let sumSq = 0;
  const luminance = new Float32Array(pixelCount);

  for (let i = 0; i < pixelCount; i += 1) {
    const value = luminanceAt(data, i * 4);
    luminance[i] = value;
    sum += value;
    sumSq += value * value;
  }

  const brightness = sum / pixelCount;
  const contrast = Math.sqrt(Math.max(0, (sumSq / pixelCount) - (brightness * brightness)));
  let laplacianEnergy = 0;
  let laplacianSamples = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      const laplacian =
        (4 * luminance[idx]) -
        luminance[idx - 1] -
        luminance[idx + 1] -
        luminance[idx - width] -
        luminance[idx + width];
      laplacianEnergy += laplacian * laplacian;
      laplacianSamples += 1;
    }
  }

  return {
    blurScore: laplacianSamples ? Math.sqrt(laplacianEnergy / laplacianSamples) : 0,
    brightness,
    contrast
  };
}

function getRejectionReason(result) {
  if (!result.isReadable) return "corrupted_or_unreadable";
  if (result.blurScore < BLUR_THRESHOLD) return "blur";
  if (result.brightness < MIN_BRIGHTNESS || result.brightness > MAX_BRIGHTNESS) return "brightness";
  if (result.contrast < MIN_CONTRAST) return "contrast";
  return "";
}

function calculateQualityScore(result) {
  if (!result.isReadable) return 0;
  const blurScore = Math.min(1, result.blurScore / 160);
  const brightnessDistance = Math.abs(result.brightness - 128) / 128;
  const brightnessScore = Math.max(0, 1 - brightnessDistance);
  const contrastScore = Math.min(1, result.contrast / 70);
  return Math.round(((blurScore * 0.45) + (brightnessScore * 0.25) + (contrastScore * 0.30)) * 100);
}

async function analyzeFrameQuality(framePath) {
  const fileName = path.basename(framePath || "");
  try {
    const buffer = await fs.readFile(framePath);
    const extension = getExtension(framePath);
    const decoded = decodeImage(buffer, extension);
    const metrics = analyzePixels(decoded);
    const baseResult = {
      fileName,
      framePath,
      width: decoded.width,
      height: decoded.height,
      fileSize: buffer.length,
      isReadable: true,
      blurScore: Number(metrics.blurScore.toFixed(2)),
      brightness: Number(metrics.brightness.toFixed(2)),
      contrast: Number(metrics.contrast.toFixed(2)),
      selected: false,
      rejected: false,
      rejectionReason: ""
    };
    const rejectionReason = getRejectionReason(baseResult);
    const qualityScore = calculateQualityScore(baseResult);
    return {
      ...baseResult,
      qualityScore,
      selected: !rejectionReason,
      rejected: Boolean(rejectionReason),
      rejectionReason
    };
  } catch (err) {
    return {
      fileName,
      framePath,
      width: null,
      height: null,
      fileSize: 0,
      isReadable: false,
      blurScore: 0,
      brightness: 0,
      contrast: 0,
      qualityScore: 0,
      selected: false,
      rejected: true,
      rejectionReason: "corrupted_or_unreadable",
      errorMessage: "Frame unreadable or corrupted."
    };
  }
}

async function analyzeFramesQuality(framePaths) {
  const paths = Array.from(framePaths || []);
  const results = [];
  for (const framePath of paths) {
    results.push(await analyzeFrameQuality(framePath));
  }
  return results;
}

function average(values) {
  const usable = values.filter(value => Number.isFinite(value));
  if (!usable.length) return 0;
  return Number((usable.reduce((sum, value) => sum + value, 0) / usable.length).toFixed(2));
}

function buildWarnings(results, selectedFrames) {
  const warnings = [];
  const readable = results.filter(result => result.isReadable);
  const blurry = readable.filter(result => result.rejectionReason === "blur").length;
  const badLight = readable.filter(result => result.rejectionReason === "brightness").length;
  const lowContrast = readable.filter(result => result.rejectionReason === "contrast").length;

  if (readable.length && blurry / readable.length > 0.35) warnings.push("Слишком много размытых кадров");
  if (selectedFrames.length < MIN_GOOD_FRAMES) warnings.push("Недостаточно качественных кадров");
  if (readable.length && badLight / readable.length > 0.30) warnings.push("Плохое освещение");
  if (readable.length && lowContrast / readable.length > 0.30) warnings.push("Низкий контраст");
  return warnings;
}

function selectBestFrames(frameAnalysisResults, options = {}) {
  const maxFrames = options.maxFrames || MAX_SELECTED_FRAMES;
  const results = Array.from(frameAnalysisResults || []);
  const eligible = results
    .filter(result => result.isReadable && !getRejectionReason(result))
    .sort((left, right) => right.qualityScore - left.qualityScore)
    .slice(0, maxFrames);
  const selectedNames = new Set(eligible.map(result => result.fileName));

  const normalizedResults = results.map(result => {
    const selected = selectedNames.has(result.fileName);
    const rejectionReason = selected ? "" : (result.rejectionReason || getRejectionReason(result) || "not_selected");
    return {
      ...result,
      selected,
      rejected: !selected,
      rejectionReason
    };
  });

  const selectedFrames = normalizedResults
    .filter(result => result.selected)
    .map(result => ({
      fileName: result.fileName,
      framePath: result.framePath,
      qualityScore: result.qualityScore,
      blurScore: result.blurScore,
      brightness: result.brightness,
      contrast: result.contrast,
      width: result.width,
      height: result.height
    }));
  const rejectedFramesCount = normalizedResults.length - selectedFrames.length;
  const report = {
    totalFrames: normalizedResults.length,
    selectedFramesCount: selectedFrames.length,
    rejectedFramesCount,
    averageBlurScore: average(normalizedResults.map(result => result.blurScore)),
    averageBrightness: average(normalizedResults.map(result => result.brightness)),
    averageContrast: average(normalizedResults.map(result => result.contrast)),
    qualityScore: average(selectedFrames.map(result => result.qualityScore)),
    warnings: buildWarnings(normalizedResults, selectedFrames),
    frames: normalizedResults.map(result => ({
      fileName: result.fileName,
      isReadable: result.isReadable,
      selected: result.selected,
      rejected: result.rejected,
      rejectionReason: result.rejectionReason,
      qualityScore: result.qualityScore,
      blurScore: result.blurScore,
      brightness: result.brightness,
      contrast: result.contrast,
      width: result.width,
      height: result.height,
      fileSize: result.fileSize
    }))
  };

  return {
    selectedFrames,
    frameQualityReport: report
  };
}

module.exports = {
  analyzeFrameQuality,
  analyzeFramesQuality,
  selectBestFrames
};
