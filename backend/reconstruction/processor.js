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
  activeJobs.delete(jobId);
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
    const selected = selectBestFrames(analysis, { maxFrames: 60 });
    return {
      frameQualityReport: selected.frameQualityReport,
      selectedFrames: selected.selectedFrames,
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
      selectedFramesCount: 0,
      rejectedFramesCount: framePaths.length,
      warnings: ["Frame quality analysis unavailable"]
    };
  }
}

async function segmentJobHead(jobId) {
  const job = ensureJob(jobId);
  const selectedFrames = getSelectedFramesForSegmentation(job);
  const masksDir = path.resolve(__dirname, "../tmp/jobs", job.jobId, "masks");

  if (!selectedFrames.length) {
    return {
      segmentationMode: "mock",
      masksCount: 0,
      masksDir,
      segmentationWarnings: [
        "Не удалось уверенно выделить голову на части кадров",
        "Фон может попасть в reconstruction",
        "Волосы/плечи могут создать шум в mesh",
        "Нужна проверка масок перед reconstruction"
      ],
      segmentationQuality: "poor"
    };
  }

  try {
    return await generateSegmentationMasks(selectedFrames, { masksDir, mode: "mock" });
  } catch (err) {
    return {
      segmentationMode: "mock",
      masksCount: 0,
      masksDir,
      segmentationWarnings: [
        "Не удалось уверенно выделить голову на части кадров",
        "Фон может попасть в reconstruction",
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

async function processJob(jobId) {
  try {
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
      const videoPreprocessing = await preprocessVideoInputs(mutableJob);
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
    jobWithSegmentation.masksDir = segmentation.masksDir;
    jobWithSegmentation.segmentationWarnings = segmentation.segmentationWarnings;
    jobWithSegmentation.segmentationQuality = segmentation.segmentationQuality;
    jobWithSegmentation.warnings = mergeWarnings(jobWithSegmentation.warnings || [], segmentation.segmentationWarnings);
    saveJob(jobWithSegmentation);
    setJobProgress(jobId, STATUSES.segmentingHead, 65);
    await sleep(220);
    if (isCanceled(jobId)) return getJob(jobId);

    setJobProgress(jobId, STATUSES.queued, 65);
    await sleep(260);
    if (isCanceled(jobId)) return getJob(jobId);
    setJobProgress(jobId, STATUSES.queued, 70);

    setJobProgress(jobId, STATUSES.reconstructing3d, 70);
    await sleep(180);
    if (isCanceled(jobId)) return getJob(jobId);
    const reconstruction = await runMockReconstruction(ensureJob(jobId));
    if (isCanceled(jobId)) return getJob(jobId);
    const jobWithReconstruction = ensureJob(jobId);
    jobWithReconstruction.reconstructionMode = reconstruction.reconstructionMode;
    jobWithReconstruction.engineName = reconstruction.engineName;
    jobWithReconstruction.engineJobId = reconstruction.engineJobId;
    jobWithReconstruction.datasetPath = reconstruction.datasetPath;
    jobWithReconstruction.inputFramesCount = reconstruction.inputFramesCount;
    jobWithReconstruction.inputMasksCount = reconstruction.inputMasksCount;
    jobWithReconstruction.rawMeshPath = reconstruction.rawMeshPath;
    jobWithReconstruction.reconstructionWarnings = reconstruction.reconstructionWarnings;
    jobWithReconstruction.reconstructionQuality = reconstruction.reconstructionQuality;
    jobWithReconstruction.warnings = mergeWarnings(jobWithReconstruction.warnings || [], reconstruction.reconstructionWarnings);
    saveJob(jobWithReconstruction);
    setJobProgress(jobId, STATUSES.reconstructing3d, 82);
    await sleep(220);
    if (isCanceled(jobId)) return getJob(jobId);

    setJobProgress(jobId, STATUSES.cleaningMesh, 82);
    await sleep(160);
    if (isCanceled(jobId)) return getJob(jobId);
    const cleanup = await runMockMeshCleanup(ensureJob(jobId));
    if (isCanceled(jobId)) return getJob(jobId);
    const jobWithCleanup = ensureJob(jobId);
    jobWithCleanup.cleanupMode = cleanup.cleanupMode;
    jobWithCleanup.inputMeshPath = cleanup.inputMeshPath;
    jobWithCleanup.cleanedMeshPath = cleanup.cleanedMeshPath;
    jobWithCleanup.publicCleanedMeshUrl = cleanup.publicCleanedMeshUrl;
    jobWithCleanup.removedArtifactsCount = cleanup.removedArtifactsCount;
    jobWithCleanup.holesRepairedCount = cleanup.holesRepairedCount;
    jobWithCleanup.decimationRatio = cleanup.decimationRatio;
    jobWithCleanup.cleanupWarnings = cleanup.cleanupWarnings;
    jobWithCleanup.cleanupQuality = cleanup.cleanupQuality;
    jobWithCleanup.resultModelSource = cleanup.resultModelSource;
    jobWithCleanup.resultGlbUrl = cleanup.publicCleanedMeshUrl;
    jobWithCleanup.warnings = mergeWarnings(jobWithCleanup.warnings || [], cleanup.cleanupWarnings);
    saveJob(jobWithCleanup);
    setJobProgress(jobId, STATUSES.cleaningMesh, 90);
    await sleep(220);
    if (isCanceled(jobId)) return getJob(jobId);

    // Cleaned mesh has already been exported by the mesh cleanup stage.
    await rampJob(jobId, STATUSES.exporting, 90, 96, 5, 120);
    if (isCanceled(jobId)) return getJob(jobId);

    return completeWithMockGlb(jobId);
  } catch (err) {
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
  job.selectedFramesCount = 0;
  job.rejectedFramesCount = 0;
  job.segmentationMode = "mock";
  job.masksCount = 0;
  job.masksDir = "";
  job.segmentationWarnings = [];
  job.segmentationQuality = "poor";
  job.reconstructionMode = "mock";
  job.engineName = "";
  job.engineJobId = "";
  job.datasetPath = "";
  job.inputFramesCount = 0;
  job.inputMasksCount = 0;
  job.rawMeshPath = "";
  job.reconstructionWarnings = [];
  job.reconstructionQuality = "poor";
  job.cleanupMode = "mock";
  job.inputMeshPath = "";
  job.cleanedMeshPath = "";
  job.publicCleanedMeshUrl = "";
  job.removedArtifactsCount = 0;
  job.holesRepairedCount = 0;
  job.decimationRatio = 1;
  job.cleanupWarnings = [];
  job.cleanupQuality = "poor";
  job.resultModelSource = "mock";
  job.resultDeleted = false;
  saveJob(job);

  const promise = processJob(jobId);
  activeJobs.set(jobId, promise);
  return getJob(jobId);
}

module.exports = {
  startJob,
  cancelJob
};
