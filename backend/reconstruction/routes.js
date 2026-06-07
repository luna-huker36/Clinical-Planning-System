const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { MAX_FILE_BYTES, ERROR_CODES, STATUSES } = require("./constants");
const { ApiError, sendError } = require("./errors");
const { validateUploadedFiles, toSafeFileMeta } = require("./validation");
const {
  createUpload,
  getUpload,
  createCase,
  getCase,
  listCases,
  deleteCase,
  createJob,
  getJob,
  getMutableJob,
  deleteJob,
  saveMeasurement,
  updateMeasurementLabel,
  deleteMeasurement,
  listMeasurements,
  saveSurgicalPlan,
  listSurgicalPlans,
  saveSimulation,
  listSimulations,
  listCaseTeamMembers,
  saveCaseTeamMember,
  updateCaseTeamMemberRole,
  removeCaseTeamMember,
  saveLandmark,
  deleteLandmark,
  listLandmarks,
  listLandmarkTemplates,
  saveLandmarkTemplate,
  deleteLandmarkTemplate
} = require("./store");
const { startJob, cancelJob, approveReviewAndContinue, applyManualAdjustmentToJob, skipManualAdjustmentForJob } = require("./processor");
const { assertValidReconstructionSettings } = require("./settings");
const {
  listReconstructionHistory,
  getReconstructionResult,
  buildReconstructionReport,
  buildCaseReport,
  buildCaseTimeline,
  deleteReconstructionResult,
  getArtifactPath
} = require("./reconstruction-results");
const {
  createModelComparison,
  listModelComparisons,
  buildComparisonReport
} = require("./model-comparison");

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

router.get("/cases", asyncRoute(async (req, res) => {
  res.json({ cases: listCases() });
}));

router.post("/cases", asyncRoute(async (req, res) => {
  const patientName = String(req.body?.patientName || "").trim();
  if (!patientName) {
    throw new ApiError(400, ERROR_CODES.validationFailed, "patientName is required.");
  }
  res.json(createCase({
    patientName,
    patientId: req.body?.patientId || "",
    notes: req.body?.notes || ""
  }));
}));

router.get("/cases/:caseId", asyncRoute(async (req, res) => {
  const caseItem = getCase(req.params.caseId);
  if (!caseItem) throw new ApiError(404, ERROR_CODES.validationFailed, "Case not found.");
  res.json(caseItem);
}));

router.delete("/cases/:caseId", asyncRoute(async (req, res) => {
  const caseItem = deleteCase(req.params.caseId);
  if (!caseItem) throw new ApiError(404, ERROR_CODES.validationFailed, "Case not found.");
  res.json({ deleted: true, case: caseItem });
}));

router.get("/cases/:caseId/report", asyncRoute(async (req, res) => {
  const report = buildCaseReport(req.params.caseId);
  if (!report) throw new ApiError(404, ERROR_CODES.validationFailed, "Case not found.");
  res.json(report);
}));

router.get("/cases/:caseId/timeline", asyncRoute(async (req, res) => {
  const timeline = buildCaseTimeline(req.params.caseId);
  if (!timeline) throw new ApiError(404, ERROR_CODES.validationFailed, "Case not found.");
  res.json(timeline);
}));

router.get("/cases/:caseId/team", asyncRoute(async (req, res) => {
  const caseItem = getCase(req.params.caseId);
  if (!caseItem) throw new ApiError(404, ERROR_CODES.validationFailed, "Case not found.");
  res.json({
    ownerId: caseItem.ownerId || "",
    permissions: caseItem.permissions || {},
    teamMembers: listCaseTeamMembers(req.params.caseId)
  });
}));

router.post("/cases/:caseId/team", asyncRoute(async (req, res) => {
  if (!getCase(req.params.caseId)) throw new ApiError(404, ERROR_CODES.validationFailed, "Case not found.");
  // TODO: enforce backend auth and permission checks before mutating team membership.
  const member = saveCaseTeamMember(req.params.caseId, req.body || {});
  if (!member) throw new ApiError(400, ERROR_CODES.validationFailed, "Valid team member data is required.");
  res.json(member);
}));

router.patch("/cases/:caseId/team/:memberId", asyncRoute(async (req, res) => {
  if (!getCase(req.params.caseId)) throw new ApiError(404, ERROR_CODES.validationFailed, "Case not found.");
  // TODO: enforce backend auth and owner/admin permission checks.
  const member = updateCaseTeamMemberRole(req.params.caseId, req.params.memberId, req.body?.role || "");
  if (!member) throw new ApiError(404, ERROR_CODES.validationFailed, "Team member not found.");
  res.json(member);
}));

router.delete("/cases/:caseId/team/:memberId", asyncRoute(async (req, res) => {
  if (!getCase(req.params.caseId)) throw new ApiError(404, ERROR_CODES.validationFailed, "Case not found.");
  // TODO: enforce backend auth and owner/admin permission checks.
  const member = removeCaseTeamMember(req.params.caseId, req.params.memberId);
  if (!member) throw new ApiError(404, ERROR_CODES.validationFailed, "Team member not found or owner cannot be removed.");
  res.json({ deleted: true, member });
}));

router.get("/measurements", asyncRoute(async (req, res) => {
  res.json({
    measurements: listMeasurements({
      caseId: req.query?.caseId || "all",
      jobId: req.query?.jobId || "all",
      modelId: req.query?.modelId || "all"
    })
  });
}));

router.post("/measurements", asyncRoute(async (req, res) => {
  const caseId = String(req.body?.caseId || "").trim();
  const jobId = String(req.body?.jobId || "").trim();
  const job = getJob(jobId);
  if (!caseId || !getCase(caseId) || !job || job.caseId !== caseId) {
    throw new ApiError(400, ERROR_CODES.validationFailed, "Measurement must belong to an existing case and reconstruction job.");
  }
  const measurement = saveMeasurement(req.body || {});
  if (!measurement) {
    throw new ApiError(400, ERROR_CODES.validationFailed, "Valid caseId, jobId, modelId, and measurement type are required.");
  }
  res.json(measurement);
}));

router.patch("/measurements/:measurementId", asyncRoute(async (req, res) => {
  const measurement = updateMeasurementLabel(req.params.measurementId, req.body?.label || "");
  if (!measurement) throw new ApiError(404, ERROR_CODES.validationFailed, "Measurement not found.");
  res.json(measurement);
}));

router.delete("/measurements/:measurementId", asyncRoute(async (req, res) => {
  const measurement = deleteMeasurement(req.params.measurementId);
  if (!measurement) throw new ApiError(404, ERROR_CODES.validationFailed, "Measurement not found.");
  res.json({ deleted: true, measurement });
}));

router.get("/landmarks", asyncRoute(async (req, res) => {
  res.json({
    landmarks: listLandmarks({
      caseId: req.query?.caseId || "all",
      jobId: req.query?.jobId || "all",
      modelId: req.query?.modelId || "all"
    })
  });
}));

router.post("/landmarks", asyncRoute(async (req, res) => {
  const caseId = String(req.body?.caseId || "").trim();
  const jobId = String(req.body?.jobId || "").trim();
  const job = getJob(jobId);
  if (!caseId || !getCase(caseId) || !job || job.caseId !== caseId) {
    throw new ApiError(400, ERROR_CODES.validationFailed, "Landmark must belong to an existing case and reconstruction job.");
  }
  const landmark = saveLandmark(req.body || {});
  if (!landmark) {
    throw new ApiError(400, ERROR_CODES.validationFailed, "Valid caseId, jobId, modelId, and position3D are required.");
  }
  res.json(landmark);
}));

router.delete("/landmarks/:landmarkId", asyncRoute(async (req, res) => {
  const landmark = deleteLandmark(req.params.landmarkId);
  if (!landmark) throw new ApiError(404, ERROR_CODES.validationFailed, "Landmark not found.");
  res.json({ deleted: true, landmark });
}));

router.get("/landmark-templates", asyncRoute(async (req, res) => {
  res.json({ templates: listLandmarkTemplates() });
}));

router.post("/landmark-templates", asyncRoute(async (req, res) => {
  const template = saveLandmarkTemplate(req.body || {});
  if (!template) throw new ApiError(400, ERROR_CODES.validationFailed, "Valid landmark template data is required.");
  res.json(template);
}));

router.delete("/landmark-templates/:templateId", asyncRoute(async (req, res) => {
  const template = deleteLandmarkTemplate(req.params.templateId);
  if (!template) throw new ApiError(404, ERROR_CODES.validationFailed, "Only custom landmark templates can be deleted.");
  res.json({ deleted: true, template });
}));

router.get("/surgical-plans", asyncRoute(async (req, res) => {
  res.json({
    plans: listSurgicalPlans({
      caseId: req.query?.caseId || "all",
      jobId: req.query?.jobId || "all",
      modelId: req.query?.modelId || "all"
    })
  });
}));

router.post("/surgical-plans", asyncRoute(async (req, res) => {
  const caseId = String(req.body?.caseId || "").trim();
  const jobId = String(req.body?.jobId || "").trim();
  const job = jobId ? getJob(jobId) : null;
  if (!caseId || !getCase(caseId)) {
    throw new ApiError(400, ERROR_CODES.validationFailed, "Surgical plan must belong to an existing case.");
  }
  if (jobId && (!job || job.caseId !== caseId)) {
    throw new ApiError(400, ERROR_CODES.validationFailed, "Selected model/job must belong to the same case.");
  }
  const plan = saveSurgicalPlan(req.body || {});
  if (!plan) {
    throw new ApiError(400, ERROR_CODES.validationFailed, "Valid caseId is required for surgical plan.");
  }
  res.json(plan);
}));

router.get("/simulations", asyncRoute(async (req, res) => {
  res.json({
    simulations: listSimulations({
      caseId: req.query?.caseId || "all",
      jobId: req.query?.jobId || "all",
      modelId: req.query?.modelId || "all"
    })
  });
}));

router.post("/simulations", asyncRoute(async (req, res) => {
  const caseId = String(req.body?.caseId || "").trim();
  const jobId = String(req.body?.jobId || "").trim();
  const modelId = String(req.body?.modelId || req.body?.originalModelId || "").trim();
  const job = jobId ? getJob(jobId) : null;
  if (!caseId || !getCase(caseId) || !modelId) {
    throw new ApiError(400, ERROR_CODES.validationFailed, "Surgical simulation must belong to an existing case and model.");
  }
  if (jobId && (!job || job.caseId !== caseId)) {
    throw new ApiError(400, ERROR_CODES.validationFailed, "Selected simulation model/job must belong to the same case.");
  }
  const simulation = saveSimulation(req.body || {});
  if (!simulation) {
    throw new ApiError(400, ERROR_CODES.validationFailed, "Valid caseId, modelId, and simulation parameters are required.");
  }
  res.json(simulation);
}));

router.get("/comparisons", asyncRoute(async (req, res) => {
  res.json({ comparisons: listModelComparisons(req.query?.caseId || "all") });
}));

router.post("/comparisons", asyncRoute(async (req, res) => {
  res.json(createModelComparison(req.body || {}));
}));

router.get("/comparisons/:comparisonId/report", asyncRoute(async (req, res) => {
  const report = buildComparisonReport(req.params.comparisonId);
  if (!report) throw new ApiError(404, ERROR_CODES.validationFailed, "Comparison not found.");
  res.json(report);
}));

router.post("/jobs", asyncRoute(async (req, res) => {
  const uploadId = req.body?.uploadId;
  const caseId = String(req.body?.caseId || "").trim();
  const uploadResult = getUpload(uploadId);
  if (!uploadResult) {
    throw new ApiError(404, ERROR_CODES.uploadNotFound, "Upload result не найден.");
  }
  if (!caseId || !getCase(caseId)) {
    throw new ApiError(400, ERROR_CODES.validationFailed, "Выберите или создайте case перед reconstruction.");
  }

  const settings = assertValidReconstructionSettings(req.body?.settings || {});
  const job = createJob(uploadResult, settings, caseId);
  res.json(job);
}));

router.get("/jobs", asyncRoute(async (req, res) => {
  res.json({
    jobs: listReconstructionHistory(req.query?.status || "all", req.query?.caseId || "all")
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
    STATUSES.reviewRequired,
    STATUSES.queued,
    STATUSES.reconstructing3d,
    STATUSES.cleaningMesh,
    STATUSES.aligningModel,
    STATUSES.manualAdjustmentRequired,
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

router.post("/jobs/:jobId/review/approve", asyncRoute(async (req, res) => {
  const job = approveReviewAndContinue(req.params.jobId, req.body || {});
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

router.post("/jobs/:jobId/adjustment/apply", asyncRoute(async (req, res) => {
  const job = await applyManualAdjustmentToJob(req.params.jobId, req.body?.adjustmentValues || req.body || {});
  res.json(job);
}));

router.post("/jobs/:jobId/adjustment/skip", asyncRoute(async (req, res) => {
  const job = await skipManualAdjustmentForJob(req.params.jobId);
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

router.get("/artifacts/:jobId/frames/:frameName", asyncRoute(async (req, res) => {
  const job = getMutableJob(req.params.jobId);
  if (!job) throw new ApiError(404, ERROR_CODES.jobNotFound, "Reconstruction job не найден.");
  const frameName = req.params.frameName;
  const frame = [...(job.selectedFrames || []), ...(job.rejectedFrames || []), ...(job.finalSelectedFrames || [])]
    .find(item => item.fileName === frameName);
  const framePath = frame?.framePath || (job.framesDir ? path.join(job.framesDir, frameName) : "");
  if (!framePath || !fs.existsSync(framePath)) {
    throw new ApiError(404, ERROR_CODES.resultNotReady, "Frame preview не найден.");
  }
  res.sendFile(framePath);
}));

router.get("/artifacts/:jobId/masks/:maskName", asyncRoute(async (req, res) => {
  const job = getMutableJob(req.params.jobId);
  if (!job) throw new ApiError(404, ERROR_CODES.jobNotFound, "Reconstruction job не найден.");
  const maskName = req.params.maskName;
  const mask = [...(job.segmentationMasks || []), ...(job.finalSelectedMasks || [])]
    .find(item => item.maskName === maskName);
  const maskPath = mask?.maskPath || (job.masksDir ? path.join(job.masksDir, maskName) : "");
  if (!maskPath || !fs.existsSync(maskPath)) {
    throw new ApiError(404, ERROR_CODES.resultNotReady, "Mask preview не найден.");
  }
  res.type("image/png");
  res.sendFile(maskPath);
}));

module.exports = router;
