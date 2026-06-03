const { ERROR_CODES, STATUSES } = require("./constants");
const { ApiError } = require("./errors");
const {
  createComparison,
  getComparison,
  getMutableJob,
  listComparisons,
  addReportToCase
} = require("./store");
const { buildResultObject } = require("./reconstruction-results");

const COMPARISON_MODES = new Set(["show_before", "show_after", "overlay", "side_by_side"]);

function ensureReadyJob(jobId) {
  const job = getMutableJob(jobId);
  if (!job) throw new ApiError(404, ERROR_CODES.jobNotFound, "Comparison model job not found.");
  if (job.status !== STATUSES.ready) {
    throw new ApiError(409, ERROR_CODES.resultNotReady, "Comparison model must be ready.");
  }
  return job;
}

function normalizeComparisonInput(input = {}) {
  const comparisonMode = COMPARISON_MODES.has(input.comparisonMode)
    ? input.comparisonMode
    : "show_before";
  return {
    caseId: String(input.caseId || "").trim(),
    beforeJobId: String(input.beforeJobId || "").trim(),
    afterJobId: String(input.afterJobId || "").trim(),
    notes: String(input.notes || "").trim(),
    comparisonMode
  };
}

function createModelComparison(input = {}) {
  const normalized = normalizeComparisonInput(input);
  if (!normalized.caseId || !normalized.beforeJobId || !normalized.afterJobId) {
    throw new ApiError(400, ERROR_CODES.validationFailed, "caseId, beforeJobId, and afterJobId are required.");
  }
  if (normalized.beforeJobId === normalized.afterJobId) {
    throw new ApiError(400, ERROR_CODES.validationFailed, "Before and after models must be different.");
  }

  const beforeJob = ensureReadyJob(normalized.beforeJobId);
  const afterJob = ensureReadyJob(normalized.afterJobId);
  if (beforeJob.caseId !== normalized.caseId || afterJob.caseId !== normalized.caseId) {
    throw new ApiError(400, ERROR_CODES.validationFailed, "Both comparison models must belong to the selected case.");
  }

  return createComparison(normalized);
}

function buildComparisonReport(comparisonId) {
  const comparison = getComparison(comparisonId);
  if (!comparison) return null;
  const beforeJob = ensureReadyJob(comparison.beforeJobId);
  const afterJob = ensureReadyJob(comparison.afterJobId);
  const beforeResult = buildResultObject(beforeJob);
  const afterResult = buildResultObject(afterJob);
  const report = {
    comparisonId: comparison.comparisonId,
    caseId: comparison.caseId,
    createdAt: comparison.createdAt,
    generatedAt: new Date().toISOString(),
    comparisonMode: comparison.comparisonMode,
    notes: comparison.notes || "",
    beforeModel: {
      jobId: beforeJob.jobId,
      resultGlbUrl: beforeResult.resultGlbUrl,
      createdAt: beforeJob.createdAt,
      readinessScore: beforeResult.readinessScore,
      readinessLevel: beforeResult.readinessLevel,
      warnings: beforeResult.warnings
    },
    afterModel: {
      jobId: afterJob.jobId,
      resultGlbUrl: afterResult.resultGlbUrl,
      createdAt: afterJob.createdAt,
      readinessScore: afterResult.readinessScore,
      readinessLevel: afterResult.readinessLevel,
      warnings: afterResult.warnings
    },
    warnings: Array.from(new Set([
      ...(beforeResult.warnings || []).map(item => `Before: ${item}`),
      ...(afterResult.warnings || []).map(item => `After: ${item}`)
    ]))
  };
  addReportToCase(comparison.caseId, `${comparison.comparisonId}:comparison-report`);
  return report;
}

module.exports = {
  COMPARISON_MODES,
  createModelComparison,
  listModelComparisons: listComparisons,
  buildComparisonReport
};
