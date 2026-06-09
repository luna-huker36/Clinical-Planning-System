const READINESS_SCOPES = new Set(["case", "model", "report", "system"]);
const READINESS_LEVELS = new Set(["not_ready", "limited", "ready", "production_ready"]);
const CHECK_STATUSES = new Set(["passed", "warning", "failed"]);

function normalizeReadinessCheck(input = {}) {
  return {
    checkId: String(input.checkId || ""),
    scope: READINESS_SCOPES.has(input.scope) ? input.scope : "case",
    status: CHECK_STATUSES.has(input.status) ? input.status : "warning",
    title: String(input.title || "Readiness check"),
    description: String(input.description || ""),
    warning: String(input.warning || "")
  };
}

function readinessLevelFromScore(score) {
  if (score >= 90) return "production_ready";
  if (score >= 75) return "ready";
  if (score >= 50) return "limited";
  return "not_ready";
}

function summarizeReadinessChecks(checks = []) {
  const normalized = checks.map(normalizeReadinessCheck);
  const failedChecks = normalized.filter(item => item.status === "failed");
  const warningChecks = normalized.filter(item => item.status === "warning");
  const passedChecks = normalized.filter(item => item.status === "passed");
  const score = Math.max(0, Math.min(100, 100 - failedChecks.length * 18 - warningChecks.length * 8));
  return {
    productionScore: score,
    readinessLevel: readinessLevelFromScore(score),
    passedChecks: passedChecks.length,
    failedChecks: failedChecks.length,
    warnings: warningChecks.length
  };
}

function normalizeReadiness(input = {}, context = {}) {
  const makeId = typeof context.makeId === "function" ? context.makeId : prefix => `${prefix}-${Date.now().toString(36)}`;
  const nowIso = typeof context.nowIso === "function" ? context.nowIso : () => new Date().toISOString();
  const checks = Array.isArray(input.checks) ? input.checks.map(normalizeReadinessCheck) : [];
  const summary = summarizeReadinessChecks(checks);
  const score = Number.isFinite(Number(input.score)) ? Math.max(0, Math.min(100, Number(input.score))) : summary.productionScore;
  return {
    readinessId: String(input.readinessId || makeId("readiness")),
    caseId: String(input.caseId || context.caseId || ""),
    modelId: String(input.modelId || ""),
    reportId: String(input.reportId || ""),
    scope: READINESS_SCOPES.has(input.scope) ? input.scope : "case",
    score,
    level: READINESS_LEVELS.has(input.level) ? input.level : readinessLevelFromScore(score),
    checks,
    createdAt: input.createdAt || nowIso(),
    productionScore: score,
    readinessLevel: READINESS_LEVELS.has(input.readinessLevel) ? input.readinessLevel : readinessLevelFromScore(score),
    passedChecks: Number.isFinite(Number(input.passedChecks)) ? Number(input.passedChecks) : summary.passedChecks,
    failedChecks: Number.isFinite(Number(input.failedChecks)) ? Number(input.failedChecks) : summary.failedChecks,
    warnings: Number.isFinite(Number(input.warnings)) ? Number(input.warnings) : summary.warnings
  };
}

function generateProductionReadiness(input = {}, context = {}) {
  const scope = READINESS_SCOPES.has(input.scope) ? input.scope : "case";
  const caseId = String(input.caseId || context.caseId || input.caseItem?.caseId || "");
  const caseItem = input.caseItem || {};
  const jobs = input.jobs || [];
  const model = input.model || jobs.find(item => item.jobId === input.modelId || item.resultGlbUrl === input.modelId) || jobs[0] || {};
  const measurements = input.measurements || [];
  const landmarks = input.landmarks || [];
  const reports = input.reports || caseItem.reports || [];
  const qaSummary = input.qaSummary || {};
  const auditEvents = input.auditEvents || [];
  const timeline = input.timeline || null;
  const backupStatus = input.backupStatus || {};
  const systemFailures = input.systemFailures || [];
  const checks = [];
  const add = check => checks.push(normalizeReadinessCheck({
    checkId: String(check.checkId || `${scope}-${checks.length + 1}`),
    scope,
    ...check
  }));

  if (scope === "case") {
    add({ status: caseItem.caseId ? "passed" : "failed", title: "Patient case exists", description: caseItem.caseId ? `Case ${caseItem.caseId} exists.` : "Patient case metadata is missing." });
    add({ status: jobs.length ? "passed" : "failed", title: "Reconstruction exists", description: jobs.length ? `${jobs.length} reconstruction job(s) linked.` : "No reconstruction job is linked." });
    add({ status: reports.length ? "passed" : "warning", title: "Report exists", description: reports.length ? `${reports.length} report reference(s) attached.` : "No report reference is attached yet." });
    add({ status: measurements.length ? "passed" : "warning", title: "Measurements exist", description: measurements.length ? `${measurements.length} measurement(s) stored.` : "No measurement data is stored." });
    const missingRequired = landmarks.filter(item => item.required && !["placed", "approved", "corrected"].includes(item.status));
    add({
      status: landmarks.some(item => item.required) && !missingRequired.length ? "passed" : missingRequired.length ? "failed" : "warning",
      title: "Required landmarks exist",
      description: missingRequired.length ? `${missingRequired.length} required landmark(s) are missing.` : landmarks.some(item => item.required) ? "Required landmarks are present." : "No required landmarks are defined."
    });
  }

  if (scope === "model") {
    add({ status: model.resultGlbUrl || model.outputGlbPath ? "passed" : "failed", title: "GLB available", description: model.resultGlbUrl || model.outputGlbPath ? "Model GLB metadata is available." : "No GLB model artifact is attached." });
    add({ status: Number(model.readinessScore) > 0 ? "passed" : "warning", title: "Readiness score exists", description: Number(model.readinessScore) > 0 ? `Readiness score ${Math.round(Number(model.readinessScore))}/100.` : "Readiness score is missing." });
    add({ status: qaSummary.failuresCount ? "failed" : qaSummary.warningsCount ? "warning" : "passed", title: "QA passed", description: qaSummary.failuresCount ? `${qaSummary.failuresCount} QA failure(s) remain.` : qaSummary.warningsCount ? `${qaSummary.warningsCount} QA warning(s) remain.` : "No active QA issues detected." });
    const criticalWarnings = [
      ...(model.warnings || []),
      ...(model.readinessWarnings || []),
      ...(model.reconstructionWarnings || [])
    ].filter(item => /critical|fatal|error/i.test(String(item)));
    add({ status: criticalWarnings.length || model.status === "error" ? "failed" : "passed", title: "No critical warnings", description: criticalWarnings.length || model.status === "error" ? "Critical model warning/error detected." : "No critical model warning detected." });
  }

  if (scope === "report") {
    add({ status: reports.length ? "passed" : "warning", title: "Report generated", description: reports.length ? `${reports.length} report reference(s) stored.` : "No report has been generated for this case." });
    add({ status: "passed", title: "Export available", description: "JSON/PDF/DOCX report export controls are available in PMAS." });
    const requiredSections = ["case", "reconstruction", "measurements", "landmarks", "qa", "clinical insights"];
    const missingSections = [];
    if (!caseItem.caseId) missingSections.push("case");
    if (!jobs.length) missingSections.push("reconstruction");
    if (!measurements.length) missingSections.push("measurements");
    if (!landmarks.length) missingSections.push("landmarks");
    if (qaSummary.checksCount === 0 && !Number.isFinite(Number(qaSummary.qaScore))) missingSections.push("qa");
    add({
      status: missingSections.length ? "warning" : "passed",
      title: "Required sections present",
      description: missingSections.length ? `Review report sections: ${missingSections.join(", ")}.` : `Required sections present: ${requiredSections.join(", ")}.`
    });
  }

  if (scope === "system") {
    add({ status: backupStatus.localBackupSupported === false ? "failed" : "passed", title: "Backup available", description: "Local PMAS Backup JSON export/restore layer is available." });
    add({ status: auditEvents.length || input.auditLogAvailable ? "passed" : "warning", title: "Audit log available", description: auditEvents.length ? `${auditEvents.length} audit event(s) stored.` : "Audit log module is available; no events found for this scope." });
    add({ status: timeline || input.timelineAvailable ? "passed" : "warning", title: "Timeline available", description: timeline?.entries ? `${timeline.entries.length} timeline event(s) available.` : "Timeline module is available." });
    add({ status: systemFailures.length ? "failed" : "passed", title: "No critical failures", description: systemFailures.length ? `${systemFailures.length} critical system failure(s) detected.` : "No critical PMAS failures detected by readiness check." });
  }

  const summary = summarizeReadinessChecks(checks);
  return normalizeReadiness({
    caseId,
    modelId: String(input.modelId || model.resultGlbUrl || model.jobId || ""),
    reportId: String(input.reportId || reports[0] || ""),
    scope,
    checks,
    score: summary.productionScore,
    level: summary.readinessLevel,
    ...summary
  }, context);
}

module.exports = {
  READINESS_SCOPES,
  READINESS_LEVELS,
  normalizeReadiness,
  generateProductionReadiness,
  summarizeReadinessChecks,
  readinessLevelFromScore
};
