const AUDIT_ACTIONS = new Set([
  "case_created",
  "case_updated",
  "model_uploaded",
  "reconstruction_started",
  "reconstruction_completed",
  "landmark_added",
  "landmark_updated",
  "measurement_added",
  "measurement_updated",
  "note_updated",
  "report_exported",
  "simulation_created",
  "team_member_added",
  "team_member_removed",
  "insight_created",
  "insight_acknowledged",
  "backup_created",
  "backup_imported",
  "backup_restored",
  "qa_run",
  "qa_issue_resolved"
]);

function auditActor(input = {}) {
  return {
    userId: String(input.userId || "local-user").trim() || "local-user",
    userName: String(input.userName || "Local User").trim() || "Local User"
  };
}

function cloneAuditEvent(event) {
  if (!event) return null;
  return {
    eventId: event.eventId,
    caseId: event.caseId || "",
    userId: event.userId || "local-user",
    userName: event.userName || "Local User",
    action: event.action || "case_updated",
    entityType: event.entityType || "case",
    entityId: event.entityId || event.caseId || "",
    timestamp: event.timestamp,
    details: event.details && typeof event.details === "object" ? { ...event.details } : {}
  };
}

function normalizeAuditEvent(input = {}, context = {}) {
  const caseId = String(input.caseId || context.caseId || "").trim();
  if (!caseId) return null;
  const makeId = typeof context.makeId === "function" ? context.makeId : prefix => `${prefix}-${Date.now().toString(36)}`;
  const nowIso = typeof context.nowIso === "function" ? context.nowIso : () => new Date().toISOString();
  const action = AUDIT_ACTIONS.has(String(input.action || "")) ? String(input.action) : "case_updated";
  return cloneAuditEvent({
    eventId: String(input.eventId || makeId("audit")).trim(),
    caseId,
    ...auditActor(input),
    action,
    entityType: String(input.entityType || "case").trim() || "case",
    entityId: String(input.entityId || caseId).trim() || caseId,
    timestamp: input.timestamp || nowIso(),
    details: input.details && typeof input.details === "object" ? { ...input.details } : {}
  });
}

function auditEventMatchesFilter(event, filter = {}) {
  const caseId = String(filter.caseId || "all");
  const action = String(filter.action || "all");
  const userId = String(filter.userId || "all");
  const date = String(filter.date || "").slice(0, 10);
  return (caseId === "all" || event.caseId === caseId)
    && (action === "all" || event.action === action)
    && (userId === "all" || event.userId === userId)
    && (!date || String(event.timestamp || "").slice(0, 10) === date);
}

function summarizeAuditEvents(events = []) {
  const safeEvents = events.map(cloneAuditEvent).filter(Boolean);
  return {
    eventsCount: safeEvents.length,
    actions: safeEvents.reduce((acc, event) => {
      acc[event.action] = (acc[event.action] || 0) + 1;
      return acc;
    }, {}),
    users: safeEvents.reduce((acc, event) => {
      const label = event.userName || event.userId || "Local User";
      acc[label] = (acc[label] || 0) + 1;
      return acc;
    }, {}),
    latestEvents: safeEvents.slice(0, 10)
  };
}

module.exports = {
  AUDIT_ACTIONS,
  normalizeAuditEvent,
  cloneAuditEvent,
  auditEventMatchesFilter,
  summarizeAuditEvents
};
