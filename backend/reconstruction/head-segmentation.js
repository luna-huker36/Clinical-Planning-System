const fs = require("fs/promises");
const path = require("path");
const jpeg = require("jpeg-js");
const { PNG } = require("pngjs");

const SEGMENTATION_MODES = {
  mock: "mock",
  person: "person_segmentation",
  headReady: "head_ready"
};
const FALLBACK_MASK_SIZE = 512;
const BASE_SEGMENTATION_WARNINGS = [
  "Фон может попасть в 3D-реконструкцию",
  "Часть головы может быть обрезана",
  "Маска нестабильна на некоторых кадрах",
  "Проверьте освещение и контраст с фоном"
];

let bodyPixRuntimePromise = null;

function makeMaskFileName(index) {
  return `mask-${String(index + 1).padStart(4, "0")}.png`;
}

function getExtension(filePath) {
  return path.extname(String(filePath || "")).replace(".", "").toLowerCase();
}

function resolveMaskSize(frame) {
  const width = Number(frame?.width) || FALLBACK_MASK_SIZE;
  const height = Number(frame?.height) || FALLBACK_MASK_SIZE;
  return {
    width: Math.max(64, Math.min(2048, Math.round(width))),
    height: Math.max(64, Math.min(2048, Math.round(height)))
  };
}

function decodeFrameImage(buffer, filePath) {
  const extension = getExtension(filePath);
  if (extension === "jpg" || extension === "jpeg") {
    const decoded = jpeg.decode(buffer, { useTArray: true });
    return { width: decoded.width, height: decoded.height, data: decoded.data };
  }
  if (extension === "png") {
    const decoded = PNG.sync.read(buffer);
    return { width: decoded.width, height: decoded.height, data: decoded.data };
  }
  throw new Error("Unsupported frame image format for segmentation.");
}

async function loadBodyPixRuntime() {
  if (!bodyPixRuntimePromise) {
    bodyPixRuntimePromise = Promise.resolve().then(async () => {
      let tf;
      let bodyPix;
      try {
        tf = require("@tensorflow/tfjs-node");
        bodyPix = require("@tensorflow-models/body-pix");
      } catch (err) {
        return {
          available: false,
          warning: "BodyPix/TensorFlow.js недоступны, segmentation выполнена в mock mode."
        };
      }

      try {
        const model = await bodyPix.load({
          architecture: "MobileNetV1",
          outputStride: 16,
          multiplier: 0.75,
          quantBytes: 2
        });
        return { available: true, tf, model };
      } catch (err) {
        return {
          available: false,
          warning: "BodyPix segmentation не загрузилась, segmentation выполнена в mock mode."
        };
      }
    });
  }
  return bodyPixRuntimePromise;
}

function createEmptyMask(width, height) {
  return new PNG({ width, height, colorType: 6 });
}

function setMaskPixel(png, pixelIndex, value) {
  const idx = pixelIndex << 2;
  png.data[idx] = value;
  png.data[idx + 1] = value;
  png.data[idx + 2] = value;
  png.data[idx + 3] = 255;
}

async function writeMockHeadMask(frame, maskPath) {
  const { width, height } = resolveMaskSize(frame);
  const png = createEmptyMask(width, height);
  const centerX = width / 2;
  const headCenterY = height * 0.42;
  const headRadiusX = width * 0.24;
  const headRadiusY = height * 0.30;
  const neckLeft = width * 0.38;
  const neckRight = width * 0.62;
  const neckTop = height * 0.58;
  const neckBottom = height * 0.82;
  let foregroundPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = width * y + x;
      const headValue = (((x - centerX) ** 2) / (headRadiusX ** 2)) +
        (((y - headCenterY) ** 2) / (headRadiusY ** 2));
      const inHead = headValue <= 1;
      const inNeck = x >= neckLeft && x <= neckRight && y >= neckTop && y <= neckBottom;
      const value = inHead || inNeck ? 255 : 0;
      if (value) foregroundPixels += 1;
      setMaskPixel(png, pixelIndex, value);
    }
  }

  await fs.mkdir(path.dirname(maskPath), { recursive: true });
  await fs.writeFile(maskPath, PNG.sync.write(png));
  return {
    width,
    height,
    coverage: Number((foregroundPixels / (width * height)).toFixed(4))
  };
}

async function writePersonMask(frame, maskPath, runtime) {
  if (!frame?.framePath) throw new Error("Frame path is missing for real segmentation.");
  const buffer = await fs.readFile(frame.framePath);
  const decoded = decodeFrameImage(buffer, frame.framePath);
  const { tf, model } = runtime;
  const rgb = new Uint8Array(decoded.width * decoded.height * 3);
  for (let i = 0, j = 0; i < decoded.data.length; i += 4, j += 3) {
    rgb[j] = decoded.data[i];
    rgb[j + 1] = decoded.data[i + 1];
    rgb[j + 2] = decoded.data[i + 2];
  }

  const input = tf.tensor3d(rgb, [decoded.height, decoded.width, 3], "int32");
  let personMask;
  try {
    personMask = await model.segmentPerson(input, {
      flipHorizontal: false,
      internalResolution: "medium",
      segmentationThreshold: 0.7
    });
  } finally {
    input.dispose();
  }

  const png = createEmptyMask(personMask.width, personMask.height);
  let foregroundPixels = 0;
  for (let i = 0; i < personMask.data.length; i += 1) {
    const value = personMask.data[i] ? 255 : 0;
    if (value) foregroundPixels += 1;
    setMaskPixel(png, i, value);
  }

  await fs.mkdir(path.dirname(maskPath), { recursive: true });
  await fs.writeFile(maskPath, PNG.sync.write(png));
  return {
    width: personMask.width,
    height: personMask.height,
    coverage: Number((foregroundPixels / Math.max(1, personMask.data.length)).toFixed(4))
  };
}

async function selectSegmentationMode(requestedMode) {
  if (requestedMode === SEGMENTATION_MODES.mock) {
    return { mode: SEGMENTATION_MODES.mock, runtime: null, warning: "" };
  }

  // TODO: Add MediaPipe Selfie Segmentation as another person segmentation runtime.
  // TODO: Add face parsing model for face/hair/neck classes.
  // TODO: Add head/neck segmentation and remove background before reconstruction.
  // TODO: Add hair handling and mask refinement before mesh cleanup.
  if (requestedMode === SEGMENTATION_MODES.headReady) {
    // head_ready is reserved for a future head-specific model; use person segmentation when available.
  }

  const runtime = await loadBodyPixRuntime();
  if (!runtime.available) {
    return { mode: SEGMENTATION_MODES.mock, runtime: null, warning: runtime.warning };
  }
  return { mode: SEGMENTATION_MODES.person, runtime, warning: "" };
}

async function segmentHeadOnFrame(frame, options = {}) {
  const maskPath = options.maskPath;
  const mode = options.mode || SEGMENTATION_MODES.mock;

  if (mode === SEGMENTATION_MODES.person && options.runtime) {
    try {
      const dimensions = await writePersonMask(frame, maskPath, options.runtime);
      return {
        frameName: frame.fileName || "",
        maskName: path.basename(maskPath),
        maskPath,
        width: dimensions.width,
        height: dimensions.height,
        mode: SEGMENTATION_MODES.person,
        coverage: dimensions.coverage,
        confidence: 0.78,
        success: true,
        warning: ""
      };
    } catch (err) {
      const dimensions = await writeMockHeadMask(frame, maskPath);
      return {
        frameName: frame.fileName || "",
        maskName: path.basename(maskPath),
        maskPath,
        width: dimensions.width,
        height: dimensions.height,
        mode: SEGMENTATION_MODES.mock,
        coverage: dimensions.coverage,
        confidence: 0.45,
        success: false,
        warning: "Маска нестабильна на некоторых кадрах"
      };
    }
  }

  const dimensions = await writeMockHeadMask(frame, maskPath);
  return {
    frameName: frame.fileName || "",
    maskName: path.basename(maskPath),
    maskPath,
    width: dimensions.width,
    height: dimensions.height,
    mode: SEGMENTATION_MODES.mock,
    coverage: dimensions.coverage,
    confidence: 0.55,
    success: true,
    warning: "Нужна проверка масок перед reconstruction"
  };
}

async function segmentHeadOnFrames(frames, options = {}) {
  const frameArray = Array.from(frames || []);
  const masksDir = options.masksDir;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const selectedMode = await selectSegmentationMode(options.mode || SEGMENTATION_MODES.person);
  const masks = [];
  const warnings = selectedMode.warning ? [selectedMode.warning] : [];

  for (let index = 0; index < frameArray.length; index += 1) {
    const maskPath = path.join(masksDir, makeMaskFileName(index));
    const mask = await segmentHeadOnFrame(frameArray[index], {
      ...options,
      maskPath,
      mode: selectedMode.mode,
      runtime: selectedMode.runtime
    });
    if (mask.warning) warnings.push(mask.warning);
    masks.push(mask);
    if (onProgress) onProgress(index + 1, frameArray.length);
    // Mask generation decodes images synchronously: yield so the HTTP server stays responsive.
    await new Promise(resolve => setImmediate(resolve));
  }

  return { masks, mode: selectedMode.mode, warnings };
}

function average(values) {
  const valid = values.map(Number).filter(Number.isFinite);
  if (!valid.length) return 0;
  return Number((valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(4));
}

function getSegmentationQuality({ successfulMasksCount, failedMasksCount, averageMaskCoverage, mode }) {
  if (!successfulMasksCount) return "poor";
  if (mode === SEGMENTATION_MODES.mock && successfulMasksCount < 10) return "poor";
  if (failedMasksCount > successfulMasksCount * 0.35) return "poor";
  if (successfulMasksCount >= 20 && averageMaskCoverage >= 0.08 && averageMaskCoverage <= 0.75) return "good";
  if (successfulMasksCount >= 10 && averageMaskCoverage >= 0.04 && averageMaskCoverage <= 0.85) return "medium";
  return successfulMasksCount >= 5 ? "medium" : "poor";
}

function validateSegmentationMasks(masks, options = {}) {
  const maskArray = Array.from(masks || []);
  const successfulMasksCount = maskArray.filter(mask => mask.success).length;
  const failedMasksCount = maskArray.length - successfulMasksCount;
  const averageMaskCoverage = average(maskArray.filter(mask => mask.success).map(mask => mask.coverage));
  const warnings = [...BASE_SEGMENTATION_WARNINGS, ...(options.warnings || [])];

  if (successfulMasksCount < 10) warnings.unshift("Не удалось уверенно выделить голову на части кадров");
  if (failedMasksCount > 0) warnings.push("Маска нестабильна на некоторых кадрах");
  if (averageMaskCoverage > 0 && averageMaskCoverage < 0.04) warnings.push("Часть головы может быть обрезана");
  if (averageMaskCoverage > 0.85) warnings.push("Фон может попасть в 3D-реконструкцию");

  const metrics = {
    ok: maskArray.length > 0,
    masksCount: maskArray.length,
    successfulMasksCount,
    failedMasksCount,
    averageMaskCoverage,
    segmentationQuality: getSegmentationQuality({
      successfulMasksCount,
      failedMasksCount,
      averageMaskCoverage,
      mode: options.mode || SEGMENTATION_MODES.mock
    }),
    warnings: Array.from(new Set(warnings))
  };

  return metrics;
}

async function generateSegmentationMasks(selectedFrames, options = {}) {
  const masksDir = options.masksDir;
  await fs.mkdir(masksDir, { recursive: true });
  const segmentation = await segmentHeadOnFrames(selectedFrames, {
    masksDir,
    mode: options.mode || SEGMENTATION_MODES.person,
    onProgress: options.onProgress
  });
  const validation = validateSegmentationMasks(segmentation.masks, {
    mode: segmentation.mode,
    warnings: segmentation.warnings
  });

  return {
    segmentationMode: segmentation.mode,
    masks: segmentation.masks,
    segmentationMasks: segmentation.masks,
    masksCount: validation.masksCount,
    successfulMasksCount: validation.successfulMasksCount,
    failedMasksCount: validation.failedMasksCount,
    averageMaskCoverage: validation.averageMaskCoverage,
    masksDir,
    segmentationWarnings: validation.warnings,
    segmentationQuality: validation.segmentationQuality
  };
}

module.exports = {
  SEGMENTATION_MODES,
  segmentHeadOnFrame,
  segmentHeadOnFrames,
  generateSegmentationMasks,
  validateSegmentationMasks
};
