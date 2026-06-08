const QA_CATEGORIES = new Set([
  "reconstruction",
  "model_quality",
  "landmarks",
  "measurements",
  "reports",
  "simulations",
  "patient_case",
  "backup",
  "system"
]);

const QA_STATUSES = new Set(["passed", "warning", "failed"]);
const QA_SEVERITIES = new Set(["low", "medium", "high", "critical"]);

function normalizeCheck(input = {}, context = {}) {
  const makeId = typeof context.makeId === "function" ? context.makeId : prefix => `${prefix}-${Date.now().toString(36)}`;
  const nowIso = typeof context.nowIso === "function" ? context.nowIso : () => new Date().toISOString();
  return {
    checkId: String(input.checkId || makeId("qa-check")),
    caseId: String(input.caseId || context.caseId || ""),
    category: QA_CATEGORIES.has(input.category) ? input.category : "system",
    status: QA_STATUSES.has(input.status) ? input.status : "warning",
    severity: QA_SEVERITIES.has(input.severity) ? input.severity : "medium",
    title: String(input.title || "QA check"),
    description: String(input.description || ""),
    createdAt: input.createdAt || nowIso(),
    resolved: Boolean(input.resolved),
    resolvedAt: input.resolvedAt || ""
  };
}

function readinessLevelFromScore(score) {
  if (score >= 90) return "excellent";
  if (score >= 75) return "good";
  if (score >= 50) return "medium";
  return "poor";
}

function calculateQaSummary(checks = []) {
  const active = checks.filter(item => !item.resolved);
  const warningsCount = active.filter(item => item.status === "warning").length;
  const failuresCount = active.filter(item => item.status === "failed").length;
  const criticalCount = active.filter(item => item.severity === "critical").length;
  const score = Math.max(0, Math.min(100, 100 - failuresCount * 18 - warningsCount * 7 - criticalCount * 15));
  return {
    qaScore: score,
    readinessLevel: readinessLevelFromScore(score),
    warningsCount,
    failuresCount,
    passedCount: active.filter(item => item.status === "passed").length,
    checksCount: active.length
  };
}

function generateQaChecks(input = {}, context = {}) {
  const caseId = String(input.caseId || context.caseId || "");
  const makeId = context.makeId;
  const nowIso = context.nowIso;
  const caseItem = input.caseItem || {};
  const jobs = input.jobs || [];
  const measurements = input.measurements || [];
  const landmarks = input.landmarks || [];
  const reports = caseItem.reports || [];
  const notes = input.surgicalPlanningNotes || [];
  const simulations = input.simulations || [];
  const backupStatus = input.backupStatus || {};
  const checks = [];
  const add = check => checks.push(normalizeCheck({ caseId, ...check }, { caseId, makeId, nowIso }));

  add({
    category: "patient_case",
    status: caseItem.patientName ? "passed" : "failed",
    severity: caseItem.patientName ? "low" : "high",
    title: "Patient data present",
    description: caseItem.patientName ? "Patient name is present." : "Patient name is missing."
  });
  add({
    category: "patient_case",
    status: jobs.length || (caseItem.models || []).length ? "passed" : "warning",
    severity: jobs.length || (caseItem.models || []).length ? "low" : "medium",
    title: "Model attached",
    description: jobs.length || (caseItem.models || []).length ? "Case has model/job metadata." : "No reconstruction model metadata is attached."
  });
  add({
    category: "patient_case",
    status: notes.length || caseItem.notes ? "passed" : "warning",
    severity: notes.length || caseItem.notes ? "low" : "medium",
    title: "Clinical notes present",
    description: notes.length || caseItem.notes ? "Case has notes/planning notes." : "No case notes or planning notes are present."
  });

  const readyJobs = jobs.filter(item => item.status === "ready");
  add({
    category: "reconstruction",
    status: readyJobs.length ? "passed" : "warning",
    severity: readyJobs.length ? "low" : "medium",
    title: "Reconstruction completed",
    description: readyJobs.length ? `${readyJobs.length} reconstruction job(s) are ready.` : "No completed reconstruction job found."
  });
  const resultJobs = jobs.filter(item => item.resultGlbUrl);
  add({
    category: "reconstruction",
    status: resultJobs.length ? "passed" : "warning",
    severity: resultJobs.length ? "low" : "high",
    title: "Result GLB exists",
    description: resultJobs.length ? "Result GLB metadata is available." : "No result GLB URL is stored."
  });
  const readinessJobs = jobs.filter(item => Number.isFinite(Number(item.readinessScore)) && Number(item.readinessScore) > 0);
  add({
    category: "model_quality",
    status: readinessJobs.length ? "passed" : "warning",
    severity: readinessJobs.length ? "low" : "medium",
    title: "Readiness score exists",
    description: readinessJobs.length ? "At least one model has readiness score metadata." : "Readiness score metadata is missing."
  });
  const criticalErrors = jobs.filter(item => item.status === "error" || item.errorMessage);
  if (criticalErrors.length) add({
    category: "reconstruction",
    status: "failed",
    severity: "critical",
    title: "Critical reconstruction errors detected",
    description: `${criticalErrors.length} job(s) contain error status or error message.`
  });
  else add({ category: "reconstruction", status: "passed", severity: "low", title: "No critical reconstruction errors", description: "No job error status was found." });

  const requiredLandmarks = landmarks.filter(item => item.required);
  const missingLandmarks = landmarks.filter(item => item.status === "unplaced" || (item.required && !["placed", "approved", "corrected"].includes(item.status)));
  add({
    category: "landmarks",
    status: requiredLandmarks.length && !missingLandmarks.length ? "passed" : missingLandmarks.length ? "failed" : "warning",
    severity: missingLandmarks.length ? "high" : requiredLandmarks.length ? "low" : "medium",
    title: "Required landmarks exist",
    description: missingLandmarks.length ? `${missingLandmarks.length} required/missing landmark issue(s) detected.` : requiredLandmarks.length ? "Required landmarks are present." : "No required landmarks are defined."
  });
  const approvedCount = landmarks.filter(item => ["approved", "corrected"].includes(item.status)).length;
  add({ category: "landmarks", status: approvedCount ? "passed" : "warning", severity: approvedCount ? "low" : "medium", title: "Approved landmarks count", description: `${approvedCount} landmark(s) are approved or corrected.` });
  const lowConfidence = landmarks.filter(item => Number.isFinite(Number(item.confidence)) && Number(item.confidence) < 60);
  if (lowConfidence.length) add({ category: "landmarks", status: "warning", severity: "medium", title: "Low confidence landmarks", description: `${lowConfidence.length} landmark(s) have confidence below 60%.` });

  add({ category: "measurements", status: measurements.length ? "passed" : "warning", severity: measurements.length ? "low" : "medium", title: "Measurements calculated", description: measurements.length ? `${measurements.length} measurement(s) stored.` : "No measurements are stored." });
  const invalidMeasurements = measurements.filter(item => item.status === "error" || (item.value !== null && item.value !== undefined && Number.isNaN(Number(item.value))));
  if (invalidMeasurements.length) add({ category: "measurements", status: "failed", severity: "high", title: "Invalid measurement values", description: `${invalidMeasurements.length} measurement(s) have invalid values or error status.` });
  const outdatedMeasurements = measurements.filter(item => item.status === "missing_landmarks" || item.status === "needs_review" || (item.warnings || []).length);
  if (outdatedMeasurements.length) add({ category: "measurements", status: "warning", severity: "medium", title: "Outdated or review-needed measurements", description: `${outdatedMeasurements.length} measurement(s) need review or depend on missing landmarks.` });

  add({ category: "reports", status: reports.length ? "passed" : "warning", severity: reports.length ? "low" : "medium", title: "Report generated", description: reports.length ? `${reports.length} report link(s) are attached.` : "No report link is attached to the case." });
  add({ category: "reports", status: "passed", severity: "low", title: "Report export available", description: "JSON/PDF/DOCX report export controls are available in PMAS." });

  add({ category: "simulations", status: simulations.length ? "passed" : "warning", severity: simulations.length ? "low" : "low", title: "Simulation data", description: simulations.length ? `${simulations.length} simulation object(s) stored.` : "No simulation object is stored." });
  add({ category: "backup", status: backupStatus.localBackupSupported === false ? "failed" : "passed", severity: backupStatus.localBackupSupported === false ? "high" : "low", title: "Backup system available", description: "Local PMAS Backup JSON export/restore layer is available." });
  add({ category: "system", status: "passed", severity: "low", title: "System validation completed", description: "Technical QA checks completed. This is not medical validation." });

  return checks;
}

module.exports = {
  QA_CATEGORIES,
  QA_STATUSES,
  QA_SEVERITIES,
  normalizeCheck,
  generateQaChecks,
  calculateQaSummary
};
