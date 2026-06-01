const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const { STATUSES } = require("./constants");
const { getMutableJob, saveJob } = require("./store");

function getArtifactPath(jobId) {
  return path.resolve(__dirname, "../tmp/jobs", jobId, "mesh", "cleaned-model.glb");
}

function getPublicArtifactUrl(jobId) {
  return `/api/reconstruction/artifacts/${encodeURIComponent(jobId)}/mesh/cleaned-model.glb`;
}

function collectWarnings(job) {
  return Array.from(new Set([
    ...(job.warnings || []),
    ...(job.frameQualityReport?.warnings || []),
    ...(job.segmentationWarnings || []),
    ...(job.reconstructionWarnings || []),
    ...(job.cleanupWarnings || [])
  ].filter(Boolean)));
}

function getResultChecks(job) {
  const artifactPath = getArtifactPath(job.jobId);
  const glbExists = Boolean(job.resultGlbUrl) && fsSync.existsSync(artifactPath);
  const exists = job.status === STATUSES.ready && !job.resultDeleted;
  const canOpen = exists && glbExists && Boolean(job.resultGlbUrl);
  const expiredOrMissing = job.resultDeleted || (job.status === STATUSES.ready && !glbExists);
  return {
    exists,
    glbExists,
    canOpen,
    invalid: job.status === STATUSES.ready && !canOpen && !expiredOrMissing,
    expiredOrMissing
  };
}

function buildResultObject(job) {
  const checks = getResultChecks(job);
  return {
    jobId: job.jobId,
    resultGlbUrl: checks.canOpen ? job.resultGlbUrl : "",
    rawMeshPath: job.rawMeshPath ? "raw-model.glb" : "",
    cleanedMeshPath: checks.glbExists ? getPublicArtifactUrl(job.jobId) : "",
    createdAt: job.updatedAt || job.createdAt,
    inputType: job.fileType || "unknown",
    filesCount: (job.files || []).length,
    selectedFramesCount: job.selectedFramesCount || 0,
    reconstructionQuality: job.reconstructionQuality || "poor",
    cleanupQuality: job.cleanupQuality || "poor",
    warnings: collectWarnings(job),
    metadata: {
      resultModelSource: job.resultModelSource || "mock",
      cleanupMode: job.cleanupMode || "mock",
      reconstructionMode: job.reconstructionMode || "mock",
      engineName: job.engineName || "",
      engineJobId: job.engineJobId || "",
      masksCount: job.masksCount || 0,
      inputFramesCount: job.inputFramesCount || 0,
      inputMasksCount: job.inputMasksCount || 0,
      removedArtifactsCount: job.removedArtifactsCount || 0,
      holesRepairedCount: job.holesRepairedCount || 0,
      decimationRatio: job.decimationRatio || 1
    },
    checks
  };
}

function getReconstructionResult(jobId) {
  const job = getMutableJob(jobId);
  if (!job) return null;
  return buildResultObject(job);
}

function buildReconstructionReport(jobId) {
  const job = getMutableJob(jobId);
  if (!job) return null;
  const result = buildResultObject(job);
  return {
    jobId: job.jobId,
    generatedAt: new Date().toISOString(),
    inputSummary: {
      inputType: job.fileType || "unknown",
      filesCount: (job.files || []).length,
      files: (job.files || []).map(file => ({
        name: file.name,
        size: file.size,
        mimetype: file.mimetype,
        extension: file.extension
      }))
    },
    frameQualityReport: job.frameQualityReport || null,
    segmentationReport: {
      segmentationMode: job.segmentationMode || "mock",
      masksCount: job.masksCount || 0,
      segmentationQuality: job.segmentationQuality || "poor",
      warnings: job.segmentationWarnings || []
    },
    reconstructionReport: {
      reconstructionMode: job.reconstructionMode || "mock",
      engineName: job.engineName || "",
      engineJobId: job.engineJobId || "",
      inputFramesCount: job.inputFramesCount || 0,
      inputMasksCount: job.inputMasksCount || 0,
      rawMeshPath: job.rawMeshPath ? "raw-model.glb" : "",
      reconstructionQuality: job.reconstructionQuality || "poor",
      warnings: job.reconstructionWarnings || []
    },
    cleanupReport: {
      cleanupMode: job.cleanupMode || "mock",
      cleanupQuality: job.cleanupQuality || "poor",
      resultModelSource: job.resultModelSource || "mock",
      removedArtifactsCount: job.removedArtifactsCount || 0,
      holesRepairedCount: job.holesRepairedCount || 0,
      decimationRatio: job.decimationRatio || 1,
      cleanedMeshPath: result.cleanedMeshPath,
      warnings: job.cleanupWarnings || []
    },
    finalResult: result,
    warnings: result.warnings
  };
}

async function deleteReconstructionResult(jobId) {
  const job = getMutableJob(jobId);
  if (!job) return null;
  const meshDir = path.resolve(__dirname, "../tmp/jobs", jobId, "mesh");
  await fs.rm(meshDir, { recursive: true, force: true });
  job.resultDeleted = true;
  job.resultGlbUrl = "";
  job.publicCleanedMeshUrl = "";
  job.cleanedMeshPath = "";
  job.resultModelSource = "deleted";
  job.warnings = collectWarnings(job);
  saveJob(job);
  return buildResultObject(job);
}

module.exports = {
  buildResultObject,
  getReconstructionResult,
  buildReconstructionReport,
  deleteReconstructionResult,
  getArtifactPath,
  getPublicArtifactUrl
};
