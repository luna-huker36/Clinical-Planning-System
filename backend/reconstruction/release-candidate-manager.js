const RELEASE_STATUSES = new Set(["draft", "testing", "release_candidate", "approved", "archived"]);
const VERSION_FORMAT = /^v(?:0\.[159]|1\.[01])$/;

function releaseLevelFromScores(qaScore, readinessScore) {
  const qa = Number(qaScore) || 0;
  const readiness = Number(readinessScore) || 0;
  return Math.round((qa + readiness) / 2);
}

function normalizeReleaseCandidate(input = {}, context = {}) {
  const makeId = typeof context.makeId === "function" ? context.makeId : prefix => `${prefix}-${Date.now().toString(36)}`;
  const nowIso = typeof context.nowIso === "function" ? context.nowIso : () => new Date().toISOString();
  const version = VERSION_FORMAT.test(String(input.version || "")) ? String(input.version) : "v0.1";
  const qaScore = Number.isFinite(Number(input.qaScore)) ? Math.max(0, Math.min(100, Number(input.qaScore))) : 0;
  const readinessScore = Number.isFinite(Number(input.readinessScore)) ? Math.max(0, Math.min(100, Number(input.readinessScore))) : 0;
  return {
    releaseId: String(input.releaseId || makeId("release")),
    version,
    name: String(input.name || `PMAS ${version}`).trim() || `PMAS ${version}`,
    description: String(input.description || "").trim(),
    createdAt: input.createdAt || nowIso(),
    updatedAt: input.updatedAt || input.createdAt || nowIso(),
    status: RELEASE_STATUSES.has(input.status) ? input.status : "draft",
    readinessScore,
    qaScore,
    notes: String(input.notes || "").trim(),
    snapshot: input.snapshot && typeof input.snapshot === "object" ? input.snapshot : {},
    validation: input.validation && typeof input.validation === "object" ? input.validation : {},
    history: Array.isArray(input.history) ? input.history.map(item => ({
      eventId: String(item.eventId || makeId("release-event")),
      eventType: String(item.eventType || "release_created"),
      createdAt: item.createdAt || nowIso(),
      details: item.details && typeof item.details === "object" ? { ...item.details } : {}
    })) : []
  };
}

function summarizeReleaseSnapshot(snapshot = {}) {
  const cases = Array.isArray(snapshot.cases) ? snapshot.cases : [];
  const qaData = snapshot.qaData || {};
  const readiness = snapshot.readiness || {};
  return {
    casesCount: cases.length,
    reportsCount: cases.reduce((sum, item) => sum + Number(item.reports?.length || 0), 0),
    templatesCount: Number(snapshot.templates?.landmarkTemplates?.length || 0),
    qaChecksCount: Number(qaData.checks?.length || 0),
    readinessChecksCount: Number(readiness.items?.length || 0)
  };
}

function validateReleaseCandidate(input = {}) {
  const qaScore = Number(input.qaScore) || 0;
  const readinessScore = Number(input.readinessScore) || 0;
  const qaFailures = Number(input.qaFailures || 0);
  const criticalFailures = Number(input.criticalFailures || 0);
  const readinessFailures = Number(input.readinessFailures || 0);
  const backupAvailable = input.backupAvailable !== false;
  const checks = [
    {
      checkId: "release-qa-passed",
      status: qaScore >= 75 && qaFailures === 0 ? "passed" : "failed",
      title: "QA passed",
      description: qaScore >= 75 && qaFailures === 0 ? `QA score ${Math.round(qaScore)}/100.` : `QA score ${Math.round(qaScore)}/100 with ${qaFailures} failure(s).`
    },
    {
      checkId: "release-readiness-passed",
      status: readinessScore >= 75 && readinessFailures === 0 ? "passed" : "failed",
      title: "Production Readiness passed",
      description: readinessScore >= 75 && readinessFailures === 0 ? `Readiness score ${Math.round(readinessScore)}/100.` : `Readiness score ${Math.round(readinessScore)}/100 with ${readinessFailures} failure(s).`
    },
    {
      checkId: "release-backup-available",
      status: backupAvailable ? "passed" : "failed",
      title: "Backup available",
      description: backupAvailable ? "Local PMAS Backup JSON layer is available." : "Backup layer is unavailable."
    },
    {
      checkId: "release-no-critical-failures",
      status: criticalFailures === 0 ? "passed" : "failed",
      title: "No critical failures",
      description: criticalFailures === 0 ? "No critical release-blocking failures detected." : `${criticalFailures} critical failure(s) detected.`
    }
  ];
  return {
    ok: checks.every(item => item.status === "passed"),
    checks,
    qaScore,
    readinessScore,
    releaseScore: releaseLevelFromScores(qaScore, readinessScore)
  };
}

module.exports = {
  RELEASE_STATUSES,
  VERSION_FORMAT,
  normalizeReleaseCandidate,
  summarizeReleaseSnapshot,
  validateReleaseCandidate,
  releaseLevelFromScores
};
