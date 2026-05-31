const fs = require("fs");
const path = require("path");
const { MOCK_GLB_URL, STATUSES, ERROR_CODES } = require("./constants");
const { ApiError } = require("./errors");
const { getMutableJob, getJob, saveJob } = require("./store");
const { preprocessVideoInputs } = require("./video-preprocessing");

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
  const mockGlbPath = path.resolve(__dirname, "../../models/LeePerrySmith.glb");
  if (!fs.existsSync(mockGlbPath)) {
    return failJob(jobId, "Тестовая GLB-модель не найдена.");
  }

  const job = ensureJob(jobId);
  if (job.status === STATUSES.canceled) return getJob(jobId);
  job.status = STATUSES.ready;
  job.progress = 100;
  job.errorMessage = "";
  job.resultGlbUrl = MOCK_GLB_URL;
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

    setJobProgress(jobId, STATUSES.queued, 45);
    await sleep(260);
    if (isCanceled(jobId)) return getJob(jobId);
    setJobProgress(jobId, STATUSES.queued, 50);

    // TODO: Replace mock processing with photogrammetry / 3D reconstruction engine.
    await rampJob(jobId, STATUSES.processing, 50, 70, 6, 140);
    if (isCanceled(jobId)) return getJob(jobId);

    // TODO: Run mesh cleanup after reconstruction produces raw geometry.
    await rampJob(jobId, STATUSES.cleaning, 70, 82, 4, 130);
    if (isCanceled(jobId)) return getJob(jobId);

    // TODO: Export the cleaned mesh as GLB and store the generated artifact URL.
    await rampJob(jobId, STATUSES.exporting, 82, 95, 5, 120);
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
  saveJob(job);

  const promise = processJob(jobId);
  activeJobs.set(jobId, promise);
  return getJob(jobId);
}

module.exports = {
  startJob,
  cancelJob
};
