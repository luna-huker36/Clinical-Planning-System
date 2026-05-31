const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { MAX_FILE_BYTES, ERROR_CODES, STATUSES } = require("./constants");
const { ApiError, sendError } = require("./errors");
const { validateUploadedFiles, toSafeFileMeta } = require("./validation");
const { createUpload, getUpload, createJob, getJob } = require("./store");
const { startJob, cancelJob } = require("./processor");

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

  const job = createJob(uploadResult);
  res.json(job);
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
  if (job.status !== STATUSES.ready || !job.resultGlbUrl) {
    throw new ApiError(409, ERROR_CODES.resultNotReady, "Reconstruction result ещё не готов.");
  }
  res.json({
    jobId: job.jobId,
    resultGlbUrl: job.resultGlbUrl,
    job
  });
}));

router.post("/jobs/:jobId/cancel", asyncRoute(async (req, res) => {
  const job = cancelJob(req.params.jobId, "Canceled by user");
  res.json(job);
}));

module.exports = router;
