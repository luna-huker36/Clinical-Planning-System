const fs = require("fs/promises");
const path = require("path");
const { PNG } = require("pngjs");

const SEGMENTATION_MODE = "mock";
const FALLBACK_MASK_SIZE = 512;
const BASE_SEGMENTATION_WARNINGS = [
  "Фон может попасть в reconstruction",
  "Волосы/плечи могут создать шум в mesh",
  "Нужна проверка масок перед reconstruction"
];

function makeMaskFileName(index) {
  return `mask-${String(index + 1).padStart(4, "0")}.png`;
}

function resolveMaskSize(frame) {
  const width = Number(frame?.width) || FALLBACK_MASK_SIZE;
  const height = Number(frame?.height) || FALLBACK_MASK_SIZE;
  return {
    width: Math.max(64, Math.min(2048, Math.round(width))),
    height: Math.max(64, Math.min(2048, Math.round(height)))
  };
}

async function writeMockHeadMask(frame, maskPath) {
  const { width, height } = resolveMaskSize(frame);
  const png = new PNG({ width, height, colorType: 6 });
  const centerX = width / 2;
  const headCenterY = height * 0.42;
  const headRadiusX = width * 0.24;
  const headRadiusY = height * 0.30;
  const neckLeft = width * 0.38;
  const neckRight = width * 0.62;
  const neckTop = height * 0.58;
  const neckBottom = height * 0.82;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) << 2;
      const headValue = (((x - centerX) ** 2) / (headRadiusX ** 2)) +
        (((y - headCenterY) ** 2) / (headRadiusY ** 2));
      const inHead = headValue <= 1;
      const inNeck = x >= neckLeft && x <= neckRight && y >= neckTop && y <= neckBottom;
      const value = inHead || inNeck ? 255 : 0;
      png.data[idx] = value;
      png.data[idx + 1] = value;
      png.data[idx + 2] = value;
      png.data[idx + 3] = 255;
    }
  }

  await fs.mkdir(path.dirname(maskPath), { recursive: true });
  await fs.writeFile(maskPath, PNG.sync.write(png));
  return { width, height };
}

async function segmentHeadOnFrame(frame, options = {}) {
  const mode = options.mode || SEGMENTATION_MODE;
  const maskPath = options.maskPath;

  // TODO: Replace mock masks with MediaPipe Selfie Segmentation.
  // TODO: Add face parsing model support for face/hair/neck classes.
  // TODO: Add head/neck segmentation and remove background before reconstruction.
  // TODO: Add hair handling and mask refinement before mesh cleanup.
  if (mode === "real-ready") {
    // Real segmentation engine will be connected here. Until then, fall back to mock masks.
  }

  const dimensions = await writeMockHeadMask(frame, maskPath);
  return {
    frameName: frame.fileName || "",
    maskName: path.basename(maskPath),
    width: dimensions.width,
    height: dimensions.height,
    mode: SEGMENTATION_MODE,
    confidence: 0.55,
    warning: "Нужна проверка масок перед reconstruction"
  };
}

async function segmentHeadOnFrames(frames, options = {}) {
  const frameArray = Array.from(frames || []);
  const masksDir = options.masksDir;
  const masks = [];

  for (let index = 0; index < frameArray.length; index += 1) {
    const maskPath = path.join(masksDir, makeMaskFileName(index));
    masks.push(await segmentHeadOnFrame(frameArray[index], { ...options, maskPath }));
  }

  return masks;
}

function getSegmentationQuality(masksCount) {
  if (masksCount >= 20) return "good";
  if (masksCount >= 10) return "medium";
  return "poor";
}

function validateSegmentationMasks(masks) {
  const maskArray = Array.from(masks || []);
  const warnings = [...BASE_SEGMENTATION_WARNINGS];
  if (maskArray.length < 10) {
    warnings.unshift("Не удалось уверенно выделить голову на части кадров");
  }

  return {
    ok: maskArray.length > 0,
    masksCount: maskArray.length,
    segmentationQuality: getSegmentationQuality(maskArray.length),
    warnings: Array.from(new Set(warnings))
  };
}

async function generateSegmentationMasks(selectedFrames, options = {}) {
  const masksDir = options.masksDir;
  await fs.mkdir(masksDir, { recursive: true });
  const masks = await segmentHeadOnFrames(selectedFrames, { masksDir, mode: options.mode || SEGMENTATION_MODE });
  const validation = validateSegmentationMasks(masks);

  return {
    segmentationMode: SEGMENTATION_MODE,
    masks,
    masksCount: validation.masksCount,
    masksDir,
    segmentationWarnings: validation.warnings,
    segmentationQuality: validation.segmentationQuality
  };
}

module.exports = {
  segmentHeadOnFrame,
  segmentHeadOnFrames,
  generateSegmentationMasks,
  validateSegmentationMasks
};
