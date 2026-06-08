const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const { STATUSES } = require("./constants");
const { getCase, getMutableJob, listMutableJobs, saveJob, addModelToCase, addReportToCase, listComparisons, listMeasurements, listSurgicalPlans, listLandmarks, listSimulations, listAuditEvents, listClinicalInsights, generateClinicalInsightsForCase, runQaValidationForCase, listQaChecks } = require("./store");
const { checkModelReadiness } = require("./model-readiness-check");
const { normalizeReconstructionSettings } = require("./settings");
const { summarizeAuditEvents } = require("./audit-log");
const { BACKUP_VERSION } = require("./backup-recovery");

function getArtifactPath(jobId) {
  const job = getMutableJob(jobId);
  if (job?.adjustedModelPath && fsSync.existsSync(job.adjustedModelPath)) return job.adjustedModelPath;
  if (job?.alignedModelPath && fsSync.existsSync(job.alignedModelPath)) return job.alignedModelPath;
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
    ...(job.conversionWarnings || []),
    ...(job.cleanupWarnings || []),
    ...(job.alignmentWarnings || []),
    ...(job.adjustmentWarnings || [])
  ].filter(Boolean)));
}

function summarizeLandmarkTemplates(landmarks = []) {
  const byTemplate = new Map();
  const positionedStatuses = new Set(["placed", "proposed", "approved", "corrected"]);
  for (const landmark of landmarks) {
    if (!landmark.templateId) continue;
    if (!byTemplate.has(landmark.templateId)) {
      byTemplate.set(landmark.templateId, {
        templateId: landmark.templateId,
        templateName: landmark.templateName || landmark.templateId,
        totalLandmarksCount: 0,
        placedLandmarksCount: 0,
        missingLandmarksCount: 0
      });
    }
    const summary = byTemplate.get(landmark.templateId);
    summary.totalLandmarksCount += 1;
    if (positionedStatuses.has(landmark.status)) summary.placedLandmarksCount += 1;
    if (landmark.status === "unplaced") summary.missingLandmarksCount += 1;
  }
  return {
    templatesUsed: Array.from(byTemplate.values()),
    placedLandmarksCount: landmarks.filter(item => positionedStatuses.has(item.status)).length,
    missingLandmarksCount: landmarks.filter(item => item.status === "unplaced").length
  };
}

function summarizeAiLandmarks(landmarks = []) {
  const aiLandmarks = landmarks.filter(item => item.detectionMode === "ai_assisted" || item.source === "ai_generated");
  const confidenceValues = aiLandmarks
    .map(item => Number(item.confidence))
    .filter(value => Number.isFinite(value));
  const averageConfidence = confidenceValues.length
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : 0;
  return {
    aiProposedLandmarks: aiLandmarks,
    proposedCount: aiLandmarks.filter(item => item.status === "proposed").length,
    approvedCount: aiLandmarks.filter(item => item.status === "approved").length,
    correctedCount: aiLandmarks.filter(item => item.status === "corrected").length,
    rejectedCount: aiLandmarks.filter(item => item.status === "rejected").length,
    averageConfidence: Math.round(averageConfidence)
  };
}

function summarizeMeasurementTemplates(measurements = []) {
  const generated = measurements.filter(item => item.source === "template" || item.templateId);
  const byTemplate = new Map();
  for (const measurement of generated) {
    const templateId = measurement.templateId || "measurement-template";
    if (!byTemplate.has(templateId)) {
      byTemplate.set(templateId, {
        templateId,
        templateName: measurement.templateName || templateId,
        generatedMeasurementsCount: 0,
        missingLandmarks: []
      });
    }
    const summary = byTemplate.get(templateId);
    summary.generatedMeasurementsCount += 1;
    summary.missingLandmarks = Array.from(new Set([
      ...summary.missingLandmarks,
      ...(measurement.missingLandmarks || [])
    ]));
  }
  return {
    templatesUsed: Array.from(byTemplate.values()),
    generatedMeasurementsCount: generated.length,
    missingLandmarks: Array.from(new Set(generated.flatMap(item => item.missingLandmarks || []))),
    measurementValues: generated.map(item => ({
      measurementId: item.measurementId,
      label: item.label,
      type: item.type,
      value: item.value,
      unit: item.unit,
      landmarksUsed: item.landmarksUsed || [],
      formula: item.formula || "",
      status: item.status || "ready",
      warnings: item.warnings || [],
      fromLandmark: item.fromLandmark || "",
      toLandmark: item.toLandmark || "",
      optionalThirdLandmark: item.optionalThirdLandmark || "",
      templateId: item.templateId || "",
      templateName: item.templateName || ""
    }))
  };
}

function summarizeCalculatedMeasurements(measurements = []) {
  const calculated = measurements.filter(item => item.landmarksUsed?.length || item.source === "template" || item.status === "calculated");
  return {
    calculatedMeasurements: calculated,
    calculatedMeasurementsCount: calculated.length,
    formulasUsed: Array.from(new Set(calculated.map(item => item.formula).filter(Boolean))),
    missingLandmarks: Array.from(new Set(calculated.flatMap(item => item.missingLandmarks || []))),
    warnings: Array.from(new Set(calculated.flatMap(item => item.warnings || [])))
  };
}

function summarizeClinicalAnalysisPresets(landmarks = [], measurements = []) {
  const byPreset = new Map();
  const collect = (item, kind) => {
    if (!item.analysisPresetId) return;
    if (!byPreset.has(item.analysisPresetId)) {
      byPreset.set(item.analysisPresetId, {
        presetId: item.analysisPresetId,
        name: item.analysisPresetName || item.analysisPresetId,
        generatedLandmarksCount: 0,
        generatedMeasurementsCount: 0,
        warnings: []
      });
    }
    const summary = byPreset.get(item.analysisPresetId);
    if (kind === "landmark") summary.generatedLandmarksCount += 1;
    if (kind === "measurement") summary.generatedMeasurementsCount += 1;
    summary.warnings = Array.from(new Set([
      ...summary.warnings,
      ...(item.warnings || []),
      ...(item.status === "proposed" ? [`${item.name || item.landmarkId} is proposed`] : [])
    ]));
  };
  landmarks.forEach(item => collect(item, "landmark"));
  measurements.forEach(item => collect(item, "measurement"));
  return {
    selectedAnalysisPresets: Array.from(byPreset.values()),
    generatedLandmarksCount: landmarks.filter(item => item.analysisPresetId).length,
    generatedMeasurementsCount: measurements.filter(item => item.analysisPresetId).length,
    warnings: Array.from(new Set(Array.from(byPreset.values()).flatMap(item => item.warnings)))
  };
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

function getReadiness(job) {
  const artifactPath = getArtifactPath(job.jobId);
  const readiness = checkModelReadiness(job, { artifactPath, settings: normalizeReconstructionSettings(job.settings) });
  job.readinessScore = readiness.readinessScore;
  job.readinessLevel = readiness.readinessLevel;
  job.canOpenInViewer = readiness.canOpenInViewer;
  job.canUseForVisualization = readiness.canUseForVisualization;
  job.canUseForMeasurements = readiness.canUseForMeasurements;
  job.readinessWarnings = readiness.readinessWarnings;
  job.readinessMetadata = readiness.readinessMetadata;
  return readiness;
}

function buildResultObject(job) {
  const checks = getResultChecks(job);
  const readiness = getReadiness(job);
  const settings = normalizeReconstructionSettings(job.settings);
  return {
    jobId: job.jobId,
    caseId: job.caseId || "",
    resultGlbUrl: checks.canOpen ? job.resultGlbUrl : "",
    rawMeshPath: job.rawMeshPath ? "raw-model.glb" : "",
    cleanedMeshPath: checks.glbExists ? getPublicArtifactUrl(job.jobId) : "",
    createdAt: job.updatedAt || job.createdAt,
    inputType: job.fileType || "unknown",
    filesCount: (job.files || []).length,
    selectedFramesCount: job.selectedFramesCount || 0,
    finalSelectedFramesCount: job.finalSelectedFramesCount || job.selectedFramesCount || 0,
    settings,
    reconstructionQuality: job.reconstructionQuality || "poor",
    cleanupQuality: job.cleanupQuality || "poor",
    warnings: collectWarnings(job),
    readinessScore: readiness.readinessScore,
    readinessLevel: readiness.readinessLevel,
    canOpenInViewer: readiness.canOpenInViewer,
    canUseForVisualization: readiness.canUseForVisualization,
    canUseForMeasurements: readiness.canUseForMeasurements,
    readinessWarnings: readiness.readinessWarnings,
    metadata: {
      caseId: job.caseId || "",
      resultModelSource: job.resultModelSource || "mock",
      cleanupMode: job.cleanupMode || "mock",
      reconstructionMode: job.reconstructionMode || "mock",
      engineMode: job.engineMode || job.reconstructionMode || "mock",
      engineCommand: job.engineCommand || "",
      engineExitCode: Number.isInteger(job.engineExitCode) ? job.engineExitCode : null,
      engineName: job.engineName || "",
      engineJobId: job.engineJobId || "",
      masksCount: job.masksCount || 0,
      successfulMasksCount: job.successfulMasksCount || 0,
      failedMasksCount: job.failedMasksCount || 0,
      averageMaskCoverage: job.averageMaskCoverage || 0,
      reviewRequired: Boolean(job.reviewRequired),
      reviewedByUser: Boolean(job.reviewedByUser),
      finalSelectedFramesCount: job.finalSelectedFramesCount || job.selectedFramesCount || 0,
      manuallyExcludedFramesCount: job.manuallyExcludedFramesCount || 0,
      manuallyRestoredFramesCount: job.manuallyRestoredFramesCount || 0,
      segmentationMode: job.segmentationMode || "mock",
      inputFramesCount: job.inputFramesCount || 0,
      inputMasksCount: job.inputMasksCount || 0,
      inputMeshFormat: job.inputMeshFormat || "",
      conversionMode: job.conversionMode || "mock",
      conversionSuccess: Boolean(job.conversionSuccess),
      outputFormat: "GLB",
      cleanupSuccess: Boolean(job.cleanupSuccess),
      cleanedModelReady: Boolean(job.cleanupSuccess && job.resultGlbUrl),
      alignmentMode: job.alignmentMode || "mock",
      alignmentSuccess: Boolean(job.alignmentSuccess),
      orientationStatus: job.orientationStatus || "",
      adjustmentApplied: Boolean(job.adjustmentApplied),
      adjustmentValues: job.adjustmentValues || {},
      removedArtifactsCount: job.removedArtifactsCount || 0,
      removedComponentsCount: job.removedComponentsCount || job.removedArtifactsCount || 0,
      holesRepairedCount: job.holesRepairedCount || 0,
      decimationRatio: job.decimationRatio || 1,
      readiness: readiness.readinessMetadata,
      settings
    },
    checks
  };
}

function buildHistoryItem(job) {
  const result = buildResultObject(job);
  return {
    jobId: job.jobId,
    caseId: job.caseId || "",
    createdAt: job.createdAt,
    status: job.status,
    inputType: job.fileType || "unknown",
    filesCount: (job.files || []).length,
    resultGlbUrl: result.checks.canOpen ? result.resultGlbUrl : "",
    reconstructionQuality: job.reconstructionQuality || "poor",
    cleanupQuality: job.cleanupQuality || "poor",
    warningsCount: result.warnings.length,
    readinessScore: result.readinessScore,
    readinessLevel: result.readinessLevel,
    settings: result.settings
  };
}

function listReconstructionHistory(filter = "all", caseFilter = "all") {
  const normalizedFilter = String(filter || "all").toLowerCase();
  const normalizedCase = String(caseFilter || "all");
  return listMutableJobs()
    .map(buildHistoryItem)
    .filter(item => normalizedFilter === "all" || item.status === normalizedFilter)
    .filter(item => normalizedCase === "all" || item.caseId === normalizedCase)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function getReconstructionResult(jobId) {
  const job = getMutableJob(jobId);
  if (!job) return null;
  const result = buildResultObject(job);
  if (result.checks.canOpen && job.caseId) addModelToCase(job.caseId, result.resultGlbUrl || job.jobId);
  return result;
}

function buildReconstructionReport(jobId) {
  const job = getMutableJob(jobId);
  if (!job) return null;
  const result = buildResultObject(job);
  const settings = normalizeReconstructionSettings(job.settings);
  const modelId = result.resultGlbUrl || job.resultGlbUrl || job.jobId;
  const measurements = listMeasurements({
    caseId: job.caseId || "all",
    jobId: job.jobId,
    modelId
  });
  const landmarks = listLandmarks({
    caseId: job.caseId || "all",
    jobId: job.jobId,
    modelId
  });
  const landmarkTemplateReport = summarizeLandmarkTemplates(landmarks);
  const aiLandmarkReport = summarizeAiLandmarks(landmarks);
  const measurementTemplateReport = summarizeMeasurementTemplates(measurements);
  const autoMeasurementReport = summarizeCalculatedMeasurements(measurements);
  const clinicalAnalysisPresetReport = summarizeClinicalAnalysisPresets(landmarks, measurements);
  const surgicalSimulations = listSimulations({
    caseId: job.caseId || "all",
    jobId: job.jobId,
    modelId: result.resultGlbUrl || job.jobId
  });
  // TODO: Add PDF/DOCX reconstruction report exporters from this JSON shape without reusing 2D/3D clinical export functions.
  const report = {
    jobId: job.jobId,
    caseId: job.caseId || "",
    createdAt: job.createdAt,
    generatedAt: new Date().toISOString(),
    exportFormats: ["json"],
    inputType: job.fileType || "unknown",
    filesCount: (job.files || []).length,
    videoMetadata: job.videoMetadata || null,
    extractedFramesCount: job.extractedFramesCount || 0,
    selectedFramesCount: job.selectedFramesCount || 0,
    rejectedFramesCount: job.rejectedFramesCount || 0,
    reviewRequired: Boolean(job.reviewRequired),
    reviewedByUser: Boolean(job.reviewedByUser),
    finalSelectedFramesCount: job.finalSelectedFramesCount || job.selectedFramesCount || 0,
    manuallyExcludedFramesCount: job.manuallyExcludedFramesCount || 0,
    manuallyRestoredFramesCount: job.manuallyRestoredFramesCount || 0,
    readinessScore: result.readinessScore,
    readinessLevel: result.readinessLevel,
    readinessWarnings: result.readinessWarnings,
    resultGlbUrl: result.resultGlbUrl,
    settings,
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
    reviewReport: {
      reviewRequired: Boolean(job.reviewRequired),
      reviewedByUser: Boolean(job.reviewedByUser),
      reviewCompletedAt: job.reviewCompletedAt || "",
      selectedFramesCount: job.selectedFramesCount || 0,
      rejectedFramesCount: job.rejectedFramesCount || 0,
      finalSelectedFramesCount: job.finalSelectedFramesCount || job.selectedFramesCount || 0,
      manuallyExcludedFramesCount: job.manuallyExcludedFramesCount || 0,
      manuallyRestoredFramesCount: job.manuallyRestoredFramesCount || 0
    },
    segmentationReport: {
      segmentationMode: job.segmentationMode || "mock",
      masksCount: job.masksCount || 0,
      successfulMasksCount: job.successfulMasksCount || 0,
      failedMasksCount: job.failedMasksCount || 0,
      averageMaskCoverage: job.averageMaskCoverage || 0,
      segmentationQuality: job.segmentationQuality || "poor",
      warnings: job.segmentationWarnings || []
    },
    reconstructionReport: {
      reconstructionMode: job.reconstructionMode || "mock",
      engineMode: job.engineMode || job.reconstructionMode || "mock",
      engineCommand: job.engineCommand || "",
      engineExitCode: Number.isInteger(job.engineExitCode) ? job.engineExitCode : null,
      engineStdout: job.engineStdout || "",
      engineStderr: job.engineStderr || "",
      engineName: job.engineName || "",
      engineJobId: job.engineJobId || "",
      inputFramesCount: job.inputFramesCount || 0,
      inputMasksCount: job.inputMasksCount || 0,
      rawMeshPath: job.rawMeshPath ? "raw-model.glb" : "",
      reconstructionQuality: job.reconstructionQuality || "poor",
      warnings: job.reconstructionWarnings || []
    },
    conversionReport: {
      inputMeshFormat: job.inputMeshFormat || "",
      conversionMode: job.conversionMode || "mock",
      conversionSuccess: Boolean(job.conversionSuccess),
      outputGlbPath: job.outputGlbPath ? "result.glb" : "",
      outputFormat: "GLB",
      warnings: job.conversionWarnings || []
    },
    cleanupReport: {
      cleanupMode: job.cleanupMode || "mock",
      cleanupQuality: job.cleanupQuality || "poor",
      resultModelSource: job.resultModelSource || "mock",
      inputMeshPath: job.inputMeshPath ? "input-mesh.glb" : "",
      cleanedMeshPath: result.cleanedMeshPath,
      cleanupSuccess: Boolean(job.cleanupSuccess),
      cleanedModelReady: Boolean(job.cleanupSuccess && result.resultGlbUrl),
      removedComponentsCount: job.removedComponentsCount || job.removedArtifactsCount || 0,
      removedArtifactsCount: job.removedArtifactsCount || 0,
      holesRepairedCount: job.holesRepairedCount || 0,
      decimationRatio: job.decimationRatio || 1,
      cleanedMeshPath: result.cleanedMeshPath,
      warnings: job.cleanupWarnings || []
    },
    alignmentReport: {
      alignmentMode: job.alignmentMode || "mock",
      boundingBox: job.boundingBox || null,
      scaleFactor: job.scaleFactor || 1,
      centerOffset: job.centerOffset || [0, 0, 0],
      modelCentered: Boolean(job.modelCentered),
      scaleNormalized: Boolean(job.scaleNormalized),
      orientationStatus: job.orientationStatus || "manual_review_required",
      alignedModelPath: job.alignedModelPath ? "aligned.glb" : "",
      alignmentSuccess: Boolean(job.alignmentSuccess),
      warnings: job.alignmentWarnings || []
    },
    adjustmentReport: {
      adjustmentApplied: Boolean(job.adjustmentApplied),
      adjustmentValues: job.adjustmentValues || {},
      adjustedModelPath: job.adjustedModelPath ? "adjusted.glb" : "",
      warnings: job.adjustmentWarnings || []
    },
    measurements,
    measurementTemplateReport,
    measurementTemplatesUsed: measurementTemplateReport.templatesUsed,
    generatedMeasurementsCount: measurementTemplateReport.generatedMeasurementsCount,
    autoMeasurementReport,
    calculatedMeasurements: autoMeasurementReport.calculatedMeasurements,
    clinicalAnalysisPresetReport,
    selectedAnalysisPresets: clinicalAnalysisPresetReport.selectedAnalysisPresets,
    landmarks,
    landmarkTemplateReport,
    landmarkTemplatesUsed: landmarkTemplateReport.templatesUsed,
    placedLandmarksCount: landmarkTemplateReport.placedLandmarksCount,
    missingLandmarksCount: landmarkTemplateReport.missingLandmarksCount,
    aiLandmarkReport,
    aiProposedLandmarks: aiLandmarkReport.aiProposedLandmarks,
    aiApprovedLandmarksCount: aiLandmarkReport.approvedCount,
    aiCorrectedLandmarksCount: aiLandmarkReport.correctedCount,
    aiRejectedLandmarksCount: aiLandmarkReport.rejectedCount,
    aiAverageConfidence: aiLandmarkReport.averageConfidence,
    surgicalSimulations,
    surgicalSimulationsCount: surgicalSimulations.length,
    simulationWarnings: Array.from(new Set(surgicalSimulations.flatMap(item => item.warnings || []))),
    finalResult: result,
    warnings: result.warnings
  };
  if (job.caseId) addReportToCase(job.caseId, `${job.jobId}:report`);
  return report;
}

function buildCaseReport(caseId) {
  const caseItem = getCase(caseId);
  if (!caseItem) return null;
  const jobs = listReconstructionHistory("all", caseId);
  const measurements = listMeasurements({ caseId });
  const landmarks = listLandmarks({ caseId });
  const landmarkTemplateReport = summarizeLandmarkTemplates(landmarks);
  const aiLandmarkReport = summarizeAiLandmarks(landmarks);
  const measurementTemplateReport = summarizeMeasurementTemplates(measurements);
  const autoMeasurementReport = summarizeCalculatedMeasurements(measurements);
  const clinicalAnalysisPresetReport = summarizeClinicalAnalysisPresets(landmarks, measurements);
  const comparisons = listComparisons(caseId);
  const surgicalPlanningNotes = listSurgicalPlans({ caseId });
  const surgicalSimulations = listSimulations({ caseId });
  const clinicalInsights = generateClinicalInsightsForCase(caseId);
  const qaResult = runQaValidationForCase(caseId, { recordAudit: false });
  const qaChecks = qaResult?.checks || listQaChecks({ caseId, status: "all" });
  const qaSummary = qaResult?.summary || { qaScore: 0, readinessLevel: "poor", warningsCount: 0, failuresCount: 0, passedCount: 0, checksCount: qaChecks.length };
  const teamMembers = caseItem.teamMembers || [];
  const caseOwner = teamMembers.find(member => member.memberId === caseItem.ownerId) || teamMembers.find(member => member.role === "owner") || null;
  const contributors = teamMembers
    .filter(member => member.role !== "viewer")
    .map(member => ({
      memberId: member.memberId,
      name: member.name || "",
      role: member.role || "viewer",
      permissions: member.permissions || []
    }));
  const auditEvents = listAuditEvents({ caseId });
  const auditSummary = summarizeAuditEvents(auditEvents);
  const timeline = buildCaseTimeline(caseId, {
    caseItem,
    jobs,
    measurements,
    surgicalPlanningNotes,
    surgicalSimulations
  });
  const resultModels = jobs
    .filter(job => job.resultGlbUrl)
    .map(job => ({
      jobId: job.jobId,
      modelId: job.resultGlbUrl || job.jobId,
      resultGlbUrl: job.resultGlbUrl || "",
      createdAt: job.createdAt,
      readinessScore: job.readinessScore || 0,
      readinessLevel: job.readinessLevel || "poor",
      warningsCount: job.warningsCount || 0
    }));
  const readinessScores = jobs.map(job => ({
    jobId: job.jobId,
    readinessScore: job.readinessScore || 0,
    readinessLevel: job.readinessLevel || "poor"
  }));
  const warnings = jobs
    .filter(job => Number(job.warningsCount || 0) > 0)
    .map(job => ({
      jobId: job.jobId,
      warningsCount: job.warningsCount || 0,
      readinessLevel: job.readinessLevel || "poor"
    }));
  const report = {
    caseId: caseItem.caseId,
    patientName: caseItem.patientName || "",
    patientId: caseItem.patientId || "",
    createdAt: caseItem.createdAt,
    updatedAt: caseItem.updatedAt,
    generatedAt: new Date().toISOString(),
    notes: caseItem.notes || "",
    ownerId: caseItem.ownerId || "",
    caseOwner,
    teamMembers,
    teamMembersCount: teamMembers.length,
    casePermissions: caseItem.permissions || {},
    contributors,
    auditEvents,
    auditSummary,
    reconstructionJobs: jobs,
    jobs,
    resultModels,
    models: caseItem.models || [],
    readinessScores,
    warnings,
    reports: caseItem.reports || [],
    comparisons,
    measurements,
    measurementsCount: measurements.length,
    measurementTemplateReport,
    measurementTemplatesUsed: measurementTemplateReport.templatesUsed,
    generatedMeasurementsCount: measurementTemplateReport.generatedMeasurementsCount,
    autoMeasurementReport,
    calculatedMeasurements: autoMeasurementReport.calculatedMeasurements,
    clinicalAnalysisPresetReport,
    selectedAnalysisPresets: clinicalAnalysisPresetReport.selectedAnalysisPresets,
    landmarks,
    landmarksCount: landmarks.length,
    landmarkTemplateReport,
    landmarkTemplatesUsed: landmarkTemplateReport.templatesUsed,
    placedLandmarksCount: landmarkTemplateReport.placedLandmarksCount,
    missingLandmarksCount: landmarkTemplateReport.missingLandmarksCount,
    aiLandmarkReport,
    aiProposedLandmarks: aiLandmarkReport.aiProposedLandmarks,
    aiApprovedLandmarksCount: aiLandmarkReport.approvedCount,
    aiCorrectedLandmarksCount: aiLandmarkReport.correctedCount,
    aiRejectedLandmarksCount: aiLandmarkReport.rejectedCount,
    aiAverageConfidence: aiLandmarkReport.averageConfidence,
    surgicalPlanningNotes,
    surgicalPlanningNotesCount: surgicalPlanningNotes.length,
    surgicalSimulations,
    surgicalSimulationsCount: surgicalSimulations.length,
    simulationWarnings: Array.from(new Set(surgicalSimulations.flatMap(item => item.warnings || []))),
    clinicalInsights,
    clinicalInsightsCount: clinicalInsights.filter(item => !item.dismissed).length,
    insightsSummary: {
      activeCount: clinicalInsights.filter(item => !item.dismissed).length,
      reviewedCount: clinicalInsights.filter(item => item.reviewed).length,
      dismissedCount: clinicalInsights.filter(item => item.dismissed).length,
      pinnedCount: clinicalInsights.filter(item => item.pinned).length,
      warningCount: clinicalInsights.filter(item => item.severity === "warning").length,
      attentionCount: clinicalInsights.filter(item => item.severity === "attention").length
    },
    backupStatus: {
      backupVersion: BACKUP_VERSION,
      localBackupSupported: true,
      cloudSyncEnabled: false,
      includedData: ["Patient Cases", "Reconstruction Jobs", "Models Metadata", "Measurements", "Landmarks", "Reports", "Timeline", "Surgical Notes", "Simulations", "Clinical Insights"]
    },
    qaChecks,
    qaSummary,
    timeline,
    timelineSummary: {
      timelineId: timeline.timelineId,
      entriesCount: timeline.entries.length,
      reconstructionEntriesCount: timeline.entries.filter(item => item.entryType === "reconstruction").length,
      simulationEntriesCount: timeline.entries.filter(item => item.entryType === "simulation").length,
      reportEntriesCount: timeline.entries.filter(item => item.entryType === "report").length,
      measurementSnapshotEntriesCount: timeline.entries.filter(item => item.entryType === "measurement_snapshot").length,
      noteEntriesCount: timeline.entries.filter(item => item.entryType === "note").length,
      insightEntriesCount: timeline.entries.filter(item => item.entryType === "insight_generated" || item.entryType === "insight_reviewed").length
    },
    TODO: [
      "multiple scans",
      "before/after comparison",
      "operation planning",
      "timeline",
      "soft tissue simulation",
      "bone movement simulation",
      "orthognathic planning",
      "rhinoplasty planning",
      "AI surgical planning"
    ]
  };
  addReportToCase(caseId, `${caseId}:case-report`);
  return report;
}

function buildCaseTimeline(caseId, preloaded = {}) {
  const caseItem = preloaded.caseItem || getCase(caseId);
  if (!caseItem) return null;
  const jobs = preloaded.jobs || listReconstructionHistory("all", caseId);
  const measurements = preloaded.measurements || listMeasurements({ caseId });
  const surgicalPlanningNotes = preloaded.surgicalPlanningNotes || listSurgicalPlans({ caseId });
  const surgicalSimulations = preloaded.surgicalSimulations || listSimulations({ caseId });
  const clinicalInsights = preloaded.clinicalInsights || listClinicalInsights({ caseId, status: "all" });
  const qaChecks = preloaded.qaChecks || listQaChecks({ caseId, status: "all" });
  const entries = [];

  jobs.forEach(job => {
    entries.push({
      entryId: `timeline-entry-${job.jobId}`,
      caseId,
      modelId: job.resultGlbUrl || job.jobId || "",
      reconstructionJobId: job.jobId,
      entryType: "reconstruction",
      title: `Reconstruction ${job.status || ""}`.trim(),
      description: `3D reconstruction job ${job.jobId} · readiness ${job.readinessLevel || "unknown"}`,
      createdAt: job.createdAt || job.updatedAt || caseItem.createdAt
    });
  });

  surgicalSimulations.forEach(simulation => {
    entries.push({
      entryId: `timeline-entry-${simulation.simulationId}`,
      caseId,
      modelId: simulation.simulatedModelId || simulation.modelId || "",
      reconstructionJobId: simulation.jobId || "",
      entryType: "simulation",
      title: `Simulation ${String(simulation.simulationType || "custom_simulation").replace(/_/g, " ")}`,
      description: `Before ${simulation.originalModelId || simulation.modelId || "model"} · simulated ${simulation.simulatedModelId || "model"}`,
      createdAt: simulation.createdAt || simulation.updatedAt || caseItem.updatedAt
    });
  });

  const measurementsByModel = new Map();
  measurements.forEach(measurement => {
    const modelId = measurement.modelId || measurement.jobId || "case";
    if (!measurementsByModel.has(modelId)) measurementsByModel.set(modelId, []);
    measurementsByModel.get(modelId).push(measurement);
  });
  measurementsByModel.forEach((items, modelId) => {
    const latest = items.reduce((best, item) => String(item.updatedAt || item.createdAt || "").localeCompare(String(best.updatedAt || best.createdAt || "")) > 0 ? item : best, items[0]);
    entries.push({
      entryId: `timeline-entry-measurements-${String(modelId).replace(/[^\w.-]+/g, "_")}`,
      caseId,
      modelId,
      reconstructionJobId: latest?.jobId || "",
      entryType: "measurement_snapshot",
      title: "Measurement snapshot",
      description: `${items.length} measurement(s) linked to model ${modelId}`,
      createdAt: latest?.updatedAt || latest?.createdAt || caseItem.updatedAt
    });
  });

  (caseItem.reports || []).forEach(reportId => {
    entries.push({
      entryId: `timeline-entry-report-${String(reportId).replace(/[^\w.-]+/g, "_")}`,
      caseId,
      modelId: "",
      reconstructionJobId: String(reportId).split(":")[0] || "",
      entryType: "report",
      title: "Report",
      description: String(reportId),
      createdAt: caseItem.updatedAt || caseItem.createdAt
    });
  });

  surgicalPlanningNotes.forEach(plan => {
    entries.push({
      entryId: `timeline-entry-note-${plan.planId}`,
      caseId,
      modelId: plan.modelId || "",
      reconstructionJobId: plan.jobId || "",
      entryType: "note",
      title: plan.title || plan.procedureType || "Surgical note",
      description: plan.notes || plan.diagnosis || plan.goals || "Clinical planning note",
      createdAt: plan.updatedAt || plan.createdAt || caseItem.updatedAt
    });
  });

  clinicalInsights.forEach(insight => {
    entries.push({
      entryId: `timeline-entry-insight-${insight.insightId}`,
      caseId,
      modelId: insight.modelId || "",
      reconstructionJobId: "",
      entryType: insight.reviewed ? "insight_reviewed" : "insight_generated",
      title: insight.title || "Clinical insight",
      description: `${insight.category || "custom"} · ${insight.severity || "info"} · ${insight.source || "clinical_insights_engine"}`,
      createdAt: insight.reviewedAt || insight.createdAt || caseItem.updatedAt
    });
  });

  qaChecks.forEach(check => {
    entries.push({
      entryId: `timeline-entry-qa-${check.checkId}`,
      caseId,
      modelId: "",
      reconstructionJobId: "",
      entryType: check.status === "passed" || check.resolved ? "qa_check_completed" : "qa_issue_detected",
      title: check.title || "QA check",
      description: `${check.category || "system"} · ${check.status || "warning"} · ${check.severity || "medium"}`,
      createdAt: check.resolvedAt || check.createdAt || caseItem.updatedAt
    });
  });

  entries.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const createdAt = entries.length ? entries[entries.length - 1].createdAt : caseItem.createdAt;
  const updatedAt = entries.length ? entries[0].createdAt : caseItem.updatedAt;
  return {
    timelineId: `timeline-${caseId}`,
    caseId,
    entries,
    createdAt,
    updatedAt
  };
}

async function deleteReconstructionResult(jobId) {
  const job = getMutableJob(jobId);
  if (!job) return null;
  const meshDir = path.resolve(__dirname, "../tmp/jobs", jobId, "mesh");
  const alignmentDir = path.resolve(__dirname, "../tmp/jobs", jobId, "alignment");
  const adjustmentDir = path.resolve(__dirname, "../tmp/jobs", jobId, "adjustment");
  await fs.rm(meshDir, { recursive: true, force: true });
  await fs.rm(alignmentDir, { recursive: true, force: true });
  await fs.rm(adjustmentDir, { recursive: true, force: true });
  job.resultDeleted = true;
  job.resultGlbUrl = "";
  job.publicCleanedMeshUrl = "";
  job.cleanedMeshPath = "";
  job.alignedModelPath = "";
  job.alignmentSuccess = false;
  job.adjustedModelPath = "";
  job.adjustmentApplied = false;
  job.resultModelSource = "deleted";
  job.warnings = collectWarnings(job);
  job.readinessScore = 0;
  job.readinessLevel = "poor";
  job.canOpenInViewer = false;
  job.canUseForVisualization = false;
  job.canUseForMeasurements = false;
  job.readinessWarnings = [
    "GLB-модель не найдена",
    "Модель может быть непригодна для точных измерений",
    "Требуется ручная проверка перед клиническим использованием"
  ];
  saveJob(job);
  return buildResultObject(job);
}

module.exports = {
  buildResultObject,
  buildHistoryItem,
  listReconstructionHistory,
  getReconstructionResult,
  buildReconstructionReport,
  buildCaseReport,
  buildCaseTimeline,
  deleteReconstructionResult,
  getArtifactPath,
  getPublicArtifactUrl
};
