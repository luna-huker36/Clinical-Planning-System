const crypto = require("crypto");
const { STATUSES } = require("./constants");
const { normalizeReconstructionSettings } = require("./settings");

const uploads = new Map();
const jobs = new Map();
const cases = new Map();
const comparisons = new Map();
const measurements = new Map();
const surgicalPlans = new Map();
const landmarks = new Map();
const MEASUREMENT_TYPES = new Set(["distance", "angle", "vector", "point", "annotation"]);
const LANDMARK_CATEGORIES = new Set(["facial", "nasal", "maxillofacial", "orthodontic", "custom"]);
const LANDMARK_SOURCES = new Set(["manual", "imported", "ai_generated"]);

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  if (crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}

function cloneJob(job) {
  if (!job) return null;
  const { framesDir, masksDir, inputMeshPath, cleanedMeshPath, datasetPath, rawMeshPath, outputGlbPath, alignedModelPath, adjustedModelPath, ...safeJob } = job;
  return {
    ...safeJob,
    engineStdout: String(job.engineStdout || "").slice(0, 2000),
    engineStderr: String(job.engineStderr || "").slice(0, 2000),
    cleanedMeshPath: job.publicCleanedMeshUrl || "",
    rawMeshPath: job.rawMeshPath ? "raw-model.glb" : "",
    outputGlbPath: job.outputGlbPath ? "result.glb" : "",
    alignedModelPath: job.alignedModelPath ? "aligned.glb" : "",
    adjustedModelPath: job.adjustedModelPath ? "adjusted.glb" : "",
    selectedFrames: (job.selectedFrames || []).map(frame => {
      const { framePath, ...safeFrame } = frame;
      return {
        ...safeFrame,
        frameUrl: `/api/reconstruction/artifacts/${encodeURIComponent(job.jobId)}/frames/${encodeURIComponent(frame.fileName || "")}`
      };
    }),
    rejectedFrames: (job.rejectedFrames || []).map(frame => {
      const { framePath, ...safeFrame } = frame;
      return {
        ...safeFrame,
        frameUrl: `/api/reconstruction/artifacts/${encodeURIComponent(job.jobId)}/frames/${encodeURIComponent(frame.fileName || "")}`
      };
    }),
    finalSelectedFrames: (job.finalSelectedFrames || []).map(frame => {
      const { framePath, ...safeFrame } = frame;
      return {
        ...safeFrame,
        frameUrl: `/api/reconstruction/artifacts/${encodeURIComponent(job.jobId)}/frames/${encodeURIComponent(frame.fileName || "")}`
      };
    }),
    segmentationMasks: (job.segmentationMasks || []).map(mask => ({
      frameName: mask.frameName || "",
      maskName: mask.maskName || "",
      maskUrl: `/api/reconstruction/artifacts/${encodeURIComponent(job.jobId)}/masks/${encodeURIComponent(mask.maskName || "")}`,
      mode: mask.mode || job.segmentationMode || "mock",
      width: mask.width || null,
      height: mask.height || null,
      coverage: mask.coverage || 0,
      success: Boolean(mask.success),
      warning: mask.warning || ""
    })),
    finalSelectedMasks: (job.finalSelectedMasks || []).map(mask => ({
      frameName: mask.frameName || "",
      maskName: mask.maskName || "",
      maskUrl: `/api/reconstruction/artifacts/${encodeURIComponent(job.jobId)}/masks/${encodeURIComponent(mask.maskName || "")}`,
      mode: mask.mode || job.segmentationMode || "mock",
      width: mask.width || null,
      height: mask.height || null,
      coverage: mask.coverage || 0,
      success: Boolean(mask.success),
      warning: mask.warning || ""
    })),
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

function cloneCase(caseItem) {
  if (!caseItem) return null;
  return {
    caseId: caseItem.caseId,
    patientName: caseItem.patientName || "",
    patientId: caseItem.patientId || "",
    createdAt: caseItem.createdAt,
    updatedAt: caseItem.updatedAt,
    notes: caseItem.notes || "",
    reconstructionJobs: Array.from(caseItem.reconstructionJobs || []),
    reports: Array.from(caseItem.reports || []),
    models: Array.from(caseItem.models || []),
    comparisons: Array.from(caseItem.comparisons || []),
    measurements: Array.from(caseItem.measurements || []),
    surgicalPlans: Array.from(caseItem.surgicalPlans || []),
    landmarks: Array.from(caseItem.landmarks || [])
  };
}

function cloneLandmark(landmark) {
  if (!landmark) return null;
  return {
    landmarkId: landmark.landmarkId,
    caseId: landmark.caseId,
    jobId: landmark.jobId,
    modelId: landmark.modelId,
    name: landmark.name || "",
    category: landmark.category || "custom",
    position3D: {
      x: Number(landmark.position3D?.x) || 0,
      y: Number(landmark.position3D?.y) || 0,
      z: Number(landmark.position3D?.z) || 0
    },
    color: landmark.color || "#2563eb",
    description: landmark.description || "",
    createdAt: landmark.createdAt,
    updatedAt: landmark.updatedAt,
    source: landmark.source || "manual",
    visible: landmark.visible !== false
  };
}

function cloneSurgicalPlan(plan) {
  if (!plan) return null;
  return {
    planId: plan.planId,
    caseId: plan.caseId,
    jobId: plan.jobId || "",
    modelId: plan.modelId || "",
    title: plan.title || "",
    diagnosis: plan.diagnosis || "",
    procedureType: plan.procedureType || "",
    goals: plan.goals || "",
    risks: plan.risks || "",
    notes: plan.notes || "",
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt
  };
}

function cloneMeasurement(measurement) {
  if (!measurement) return null;
  return {
    measurementId: measurement.measurementId,
    caseId: measurement.caseId,
    jobId: measurement.jobId,
    modelId: measurement.modelId,
    type: measurement.type,
    label: measurement.label || "",
    points: Array.isArray(measurement.points)
      ? measurement.points.map(point => ({
        x: Number(point.x) || 0,
        y: Number(point.y) || 0,
        z: Number(point.z) || 0
      }))
      : [],
    value: measurement.value,
    unit: measurement.unit || "",
    createdAt: measurement.createdAt,
    updatedAt: measurement.updatedAt
  };
}

function cloneComparison(comparison) {
  if (!comparison) return null;
  return {
    comparisonId: comparison.comparisonId,
    caseId: comparison.caseId,
    beforeJobId: comparison.beforeJobId,
    afterJobId: comparison.afterJobId,
    createdAt: comparison.createdAt,
    updatedAt: comparison.updatedAt,
    notes: comparison.notes || "",
    comparisonMode: comparison.comparisonMode || "show_before"
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

function createCase(data = {}) {
  const timestamp = nowIso();
  const caseItem = {
    caseId: makeId("case"),
    patientName: String(data.patientName || "Unnamed patient").trim() || "Unnamed patient",
    patientId: String(data.patientId || "").trim(),
    createdAt: timestamp,
    updatedAt: timestamp,
    notes: String(data.notes || "").trim(),
    reconstructionJobs: [],
    reports: [],
    models: [],
    comparisons: [],
    measurements: [],
    surgicalPlans: [],
    landmarks: []
  };
  // TODO: multiple scans
  // TODO: before/after comparison
  // TODO: operation planning
  // TODO: timeline
  cases.set(caseItem.caseId, caseItem);
  return cloneCase(caseItem);
}

function getMutableCase(caseId) {
  return cases.get(caseId) || null;
}

function getCase(caseId) {
  return cloneCase(getMutableCase(caseId));
}

function listCases() {
  return Array.from(cases.values())
    .map(cloneCase)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

function deleteCase(caseId) {
  const caseItem = cases.get(caseId) || null;
  if (!caseItem) return null;
  cases.delete(caseId);
  for (const jobId of caseItem.reconstructionJobs || []) jobs.delete(jobId);
  for (const comparisonId of caseItem.comparisons || []) comparisons.delete(comparisonId);
  for (const measurementId of caseItem.measurements || []) measurements.delete(measurementId);
  for (const planId of caseItem.surgicalPlans || []) surgicalPlans.delete(planId);
  for (const landmarkId of caseItem.landmarks || []) landmarks.delete(landmarkId);
  return cloneCase(caseItem);
}

function touchCase(caseItem) {
  if (!caseItem) return null;
  caseItem.updatedAt = nowIso();
  cases.set(caseItem.caseId, caseItem);
  return cloneCase(caseItem);
}

function addJobToCase(caseId, jobId) {
  const caseItem = getMutableCase(caseId);
  if (!caseItem) return null;
  if (!caseItem.reconstructionJobs.includes(jobId)) caseItem.reconstructionJobs.push(jobId);
  return touchCase(caseItem);
}

function addReportToCase(caseId, reportId) {
  const caseItem = getMutableCase(caseId);
  if (!caseItem) return null;
  if (reportId && !caseItem.reports.includes(reportId)) caseItem.reports.push(reportId);
  return touchCase(caseItem);
}

function addModelToCase(caseId, modelId) {
  const caseItem = getMutableCase(caseId);
  if (!caseItem) return null;
  if (modelId && !caseItem.models.includes(modelId)) caseItem.models.push(modelId);
  return touchCase(caseItem);
}

function addComparisonToCase(caseId, comparisonId) {
  const caseItem = getMutableCase(caseId);
  if (!caseItem) return null;
  if (comparisonId && !caseItem.comparisons.includes(comparisonId)) caseItem.comparisons.push(comparisonId);
  return touchCase(caseItem);
}

function addMeasurementToCase(caseId, measurementId) {
  const caseItem = getMutableCase(caseId);
  if (!caseItem) return null;
  caseItem.measurements = caseItem.measurements || [];
  if (measurementId && !caseItem.measurements.includes(measurementId)) caseItem.measurements.push(measurementId);
  return touchCase(caseItem);
}

function removeMeasurementFromCase(caseId, measurementId) {
  const caseItem = getMutableCase(caseId);
  if (!caseItem) return null;
  caseItem.measurements = (caseItem.measurements || []).filter(id => id !== measurementId);
  return touchCase(caseItem);
}

function addSurgicalPlanToCase(caseId, planId) {
  const caseItem = getMutableCase(caseId);
  if (!caseItem) return null;
  caseItem.surgicalPlans = caseItem.surgicalPlans || [];
  if (planId && !caseItem.surgicalPlans.includes(planId)) caseItem.surgicalPlans.push(planId);
  return touchCase(caseItem);
}

function addLandmarkToCase(caseId, landmarkId) {
  const caseItem = getMutableCase(caseId);
  if (!caseItem) return null;
  caseItem.landmarks = caseItem.landmarks || [];
  if (landmarkId && !caseItem.landmarks.includes(landmarkId)) caseItem.landmarks.push(landmarkId);
  return touchCase(caseItem);
}

function removeLandmarkFromCase(caseId, landmarkId) {
  const caseItem = getMutableCase(caseId);
  if (!caseItem) return null;
  caseItem.landmarks = (caseItem.landmarks || []).filter(id => id !== landmarkId);
  return touchCase(caseItem);
}

function normalizeLandmarkInput(data = {}, existing = null) {
  const category = LANDMARK_CATEGORIES.has(String(data.category || existing?.category || "custom"))
    ? String(data.category || existing?.category || "custom")
    : "custom";
  const source = LANDMARK_SOURCES.has(String(data.source || existing?.source || "manual"))
    ? String(data.source || existing?.source || "manual")
    : "manual";
  return {
    landmarkId: String(data.landmarkId || existing?.landmarkId || makeId("landmark")).trim(),
    caseId: String(data.caseId || existing?.caseId || "").trim(),
    jobId: String(data.jobId || existing?.jobId || "").trim(),
    modelId: String(data.modelId || existing?.modelId || "").trim(),
    name: String(data.name ?? existing?.name ?? "Landmark").trim() || "Landmark",
    category,
    position3D: {
      x: Number(data.position3D?.x ?? existing?.position3D?.x ?? 0) || 0,
      y: Number(data.position3D?.y ?? existing?.position3D?.y ?? 0) || 0,
      z: Number(data.position3D?.z ?? existing?.position3D?.z ?? 0) || 0
    },
    color: String(data.color ?? existing?.color ?? "#2563eb").trim() || "#2563eb",
    description: String(data.description ?? existing?.description ?? "").trim(),
    source,
    visible: data.visible === undefined ? existing?.visible !== false : data.visible !== false
  };
}

function saveLandmark(data = {}) {
  const timestamp = nowIso();
  const normalized = normalizeLandmarkInput(data, landmarks.get(data.landmarkId));
  if (!normalized.caseId || !normalized.jobId || !normalized.modelId) return null;
  const existing = landmarks.get(normalized.landmarkId);
  const landmark = {
    ...normalized,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp
  };
  landmarks.set(landmark.landmarkId, landmark);
  addLandmarkToCase(landmark.caseId, landmark.landmarkId);
  return cloneLandmark(landmark);
}

function deleteLandmark(landmarkId) {
  const existing = landmarks.get(landmarkId);
  if (!existing) return null;
  landmarks.delete(landmarkId);
  removeLandmarkFromCase(existing.caseId, landmarkId);
  return cloneLandmark(existing);
}

function listLandmarks(filter = {}) {
  const caseId = String(filter.caseId || "all");
  const jobId = String(filter.jobId || "all");
  const modelId = String(filter.modelId || "all");
  return Array.from(landmarks.values())
    .filter(item => caseId === "all" || item.caseId === caseId)
    .filter(item => jobId === "all" || item.jobId === jobId)
    .filter(item => modelId === "all" || item.modelId === modelId)
    .map(cloneLandmark)
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
}

function normalizeSurgicalPlanInput(data = {}, existing = null) {
  return {
    planId: String(data.planId || existing?.planId || makeId("surgical-plan")).trim(),
    caseId: String(data.caseId || existing?.caseId || "").trim(),
    jobId: String(data.jobId ?? existing?.jobId ?? "").trim(),
    modelId: String(data.modelId ?? existing?.modelId ?? "").trim(),
    title: String(data.title ?? existing?.title ?? "").trim(),
    diagnosis: String(data.diagnosis ?? existing?.diagnosis ?? "").trim(),
    procedureType: String(data.procedureType ?? existing?.procedureType ?? "").trim(),
    goals: String(data.goals ?? existing?.goals ?? "").trim(),
    risks: String(data.risks ?? existing?.risks ?? "").trim(),
    notes: String(data.notes ?? existing?.notes ?? "").trim()
  };
}

function saveSurgicalPlan(data = {}) {
  const timestamp = nowIso();
  const normalized = normalizeSurgicalPlanInput(data, surgicalPlans.get(data.planId));
  if (!normalized.caseId) return null;
  const existing = surgicalPlans.get(normalized.planId);
  const plan = {
    ...normalized,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp
  };
  surgicalPlans.set(plan.planId, plan);
  addSurgicalPlanToCase(plan.caseId, plan.planId);
  return cloneSurgicalPlan(plan);
}

function getSurgicalPlan(planId) {
  return cloneSurgicalPlan(surgicalPlans.get(planId));
}

function listSurgicalPlans(filter = {}) {
  const caseId = String(filter.caseId || "all");
  const jobId = String(filter.jobId || "all");
  const modelId = String(filter.modelId || "all");
  return Array.from(surgicalPlans.values())
    .filter(item => caseId === "all" || item.caseId === caseId)
    .filter(item => jobId === "all" || item.jobId === jobId)
    .filter(item => modelId === "all" || item.modelId === modelId)
    .map(cloneSurgicalPlan)
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
}

function normalizeMeasurementInput(data = {}, existing = null) {
  const type = String(data.type || existing?.type || "").trim();
  const rawValue = data.value ?? existing?.value ?? null;
  return {
    measurementId: String(data.measurementId || existing?.measurementId || makeId("measurement")).trim(),
    caseId: String(data.caseId || existing?.caseId || "").trim(),
    jobId: String(data.jobId || existing?.jobId || "").trim(),
    modelId: String(data.modelId || existing?.modelId || "").trim(),
    type,
    label: String(data.label ?? existing?.label ?? "").trim(),
    points: Array.isArray(data.points)
      ? data.points.map(point => ({
        x: Number(point?.x) || 0,
        y: Number(point?.y) || 0,
        z: Number(point?.z) || 0
      }))
      : Array.isArray(existing?.points) ? existing.points : [],
    value: rawValue === null || rawValue === "" || !Number.isFinite(Number(rawValue)) ? null : Number(rawValue),
    unit: String(data.unit ?? existing?.unit ?? "").trim()
  };
}

function saveMeasurement(data = {}) {
  const timestamp = nowIso();
  const normalized = normalizeMeasurementInput(data, measurements.get(data.measurementId));
  if (!normalized.caseId || !normalized.jobId || !normalized.modelId) return null;
  if (!MEASUREMENT_TYPES.has(normalized.type)) return null;
  const existing = measurements.get(normalized.measurementId);
  const measurement = {
    ...normalized,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp
  };
  measurements.set(measurement.measurementId, measurement);
  addMeasurementToCase(measurement.caseId, measurement.measurementId);
  return cloneMeasurement(measurement);
}

function updateMeasurementLabel(measurementId, label = "") {
  const existing = measurements.get(measurementId);
  if (!existing) return null;
  existing.label = String(label || "").trim() || existing.label;
  existing.updatedAt = nowIso();
  measurements.set(existing.measurementId, existing);
  touchCase(getMutableCase(existing.caseId));
  return cloneMeasurement(existing);
}

function deleteMeasurement(measurementId) {
  const existing = measurements.get(measurementId);
  if (!existing) return null;
  measurements.delete(measurementId);
  removeMeasurementFromCase(existing.caseId, measurementId);
  return cloneMeasurement(existing);
}

function listMeasurements(filter = {}) {
  const caseId = String(filter.caseId || "all");
  const jobId = String(filter.jobId || "all");
  const modelId = String(filter.modelId || "all");
  return Array.from(measurements.values())
    .filter(item => caseId === "all" || item.caseId === caseId)
    .filter(item => jobId === "all" || item.jobId === jobId)
    .filter(item => modelId === "all" || item.modelId === modelId)
    .map(cloneMeasurement)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function createComparison(data = {}) {
  const timestamp = nowIso();
  const comparison = {
    comparisonId: makeId("comparison"),
    caseId: String(data.caseId || "").trim(),
    beforeJobId: String(data.beforeJobId || "").trim(),
    afterJobId: String(data.afterJobId || "").trim(),
    createdAt: timestamp,
    updatedAt: timestamp,
    notes: String(data.notes || "").trim(),
    comparisonMode: String(data.comparisonMode || "show_before").trim() || "show_before"
  };
  comparisons.set(comparison.comparisonId, comparison);
  addComparisonToCase(comparison.caseId, comparison.comparisonId);
  return cloneComparison(comparison);
}

function getMutableComparison(comparisonId) {
  return comparisons.get(comparisonId) || null;
}

function getComparison(comparisonId) {
  return cloneComparison(getMutableComparison(comparisonId));
}

function listComparisons(caseId = "all") {
  const normalizedCase = String(caseId || "all");
  return Array.from(comparisons.values())
    .filter(item => normalizedCase === "all" || item.caseId === normalizedCase)
    .map(cloneComparison)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function createJob(upload, settings = {}, caseId = "") {
  const timestamp = nowIso();
  const linkedCaseId = String(caseId || "").trim();
  const job = {
    jobId: makeId("recon"),
    caseId: linkedCaseId,
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
    rejectedFrames: [],
    selectedFramesCount: 0,
    rejectedFramesCount: 0,
    reviewRequired: true,
    reviewedByUser: false,
    reviewCompletedAt: "",
    finalSelectedFrames: [],
    finalSelectedMasks: [],
    finalSelectedFramesCount: 0,
    manuallyExcludedFramesCount: 0,
    manuallyRestoredFramesCount: 0,
    segmentationMode: "mock",
    masksCount: 0,
    successfulMasksCount: 0,
    failedMasksCount: 0,
    averageMaskCoverage: 0,
    segmentationMasks: [],
    masksDir: "",
    segmentationWarnings: [],
    segmentationQuality: "poor",
    reconstructionMode: "mock",
    engineMode: "mock",
    engineCommand: "",
    engineExitCode: null,
    engineStdout: "",
    engineStderr: "",
    engineName: "",
    engineJobId: "",
    datasetPath: "",
    inputFramesCount: 0,
    inputMasksCount: 0,
    rawMeshPath: "",
    reconstructionWarnings: [],
    reconstructionQuality: "poor",
    inputMeshFormat: "",
    conversionMode: "mock",
    conversionSuccess: false,
    outputGlbPath: "",
    conversionWarnings: [],
    cleanupMode: "mock",
    inputMeshPath: "",
    cleanedMeshPath: "",
    publicCleanedMeshUrl: "",
    removedComponentsCount: 0,
    removedArtifactsCount: 0,
    holesRepairedCount: 0,
    decimationRatio: 1,
    cleanupSuccess: false,
    cleanupWarnings: [],
    cleanupQuality: "poor",
    alignmentMode: "mock",
    boundingBox: null,
    scaleFactor: 1,
    centerOffset: [0, 0, 0],
    modelCentered: false,
    scaleNormalized: false,
    orientationStatus: "",
    alignedModelPath: "",
    alignmentWarnings: [],
    alignmentSuccess: false,
    adjustmentApplied: false,
    adjustmentValues: {
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      positionX: 0,
      positionY: 0,
      positionZ: 0,
      scale: 1
    },
    adjustedModelPath: "",
    adjustmentWarnings: [],
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
  if (linkedCaseId) addJobToCase(linkedCaseId, job.jobId);
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
  createCase,
  getCase,
  getMutableCase,
  listCases,
  deleteCase,
  addJobToCase,
  addReportToCase,
  addModelToCase,
  addComparisonToCase,
  addMeasurementToCase,
  addSurgicalPlanToCase,
  addLandmarkToCase,
  createComparison,
  getComparison,
  getMutableComparison,
  listComparisons,
  saveMeasurement,
  updateMeasurementLabel,
  deleteMeasurement,
  listMeasurements,
  saveSurgicalPlan,
  getSurgicalPlan,
  listSurgicalPlans,
  saveLandmark,
  deleteLandmark,
  listLandmarks,
  createJob,
  getMutableJob,
  getJob,
  listMutableJobs,
  listJobs,
  saveJob,
  deleteJob
};
