const crypto = require("crypto");
const { STATUSES } = require("./constants");
const { normalizeReconstructionSettings } = require("./settings");

const uploads = new Map();
const jobs = new Map();

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  if (crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}

function cloneJob(job) {
  if (!job) return null;
  const { framesDir, masksDir, inputMeshPath, cleanedMeshPath, datasetPath, rawMeshPath, ...safeJob } = job;
  return {
    ...safeJob,
    cleanedMeshPath: job.publicCleanedMeshUrl || "",
    rawMeshPath: job.rawMeshPath ? "raw-model.glb" : "",
    selectedFrames: (job.selectedFrames || []).map(frame => ({ ...frame })),
    files: job.files.map(file => {
      const { path, ...safeFile } = file;
      return { ...safeFile };
    })
  };
}

function cloneUpload(upload) {
  if (!upload) return null;
  return {
    uploadId: upload.uploadId,
    files: upload.files.map(file => {
      const { path, ...safeFile } = file;
      return { ...safeFile };
    }),
    fileType: upload.fileType
  };
}

function createUpload(files, fileType) {
  const upload = {
    uploadId: makeId("upload"),
    files,
    fileType,
    createdAt: nowIso()
  };
  uploads.set(upload.uploadId, upload);
  return cloneUpload(upload);
}

function getUpload(uploadId) {
  return uploads.get(uploadId) || null;
}

function createJob(upload, settings = {}) {
  const timestamp = nowIso();
  const job = {
    jobId: makeId("recon"),
    files: upload.files.map(file => ({ ...file })),
    fileType: upload.fileType,
    settings: normalizeReconstructionSettings(settings),
    status: STATUSES.uploaded,
    progress: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    errorMessage: "",
    resultGlbUrl: "",
    extractedFramesCount: 0,
    videoMetadata: null,
    warnings: [],
    framesDir: "",
    frameQualityReport: null,
    selectedFrames: [],
    selectedFramesCount: 0,
    rejectedFramesCount: 0,
    segmentationMode: "mock",
    masksCount: 0,
    masksDir: "",
    segmentationWarnings: [],
    segmentationQuality: "poor",
    reconstructionMode: "mock",
    engineName: "",
    engineJobId: "",
    datasetPath: "",
    inputFramesCount: 0,
    inputMasksCount: 0,
    rawMeshPath: "",
    reconstructionWarnings: [],
    reconstructionQuality: "poor",
    cleanupMode: "mock",
    inputMeshPath: "",
    cleanedMeshPath: "",
    publicCleanedMeshUrl: "",
    removedArtifactsCount: 0,
    holesRepairedCount: 0,
    decimationRatio: 1,
    cleanupWarnings: [],
    cleanupQuality: "poor",
    resultModelSource: "mock",
    resultDeleted: false,
    readinessScore: 0,
    readinessLevel: "poor",
    canOpenInViewer: false,
    canUseForVisualization: false,
    canUseForMeasurements: false,
    readinessWarnings: [],
    readinessMetadata: null
  };
  jobs.set(job.jobId, job);
  return cloneJob(job);
}

function getMutableJob(jobId) {
  return jobs.get(jobId) || null;
}

function getJob(jobId) {
  return cloneJob(jobs.get(jobId));
}

function listMutableJobs() {
  return Array.from(jobs.values());
}

function listJobs() {
  return listMutableJobs().map(cloneJob);
}

function saveJob(job) {
  job.updatedAt = nowIso();
  jobs.set(job.jobId, job);
  return cloneJob(job);
}

function deleteJob(jobId) {
  const job = jobs.get(jobId) || null;
  if (!job) return null;
  jobs.delete(jobId);
  return job;
}

module.exports = {
  nowIso,
  createUpload,
  getUpload,
  createJob,
  getMutableJob,
  getJob,
  listMutableJobs,
  listJobs,
  saveJob,
  deleteJob
};
