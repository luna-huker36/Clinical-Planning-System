const crypto = require("crypto");

const BACKUP_VERSION = "v1";
const SUPPORTED_BACKUP_VERSIONS = new Set(["v1"]);

function nowIso() {
  return new Date().toISOString();
}

function checksumPayload(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function makeBackupId() {
  if (crypto.randomUUID) return `backup-${crypto.randomUUID()}`;
  return `backup-${Date.now().toString(36)}`;
}

function countModels(snapshot = {}) {
  const caseModels = (snapshot.cases || []).flatMap(item => item.models || []);
  const jobModels = (snapshot.jobs || []).map(item => item.resultGlbUrl).filter(Boolean);
  return new Set([...caseModels, ...jobModels]).size;
}

function countReports(snapshot = {}) {
  return (snapshot.cases || []).reduce((sum, item) => sum + Number(item.reports?.length || 0), 0);
}

function buildBackup(snapshot = {}) {
  const payload = {
    backupVersion: BACKUP_VERSION,
    exportedAt: nowIso(),
    data: snapshot
  };
  const checksum = checksumPayload(payload);
  const fileSize = Buffer.byteLength(JSON.stringify({ ...payload, checksum }), "utf8");
  return {
    backupId: makeBackupId(),
    version: BACKUP_VERSION,
    createdAt: payload.exportedAt,
    casesCount: Number(snapshot.cases?.length || 0),
    modelsCount: countModels(snapshot),
    reportsCount: countReports(snapshot),
    fileSize,
    checksum,
    payload
  };
}

function unwrapBackup(input = {}) {
  const backup = input.backupId && input.payload ? input : null;
  const payload = backup ? backup.payload : input.payload || input;
  const checksum = backup?.checksum || input.checksum || "";
  return { backup, payload, checksum };
}

function validateBackup(input = {}) {
  const { backup, payload, checksum } = unwrapBackup(input);
  if (!payload || typeof payload !== "object" || !payload.data) {
    return { ok: false, errors: ["Invalid PMAS Backup JSON format."], preview: null, payload: null };
  }
  const version = payload.backupVersion || backup?.version || "";
  const errors = [];
  if (!SUPPORTED_BACKUP_VERSIONS.has(version)) errors.push(`Unsupported backup version: ${version || "unknown"}.`);
  const expectedChecksum = checksumPayload(payload);
  if (checksum && checksum !== expectedChecksum) errors.push("Backup checksum mismatch.");
  const snapshot = payload.data || {};
  const preview = {
    backupId: backup?.backupId || "",
    version,
    createdAt: backup?.createdAt || payload.exportedAt || "",
    casesCount: Number(snapshot.cases?.length || 0),
    modelsCount: countModels(snapshot),
    reportsCount: countReports(snapshot),
    fileSize: Buffer.byteLength(JSON.stringify(input), "utf8"),
    checksum: checksum || expectedChecksum,
    casePreview: (snapshot.cases || []).map(item => ({
      caseId: item.caseId,
      patientName: item.patientName || "",
      patientId: item.patientId || "",
      jobsCount: Number(item.reconstructionJobs?.length || 0),
      modelsCount: Number(item.models?.length || 0),
      reportsCount: Number(item.reports?.length || 0)
    }))
  };
  return { ok: errors.length === 0, errors, preview, payload };
}

function migrateBackupPayload(payload = {}) {
  if (payload.backupVersion === "v1") return payload;
  return payload;
}

module.exports = {
  BACKUP_VERSION,
  buildBackup,
  validateBackup,
  migrateBackupPayload
};
