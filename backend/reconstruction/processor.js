const fs = require("fs");
const path = require("path");
const { MOCK_GLB_URL, STATUSES, ERROR_CODES } = require("./constants");
const { ApiError } = require("./errors");
const { getMutableJob, getJob, saveJob } = require("./store");
const { preprocessVideoInputs } = require("./video-preprocessing");
const {
  analyzeFramesQuality,
  selectBestFrames
} = require("./frame-quality-analysis");
const { generateSegmentationMasks } = require("./head-segmentation");
const { runMockMeshCleanup } = require("./mesh-cleanup");
const { runMockReconstruction } = require("./reconstruction-engine");
const { convertJobRawMeshToGlb } = require("./mesh-conversion");
const { alignModelForPmas } = require("./model-alignment");
const { applyManualAdjustment, skipManualAdjustment } = require("./manual-adjustment");
const { normalizeReconstructionSettings } = require("./settings");

const activeJobs = new Map();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ensureJob(jobId) {
  const job = getMutableJob(jobId);
  if (!job) throw new ApiError(404, ERROR_CODES.jobNotFound, "Reconstruction job не найден.");
  return job;
}

function setJobProgress(jobId, status, progress) {
  const job = ensureJob(jobId);
  if (job.status === STATUSES.canceled) return getJob(jobId);
  job.status = status;
  job.progress = Math.max(0, Math.min(100, Number(progress) || 0));
  if (status !== STATUSES.error) job.errorMessage = "";
  return saveJob(job);
}

function failJob(jobId, message) {
  const job = ensureJob(jobId);
  if (job.status === STATUSES.canceled) return getJob(jobId);
  job.status = STATUSES.error;
  job.errorMessage = message || "Reconstruction backend job failed.";
  job.resultGlbUrl = "";
  return saveJob(job);
}

function cancelJob(jobId, reason = "Canceled by user") {
  const job = ensureJob(jobId);
  job.status = STATUSES.canceled;
  job.errorMessage = reason;
  job.resultGlbUrl = "";
  saveJob(job);
  // The activeJobs entry is intentionally kept: the in-flight processJob
  // promise is still running and removes itself in its finally block.
  // Deleting it here would let startJob restart the same job while the old
  // run is alive, and the two runs would corrupt each other's state.
  return getJob(jobId);
}

function hasVideoInput(job) {
  return (job.files || []).some(file => ["mp4", "mov", "webm"].includes(String(file.extension || "").toLowerCase()));
}

function isImageFile(file) {
  return ["jpg", "jpeg", "png"].includes(String(file.extension || "").toLowerCase());
}

function mergeWarnings(...warningGroups) {
  return Array.from(new Set(warningGroups.flat().filter(Boolean)));
}

function getSelectedFramesForSegmentation(job) {
  return (job.selectedFrames || []).map(frame => ({ ...frame }));
}

function frameKey(frame) {
  return String(frame?.fileName || frame?.name || "").trim();
}

function maskKey(mask) {
  return String(mask?.frameName || "").trim();
}

function applyReviewSelection(job, selectedFrameNames = []) {
  const requested = new Set(Array.from(selectedFrameNames || []).map(String).filter(Boolean));
  const originalSelected = Array.from(job.selectedFrames || []);
  const originalRejected = Array.from(job.rejectedFrames || []);
  const allFrames = [...originalSelected, ...originalRejected];
  const defaultSelection = requested.size
    ? requested
    : new Set(originalSelected.map(frameKey).filter(Boolean));
  const finalSelectedFrames = allFrames.filter(frame => defaultSelection.has(frameKey(frame)));
  const originalSelectedKeys = new Set(originalSelected.map(frameKey).filter(Boolean));
  const originalRejectedKeys = new Set(originalRejected.map(frameKey).filter(Boolean));
  const finalSelectedKeys = new Set(finalSelectedFrames.map(frameKey).filter(Boolean));
  const finalSelectedMasks = Array.from(job.segmentationMasks || []).filter(mask => finalSelectedKeys.has(maskKey(mask)));

  job.selectedFrames = finalSelectedFrames;
  job.selectedFramesCount = finalSelectedFrames.length;
  job.rejectedFrames = allFrames.filter(frame => !finalSelectedKeys.has(frameKey(frame)));
  job.rejectedFramesCount = job.rejectedFrames.length;
  job.finalSelectedFrames = finalSelectedFrames;
  job.finalSelectedMasks = finalSelectedMasks;
  job.finalSelectedFramesCount = finalSelectedFrames.length;
  job.manuallyExcludedFramesCount = Array.from(originalSelectedKeys).filter(key => !finalSelectedKeys.has(key)).length;
  job.manuallyRestoredFramesCount = Array.from(originalRejectedKeys).filter(key => finalSelectedKeys.has(key)).length;
  job.reviewedByUser = true;
  job.reviewCompletedAt = new Date().toISOString();
  job.reviewRequired = true;
}

async function collectFramePaths(job) {
  if (hasVideoInput(job) && job.framesDir) {
    try {
      const files = await fs.promises.readdir(job.framesDir);
      return files
        .filter(fileName => /\.(jpe?g|png)$/i.test(fileName))
        .map(fileName => path.join(job.framesDir, fileName));
    } catch (err) {
      return [];
    }
  }

  return (job.files || [])
    .filter(file => isImageFile(file) && file.path)
    .map(file => file.path);
}

async function analyzeJobFrames(jobId) {
  const job = ensureJob(jobId);
  const settings = normalizeReconstructionSettings(job.settings);
  const framePaths = await collectFramePaths(job);
  if (!framePaths.length) {
    return {
      frameQualityReport: {
        totalFrames: 0,
        selectedFramesCount: 0,
        rejectedFramesCount: 0,
        averageBlurScore: 0,
        averageBrightness: 0,
        averageContrast: 0,
        qualityScore: 0,
        warnings: ["Недостаточно качественных кадров"],
        frames: []
      },
      selectedFrames: [],
      selectedFramesCount: 0,
      rejectedFramesCount: 0,
      warnings: ["Недостаточно качественных кадров"]
    };
  }

  try {
    const analysis = await analyzeFramesQuality(framePaths);
    const selected = selectBestFrames(analysis, { maxFrames: settings.maxFrames });
    const rejectedFrames = selected.frameQualityReport.frames
      .filter(frame => frame.rejected)
      .map(frame => {
        const analyzed = analysis.find(item => item.fileName === frame.fileName) || frame;
        return {
          fileName: frame.fileName,
          framePath: analyzed.framePath || "",
          qualityScore: frame.qualityScore,
          blurScore: frame.blurScore,
          brightness: frame.brightness,
          contrast: frame.contrast,
          width: frame.width,
          height: frame.height,
          rejectionReason: frame.rejectionReason
        };
      });
    return {
      frameQualityReport: selected.frameQualityReport,
      selectedFrames: selected.selectedFrames,
      rejectedFrames,
      selectedFramesCount: selected.frameQualityReport.selectedFramesCount,
      rejectedFramesCount: selected.frameQualityReport.rejectedFramesCount,
      warnings: selected.frameQualityReport.warnings
    };
  } catch (err) {
    return {
      frameQualityReport: {
        totalFrames: framePaths.length,
        selectedFramesCount: 0,
        rejectedFramesCount: framePaths.length,
        averageBlurScore: 0,
        averageBrightness: 0,
        averageContrast: 0,
        qualityScore: 0,
        warnings: ["Frame quality analysis unavailable"],
        frames: []
      },
      selectedFrames: [],
      rejectedFrames: [],
      selectedFramesCount: 0,
      rejectedFramesCount: framePaths.length,
      warnings: ["Frame quality analysis unavailable"]
    };
  }
}

async function cleanupIntermediateArtifacts(jobId) {
  const job = ensureJob(jobId);
  const settings = normalizeReconstructionSettings(job.settings);
  if (settings.saveIntermediateFiles) return;

  const dirs = [
    job.framesDir,
    job.masksDir,
    job.datasetPath,
    job.outputGlbPath ? path.dirname(job.outputGlbPath) : "",
    job.rawMeshPath ? path.dirname(job.rawMeshPath) : ""
  ].filter(Boolean);

  await Promise.all(dirs.map(dir => fs.promises.rm(dir, { recursive: true, force: true }).catch(() => null)));
  const currentJob = ensureJob(jobId);
  currentJob.framesDir = "";
  currentJob.masksDir = "";
  currentJob.datasetPath = "";
  currentJob.rawMeshPath = "";
  saveJob(currentJob);
}

async function segmentJobHead(jobId) {
  const job = ensureJob(jobId);
  const selectedFrames = getSelectedFramesForSegmentation(job);
  const masksDir = path.resolve(__dirname, "../tmp/jobs", job.jobId, "masks");

  if (!selectedFrames.length) {
      return {
        segmentationMode: "mock",
        masksCount: 0,
        successfulMasksCount: 0,
        failedMasksCount: 0,
        averageMaskCoverage: 0,
        segmentationMasks: [],
        masksDir,
        segmentationWarnings: [
          "Не удалось уверенно выделить голову на части кадров",
          "Фон может попасть в 3D-реконструкцию",
          "Часть головы может быть обрезана",
          "Маска нестабильна на некоторых кадрах",
          "Проверьте освещение и контраст с фоном",
          "Волосы/плечи могут создать шум в mesh",
          "Нужна проверка масок перед reconstruction"
        ],
      segmentationQuality: "poor"
    };
  }

  try {
    return await generateSegmentationMasks(selectedFrames, { masksDir, mode: "person_segmentation" });
  } catch (err) {
    return {
      segmentationMode: "mock",
      masksCount: 0,
      successfulMasksCount: 0,
      failedMasksCount: selectedFrames.length,
      averageMaskCoverage: 0,
      segmentationMasks: [],
      masksDir,
      segmentationWarnings: [
        "Не удалось уверенно выделить голову на части кадров",
        "Фон может попасть в 3D-реконструкцию",
        "Часть головы может быть обрезана",
        "Маска нестабильна на некоторых кадрах",
        "Проверьте освещение и контраст с фоном",
        "Волосы/плечи могут создать шум в mesh",
        "Нужна проверка масок перед reconstruction"
      ],
      segmentationQuality: "poor"
    };
  }
}

function isCanceled(jobId) {
  return ensureJob(jobId).status === STATUSES.canceled;
}

async function rampJob(jobId, status, from, to, steps, delayMs) {
  if (isCanceled(jobId)) return getJob(jobId);
  setJobProgress(jobId, status, from);
  for (let i = 1; i <= steps; i += 1) {
    if (isCanceled(jobId)) return getJob(jobId);
    await sleep(delayMs);
    if (isCanceled(jobId)) return getJob(jobId);
    setJobProgress(jobId, status, Math.round(from + ((to - from) * i) / steps));
  }
  return getJob(jobId);
}

function completeWithMockGlb(jobId) {
  const job = ensureJob(jobId);
  const resultGlbUrl = job.publicCleanedMeshUrl || job.resultGlbUrl;
  if (!resultGlbUrl) {
    return failJob(jobId, "Cleaned GLB-модель не готова.");
  }
  if (job.status === STATUSES.canceled) return getJob(jobId);
  job.status = STATUSES.ready;
  job.progress = 100;
  job.errorMessage = "";
  job.resultGlbUrl = resultGlbUrl;
  return saveJob(job);
}

async function finalizeJobAfterAdjustment(jobId) {
  await rampJob(jobId, STATUSES.exporting, 94, 96, 3, 120);
  if (isCanceled(jobId)) return getJob(jobId);
  const completed = completeWithMockGlb(jobId);
  if (!isCanceled(jobId)) await cleanupIntermediateArtifacts(jobId);
  return getJob(jobId) || completed;
}

function shouldPauseForManualAdjustment(alignment) {
  return !alignment.alignmentSuccess ||
    alignment.alignmentMode === "manual_fallback" ||
    (alignment.alignmentWarnings || []).length > 0;
}

async function processJob(jobId, phase = "analysis") {
  try {
    const settings = normalizeReconstructionSettings(ensureJob(jobId).settings);
    if (phase !== "reconstruction") {
    setJobProgress(jobId, STATUSES.validating, 5);
    await sleep(180);
    if (isCanceled(jobId)) return getJob(jobId);
    setJobProgress(jobId, STATUSES.validating, 15);

    setJobProgress(jobId, STATUSES.analyzing, 18);
    // TODO: Add blur detection for uploaded photos and extracted video frames.
    await sleep(220);
    if (isCanceled(jobId)) return getJob(jobId);
    setJobProgress(jobId, STATUSES.analyzing, 28);

    setJobProgress(jobId, STATUSES.preparing, 30);
    // TODO: Add head segmentation before reconstruction input is sent to the engine.
    await sleep(260);
    if (isCanceled(jobId)) return getJob(jobId);
    setJobProgress(jobId, STATUSES.preparing, 35);

    const mutableJob = ensureJob(jobId);
    if (hasVideoInput(mutableJob)) {
      setJobProgress(jobId, STATUSES.extractingFrames, 35);
      await sleep(250);
      if (isCanceled(jobId)) return getJob(jobId);
      // Video frames are prepared here for the future photogrammetry input set.
      const videoPreprocessing = await preprocessVideoInputs(mutableJob, {
        frameExtractionRate: settings.frameExtractionRate,
        maxFrames: settings.maxFrames
      });
      if (isCanceled(jobId)) return getJob(jobId);
      const currentJob = ensureJob(jobId);
      currentJob.extractedFramesCount = videoPreprocessing.extractedFramesCount;
      currentJob.videoMetadata = videoPreprocessing.videoMetadata;
      currentJob.warnings = videoPreprocessing.warnings;
      currentJob.framesDir = videoPreprocessing.framesDir;
      saveJob(currentJob);
      setJobProgress(jobId, STATUSES.extractingFrames, 45);
      await sleep(250);
      if (isCanceled(jobId)) return getJob(jobId);
    }

    setJobProgress(jobId, STATUSES.analyzingFrames, 45);
    await sleep(180);
    if (isCanceled(jobId)) return getJob(jobId);
    const frameQuality = await analyzeJobFrames(jobId);
    if (isCanceled(jobId)) return getJob(jobId);
    const jobWithQuality = ensureJob(jobId);
    jobWithQuality.frameQualityReport = frameQuality.frameQualityReport;
    jobWithQuality.selectedFrames = frameQuality.selectedFrames;
    jobWithQuality.rejectedFrames = frameQuality.rejectedFrames;
    jobWithQuality.selectedFramesCount = frameQuality.selectedFramesCount;
    jobWithQuality.rejectedFramesCount = frameQuality.rejectedFramesCount;
    jobWithQuality.warnings = mergeWarnings(jobWithQuality.warnings || [], frameQuality.warnings);
    saveJob(jobWithQuality);
    setJobProgress(jobId, STATUSES.analyzingFrames, 55);
    await sleep(220);
    if (isCanceled(jobId)) return getJob(jobId);

    setJobProgress(jobId, STATUSES.segmentingHead, 55);
    await sleep(180);
    if (isCanceled(jobId)) return getJob(jobId);
    const segmentation = await segmentJobHead(jobId);
    if (isCanceled(jobId)) return getJob(jobId);
    const jobWithSegmentation = ensureJob(jobId);
    jobWithSegmentation.segmentationMode = segmentation.segmentationMode;
    jobWithSegmentation.masksCount = segmentation.masksCount;
    jobWithSegmentation.successfulMasksCount = segmentation.successfulMasksCount;
    jobWithSegmentation.failedMasksCount = segmentation.failedMasksCount;
    jobWithSegmentation.averageMaskCoverage = segmentation.averageMaskCoverage;
    jobWithSegmentation.segmentationMasks = segmentation.segmentationMasks || segmentation.masks || [];
    jobWithSegmentation.masksDir = segmentation.masksDir;
    jobWithSegmentation.segmentationWarnings = segmentation.segmentationWarnings;
    jobWithSegmentation.segmentationQuality = segmentation.segmentationQuality;
    jobWithSegmentation.warnings = mergeWarnings(jobWithSegmentation.warnings || [], segmentation.segmentationWarnings);
    saveJob(jobWithSegmentation);
    setJobProgress(jobId, STATUSES.segmentingHead, 65);
    await sleep(220);
    if (isCanceled(jobId)) return getJob(jobId);

    const reviewJob = ensureJob(jobId);
    reviewJob.status = STATUSES.reviewRequired;
    reviewJob.progress = 65;
    reviewJob.reviewRequired = true;
    reviewJob.reviewedByUser = false;
    reviewJob.finalSelectedFrames = [];
    reviewJob.finalSelectedMasks = [];
    reviewJob.finalSelectedFramesCount = 0;
    reviewJob.manuallyExcludedFramesCount = 0;
    reviewJob.manuallyRestoredFramesCount = 0;
    saveJob(reviewJob);
    return getJob(jobId);
    }

    setJobProgress(jobId, STATUSES.queued, 65);
    await sleep(260);
    if (isCanceled(jobId)) return getJob(jobId);
    setJobProgress(jobId, STATUSES.queued, 70);

    setJobProgress(jobId, STATUSES.reconstructing3d, 70);
    await sleep(180);
    if (isCanceled(jobId)) return getJob(jobId);
    const reconstruction = await runMockReconstruction(ensureJob(jobId), {
      settings,
      onProgress: fraction => {
        // Never throw from inside the engine: the job may have been canceled
        // or deleted mid-run — in that case just stop reporting progress.
        const liveJob = getMutableJob(jobId);
        if (liveJob && liveJob.status !== STATUSES.canceled) {
          setJobProgress(jobId, STATUSES.reconstructing3d, 70 + Math.round(fraction * 11));
        }
      }
    });
    if (isCanceled(jobId)) return getJob(jobId);
    const jobWithReconstruction = ensureJob(jobId);
    jobWithReconstruction.reconstructionMode = reconstruction.reconstructionMode;
    jobWithReconstruction.engineMode = reconstruction.engineMode;
    jobWithReconstruction.engineCommand = reconstruction.engineCommand;
    jobWithReconstruction.engineExitCode = reconstruction.engineExitCode;
    jobWithReconstruction.engineStdout = reconstruction.engineStdout;
    jobWithReconstruction.engineStderr = reconstruction.engineStderr;
    jobWithReconstruction.engineName = reconstruction.engineName;
    jobWithReconstruction.engineJobId = reconstruction.engineJobId;
    jobWithReconstruction.datasetPath = reconstruction.datasetPath;
    jobWithReconstruction.inputFramesCount = reconstruction.inputFramesCount;
    jobWithReconstruction.inputMasksCount = reconstruction.inputMasksCount;
    jobWithReconstruction.rawMeshPath = reconstruction.rawMeshPath;
    jobWithReconstruction.reconstructionWarnings = reconstruction.reconstructionWarnings;
    jobWithReconstruction.reconstructionQuality = reconstruction.reconstructionQuality;
    jobWithReconstruction.reconstructionStats = reconstruction.reconstructionStats || null;
    jobWithReconstruction.warnings = mergeWarnings(jobWithReconstruction.warnings || [], reconstruction.reconstructionWarnings);
    saveJob(jobWithReconstruction);

    const conversion = await convertJobRawMeshToGlb(ensureJob(jobId));
    if (isCanceled(jobId)) return getJob(jobId);
    const jobWithConversion = ensureJob(jobId);
    jobWithConversion.inputMeshFormat = conversion.inputMeshFormat;
    jobWithConversion.conversionMode = conversion.conversionMode;
    jobWithConversion.conversionSuccess = conversion.conversionSuccess;
    jobWithConversion.outputGlbPath = conversion.outputGlbPath;
    jobWithConversion.conversionWarnings = conversion.conversionWarnings;
    jobWithConversion.warnings = mergeWarnings(jobWithConversion.warnings || [], conversion.conversionWarnings);
    saveJob(jobWithConversion);
    setJobProgress(jobId, STATUSES.reconstructing3d, 82);
    await sleep(220);
    if (isCanceled(jobId)) return getJob(jobId);

    setJobProgress(jobId, STATUSES.cleaningMesh, 82);
    await sleep(160);
    if (isCanceled(jobId)) return getJob(jobId);
    const cleanup = await runMockMeshCleanup(ensureJob(jobId), {
      cleanupStrength: settings.cleanupStrength,
      inputMeshPath: ensureJob(jobId).outputGlbPath || ensureJob(jobId).rawMeshPath
    });
    if (isCanceled(jobId)) return getJob(jobId);
    const jobWithCleanup = ensureJob(jobId);
    jobWithCleanup.cleanupMode = cleanup.cleanupMode;
    jobWithCleanup.inputMeshPath = cleanup.inputMeshPath;
    jobWithCleanup.cleanedMeshPath = cleanup.cleanedMeshPath;
    jobWithCleanup.publicCleanedMeshUrl = cleanup.publicCleanedMeshUrl;
    jobWithCleanup.removedComponentsCount = cleanup.removedComponentsCount;
    jobWithCleanup.removedArtifactsCount = cleanup.removedArtifactsCount;
    jobWithCleanup.holesRepairedCount = cleanup.holesRepairedCount;
    jobWithCleanup.decimationRatio = cleanup.decimationRatio;
    jobWithCleanup.cleanupSuccess = cleanup.cleanupSuccess;
    jobWithCleanup.cleanupWarnings = cleanup.cleanupWarnings;
    jobWithCleanup.cleanupQuality = cleanup.cleanupQuality;
    jobWithCleanup.resultModelSource = cleanup.resultModelSource;
    jobWithCleanup.warnings = mergeWarnings(jobWithCleanup.warnings || [], cleanup.cleanupWarnings);
    saveJob(jobWithCleanup);
    setJobProgress(jobId, STATUSES.cleaningMesh, 90);
    await sleep(220);
    if (isCanceled(jobId)) return getJob(jobId);

    setJobProgress(jobId, STATUSES.aligningModel, 90);
    await sleep(160);
    if (isCanceled(jobId)) return getJob(jobId);
    const alignment = await alignModelForPmas(ensureJob(jobId), {
      inputMeshPath: ensureJob(jobId).cleanedMeshPath
    });
    if (isCanceled(jobId)) return getJob(jobId);
    const jobWithAlignment = ensureJob(jobId);
    jobWithAlignment.alignmentMode = alignment.alignmentMode;
    jobWithAlignment.boundingBox = alignment.boundingBox;
    jobWithAlignment.scaleFactor = alignment.scaleFactor;
    jobWithAlignment.centerOffset = alignment.centerOffset;
    jobWithAlignment.modelCentered = alignment.modelCentered;
    jobWithAlignment.scaleNormalized = alignment.scaleNormalized;
    jobWithAlignment.orientationStatus = alignment.orientationStatus;
    jobWithAlignment.alignedModelPath = alignment.alignedModelPath;
    jobWithAlignment.alignmentWarnings = alignment.alignmentWarnings;
    jobWithAlignment.alignmentSuccess = alignment.alignmentSuccess;
    jobWithAlignment.resultGlbUrl = alignment.alignedModelPath ? jobWithAlignment.publicCleanedMeshUrl : cleanup.publicCleanedMeshUrl;
    jobWithAlignment.warnings = mergeWarnings(jobWithAlignment.warnings || [], alignment.alignmentWarnings);
    saveJob(jobWithAlignment);
    setJobProgress(jobId, STATUSES.aligningModel, 94);
    await sleep(160);
    if (isCanceled(jobId)) return getJob(jobId);

    if (shouldPauseForManualAdjustment(alignment)) {
      const manualJob = ensureJob(jobId);
      manualJob.status = STATUSES.manualAdjustmentRequired;
      manualJob.progress = 94;
      manualJob.adjustmentWarnings = mergeWarnings(manualJob.adjustmentWarnings || [], [
        "Manual adjustment required before final export."
      ]);
      manualJob.warnings = mergeWarnings(manualJob.warnings || [], manualJob.adjustmentWarnings);
      saveJob(manualJob);
      return getJob(jobId);
    }

    return await finalizeJobAfterAdjustment(jobId);
  } catch (err) {
    if (!getMutableJob(jobId)) return null;
    return failJob(jobId, err.message);
  } finally {
    activeJobs.delete(jobId);
  }
}

function startJob(jobId) {
  const job = ensureJob(jobId);
  if (activeJobs.has(jobId)) {
    throw new ApiError(409, ERROR_CODES.jobInvalidState, "Reconstruction job уже выполняется.");
  }
  if (job.status === STATUSES.ready) {
    throw new ApiError(409, ERROR_CODES.jobInvalidState, "Reconstruction job уже готов.");
  }

  job.status = STATUSES.uploaded;
  job.progress = 0;
  job.errorMessage = "";
  job.resultGlbUrl = "";
  job.extractedFramesCount = 0;
  job.videoMetadata = null;
  job.warnings = [];
  job.framesDir = "";
  job.frameQualityReport = null;
  job.selectedFrames = [];
  job.rejectedFrames = [];
  job.selectedFramesCount = 0;
  job.rejectedFramesCount = 0;
  job.reviewRequired = true;
  job.reviewedByUser = false;
  job.reviewCompletedAt = "";
  job.finalSelectedFrames = [];
  job.finalSelectedMasks = [];
  job.finalSelectedFramesCount = 0;
  job.manuallyExcludedFramesCount = 0;
  job.manuallyRestoredFramesCount = 0;
  job.segmentationMode = "mock";
  job.masksCount = 0;
  job.successfulMasksCount = 0;
  job.failedMasksCount = 0;
  job.averageMaskCoverage = 0;
  job.segmentationMasks = [];
  job.masksDir = "";
  job.segmentationWarnings = [];
  job.segmentationQuality = "poor";
  job.reconstructionMode = "mock";
  job.engineMode = "mock";
  job.engineCommand = "";
  job.engineExitCode = null;
  job.engineStdout = "";
  job.engineStderr = "";
  job.engineName = "";
  job.engineJobId = "";
  job.datasetPath = "";
  job.inputFramesCount = 0;
  job.inputMasksCount = 0;
  job.rawMeshPath = "";
  job.reconstructionWarnings = [];
  job.reconstructionQuality = "poor";
  job.reconstructionStats = null;
  job.inputMeshFormat = "";
  job.conversionMode = "mock";
  job.conversionSuccess = false;
  job.outputGlbPath = "";
  job.conversionWarnings = [];
  job.cleanupMode = "mock";
  job.inputMeshPath = "";
  job.cleanedMeshPath = "";
  job.publicCleanedMeshUrl = "";
  job.removedComponentsCount = 0;
  job.removedArtifactsCount = 0;
  job.holesRepairedCount = 0;
  job.decimationRatio = 1;
  job.cleanupSuccess = false;
  job.cleanupWarnings = [];
  job.cleanupQuality = "poor";
  job.alignmentMode = "mock";
  job.boundingBox = null;
  job.scaleFactor = 1;
  job.centerOffset = [0, 0, 0];
  job.modelCentered = false;
  job.scaleNormalized = false;
  job.orientationStatus = "";
  job.alignedModelPath = "";
  job.alignmentWarnings = [];
  job.alignmentSuccess = false;
  job.adjustmentApplied = false;
  job.adjustmentValues = {
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    positionX: 0,
    positionY: 0,
    positionZ: 0,
    scale: 1
  };
  job.adjustedModelPath = "";
  job.adjustmentWarnings = [];
  job.resultModelSource = "mock";
  job.resultDeleted = false;
  saveJob(job);

  const promise = processJob(jobId, "analysis");
  activeJobs.set(jobId, promise);
  return getJob(jobId);
}

function approveReviewAndContinue(jobId, review = {}) {
  const job = ensureJob(jobId);
  if (job.status !== STATUSES.reviewRequired) {
    throw new ApiError(409, ERROR_CODES.jobInvalidState, "Review stage сейчас не активен.");
  }
  if (activeJobs.has(jobId)) {
    throw new ApiError(409, ERROR_CODES.jobInvalidState, "Reconstruction job уже выполняется.");
  }

  applyReviewSelection(job, review.selectedFrameNames || review.selectedFrames || []);
  if (!job.finalSelectedFramesCount) {
    throw new ApiError(400, ERROR_CODES.validationFailed, "Нужно выбрать хотя бы один кадр перед reconstruction.");
  }
  saveJob(job);
  const promise = processJob(jobId, "reconstruction");
  activeJobs.set(jobId, promise);
  return getJob(jobId);
}

async function applyManualAdjustmentToJob(jobId, values = {}) {
  const job = ensureJob(jobId);
  if (job.status !== STATUSES.manualAdjustmentRequired) {
    throw new ApiError(409, ERROR_CODES.jobInvalidState, "Manual adjustment сейчас не требуется.");
  }
  const adjustment = await applyManualAdjustment(job, values);
  const currentJob = ensureJob(jobId);
  currentJob.adjustmentApplied = adjustment.adjustmentApplied;
  currentJob.adjustmentValues = adjustment.adjustmentValues;
  currentJob.adjustedModelPath = adjustment.adjustedModelPath;
  currentJob.adjustmentWarnings = adjustment.adjustmentWarnings;
  currentJob.resultGlbUrl = currentJob.publicCleanedMeshUrl;
  currentJob.warnings = mergeWarnings(currentJob.warnings || [], adjustment.adjustmentWarnings);
  saveJob(currentJob);
  return await finalizeJobAfterAdjustment(jobId);
}

async function skipManualAdjustmentForJob(jobId) {
  const job = ensureJob(jobId);
  if (job.status !== STATUSES.manualAdjustmentRequired) {
    throw new ApiError(409, ERROR_CODES.jobInvalidState, "Manual adjustment сейчас не требуется.");
  }
  const adjustment = skipManualAdjustment(job);
  job.adjustmentApplied = adjustment.adjustmentApplied;
  job.adjustmentValues = adjustment.adjustmentValues;
  job.adjustedModelPath = adjustment.adjustedModelPath;
  job.adjustmentWarnings = adjustment.adjustmentWarnings;
  job.resultGlbUrl = job.publicCleanedMeshUrl;
  job.warnings = mergeWarnings(job.warnings || [], adjustment.adjustmentWarnings);
  saveJob(job);
  return await finalizeJobAfterAdjustment(jobId);
}

module.exports = {
  startJob,
  cancelJob,
  approveReviewAndContinue,
  applyManualAdjustmentToJob,
  skipManualAdjustmentForJob
};
