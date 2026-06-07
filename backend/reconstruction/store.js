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
const landmarkTemplates = new Map();
const simulations = new Map();
const MEASUREMENT_TYPES = new Set(["distance", "angle", "vector", "point", "annotation", "ratio", "custom"]);
const MEASUREMENT_STATUSES = new Set(["ready", "missing_landmarks", "needs_review", "calculated", "error"]);
const LANDMARK_CATEGORIES = new Set(["facial", "nasal", "maxillofacial", "orthodontic", "custom"]);
const LANDMARK_SOURCES = new Set(["manual", "imported", "ai_generated"]);
const LANDMARK_STATUSES = new Set(["unplaced", "placed", "hidden", "proposed", "approved", "corrected", "rejected"]);
const LANDMARK_DETECTION_MODES = new Set(["manual", "ai_assisted", "template_only"]);
const SURGICAL_SIMULATION_TYPES = new Set(["nasal_adjustment", "chin_adjustment", "jaw_adjustment", "facial_projection", "custom_simulation"]);
const TEAM_ROLES = new Set(["owner", "surgeon", "assistant", "viewer"]);
const TEAM_PERMISSIONS = new Set(["view_case", "edit_case", "add_measurements", "edit_measurements", "add_notes", "export_reports", "run_reconstruction", "run_simulation"]);

const ROLE_PERMISSIONS = {
  owner: ["view_case", "edit_case", "add_measurements", "edit_measurements", "add_notes", "export_reports", "run_reconstruction", "run_simulation"],
  surgeon: ["view_case", "edit_case", "add_measurements", "edit_measurements", "add_notes", "export_reports", "run_reconstruction", "run_simulation"],
  assistant: ["view_case", "add_measurements", "add_notes"],
  viewer: ["view_case"]
};

const DEFAULT_LANDMARK_TEMPLATES = [
  {
    templateId: "template-facial-basic",
    name: "Facial Basic",
    category: "facial",
    description: "Core facial reference landmarks for basic 3D face assessment.",
    landmarks: [
      { landmarkName: "Nasion", landmarkCategory: "facial", description: "Midline frontonasal point.", required: true, color: "#2563eb" },
      { landmarkName: "Pronasale", landmarkCategory: "nasal", description: "Most anterior point of the nose tip.", required: true, color: "#0ea5e9" },
      { landmarkName: "Pogonion", landmarkCategory: "maxillofacial", description: "Most anterior point on the chin.", required: true, color: "#16a34a" },
      { landmarkName: "Left Zygion", landmarkCategory: "facial", description: "Left lateral zygomatic landmark.", required: false, color: "#9333ea" },
      { landmarkName: "Right Zygion", landmarkCategory: "facial", description: "Right lateral zygomatic landmark.", required: false, color: "#9333ea" }
    ]
  },
  {
    templateId: "template-nasal-analysis",
    name: "Nasal Analysis",
    category: "nasal",
    description: "Nasal landmarks for profile and symmetry planning.",
    landmarks: [
      { landmarkName: "Nasion", landmarkCategory: "nasal", description: "Root of nose reference.", required: true, color: "#2563eb" },
      { landmarkName: "Rhinion", landmarkCategory: "nasal", description: "Bony-cartilaginous dorsum transition.", required: true, color: "#0ea5e9" },
      { landmarkName: "Pronasale", landmarkCategory: "nasal", description: "Nose tip.", required: true, color: "#f97316" },
      { landmarkName: "Subnasale", landmarkCategory: "nasal", description: "Columella-lip junction.", required: true, color: "#16a34a" }
    ]
  },
  {
    templateId: "template-orthognathic-analysis",
    name: "Orthognathic Analysis",
    category: "orthodontic",
    description: "Landmarks for jaw relation and orthognathic planning.",
    landmarks: [
      { landmarkName: "Subnasale", landmarkCategory: "maxillofacial", description: "Maxillary soft tissue reference.", required: true, color: "#2563eb" },
      { landmarkName: "Pogonion", landmarkCategory: "maxillofacial", description: "Chin prominence.", required: true, color: "#16a34a" },
      { landmarkName: "Menton", landmarkCategory: "maxillofacial", description: "Inferior chin point.", required: true, color: "#f97316" },
      { landmarkName: "Left Gonion", landmarkCategory: "maxillofacial", description: "Left mandibular angle.", required: false, color: "#9333ea" },
      { landmarkName: "Right Gonion", landmarkCategory: "maxillofacial", description: "Right mandibular angle.", required: false, color: "#9333ea" }
    ]
  },
  {
    templateId: "template-maxillofacial-analysis",
    name: "Maxillofacial Analysis",
    category: "maxillofacial",
    description: "Broader maxillofacial symmetry and contour landmarks.",
    landmarks: [
      { landmarkName: "Nasion", landmarkCategory: "maxillofacial", description: "Craniofacial midline reference.", required: true, color: "#2563eb" },
      { landmarkName: "Left Orbitale", landmarkCategory: "maxillofacial", description: "Left infraorbital reference.", required: false, color: "#0ea5e9" },
      { landmarkName: "Right Orbitale", landmarkCategory: "maxillofacial", description: "Right infraorbital reference.", required: false, color: "#0ea5e9" },
      { landmarkName: "Menton", landmarkCategory: "maxillofacial", description: "Lower facial height reference.", required: true, color: "#f97316" }
    ]
  },
  {
    templateId: "template-custom",
    name: "Custom Template",
    category: "custom",
    description: "Editable starter template for custom landmark sets.",
    landmarks: [
      { landmarkName: "Custom Point 1", landmarkCategory: "custom", description: "Custom landmark placeholder.", required: false, color: "#64748b" }
    ]
  }
];

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
    landmarks: Array.from(caseItem.landmarks || []),
    landmarkTemplates: Array.from(caseItem.landmarkTemplates || []),
    simulations: Array.from(caseItem.simulations || []),
    ownerId: caseItem.ownerId || "",
    teamMembers: Array.isArray(caseItem.teamMembers) ? caseItem.teamMembers.map(cloneTeamMember) : [],
    permissions: cloneCasePermissions(caseItem.permissions || {})
  };
}

function normalizePermissions(permissions = []) {
  const source = Array.isArray(permissions) ? permissions : [];
  return Array.from(new Set(source.map(String).filter(permission => TEAM_PERMISSIONS.has(permission))));
}

function permissionsForRole(role) {
  return normalizePermissions(ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.viewer);
}

function cloneCasePermissions(permissions = {}) {
  return Object.fromEntries(Object.entries(permissions).map(([memberId, memberPermissions]) => [
    memberId,
    normalizePermissions(memberPermissions)
  ]));
}

function cloneTeamMember(member) {
  if (!member) return null;
  const role = TEAM_ROLES.has(member.role) ? member.role : "viewer";
  return {
    memberId: member.memberId,
    name: member.name || "",
    role,
    email: member.email || "",
    permissions: normalizePermissions(member.permissions?.length ? member.permissions : permissionsForRole(role)),
    createdAt: member.createdAt,
    updatedAt: member.updatedAt
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
    visible: landmark.visible !== false,
    status: LANDMARK_STATUSES.has(landmark.status) ? landmark.status : "placed",
    templateId: landmark.templateId || "",
    templateName: landmark.templateName || "",
    required: Boolean(landmark.required),
    confidence: Number.isFinite(Number(landmark.confidence)) ? Math.max(0, Math.min(100, Number(landmark.confidence))) : null,
    detectionMode: LANDMARK_DETECTION_MODES.has(landmark.detectionMode) ? landmark.detectionMode : "manual",
    detectionSource: landmark.detectionSource || landmark.source || "manual",
    approvedByUser: Boolean(landmark.approvedByUser),
    correctedByUser: Boolean(landmark.correctedByUser),
    analysisPresetId: landmark.analysisPresetId || "",
    analysisPresetName: landmark.analysisPresetName || ""
  };
}

function cloneLandmarkTemplate(template) {
  if (!template) return null;
  return {
    templateId: template.templateId,
    name: template.name || "",
    category: template.category || "custom",
    description: template.description || "",
    landmarks: Array.isArray(template.landmarks) ? template.landmarks.map(item => ({
      landmarkName: item.landmarkName || "",
      landmarkCategory: LANDMARK_CATEGORIES.has(item.landmarkCategory) ? item.landmarkCategory : "custom",
      description: item.description || "",
      required: Boolean(item.required),
      color: item.color || "#2563eb"
    })) : [],
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    builtIn: Boolean(template.builtIn)
  };
}

for (const template of DEFAULT_LANDMARK_TEMPLATES) {
  const timestamp = nowIso();
  landmarkTemplates.set(template.templateId, {
    ...template,
    createdAt: template.createdAt || timestamp,
    updatedAt: template.updatedAt || timestamp,
    builtIn: true
  });
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
    landmarksUsed: Array.isArray(measurement.landmarksUsed) ? measurement.landmarksUsed.map(String) : [],
    source: measurement.source || "manual",
    templateId: measurement.templateId || "",
    templateName: measurement.templateName || "",
    missingLandmarks: Array.isArray(measurement.missingLandmarks) ? measurement.missingLandmarks.map(String) : [],
    status: MEASUREMENT_STATUSES.has(measurement.status) ? measurement.status : "ready",
    warnings: Array.isArray(measurement.warnings) ? measurement.warnings.map(String) : [],
    formula: measurement.formula || "",
    description: measurement.description || "",
    fromLandmark: measurement.fromLandmark || "",
    toLandmark: measurement.toLandmark || "",
    optionalThirdLandmark: measurement.optionalThirdLandmark || "",
    analysisPresetId: measurement.analysisPresetId || "",
    analysisPresetName: measurement.analysisPresetName || "",
    calculatedAt: measurement.calculatedAt || "",
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

function normalizeSimulationParameters(parameters = {}) {
  return {
    moveX: Number(parameters.moveX) || 0,
    moveY: Number(parameters.moveY) || 0,
    moveZ: Number(parameters.moveZ) || 0,
    rotateX: Number(parameters.rotateX) || 0,
    rotateY: Number(parameters.rotateY) || 0,
    rotateZ: Number(parameters.rotateZ) || 0,
    scale: Number(parameters.scale) || 1,
    customParameters: String(parameters.customParameters || "").trim()
  };
}

function cloneSimulation(simulation) {
  if (!simulation) return null;
  return {
    simulationId: simulation.simulationId,
    caseId: simulation.caseId,
    modelId: simulation.modelId,
    jobId: simulation.jobId || "",
    simulationType: simulation.simulationType || "custom_simulation",
    parameters: normalizeSimulationParameters(simulation.parameters || {}),
    originalModel: simulation.originalModel || null,
    simulatedModel: simulation.simulatedModel || null,
    originalModelId: simulation.originalModelId || simulation.modelId || "",
    simulatedModelId: simulation.simulatedModelId || "",
    comparisonId: simulation.comparisonId || "",
    warnings: Array.isArray(simulation.warnings) ? simulation.warnings.map(String) : [],
    createdAt: simulation.createdAt,
    updatedAt: simulation.updatedAt
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
    landmarks: [],
    landmarkTemplates: [],
    simulations: [],
    ownerId: "",
    teamMembers: [],
    permissions: {}
  };
  const owner = normalizeTeamMemberInput({
    name: data.ownerName || "Case Owner",
    role: "owner",
    email: data.ownerEmail || ""
  });
  caseItem.ownerId = owner.memberId;
  caseItem.teamMembers.push({ ...owner, createdAt: timestamp, updatedAt: timestamp });
  caseItem.permissions[owner.memberId] = owner.permissions;
  // TODO: multiple scans
  // TODO: before/after comparison
  // TODO: operation planning
  // TODO: timeline
  // TODO: soft tissue simulation
  // TODO: bone movement simulation
  // TODO: orthognathic planning
  // TODO: rhinoplasty planning
  // TODO: AI surgical planning
  // TODO: backend auth and server-side team membership persistence
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
  for (const simulationId of caseItem.simulations || []) simulations.delete(simulationId);
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

function addLandmarkTemplateToCase(caseId, templateId) {
  const caseItem = getMutableCase(caseId);
  if (!caseItem) return null;
  caseItem.landmarkTemplates = caseItem.landmarkTemplates || [];
  if (templateId && !caseItem.landmarkTemplates.includes(templateId)) caseItem.landmarkTemplates.push(templateId);
  return touchCase(caseItem);
}

function addSimulationToCase(caseId, simulationId) {
  const caseItem = getMutableCase(caseId);
  if (!caseItem) return null;
  caseItem.simulations = caseItem.simulations || [];
  if (simulationId && !caseItem.simulations.includes(simulationId)) caseItem.simulations.push(simulationId);
  return touchCase(caseItem);
}

function normalizeTeamMemberInput(data = {}, existing = null) {
  const role = TEAM_ROLES.has(String(data.role || existing?.role || "viewer"))
    ? String(data.role || existing?.role || "viewer")
    : "viewer";
  return {
    memberId: String(data.memberId || existing?.memberId || makeId("member")).trim(),
    name: String(data.name ?? existing?.name ?? "Team member").trim() || "Team member",
    role,
    email: String(data.email ?? existing?.email ?? "").trim(),
    permissions: normalizePermissions(
      Array.isArray(data.permissions)
        ? data.permissions
        : Array.isArray(existing?.permissions)
          ? existing.permissions
          : permissionsForRole(role)
    )
  };
}

function listCaseTeamMembers(caseId) {
  const caseItem = getMutableCase(caseId);
  if (!caseItem) return [];
  return (caseItem.teamMembers || [])
    .map(member => cloneTeamMember({
      ...member,
      permissions: caseItem.permissions?.[member.memberId] || member.permissions
    }))
    .filter(Boolean)
    .sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner") || String(a.name).localeCompare(String(b.name)));
}

function saveCaseTeamMember(caseId, data = {}) {
  const caseItem = getMutableCase(caseId);
  if (!caseItem) return null;
  const timestamp = nowIso();
  const existing = (caseItem.teamMembers || []).find(item => item.memberId === data.memberId);
  const normalized = normalizeTeamMemberInput(data, existing);
  const member = {
    ...normalized,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp
  };
  caseItem.teamMembers = [
    member,
    ...(caseItem.teamMembers || []).filter(item => item.memberId !== member.memberId)
  ];
  caseItem.permissions = caseItem.permissions || {};
  caseItem.permissions[member.memberId] = member.permissions;
  if (member.role === "owner" || !caseItem.ownerId) caseItem.ownerId = member.memberId;
  touchCase(caseItem);
  return cloneTeamMember(member);
}

function updateCaseTeamMemberRole(caseId, memberId, role) {
  const caseItem = getMutableCase(caseId);
  if (!caseItem) return null;
  const existing = (caseItem.teamMembers || []).find(item => item.memberId === memberId);
  if (!existing) return null;
  const nextRole = TEAM_ROLES.has(String(role || "")) ? String(role) : existing.role;
  const updated = {
    ...existing,
    role: nextRole,
    permissions: permissionsForRole(nextRole),
    updatedAt: nowIso()
  };
  caseItem.teamMembers = caseItem.teamMembers.map(item => item.memberId === memberId ? updated : item);
  caseItem.permissions = caseItem.permissions || {};
  caseItem.permissions[memberId] = updated.permissions;
  if (nextRole === "owner") caseItem.ownerId = memberId;
  if (caseItem.ownerId === memberId && nextRole !== "owner") {
    const owner = caseItem.teamMembers.find(item => item.role === "owner");
    caseItem.ownerId = owner?.memberId || "";
  }
  touchCase(caseItem);
  return cloneTeamMember(updated);
}

function removeCaseTeamMember(caseId, memberId) {
  const caseItem = getMutableCase(caseId);
  if (!caseItem) return null;
  const existing = (caseItem.teamMembers || []).find(item => item.memberId === memberId);
  if (!existing || existing.memberId === caseItem.ownerId) return null;
  caseItem.teamMembers = (caseItem.teamMembers || []).filter(item => item.memberId !== memberId);
  if (caseItem.permissions) delete caseItem.permissions[memberId];
  touchCase(caseItem);
  return cloneTeamMember(existing);
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
  const status = LANDMARK_STATUSES.has(String(data.status || existing?.status || "placed"))
    ? String(data.status || existing?.status || "placed")
    : "placed";
  const detectionMode = LANDMARK_DETECTION_MODES.has(String(data.detectionMode || existing?.detectionMode || "manual"))
    ? String(data.detectionMode || existing?.detectionMode || "manual")
    : "manual";
  const confidence = data.confidence ?? existing?.confidence ?? null;
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
    visible: (status === "hidden" || status === "rejected") ? false : (data.visible === undefined ? existing?.visible !== false : data.visible !== false),
    status,
    templateId: String(data.templateId ?? existing?.templateId ?? "").trim(),
    templateName: String(data.templateName ?? existing?.templateName ?? "").trim(),
    required: Boolean(data.required ?? existing?.required),
    confidence: confidence === null || confidence === "" ? null : Math.max(0, Math.min(100, Number(confidence) || 0)),
    detectionMode,
    detectionSource: String(data.detectionSource ?? existing?.detectionSource ?? source).trim() || source,
    approvedByUser: Boolean(data.approvedByUser ?? existing?.approvedByUser),
    correctedByUser: Boolean(data.correctedByUser ?? existing?.correctedByUser),
    analysisPresetId: String(data.analysisPresetId ?? existing?.analysisPresetId ?? "").trim(),
    analysisPresetName: String(data.analysisPresetName ?? existing?.analysisPresetName ?? "").trim()
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
  if (landmark.templateId) addLandmarkTemplateToCase(landmark.caseId, landmark.templateId);
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

function normalizeLandmarkTemplateInput(data = {}, existing = null) {
  const category = LANDMARK_CATEGORIES.has(String(data.category || existing?.category || "custom"))
    ? String(data.category || existing?.category || "custom")
    : "custom";
  const items = Array.isArray(data.landmarks) ? data.landmarks : existing?.landmarks || [];
  return {
    templateId: String(data.templateId || existing?.templateId || makeId("landmark-template")).trim(),
    name: String(data.name ?? existing?.name ?? "Custom Template").trim() || "Custom Template",
    category,
    description: String(data.description ?? existing?.description ?? "").trim(),
    landmarks: items.map(item => ({
      landmarkName: String(item.landmarkName || item.name || "Landmark").trim() || "Landmark",
      landmarkCategory: LANDMARK_CATEGORIES.has(String(item.landmarkCategory || item.category || "custom"))
        ? String(item.landmarkCategory || item.category || "custom")
        : "custom",
      description: String(item.description || "").trim(),
      required: Boolean(item.required),
      color: String(item.color || "#2563eb").trim() || "#2563eb"
    })),
    builtIn: Boolean(existing?.builtIn || data.builtIn)
  };
}

function listLandmarkTemplates() {
  return Array.from(landmarkTemplates.values())
    .map(cloneLandmarkTemplate)
    .sort((a, b) => Number(b.builtIn) - Number(a.builtIn) || String(a.name).localeCompare(String(b.name)));
}

function getLandmarkTemplate(templateId) {
  return cloneLandmarkTemplate(landmarkTemplates.get(templateId));
}

function saveLandmarkTemplate(data = {}) {
  const timestamp = nowIso();
  const existing = landmarkTemplates.get(data.templateId);
  const normalized = normalizeLandmarkTemplateInput(data, existing);
  const template = {
    ...normalized,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp
  };
  landmarkTemplates.set(template.templateId, template);
  return cloneLandmarkTemplate(template);
}

function deleteLandmarkTemplate(templateId) {
  const existing = landmarkTemplates.get(templateId);
  if (!existing || existing.builtIn) return null;
  landmarkTemplates.delete(templateId);
  return cloneLandmarkTemplate(existing);
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

function normalizeSimulationInput(data = {}, existing = null) {
  const simulationType = SURGICAL_SIMULATION_TYPES.has(String(data.simulationType || existing?.simulationType || "custom_simulation"))
    ? String(data.simulationType || existing?.simulationType || "custom_simulation")
    : "custom_simulation";
  const modelId = String(data.modelId || existing?.modelId || data.originalModelId || "").trim();
  const simulatedModelId = String(data.simulatedModelId || existing?.simulatedModelId || `${modelId}:simulated`).trim();
  return {
    simulationId: String(data.simulationId || existing?.simulationId || makeId("simulation")).trim(),
    caseId: String(data.caseId || existing?.caseId || "").trim(),
    modelId,
    jobId: String(data.jobId || existing?.jobId || "").trim(),
    simulationType,
    parameters: normalizeSimulationParameters(data.parameters || existing?.parameters || {}),
    originalModel: data.originalModel || existing?.originalModel || null,
    simulatedModel: data.simulatedModel || existing?.simulatedModel || null,
    originalModelId: String(data.originalModelId || existing?.originalModelId || modelId).trim(),
    simulatedModelId,
    comparisonId: String(data.comparisonId || existing?.comparisonId || "").trim(),
    warnings: Array.isArray(data.warnings) ? data.warnings.map(String) : Array.isArray(existing?.warnings) ? existing.warnings : []
  };
}

function saveSimulation(data = {}) {
  const timestamp = nowIso();
  const normalized = normalizeSimulationInput(data, simulations.get(data.simulationId));
  if (!normalized.caseId || !normalized.modelId) return null;
  const existing = simulations.get(normalized.simulationId);
  const simulation = {
    ...normalized,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp
  };
  simulations.set(simulation.simulationId, simulation);
  addSimulationToCase(simulation.caseId, simulation.simulationId);
  addModelToCase(simulation.caseId, simulation.originalModelId || simulation.modelId);
  addModelToCase(simulation.caseId, simulation.simulatedModelId);
  return cloneSimulation(simulation);
}

function getSimulation(simulationId) {
  return cloneSimulation(simulations.get(simulationId));
}

function listSimulations(filter = {}) {
  const caseId = String(filter.caseId || "all");
  const jobId = String(filter.jobId || "all");
  const modelId = String(filter.modelId || "all");
  return Array.from(simulations.values())
    .filter(item => caseId === "all" || item.caseId === caseId)
    .filter(item => jobId === "all" || item.jobId === jobId)
    .filter(item => modelId === "all" || item.modelId === modelId || item.originalModelId === modelId || item.simulatedModelId === modelId)
    .map(cloneSimulation)
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
    unit: String(data.unit ?? existing?.unit ?? "").trim(),
    landmarksUsed: Array.isArray(data.landmarksUsed) ? data.landmarksUsed.map(String) : Array.isArray(existing?.landmarksUsed) ? existing.landmarksUsed : [],
    source: String(data.source ?? existing?.source ?? "manual").trim() || "manual",
    templateId: String(data.templateId ?? existing?.templateId ?? "").trim(),
    templateName: String(data.templateName ?? existing?.templateName ?? "").trim(),
    missingLandmarks: Array.isArray(data.missingLandmarks) ? data.missingLandmarks.map(String) : Array.isArray(existing?.missingLandmarks) ? existing.missingLandmarks : [],
    status: MEASUREMENT_STATUSES.has(String(data.status ?? existing?.status ?? "ready")) ? String(data.status ?? existing?.status ?? "ready") : "ready",
    warnings: Array.isArray(data.warnings) ? data.warnings.map(String) : Array.isArray(existing?.warnings) ? existing.warnings : [],
    formula: String(data.formula ?? existing?.formula ?? "").trim(),
    description: String(data.description ?? existing?.description ?? "").trim(),
    fromLandmark: String(data.fromLandmark ?? existing?.fromLandmark ?? "").trim(),
    toLandmark: String(data.toLandmark ?? existing?.toLandmark ?? "").trim(),
    optionalThirdLandmark: String(data.optionalThirdLandmark ?? existing?.optionalThirdLandmark ?? "").trim(),
    analysisPresetId: String(data.analysisPresetId ?? existing?.analysisPresetId ?? "").trim(),
    analysisPresetName: String(data.analysisPresetName ?? existing?.analysisPresetName ?? "").trim(),
    calculatedAt: String(data.calculatedAt ?? existing?.calculatedAt ?? "").trim()
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
  addLandmarkTemplateToCase,
  addSimulationToCase,
  listCaseTeamMembers,
  saveCaseTeamMember,
  updateCaseTeamMemberRole,
  removeCaseTeamMember,
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
  saveSimulation,
  getSimulation,
  listSimulations,
  saveLandmark,
  deleteLandmark,
  listLandmarks,
  listLandmarkTemplates,
  getLandmarkTemplate,
  saveLandmarkTemplate,
  deleteLandmarkTemplate,
  createJob,
  getMutableJob,
  getJob,
  listMutableJobs,
  listJobs,
  saveJob,
  deleteJob
};
