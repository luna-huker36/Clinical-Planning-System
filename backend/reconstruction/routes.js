const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { MAX_FILE_BYTES, ERROR_CODES, STATUSES } = require("./constants");
const { ApiError, sendError } = require("./errors");
const { validateUploadedFiles, toSafeFileMeta } = require("./validation");
const { createUpload, getUpload, createJob, getJob, getMutableJob, deleteJob } = require("./store");
const { startJob, cancelJob } = require("./processor");
const { assertValidReconstructionSettings } = require("./settings");
const {
  listReconstructionHistory,
  getReconstructionResult,
  buildReconstructionReport,
  deleteReconstructionResult,
  getArtifactPath
} = require("./reconstruction-results");

const router = express.Router();
const uploadDir = path.resolve(__dirname, "../tmp/uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
      const safeName = `${Date.now()}-${Math.random().toString(16).slice(2)}-${file.originalname}`;
      cb(null, safeName.replace(/[^\w.\-]+/g, "_"));
    }
  }),
  limits: {
    fileSize: MAX_FILE_BYTES
  }
});

function asyncRoute(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch(err => sendError(res, err));
  };
}

router.post("/upload", (req, res) => {
  upload.array("files")(req, res, err => {
    if (err) {
      const message = err.code === "LIMIT_FILE_SIZE"
        ? "Файл превышает лимит 250 MB."
        : "Upload failed.";
      sendError(res, new ApiError(400, ERROR_CODES.uploadFailed, message));
      return;
    }

    try {
      const validation = validateUploadedFiles(req.files || []);
      const files = (req.files || []).map(toSafeFileMeta);
      const uploadResult = createUpload(files, validation.fileType);
      res.json(uploadResult);
    } catch (validationErr) {
      sendError(res, validationErr);
    }
  });
});

router.post("/jobs", asyncRoute(async (req, res) => {
  const uploadId = req.body?.uploadId;
  const uploadResult = getUpload(uploadId);
  if (!uploadResult) {
    throw new ApiError(404, ERROR_CODES.uploadNotFound, "Upload result не найден.");
  }

  const settings = assertValidReconstructionSettings(req.body?.settings || {});
  const job = createJob(uploadResult, settings);
  res.json(job);
}));

router.get("/jobs", asyncRoute(async (req, res) => {
  res.json({
    jobs: listReconstructionHistory(req.query?.status || "all")
  });
}));

router.get("/jobs/:jobId", asyncRoute(async (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) throw new ApiError(404, ERROR_CODES.jobNotFound, "Reconstruction job не найден.");
  res.json(job);
}));

router.delete("/jobs/:jobId", asyncRoute(async (req, res) => {
  const job = getMutableJob(req.params.jobId);
  if (!job) throw new ApiError(404, ERROR_CODES.jobNotFound, "Reconstruction job не найден.");

  if ([
    STATUSES.validating,
    STATUSES.analyzing,
    STATUSES.preparing,
    STATUSES.extractingFrames,
    STATUSES.analyzingFrames,
    STATUSES.segmentingHead,
    STATUSES.queued,
    STATUSES.reconstructing3d,
    STATUSES.cleaningMesh,
    STATUSES.exporting
  ].includes(job.status)) {
    cancelJob(req.params.jobId, "Deleted by user");
  }

  const deletedJob = deleteJob(req.params.jobId);
  const jobDir = path.resolve(__dirname, "../tmp/jobs", req.params.jobId);
  await fs.promises.rm(jobDir, { recursive: true, force: true });
  await Promise.all((deletedJob.files || [])
    .map(file => file.path)
    .filter(Boolean)
    .map(filePath => fs.promises.rm(filePath, { force: true }).catch(() => null)));

  res.json({
    deleted: true,
    jobId: req.params.jobId
  });
}));

router.post("/jobs/:jobId/start", asyncRoute(async (req, res) => {
  const job = startJob(req.params.jobId);
  res.json(job);
}));

router.get("/jobs/:jobId/status", asyncRoute(async (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) throw new ApiError(404, ERROR_CODES.jobNotFound, "Reconstruction job не найден.");
  res.json(job);
}));

router.get("/jobs/:jobId/result", asyncRoute(async (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) throw new ApiError(404, ERROR_CODES.jobNotFound, "Reconstruction job не найден.");
  if (job.status !== STATUSES.ready) {
    throw new ApiError(409, ERROR_CODES.resultNotReady, "Reconstruction result ещё не готов.");
  }
  res.json(getReconstructionResult(req.params.jobId));
}));

router.get("/jobs/:jobId/report", asyncRoute(async (req, res) => {
  const report = buildReconstructionReport(req.params.jobId);
  if (!report) throw new ApiError(404, ERROR_CODES.jobNotFound, "Reconstruction job не найден.");
  res.json(report);
}));

router.delete("/jobs/:jobId/result", asyncRoute(async (req, res) => {
  const result = await deleteReconstructionResult(req.params.jobId);
  if (!result) throw new ApiError(404, ERROR_CODES.jobNotFound, "Reconstruction job не найден.");
  res.json({
    deleted: true,
    result
  });
}));

router.post("/jobs/:jobId/cancel", asyncRoute(async (req, res) => {
  const job = cancelJob(req.params.jobId, "Canceled by user");
  res.json(job);
}));

router.get("/artifacts/:jobId/mesh/cleaned-model.glb", asyncRoute(async (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job || !job.cleanedMeshPath) {
    throw new ApiError(404, ERROR_CODES.resultNotReady, "Cleaned mesh artifact не найден.");
  }

  const artifactPath = getArtifactPath(req.params.jobId);
  if (!fs.existsSync(artifactPath)) {
    throw new ApiError(404, ERROR_CODES.resultNotReady, "Cleaned mesh artifact не найден.");
  }
  res.type("model/gltf-binary");
  res.sendFile(artifactPath);
}));

module.exports = router;
