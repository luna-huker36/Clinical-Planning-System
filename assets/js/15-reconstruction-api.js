(function () {
  let reconstructionMode = "mock";
  const MOCK_HISTORY_KEY = "pmas.reconstruction.history.v1";
  const MOCK_CASES_KEY = "pmas.reconstruction.cases.v1";
  const MOCK_COMPARISONS_KEY = "pmas.reconstruction.comparisons.v1";
  const MOCK_MEASUREMENTS_KEY = "pmas.reconstruction.measurements.v1";
  const MOCK_LANDMARKS_KEY = "pmas.reconstruction.landmarks.v1";
  const MOCK_LANDMARK_TEMPLATES_KEY = "pmas.reconstruction.landmark-templates.v1";
  const MOCK_SURGICAL_PLANS_KEY = "pmas.reconstruction.surgical-plans.v1";
  const MOCK_SURGICAL_SIMULATIONS_KEY = "pmas.reconstruction.surgical-simulations.v1";
  const MOCK_AUDIT_EVENTS_KEY = "pmas.reconstruction.audit-events.v1";
  const MOCK_CLINICAL_INSIGHTS_KEY = "pmas.reconstruction.clinical-insights.v1";
  const MOCK_QA_CHECKS_KEY = "pmas.reconstruction.qa-checks.v1";
  const MOCK_PRODUCTION_READINESS_KEY = "pmas.reconstruction.production-readiness.v1";
  const MOCK_RELEASES_KEY = "pmas.reconstruction.releases.v1";
  const MOCK_PLUGINS_KEY = "pmas.reconstruction.plugins.v1";
  const REPORT_EXPORT_FORMATS = ["json"];
  const DEFAULT_RECONSTRUCTION_SETTINGS = Object.freeze({
    processingMode: "balanced",
    inputTypePreference: "auto",
    maxFrames: 40,
    frameExtractionRate: 1,
    cleanupStrength: "medium",
    targetModelQuality: "preview",
    saveIntermediateFiles: false
  });
  const SETTINGS_OPTIONS = Object.freeze({
    processingMode: ["fast", "balanced", "quality"],
    inputTypePreference: ["auto", "photos", "video"],
    maxFrames: [20, 40, 60],
    frameExtractionRate: [0.5, 1, 2],
    cleanupStrength: ["low", "medium", "high"],
    targetModelQuality: ["preview", "planning"]
  });

  const ENDPOINTS = {
    health: "/api/reconstruction/health",
    upload: "/api/reconstruction/upload",
    cases: "/api/reconstruction/cases",
    caseReport: caseId => `/api/reconstruction/cases/${encodeURIComponent(caseId)}/report`,
    systemReport: "/api/reconstruction/system/report",
    caseTimeline: caseId => `/api/reconstruction/cases/${encodeURIComponent(caseId)}/timeline`,
    caseTeam: caseId => `/api/reconstruction/cases/${encodeURIComponent(caseId)}/team`,
    caseTeamMember: (caseId, memberId) => `/api/reconstruction/cases/${encodeURIComponent(caseId)}/team/${encodeURIComponent(memberId)}`,
    caseAudit: caseId => `/api/reconstruction/cases/${encodeURIComponent(caseId)}/audit`,
    caseInsights: caseId => `/api/reconstruction/cases/${encodeURIComponent(caseId)}/insights`,
    generateCaseInsights: caseId => `/api/reconstruction/cases/${encodeURIComponent(caseId)}/insights/generate`,
    clinicalInsight: insightId => `/api/reconstruction/insights/${encodeURIComponent(insightId)}`,
    backupExport: "/api/reconstruction/backup/export",
    backupPreview: "/api/reconstruction/backup/preview",
    backupRestore: "/api/reconstruction/backup/restore",
    caseQa: caseId => `/api/reconstruction/cases/${encodeURIComponent(caseId)}/qa`,
    runCaseQa: caseId => `/api/reconstruction/cases/${encodeURIComponent(caseId)}/qa/run`,
    resolveQaCheck: checkId => `/api/reconstruction/qa/${encodeURIComponent(checkId)}/resolve`,
    caseReadiness: caseId => `/api/reconstruction/cases/${encodeURIComponent(caseId)}/readiness`,
    runCaseReadiness: caseId => `/api/reconstruction/cases/${encodeURIComponent(caseId)}/readiness/run`,
    releases: "/api/reconstruction/releases",
    releaseStatus: releaseId => `/api/reconstruction/releases/${encodeURIComponent(releaseId)}/status`,
    releaseArchive: releaseId => `/api/reconstruction/releases/${encodeURIComponent(releaseId)}/archive`,
    releaseClone: releaseId => `/api/reconstruction/releases/${encodeURIComponent(releaseId)}/clone`,
    releaseReport: releaseId => `/api/reconstruction/releases/${encodeURIComponent(releaseId)}/report`,
    plugins: "/api/reconstruction/plugins",
    plugin: pluginId => `/api/reconstruction/plugins/${encodeURIComponent(pluginId)}`,
    pluginEnable: pluginId => `/api/reconstruction/plugins/${encodeURIComponent(pluginId)}/enable`,
    pluginDisable: pluginId => `/api/reconstruction/plugins/${encodeURIComponent(pluginId)}/disable`,
    comparisons: "/api/reconstruction/comparisons",
    comparisonReport: comparisonId => `/api/reconstruction/comparisons/${encodeURIComponent(comparisonId)}/report`,
    measurements: "/api/reconstruction/measurements",
    measurement: measurementId => `/api/reconstruction/measurements/${encodeURIComponent(measurementId)}`,
    landmarks: "/api/reconstruction/landmarks",
    landmark: landmarkId => `/api/reconstruction/landmarks/${encodeURIComponent(landmarkId)}`,
    landmarkTemplates: "/api/reconstruction/landmark-templates",
    landmarkTemplate: templateId => `/api/reconstruction/landmark-templates/${encodeURIComponent(templateId)}`,
    surgicalPlans: "/api/reconstruction/surgical-plans",
    surgicalSimulations: "/api/reconstruction/simulations",
    jobs: "/api/reconstruction/jobs",
    job: jobId => `/api/reconstruction/jobs/${encodeURIComponent(jobId)}`,
    startJob: jobId => `/api/reconstruction/jobs/${encodeURIComponent(jobId)}/start`,
    approveReview: jobId => `/api/reconstruction/jobs/${encodeURIComponent(jobId)}/review/approve`,
    status: jobId => `/api/reconstruction/jobs/${encodeURIComponent(jobId)}/status`,
    result: jobId => `/api/reconstruction/jobs/${encodeURIComponent(jobId)}/result`,
    report: jobId => `/api/reconstruction/jobs/${encodeURIComponent(jobId)}/report`,
    applyAdjustment: jobId => `/api/reconstruction/jobs/${encodeURIComponent(jobId)}/adjustment/apply`,
    skipAdjustment: jobId => `/api/reconstruction/jobs/${encodeURIComponent(jobId)}/adjustment/skip`,
    cancel: jobId => `/api/reconstruction/jobs/${encodeURIComponent(jobId)}/cancel`
  };

  const ERROR_CODES = {
    networkUnavailable: "NETWORK_UNAVAILABLE",
    uploadFailed: "UPLOAD_FAILED",
    jobFailed: "JOB_FAILED",
    canceledByUser: "CANCELED_BY_USER"
  };

  const TEAM_ROLES = ["owner", "surgeon", "assistant", "viewer"];
  const AUDIT_ACTIONS = [
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
    "qa_issue_resolved",
    "readiness_check_run",
    "release_action",
    "plugin_enabled",
    "plugin_disabled",
    "plugin_registered"
  ];
  const ROLE_PERMISSIONS = Object.freeze({
    owner: ["view_case", "edit_case", "add_measurements", "edit_measurements", "add_notes", "export_reports", "run_reconstruction", "run_simulation"],
    surgeon: ["view_case", "edit_case", "add_measurements", "edit_measurements", "add_notes", "export_reports", "run_reconstruction", "run_simulation"],
    assistant: ["view_case", "add_measurements", "add_notes"],
    viewer: ["view_case"]
  });

  const BUILT_IN_PLUGINS = Object.freeze([
    { pluginId: "builtin-landmark-templates", name: "Landmark Templates", version: "v1", category: "landmarks", description: "Built-in PMAS landmark template registry.", author: "PMAS Core", enabled: true, builtIn: true, extensionPoints: ["landmark_detection"], compatibleVersion: "v1", dependencies: [] },
    { pluginId: "builtin-measurement-templates", name: "Measurement Templates", version: "v1", category: "measurements", description: "Built-in PMAS measurement template engine.", author: "PMAS Core", enabled: true, builtIn: true, extensionPoints: ["measurement_templates"], compatibleVersion: "v1", dependencies: [] },
    { pluginId: "builtin-clinical-analysis-presets", name: "Clinical Analysis Presets", version: "v1", category: "analysis", description: "Built-in PMAS clinical analysis preset layer.", author: "PMAS Core", enabled: true, builtIn: true, extensionPoints: ["clinical_analysis"], compatibleVersion: "v1", dependencies: [] },
    { pluginId: "builtin-report-builder", name: "Report Builder", version: "v1", category: "reports", description: "Built-in PMAS clinical and case report builder.", author: "PMAS Core", enabled: true, builtIn: true, extensionPoints: ["report_generation", "export_system"], compatibleVersion: "v1", dependencies: [] }
  ]);

  const PLUGIN_EXTENSION_POINTS = ["reconstruction_pipeline", "landmark_detection", "measurement_templates", "clinical_analysis", "report_generation", "surgical_simulation", "export_system"];

  const DEFAULT_LANDMARK_TEMPLATES = Object.freeze([
    {
      templateId: "template-facial-basic",
      name: "Facial Basic",
      category: "facial",
      description: "Core facial reference landmarks for basic 3D face assessment.",
      builtIn: true,
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
      builtIn: true,
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
      builtIn: true,
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
      builtIn: true,
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
      builtIn: true,
      landmarks: [
        { landmarkName: "Custom Point 1", landmarkCategory: "custom", description: "Custom landmark placeholder.", required: false, color: "#64748b" }
      ]
    }
  ]);

  function pipeline() {
    return window.PMASReconstructionPipeline;
  }

  function preprocessing() {
    return window.PMASReconstructionPreprocessing;
  }

  function readMockHistory() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MOCK_HISTORY_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function writeMockHistory(items) {
    try {
      localStorage.setItem(MOCK_HISTORY_KEY, JSON.stringify(items.slice(0, 50)));
    } catch (err) {
      console.warn("Unable to save reconstruction history.", err);
    }
  }

  function readMockCases() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MOCK_CASES_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function writeMockCases(items) {
    try {
      localStorage.setItem(MOCK_CASES_KEY, JSON.stringify(items.slice(0, 100)));
    } catch (err) {
      console.warn("Unable to save reconstruction cases.", err);
    }
  }

  function makeMockCaseId() {
    if (window.crypto?.randomUUID) return `case-${window.crypto.randomUUID()}`;
    return `case-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  }

  function makeMockTeamMemberId() {
    if (window.crypto?.randomUUID) return `member-${window.crypto.randomUUID()}`;
    return `member-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  }

  function readMockAuditEvents() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MOCK_AUDIT_EVENTS_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function writeMockAuditEvents(items) {
    try {
      localStorage.setItem(MOCK_AUDIT_EVENTS_KEY, JSON.stringify(items.slice(0, 2000)));
    } catch (err) {
      console.warn("Unable to save audit events.", err);
    }
  }

  function makeMockAuditEventId() {
    if (window.crypto?.randomUUID) return `audit-${window.crypto.randomUUID()}`;
    return `audit-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  }

  function recordMockAuditEvent(input = {}) {
    const caseId = String(input.caseId || "").trim();
    if (!caseId) return null;
    const action = AUDIT_ACTIONS.includes(input.action) ? input.action : "case_updated";
    const event = {
      eventId: String(input.eventId || makeMockAuditEventId()),
      caseId,
      userId: String(input.userId || "local-user"),
      userName: String(input.userName || "Local User"),
      action,
      entityType: String(input.entityType || "case"),
      entityId: String(input.entityId || caseId),
      timestamp: input.timestamp || new Date().toISOString(),
      details: input.details && typeof input.details === "object" ? { ...input.details } : {}
    };
    writeMockAuditEvents([event, ...readMockAuditEvents().filter(item => item.eventId !== event.eventId)]);
    const cases = readMockCases();
    const caseItem = cases.find(item => item.caseId === caseId);
    if (caseItem) {
      caseItem.auditEvents = caseItem.auditEvents || [];
      if (!caseItem.auditEvents.includes(event.eventId)) caseItem.auditEvents.push(event.eventId);
      caseItem.updatedAt = event.timestamp;
      writeMockCases([caseItem, ...cases.filter(item => item.caseId !== caseId)]);
    }
    return event;
  }

  function filterMockAuditEvents(filter = {}) {
    const caseId = String(filter.caseId || "all");
    const action = String(filter.action || "all");
    const userId = String(filter.userId || "all");
    const date = String(filter.date || "").slice(0, 10);
    return readMockAuditEvents()
      .filter(item => caseId === "all" || item.caseId === caseId)
      .filter(item => action === "all" || item.action === action)
      .filter(item => userId === "all" || item.userId === userId)
      .filter(item => !date || String(item.timestamp || "").slice(0, 10) === date)
      .sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
  }

  function readMockClinicalInsights() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MOCK_CLINICAL_INSIGHTS_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function writeMockClinicalInsights(items) {
    try {
      localStorage.setItem(MOCK_CLINICAL_INSIGHTS_KEY, JSON.stringify(items.slice(0, 1000)));
    } catch (err) {
      console.warn("Unable to save clinical insights.", err);
    }
  }

  function readMockQaChecks() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MOCK_QA_CHECKS_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function writeMockQaChecks(items) {
    try {
      localStorage.setItem(MOCK_QA_CHECKS_KEY, JSON.stringify(items.slice(0, 1500)));
    } catch (err) {
      console.warn("Unable to save QA checks.", err);
    }
  }

  function readMockProductionReadiness() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MOCK_PRODUCTION_READINESS_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function writeMockProductionReadiness(items) {
    try {
      localStorage.setItem(MOCK_PRODUCTION_READINESS_KEY, JSON.stringify(items.slice(0, 1000)));
    } catch (err) {
      console.warn("Unable to save production readiness checks.", err);
    }
  }

  function readMockReleases() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MOCK_RELEASES_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function writeMockReleases(items) {
    try {
      localStorage.setItem(MOCK_RELEASES_KEY, JSON.stringify(items.slice(0, 200)));
    } catch (err) {
      console.warn("Unable to save releases.", err);
    }
  }

  function normalizeMockPlugin(input = {}) {
    return {
      pluginId: String(input.pluginId || "").trim(),
      name: String(input.name || input.pluginId || "PMAS Plugin").trim() || "PMAS Plugin",
      version: String(input.version || "v1").trim() || "v1",
      category: ["reconstruction", "landmarks", "measurements", "analysis", "reports", "simulation", "export", "custom"].includes(input.category) ? input.category : "custom",
      description: String(input.description || "").trim(),
      author: String(input.author || "Unknown").trim() || "Unknown",
      enabled: input.enabled !== false,
      createdAt: input.createdAt || new Date().toISOString(),
      updatedAt: input.updatedAt || input.createdAt || new Date().toISOString(),
      builtIn: Boolean(input.builtIn),
      compatibleVersion: String(input.compatibleVersion || "v1").trim() || "v1",
      dependencies: Array.isArray(input.dependencies) ? input.dependencies.map(String).filter(Boolean) : [],
      extensionPoints: Array.isArray(input.extensionPoints) ? input.extensionPoints.map(String).filter(item => PLUGIN_EXTENSION_POINTS.includes(item)) : []
    };
  }

  function readMockPlugins() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MOCK_PLUGINS_KEY) || "[]");
      const custom = Array.isArray(parsed) ? parsed.map(normalizeMockPlugin).filter(item => item.pluginId && !item.builtIn) : [];
      const byId = new Map([...BUILT_IN_PLUGINS.map(normalizeMockPlugin), ...custom].map(item => [item.pluginId, item]));
      return Array.from(byId.values());
    } catch (err) {
      return BUILT_IN_PLUGINS.map(normalizeMockPlugin);
    }
  }

  function writeMockPlugins(items) {
    try {
      localStorage.setItem(MOCK_PLUGINS_KEY, JSON.stringify((items || []).filter(item => !item.builtIn).slice(0, 500)));
    } catch (err) {
      console.warn("Unable to save plugins.", err);
    }
  }

  function mockPluginSummary(plugins = readMockPlugins()) {
    return {
      pluginsCount: plugins.length,
      enabledCount: plugins.filter(item => item.enabled).length,
      disabledCount: plugins.filter(item => !item.enabled).length,
      builtInCount: plugins.filter(item => item.builtIn).length,
      categories: plugins.reduce((acc, item) => {
        acc[item.category] = (acc[item.category] || 0) + 1;
        return acc;
      }, {}),
      extensionPoints: PLUGIN_EXTENSION_POINTS.map(point => ({
        extensionPoint: point,
        plugins: plugins.filter(item => item.enabled && item.extensionPoints.includes(point))
      }))
    };
  }

  function recordMockPluginAudit(plugin, action) {
    readMockCases().forEach(caseItem => {
      recordMockAuditEvent({ caseId: caseItem.caseId, action, entityType: "plugin", entityId: plugin.pluginId, details: { name: plugin.name, version: plugin.version, category: plugin.category } });
    });
  }

  function qaSummary(checks = []) {
    const active = checks.filter(item => !item.resolved);
    const warningsCount = active.filter(item => item.status === "warning").length;
    const failuresCount = active.filter(item => item.status === "failed").length;
    const criticalCount = active.filter(item => item.severity === "critical").length;
    const qaScore = Math.max(0, Math.min(100, 100 - failuresCount * 18 - warningsCount * 7 - criticalCount * 15));
    return {
      qaScore,
      readinessLevel: qaScore >= 90 ? "excellent" : qaScore >= 75 ? "good" : qaScore >= 50 ? "medium" : "poor",
      warningsCount,
      failuresCount,
      passedCount: active.filter(item => item.status === "passed").length,
      checksCount: active.length
    };
  }

  function makeMockQaCheck(input) {
    return {
      checkId: input.checkId || (crypto.randomUUID ? `qa-check-${crypto.randomUUID()}` : `qa-check-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`),
      caseId: input.caseId || "",
      category: input.category || "system",
      status: input.status || "warning",
      severity: input.severity || "medium",
      title: input.title || "QA check",
      description: input.description || "",
      createdAt: input.createdAt || new Date().toISOString(),
      resolved: Boolean(input.resolved),
      resolvedAt: input.resolvedAt || ""
    };
  }

  function generateMockQaChecks(caseId) {
    const caseItem = readMockCases().find(item => item.caseId === caseId) || {};
    const jobs = readMockHistory().filter(item => item.caseId === caseId);
    const measurements = readMockMeasurements().filter(item => item.caseId === caseId);
    const landmarks = readMockLandmarks().filter(item => item.caseId === caseId);
    const plans = readMockSurgicalPlans().filter(item => item.caseId === caseId);
    const simulations = readMockSurgicalSimulations().filter(item => item.caseId === caseId);
    const checks = [];
    const add = item => checks.push(makeMockQaCheck({ caseId, ...item }));
    add({ category: "patient_case", status: caseItem.patientName ? "passed" : "failed", severity: caseItem.patientName ? "low" : "high", title: "Patient data present", description: caseItem.patientName ? "Patient name is present." : "Patient name is missing." });
    add({ category: "patient_case", status: jobs.length || caseItem.models?.length ? "passed" : "warning", severity: "medium", title: "Model attached", description: jobs.length || caseItem.models?.length ? "Case has model/job metadata." : "No model metadata is attached." });
    add({ category: "patient_case", status: plans.length || caseItem.notes ? "passed" : "warning", severity: "medium", title: "Clinical notes present", description: plans.length || caseItem.notes ? "Notes are present." : "No notes are present." });
    add({ category: "reconstruction", status: jobs.some(item => item.status === "ready") ? "passed" : "warning", severity: "medium", title: "Reconstruction completed", description: jobs.some(item => item.status === "ready") ? "Ready job found." : "No ready job found." });
    add({ category: "reconstruction", status: jobs.some(item => item.resultGlbUrl) ? "passed" : "warning", severity: "high", title: "Result GLB exists", description: jobs.some(item => item.resultGlbUrl) ? "Result GLB metadata exists." : "No result GLB URL is stored." });
    add({ category: "model_quality", status: jobs.some(item => Number(item.readinessScore) > 0) ? "passed" : "warning", severity: "medium", title: "Readiness score exists", description: jobs.some(item => Number(item.readinessScore) > 0) ? "Readiness score metadata exists." : "Readiness score metadata is missing." });
    const errors = jobs.filter(item => item.status === "error" || item.errorMessage);
    add({ category: "reconstruction", status: errors.length ? "failed" : "passed", severity: errors.length ? "critical" : "low", title: "No critical reconstruction errors", description: errors.length ? `${errors.length} job(s) contain errors.` : "No job error status found." });
    const missing = landmarks.filter(item => item.status === "unplaced" || (item.required && !["placed", "approved", "corrected"].includes(item.status)));
    add({ category: "landmarks", status: missing.length ? "failed" : landmarks.length ? "passed" : "warning", severity: missing.length ? "high" : "medium", title: "Required landmarks exist", description: missing.length ? `${missing.length} missing landmark issue(s).` : landmarks.length ? "Landmarks are present." : "No landmarks stored." });
    const approved = landmarks.filter(item => ["approved", "corrected"].includes(item.status)).length;
    add({ category: "landmarks", status: approved ? "passed" : "warning", severity: "medium", title: "Approved landmarks count", description: `${approved} approved/corrected landmark(s).` });
    const lowConfidence = landmarks.filter(item => Number(item.confidence) < 60);
    if (lowConfidence.length) add({ category: "landmarks", status: "warning", severity: "medium", title: "Low confidence landmarks", description: `${lowConfidence.length} low-confidence landmark(s).` });
    add({ category: "measurements", status: measurements.length ? "passed" : "warning", severity: "medium", title: "Measurements calculated", description: measurements.length ? `${measurements.length} measurement(s) stored.` : "No measurements stored." });
    const invalid = measurements.filter(item => item.status === "error" || Number.isNaN(Number(item.value)));
    if (invalid.length) add({ category: "measurements", status: "failed", severity: "high", title: "Invalid measurement values", description: `${invalid.length} invalid measurement(s).` });
    add({ category: "reports", status: caseItem.reports?.length ? "passed" : "warning", severity: "medium", title: "Report generated", description: caseItem.reports?.length ? `${caseItem.reports.length} report(s).` : "No report attached." });
    add({ category: "reports", status: "passed", severity: "low", title: "Report export available", description: "JSON/PDF/DOCX export controls are available." });
    add({ category: "simulations", status: simulations.length ? "passed" : "warning", severity: "low", title: "Simulation data", description: simulations.length ? `${simulations.length} simulation(s).` : "No simulations stored." });
    add({ category: "backup", status: "passed", severity: "low", title: "Backup system available", description: "Local PMAS Backup JSON is available." });
    add({ category: "system", status: "passed", severity: "low", title: "System validation completed", description: "Technical QA checks completed. This is not medical validation." });
    writeMockQaChecks([...checks, ...readMockQaChecks().filter(item => item.caseId !== caseId || item.resolved)]);
    recordMockAuditEvent({ caseId, action: "qa_run", entityType: "qa_validation", entityId: `qa-${caseId}`, details: qaSummary(checks) });
    return { caseId, checks, summary: qaSummary(checks) };
  }

  function productionLevelFromScore(score) {
    if (score >= 90) return "production_ready";
    if (score >= 75) return "ready";
    if (score >= 50) return "limited";
    return "not_ready";
  }

  function productionSummary(readiness = []) {
    const passedChecks = readiness.reduce((sum, item) => sum + Number(item.passedChecks || 0), 0);
    const failedChecks = readiness.reduce((sum, item) => sum + Number(item.failedChecks || 0), 0);
    const warnings = readiness.reduce((sum, item) => sum + Number(item.warnings || 0), 0);
    const productionScore = readiness.length
      ? Math.round(readiness.reduce((sum, item) => sum + Number(item.productionScore || item.score || 0), 0) / readiness.length)
      : 0;
    return {
      productionScore,
      readinessLevel: productionLevelFromScore(productionScore),
      passedChecks,
      failedChecks,
      warnings,
      scopes: readiness.length
    };
  }

  function makeMockReadiness(scope, checks, input = {}) {
    const failedChecks = checks.filter(item => item.status === "failed").length;
    const warnings = checks.filter(item => item.status === "warning").length;
    const passedChecks = checks.filter(item => item.status === "passed").length;
    const score = Math.max(0, Math.min(100, 100 - failedChecks * 18 - warnings * 8));
    return {
      readinessId: input.readinessId || (crypto.randomUUID ? `readiness-${crypto.randomUUID()}` : `readiness-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`),
      caseId: input.caseId || "",
      modelId: input.modelId || "",
      reportId: input.reportId || "",
      scope,
      score,
      level: productionLevelFromScore(score),
      checks: checks.map((item, index) => ({
        checkId: item.checkId || `${scope}-${index + 1}`,
        scope,
        status: item.status || "warning",
        title: item.title || "Readiness check",
        description: item.description || ""
      })),
      createdAt: input.createdAt || new Date().toISOString(),
      productionScore: score,
      readinessLevel: productionLevelFromScore(score),
      passedChecks,
      failedChecks,
      warnings
    };
  }

  function generateMockProductionReadiness(caseId, options = {}) {
    const caseItem = readMockCases().find(item => item.caseId === caseId) || {};
    const jobs = readMockHistory().filter(item => item.caseId === caseId);
    const model = jobs.find(item => item.resultGlbUrl) || jobs[0] || {};
    const measurements = readMockMeasurements().filter(item => item.caseId === caseId);
    const landmarks = readMockLandmarks().filter(item => item.caseId === caseId);
    const qa = qaSummary(readMockQaChecks().filter(item => item.caseId === caseId));
    const auditEvents = filterMockAuditEvents({ caseId });
    const timeline = buildMockCaseTimeline(caseId);
    const missingRequired = landmarks.filter(item => item.required && !["placed", "approved", "corrected"].includes(item.status));
    const readiness = [
      makeMockReadiness("case", [
        { status: caseItem.caseId ? "passed" : "failed", title: "Patient case exists", description: caseItem.caseId ? `Case ${caseItem.caseId} exists.` : "Patient case metadata is missing." },
        { status: jobs.length ? "passed" : "failed", title: "Reconstruction exists", description: jobs.length ? `${jobs.length} reconstruction job(s) linked.` : "No reconstruction job is linked." },
        { status: caseItem.reports?.length ? "passed" : "warning", title: "Report exists", description: caseItem.reports?.length ? `${caseItem.reports.length} report(s) attached.` : "No report reference is attached yet." },
        { status: measurements.length ? "passed" : "warning", title: "Measurements exist", description: measurements.length ? `${measurements.length} measurement(s) stored.` : "No measurement data is stored." },
        { status: landmarks.some(item => item.required) && !missingRequired.length ? "passed" : missingRequired.length ? "failed" : "warning", title: "Required landmarks exist", description: missingRequired.length ? `${missingRequired.length} required landmark(s) are missing.` : landmarks.some(item => item.required) ? "Required landmarks are present." : "No required landmarks are defined." }
      ], { caseId }),
      makeMockReadiness("model", [
        { status: model.resultGlbUrl ? "passed" : "failed", title: "GLB available", description: model.resultGlbUrl ? "Model GLB metadata is available." : "No GLB model artifact is attached." },
        { status: Number(model.readinessScore) > 0 ? "passed" : "warning", title: "Readiness score exists", description: Number(model.readinessScore) > 0 ? `Readiness score ${Math.round(Number(model.readinessScore))}/100.` : "Readiness score is missing." },
        { status: qa.failuresCount ? "failed" : qa.warningsCount ? "warning" : "passed", title: "QA passed", description: qa.failuresCount ? `${qa.failuresCount} QA failure(s) remain.` : qa.warningsCount ? `${qa.warningsCount} QA warning(s) remain.` : "No active QA issues detected." },
        { status: model.status === "error" || (model.warnings || []).some(item => /critical|fatal|error/i.test(String(item))) ? "failed" : "passed", title: "No critical warnings", description: model.status === "error" ? "Critical model error detected." : "No critical model warning detected." }
      ], { caseId, modelId: model.resultGlbUrl || model.jobId || "" }),
      makeMockReadiness("report", [
        { status: caseItem.reports?.length ? "passed" : "warning", title: "Report generated", description: caseItem.reports?.length ? `${caseItem.reports.length} report reference(s) stored.` : "No report has been generated for this case." },
        { status: "passed", title: "Export available", description: "JSON/PDF/DOCX report export controls are available in PMAS." },
        { status: caseItem.caseId && jobs.length && measurements.length && landmarks.length ? "passed" : "warning", title: "Required sections present", description: "Case, reconstruction, measurements, landmarks, QA and insights sections are checked." }
      ], { caseId, reportId: caseItem.reports?.[0] || "" }),
      makeMockReadiness("system", [
        { status: "passed", title: "Backup available", description: "Local PMAS Backup JSON export/restore layer is available." },
        { status: auditEvents.length ? "passed" : "warning", title: "Audit log available", description: auditEvents.length ? `${auditEvents.length} audit event(s) stored.` : "Audit log module is available; no events found." },
        { status: timeline ? "passed" : "warning", title: "Timeline available", description: timeline?.entries ? `${timeline.entries.length} timeline event(s) available.` : "Timeline module is available." },
        { status: "passed", title: "No critical failures", description: "No critical PMAS failures detected by readiness check." }
      ], { caseId })
    ];
    writeMockProductionReadiness([...readiness, ...readMockProductionReadiness().filter(item => item.caseId !== caseId)]);
    const summary = productionSummary(readiness);
    if (options.recordAudit !== false) {
      recordMockAuditEvent({ caseId, action: "readiness_check_run", entityType: "production_readiness", entityId: readiness[0]?.readinessId || `readiness-${caseId}`, details: summary });
    }
    return { caseId, readiness, summary };
  }

  function makeMockReleaseId() {
    if (crypto.randomUUID) return `release-${crypto.randomUUID()}`;
    return `release-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  }

  function mockReleaseSnapshot() {
    const qaChecks = readMockQaChecks();
    const readiness = readMockProductionReadiness();
    const activeQa = qaChecks.filter(item => !item.resolved);
    const qaFailures = activeQa.filter(item => item.status === "failed").length;
    const criticalFailures = activeQa.filter(item => item.severity === "critical").length;
    const qaScore = activeQa.length ? Math.max(0, Math.min(100, 100 - qaFailures * 18 - activeQa.filter(item => item.status === "warning").length * 7 - criticalFailures * 15)) : 100;
    const readinessFailures = readiness.reduce((sum, item) => sum + Number(item.failedChecks || 0), 0);
    const readinessScore = readiness.length ? Math.round(readiness.reduce((sum, item) => sum + Number(item.productionScore || item.score || 0), 0) / readiness.length) : 100;
    const cases = readMockCases();
    return {
      createdAt: new Date().toISOString(),
      cases,
      reports: cases.flatMap(item => (item.reports || []).map(reportId => ({ caseId: item.caseId, reportId }))),
      templates: { landmarkTemplates: readMockLandmarkTemplates() },
      settings: { reconstructionDefaults: { ...DEFAULT_RECONSTRUCTION_SETTINGS } },
      configuration: { localBackupSupported: true, cloudSyncEnabled: false, releaseManagerVersion: "v1", pluginApiVersion: "v1" },
      plugins: readMockPlugins(),
      qaData: { checks: qaChecks, qaScore, failuresCount: qaFailures, criticalFailures },
      readiness: { items: readiness, readinessScore, failuresCount: readinessFailures }
    };
  }

  function validateMockRelease(snapshot) {
    const qaScore = Number(snapshot?.qaData?.qaScore || 0);
    const readinessScore = Number(snapshot?.readiness?.readinessScore || 0);
    const qaFailures = Number(snapshot?.qaData?.failuresCount || 0);
    const readinessFailures = Number(snapshot?.readiness?.failuresCount || 0);
    const criticalFailures = Number(snapshot?.qaData?.criticalFailures || 0);
    const checks = [
      { checkId: "release-qa-passed", status: qaScore >= 75 && qaFailures === 0 ? "passed" : "failed", title: "QA passed", description: `QA score ${Math.round(qaScore)}/100.` },
      { checkId: "release-readiness-passed", status: readinessScore >= 75 && readinessFailures === 0 ? "passed" : "failed", title: "Production Readiness passed", description: `Readiness score ${Math.round(readinessScore)}/100.` },
      { checkId: "release-backup-available", status: "passed", title: "Backup available", description: "Local PMAS Backup JSON layer is available." },
      { checkId: "release-no-critical-failures", status: criticalFailures === 0 ? "passed" : "failed", title: "No critical failures", description: criticalFailures === 0 ? "No critical failures detected." : `${criticalFailures} critical failure(s) detected.` }
    ];
    return { ok: checks.every(item => item.status === "passed"), checks, qaScore, readinessScore, releaseScore: Math.round((qaScore + readinessScore) / 2) };
  }

  function mockReleaseCaseIds(release) {
    return (release?.snapshot?.cases || []).map(item => item.caseId).filter(Boolean);
  }

  function recordMockReleaseAction(release, eventType, details = {}) {
    mockReleaseCaseIds(release).forEach(caseId => {
      recordMockAuditEvent({ caseId, action: "release_action", entityType: "release_candidate", entityId: release.releaseId, details: { eventType, version: release.version, status: release.status, ...details } });
    });
  }

  async function sha256Text(text) {
    const data = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash)).map(byte => byte.toString(16).padStart(2, "0")).join("");
  }

  function mockBackupSnapshot() {
    return {
      cases: readMockCases(),
      jobs: readMockHistory(),
      comparisons: readMockComparisons(),
      measurements: readMockMeasurements(),
      landmarks: readMockLandmarks(),
      landmarkTemplates: readMockLandmarkTemplates(),
      surgicalPlans: readMockSurgicalPlans(),
      simulations: readMockSurgicalSimulations(),
      auditEvents: readMockAuditEvents(),
      clinicalInsights: readMockClinicalInsights(),
      qaChecks: readMockQaChecks(),
      productionReadiness: readMockProductionReadiness(),
      releases: readMockReleases(),
      plugins: readMockPlugins()
    };
  }

  function mockCountModels(snapshot = {}) {
    return new Set([
      ...(snapshot.cases || []).flatMap(item => item.models || []),
      ...(snapshot.jobs || []).map(item => item.resultGlbUrl).filter(Boolean)
    ]).size;
  }

  function mockCountReports(snapshot = {}) {
    return (snapshot.cases || []).reduce((sum, item) => sum + Number(item.reports?.length || 0), 0);
  }

  async function makeMockBackup() {
    const snapshot = mockBackupSnapshot();
    const payload = {
      backupVersion: "v1",
      exportedAt: new Date().toISOString(),
      data: snapshot
    };
    const checksum = await sha256Text(JSON.stringify(payload));
    const backup = {
      backupId: window.crypto?.randomUUID ? `backup-${window.crypto.randomUUID()}` : `backup-${Date.now().toString(36)}`,
      version: "v1",
      createdAt: payload.exportedAt,
      casesCount: Number(snapshot.cases?.length || 0),
      modelsCount: mockCountModels(snapshot),
      reportsCount: mockCountReports(snapshot),
      fileSize: new Blob([JSON.stringify({ payload, checksum })]).size,
      checksum,
      payload
    };
    (snapshot.cases || []).forEach(caseItem => recordMockAuditEvent({
      caseId: caseItem.caseId,
      action: "backup_created",
      entityType: "backup",
      entityId: backup.backupId,
      details: { casesCount: backup.casesCount, modelsCount: backup.modelsCount, reportsCount: backup.reportsCount }
    }));
    return backup;
  }

  async function validateMockBackup(input = {}) {
    const backup = input.backupId && input.payload ? input : null;
    const payload = backup ? backup.payload : input.payload || input;
    const checksum = backup?.checksum || input.checksum || "";
    const errors = [];
    if (!payload?.data) errors.push("Invalid PMAS Backup JSON format.");
    if (payload?.backupVersion !== "v1") errors.push(`Unsupported backup version: ${payload?.backupVersion || "unknown"}.`);
    const expected = payload?.data ? await sha256Text(JSON.stringify(payload)) : "";
    if (checksum && expected && checksum !== expected) errors.push("Backup checksum mismatch.");
    const snapshot = payload?.data || {};
    return {
      ok: errors.length === 0,
      errors,
      preview: {
        backupId: backup?.backupId || "",
        version: payload?.backupVersion || "",
        createdAt: backup?.createdAt || payload?.exportedAt || "",
        casesCount: Number(snapshot.cases?.length || 0),
        modelsCount: mockCountModels(snapshot),
        reportsCount: mockCountReports(snapshot),
        fileSize: new Blob([JSON.stringify(input)]).size,
        checksum: checksum || expected,
        casePreview: (snapshot.cases || []).map(item => ({
          caseId: item.caseId,
          patientName: item.patientName || "",
          patientId: item.patientId || "",
          jobsCount: Number(item.reconstructionJobs?.length || 0),
          modelsCount: Number(item.models?.length || 0),
          reportsCount: Number(item.reports?.length || 0)
        }))
      },
      payload
    };
  }

  function makeMockInsightId() {
    if (window.crypto?.randomUUID) return `insight-${window.crypto.randomUUID()}`;
    return `insight-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  }

  function normalizeMockInsight(input = {}) {
    const categories = ["facial_analysis", "symmetry", "measurements", "reconstruction_quality", "landmark_quality", "planning", "custom"];
    const severities = ["info", "warning", "attention"];
    return {
      insightId: String(input.insightId || makeMockInsightId()),
      caseId: String(input.caseId || ""),
      modelId: String(input.modelId || ""),
      category: categories.includes(input.category) ? input.category : "custom",
      severity: severities.includes(input.severity) ? input.severity : "info",
      title: String(input.title || "Clinical observation"),
      description: String(input.description || ""),
      source: String(input.source || "clinical_insights_engine"),
      createdAt: input.createdAt || new Date().toISOString(),
      reviewed: Boolean(input.reviewed),
      dismissed: Boolean(input.dismissed),
      pinned: Boolean(input.pinned),
      reviewedAt: input.reviewedAt || "",
      dismissedAt: input.dismissedAt || ""
    };
  }

  function mockInsightSignature(item) {
    return [item.caseId || "", item.modelId || "", item.category || "", item.title || "", item.source || ""].join("::");
  }

  function upsertMockClinicalInsights(items = []) {
    const existing = readMockClinicalInsights();
    const bySignature = new Map(existing.map(item => [mockInsightSignature(item), item]));
    const nextItems = items.map(item => {
      const normalized = normalizeMockInsight(item);
      const previous = bySignature.get(mockInsightSignature(normalized));
      return previous ? { ...normalized, ...previous, createdAt: previous.createdAt || normalized.createdAt } : normalized;
    });
    const nextIds = new Set(nextItems.map(item => item.insightId));
    writeMockClinicalInsights([
      ...nextItems,
      ...existing.filter(item => !nextIds.has(item.insightId) && item.caseId !== nextItems[0]?.caseId)
    ]);
    nextItems
      .filter(item => !existing.some(existingItem => existingItem.insightId === item.insightId))
      .forEach(item => recordMockAuditEvent({
        caseId: item.caseId,
        action: "insight_created",
        entityType: "clinical_insight",
        entityId: item.insightId,
        details: { category: item.category, severity: item.severity, source: item.source }
      }));
    return nextItems;
  }

  function generateMockClinicalInsights(caseId) {
    const jobs = readMockHistory().filter(item => item.caseId === caseId);
    const measurements = readMockMeasurements().filter(item => item.caseId === caseId);
    const landmarks = readMockLandmarks().filter(item => item.caseId === caseId);
    const comparisons = readMockComparisons().filter(item => item.caseId === caseId);
    const simulations = readMockSurgicalSimulations().filter(item => item.caseId === caseId);
    const drafts = [];
    const add = draft => drafts.push(normalizeMockInsight({ caseId, ...draft }));
    jobs.forEach(job => {
      const score = Number(job.readinessScore);
      if (Number.isFinite(score) && score > 0 && score < 50) add({ modelId: job.resultGlbUrl || job.jobId || "", category: "reconstruction_quality", severity: "warning", title: "Модель имеет низкий readiness score.", description: `Readiness score ${Math.round(score)}/100. Observation для врачебной проверки качества модели.`, source: `job:${job.jobId}:readiness` });
      else if (Number.isFinite(score) && score >= 50 && score < 70) add({ modelId: job.resultGlbUrl || job.jobId || "", category: "reconstruction_quality", severity: "attention", title: "Readiness score требует внимания.", description: `Readiness score ${Math.round(score)}/100. Проверьте пригодность модели для выбранной задачи.`, source: `job:${job.jobId}:readiness` });
      const warningsCount = Number(job.warningsCount || (Array.isArray(job.warnings) ? job.warnings.length : 0));
      if (warningsCount >= 3) add({ modelId: job.resultGlbUrl || job.jobId || "", category: "reconstruction_quality", severity: "warning", title: "Реконструкция выполнена с большим количеством предупреждений.", description: `${warningsCount} warning(s) связаны с реконструкцией.`, source: `job:${job.jobId}:warnings` });
    });
    const missing = landmarks.filter(item => item.status === "unplaced" || (item.required && !["placed", "approved", "corrected"].includes(item.status)));
    if (missing.length) add({ modelId: missing[0]?.modelId || "", category: "landmark_quality", severity: "attention", title: "Отсутствуют обязательные landmarks.", description: `${missing.length} landmark(s) отсутствуют или не размещены.`, source: "landmarks:missing" });
    const lowConfidence = landmarks.filter(item => Number.isFinite(Number(item.confidence)) && Number(item.confidence) < 60);
    if (lowConfidence.length) add({ modelId: lowConfidence[0]?.modelId || "", category: "landmark_quality", severity: "attention", title: "Некоторые landmarks имеют низкую уверенность.", description: `${lowConfidence.length} AI landmark(s) имеют confidence ниже 60%.`, source: "landmarks:low_confidence" });
    const reviewMeasurements = measurements.filter(item => ["missing_landmarks", "needs_review", "error"].includes(item.status) || (item.warnings || []).length || (item.missingLandmarks || []).length);
    if (reviewMeasurements.length) add({ modelId: reviewMeasurements[0]?.modelId || "", category: "measurements", severity: "attention", title: "Некоторые измерения требуют ручной проверки.", description: `${reviewMeasurements.length} measurement(s) имеют warnings или review status.`, source: "measurements:review" });
    if (comparisons.length) add({ modelId: comparisons[0].afterJobId || comparisons[0].beforeJobId || "", category: "symmetry", severity: "info", title: "Есть данные для сравнения двух моделей.", description: `${comparisons.length} comparison object(s) доступны для визуальной проверки.`, source: "comparisons:available" });
    const simulationWarnings = simulations.flatMap(item => item.warnings || []);
    if (simulationWarnings.length) add({ modelId: simulations[0]?.simulatedModelId || simulations[0]?.modelId || "", category: "planning", severity: "attention", title: "Simulation results содержат предупреждения.", description: `${simulationWarnings.length} simulation warning(s) доступны.`, source: "simulations:warnings" });
    return upsertMockClinicalInsights(drafts);
  }

  function permissionsForRole(role) {
    return Array.from(new Set(ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.viewer));
  }

  function normalizeTeamMember(input = {}, existing = null) {
    const role = TEAM_ROLES.includes(input.role || existing?.role) ? (input.role || existing?.role) : "viewer";
    return {
      memberId: String(input.memberId || existing?.memberId || makeMockTeamMemberId()).trim(),
      name: String(input.name ?? existing?.name ?? "Team member").trim() || "Team member",
      role,
      email: String(input.email ?? existing?.email ?? "").trim(),
      permissions: Array.isArray(input.permissions)
        ? input.permissions.filter(permission => permissionsForRole("owner").includes(permission))
        : Array.isArray(existing?.permissions) && existing.permissions.length
          ? existing.permissions
          : permissionsForRole(role),
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function readMockComparisons() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MOCK_COMPARISONS_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function writeMockComparisons(items) {
    try {
      localStorage.setItem(MOCK_COMPARISONS_KEY, JSON.stringify(items.slice(0, 100)));
    } catch (err) {
      console.warn("Unable to save reconstruction comparisons.", err);
    }
  }

  function readMockMeasurements() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MOCK_MEASUREMENTS_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function writeMockMeasurements(items) {
    try {
      localStorage.setItem(MOCK_MEASUREMENTS_KEY, JSON.stringify(items.slice(0, 1000)));
    } catch (err) {
      console.warn("Unable to save reconstruction measurements.", err);
    }
  }

  function makeMockMeasurementId() {
    if (window.crypto?.randomUUID) return `measurement-${window.crypto.randomUUID()}`;
    return `measurement-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  }

  function readMockLandmarks() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MOCK_LANDMARKS_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function writeMockLandmarks(items) {
    try {
      localStorage.setItem(MOCK_LANDMARKS_KEY, JSON.stringify(items.slice(0, 1500)));
    } catch (err) {
      console.warn("Unable to save reconstruction landmarks.", err);
    }
  }

  function makeMockLandmarkId() {
    if (window.crypto?.randomUUID) return `landmark-${window.crypto.randomUUID()}`;
    return `landmark-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  }

  function withTemplateTimestamps(template) {
    const timestamp = template.createdAt || new Date().toISOString();
    return {
      ...template,
      createdAt: timestamp,
      updatedAt: template.updatedAt || timestamp
    };
  }

  function readMockLandmarkTemplates() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MOCK_LANDMARK_TEMPLATES_KEY) || "[]");
      const customTemplates = Array.isArray(parsed) ? parsed : [];
      const defaults = DEFAULT_LANDMARK_TEMPLATES.map(withTemplateTimestamps);
      const customIds = new Set(customTemplates.map(item => item.templateId));
      return defaults
        .filter(item => !customIds.has(item.templateId))
        .concat(customTemplates.map(withTemplateTimestamps));
    } catch (err) {
      return DEFAULT_LANDMARK_TEMPLATES.map(withTemplateTimestamps);
    }
  }

  function writeMockLandmarkTemplates(items) {
    try {
      const customItems = items.filter(item => !item.builtIn);
      localStorage.setItem(MOCK_LANDMARK_TEMPLATES_KEY, JSON.stringify(customItems.slice(0, 100)));
    } catch (err) {
      console.warn("Unable to save landmark templates.", err);
    }
  }

  function makeMockLandmarkTemplateId() {
    if (window.crypto?.randomUUID) return `landmark-template-${window.crypto.randomUUID()}`;
    return `landmark-template-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  }

  function summarizeLandmarkTemplates(landmarks = []) {
    const positionedStatuses = new Set(["placed", "proposed", "approved", "corrected"]);
    const byTemplate = new Map();
    landmarks.forEach(item => {
      if (!item.templateId) return;
      if (!byTemplate.has(item.templateId)) {
        byTemplate.set(item.templateId, {
          templateId: item.templateId,
          templateName: item.templateName || item.templateId,
          totalLandmarksCount: 0,
          placedLandmarksCount: 0,
          missingLandmarksCount: 0
        });
      }
      const summary = byTemplate.get(item.templateId);
      summary.totalLandmarksCount += 1;
      if (positionedStatuses.has(item.status)) summary.placedLandmarksCount += 1;
      if (item.status === "unplaced") summary.missingLandmarksCount += 1;
    });
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
    generated.forEach(item => {
      const templateId = item.templateId || "measurement-template";
      if (!byTemplate.has(templateId)) {
        byTemplate.set(templateId, {
          templateId,
          templateName: item.templateName || templateId,
          generatedMeasurementsCount: 0,
          missingLandmarks: []
        });
      }
      const summary = byTemplate.get(templateId);
      summary.generatedMeasurementsCount += 1;
      summary.missingLandmarks = Array.from(new Set([
        ...summary.missingLandmarks,
        ...(item.missingLandmarks || [])
      ]));
    });
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

  function readMockSurgicalPlans() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MOCK_SURGICAL_PLANS_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function writeMockSurgicalPlans(items) {
    try {
      localStorage.setItem(MOCK_SURGICAL_PLANS_KEY, JSON.stringify(items.slice(0, 500)));
    } catch (err) {
      console.warn("Unable to save surgical planning notes.", err);
    }
  }

  function makeMockSurgicalPlanId() {
    if (window.crypto?.randomUUID) return `surgical-plan-${window.crypto.randomUUID()}`;
    return `surgical-plan-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  }

  function readMockSurgicalSimulations() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MOCK_SURGICAL_SIMULATIONS_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function writeMockSurgicalSimulations(items) {
    try {
      localStorage.setItem(MOCK_SURGICAL_SIMULATIONS_KEY, JSON.stringify(items.slice(0, 500)));
    } catch (err) {
      console.warn("Unable to save surgical simulations.", err);
    }
  }

  function makeMockSurgicalSimulationId() {
    if (window.crypto?.randomUUID) return `simulation-${window.crypto.randomUUID()}`;
    return `simulation-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
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

  function simulationMatchesFilter(item, filter = {}) {
    const caseId = String(filter.caseId || "all");
    const jobId = String(filter.jobId || "all");
    const modelId = String(filter.modelId || "all");
    return (caseId === "all" || item.caseId === caseId)
      && (jobId === "all" || item.jobId === jobId)
      && (modelId === "all" || item.modelId === modelId || item.originalModelId === modelId || item.simulatedModelId === modelId);
  }

  function buildMockCaseTimeline(caseId) {
    const caseItem = readMockCases().find(item => item.caseId === caseId);
    if (!caseItem) return null;
    const entries = [];
    readMockHistory().filter(item => item.caseId === caseId).forEach(job => {
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
    readMockSurgicalSimulations().filter(item => item.caseId === caseId).forEach(simulation => {
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
    readMockMeasurements().filter(item => item.caseId === caseId).forEach(measurement => {
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
    readMockSurgicalPlans().filter(item => item.caseId === caseId).forEach(plan => {
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
    readMockProductionReadiness().filter(item => item.caseId === caseId).forEach(readiness => {
      entries.push({
        entryId: `timeline-entry-readiness-${readiness.readinessId}`,
        caseId,
        modelId: readiness.modelId || "",
        reconstructionJobId: "",
        entryType: "readiness_check_completed",
        title: `Production readiness ${readiness.scope || "case"}`,
        description: `${readiness.scope || "case"} · ${readiness.level || readiness.readinessLevel || "limited"} · score ${Math.round(Number(readiness.score || readiness.productionScore || 0))}/100`,
        createdAt: readiness.createdAt || caseItem.updatedAt
      });
    });
    readMockReleases().filter(release => mockReleaseCaseIds(release).includes(caseId)).forEach(release => {
      (release.history || []).forEach(event => {
        if (!["release_created", "release_promoted", "release_archived"].includes(event.eventType)) return;
        entries.push({
          entryId: `timeline-entry-release-${release.releaseId}-${event.eventId}`,
          caseId,
          modelId: "",
          reconstructionJobId: "",
          entryType: event.eventType,
          title: `Release ${release.version || ""} ${release.status || ""}`.trim(),
          description: `${release.name || release.releaseId} · QA ${Math.round(Number(release.qaScore || 0))}/100 · readiness ${Math.round(Number(release.readinessScore || 0))}/100`,
          createdAt: event.createdAt || release.updatedAt || release.createdAt || caseItem.updatedAt
        });
      });
    });
    entries.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    return {
      timelineId: `timeline-${caseId}`,
      caseId,
      entries,
      createdAt: entries.length ? entries[entries.length - 1].createdAt : caseItem.createdAt,
      updatedAt: entries.length ? entries[0].createdAt : caseItem.updatedAt
    };
  }

  function makeMockComparisonId() {
    if (window.crypto?.randomUUID) return `comparison-${window.crypto.randomUUID()}`;
    return `comparison-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  }

  function updateMockCaseFromJob(job, result = null) {
    if (!job?.caseId) return;
    const cases = readMockCases();
    const existing = cases.find(item => item.caseId === job.caseId);
    if (!existing) return;
    if (!existing.reconstructionJobs.includes(job.jobId)) existing.reconstructionJobs.push(job.jobId);
    if ((result?.checks?.canOpen || job.resultGlbUrl) && !existing.models.includes(job.resultGlbUrl || job.jobId)) {
      existing.models.push(job.resultGlbUrl || job.jobId);
    }
    existing.updatedAt = new Date().toISOString();
    writeMockCases([existing, ...cases.filter(item => item.caseId !== existing.caseId)]);
  }

  function addMockReportToCase(caseId, reportId) {
    if (!caseId || !reportId) return;
    const cases = readMockCases();
    const existing = cases.find(item => item.caseId === caseId);
    if (!existing) return;
    if (!existing.reports.includes(reportId)) existing.reports.push(reportId);
    existing.updatedAt = new Date().toISOString();
    writeMockCases([existing, ...cases.filter(item => item.caseId !== existing.caseId)]);
  }

  function countWarnings(job) {
    return new Set([
      ...(job?.warnings || []),
      ...(job?.frameQualityReport?.warnings || []),
      ...(job?.segmentationWarnings || []),
      ...(job?.reconstructionWarnings || []),
      ...(job?.cleanupWarnings || []),
      ...(job?.alignmentWarnings || []),
      ...(job?.adjustmentWarnings || [])
    ].filter(Boolean)).size;
  }

  function normalizeReconstructionSettings(settings = {}) {
    const source = settings && typeof settings === "object" ? settings : {};
    return {
      processingMode: source.processingMode || DEFAULT_RECONSTRUCTION_SETTINGS.processingMode,
      inputTypePreference: source.inputTypePreference || DEFAULT_RECONSTRUCTION_SETTINGS.inputTypePreference,
      maxFrames: Number(source.maxFrames ?? DEFAULT_RECONSTRUCTION_SETTINGS.maxFrames),
      frameExtractionRate: Number(source.frameExtractionRate ?? DEFAULT_RECONSTRUCTION_SETTINGS.frameExtractionRate),
      cleanupStrength: source.cleanupStrength || DEFAULT_RECONSTRUCTION_SETTINGS.cleanupStrength,
      targetModelQuality: source.targetModelQuality || DEFAULT_RECONSTRUCTION_SETTINGS.targetModelQuality,
      saveIntermediateFiles: typeof source.saveIntermediateFiles === "boolean"
        ? source.saveIntermediateFiles
        : source.saveIntermediateFiles === "true"
          ? true
          : source.saveIntermediateFiles === "false"
            ? false
            : DEFAULT_RECONSTRUCTION_SETTINGS.saveIntermediateFiles
    };
  }

  function validateReconstructionSettings(settings = {}) {
    const normalized = normalizeReconstructionSettings(settings);
    const errors = [];
    if (!SETTINGS_OPTIONS.processingMode.includes(normalized.processingMode)) errors.push("processingMode must be fast, balanced, or quality.");
    if (!SETTINGS_OPTIONS.inputTypePreference.includes(normalized.inputTypePreference)) errors.push("inputTypePreference must be auto, photos, or video.");
    if (!SETTINGS_OPTIONS.maxFrames.includes(normalized.maxFrames)) errors.push("maxFrames must be 20, 40, or 60.");
    if (!SETTINGS_OPTIONS.frameExtractionRate.includes(normalized.frameExtractionRate)) errors.push("frameExtractionRate must be 0.5, 1, or 2.");
    if (!SETTINGS_OPTIONS.cleanupStrength.includes(normalized.cleanupStrength)) errors.push("cleanupStrength must be low, medium, or high.");
    if (!SETTINGS_OPTIONS.targetModelQuality.includes(normalized.targetModelQuality)) errors.push("targetModelQuality must be preview or planning.");
    if (typeof normalized.saveIntermediateFiles !== "boolean") errors.push("saveIntermediateFiles must be boolean.");
    return { ok: errors.length === 0, errors, settings: normalized };
  }

  function buildMockHistoryItem(job, result = null) {
    const canOpen = result?.checks?.canOpen || (job?.status === "ready" && Boolean(job?.resultGlbUrl));
    return {
      jobId: job.jobId,
      caseId: job.caseId || "",
      createdAt: job.createdAt || job.updatedAt || new Date().toISOString(),
      status: job.status || "uploaded",
      inputType: job.fileType || "unknown",
      filesCount: (job.uploadedFiles || job.files || []).length,
      resultGlbUrl: canOpen ? (result?.resultGlbUrl || job.resultGlbUrl || "") : "",
      reconstructionQuality: job.reconstructionQuality || "medium",
      cleanupQuality: job.cleanupQuality || "medium",
      warningsCount: countWarnings(job),
      readinessScore: result?.readinessScore ?? job.readinessScore ?? (canOpen ? 70 : 0),
      readinessLevel: result?.readinessLevel || job.readinessLevel || (canOpen ? "medium" : "poor"),
      settings: normalizeReconstructionSettings(job.settings)
    };
  }

  function mockReadiness(canOpen) {
    return canOpen ? {
      readinessScore: 70,
      readinessLevel: "medium",
      canOpenInViewer: true,
      canUseForVisualization: true,
      canUseForMeasurements: "caution",
      readinessWarnings: [
        "Требуется ручная проверка перед клиническим использованием",
        "Модель может быть непригодна для точных измерений"
      ]
    } : {
      readinessScore: 0,
      readinessLevel: "poor",
      canOpenInViewer: false,
      canUseForVisualization: false,
      canUseForMeasurements: false,
      readinessWarnings: [
        "GLB-модель не найдена",
        "Модель может быть непригодна для точных измерений",
        "Требуется ручная проверка перед клиническим использованием"
      ]
    };
  }

  function upsertMockHistoryFromJob(job, result = null) {
    if (!job?.jobId) return;
    const item = buildMockHistoryItem(job, result);
    const next = [item, ...readMockHistory().filter(existing => existing.jobId !== item.jobId)];
    writeMockHistory(next);
    updateMockCaseFromJob(job, result);
  }

  function apiError(code, message, cause = null) {
    const err = new Error(message);
    err.code = code;
    err.cause = cause;
    return err;
  }

  function normalizeBackendError(err, fallbackCode, fallbackMessage) {
    if (err?.code) return err;
    return apiError(fallbackCode, fallbackMessage, err);
  }

  async function backendJson(url, options = {}, fallbackCode = ERROR_CODES.networkUnavailable) {
    try {
      const response = await fetch(url, {
        headers: { "Accept": "application/json", ...(options.headers || {}) },
        ...options
      });
      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json") ? await response.json() : null;
      if (!response.ok) {
        const backendError = payload?.error;
        throw apiError(
          backendError?.code || fallbackCode,
          backendError?.message || `Backend request failed: ${response.status} ${response.statusText}`
        );
      }
      return payload;
    } catch (err) {
      throw normalizeBackendError(err, fallbackCode, "Network/backend unavailable.");
    }
  }

  async function uploadReconstructionFiles(files) {
    const fileArray = Array.from(files || []);

    if (reconstructionMode === "mock") {
      if (!pipeline()) throw apiError(ERROR_CODES.jobFailed, "Mock reconstruction pipeline не загружен.");
      const validation = pipeline().validateReconstructionFiles(fileArray);
      if (!validation.ok) {
        throw apiError(ERROR_CODES.uploadFailed, validation.errors.map(error => error.message).join(" "));
      }

      let previewReport = null;
      if (preprocessing()) {
        const prepared = await preprocessing().prepareReconstructionInput(fileArray);
        previewReport = {
          ...prepared.analysis,
          estimatedQuality: prepared.estimatedQuality,
          warnings: prepared.warnings,
          recommendations: prepared.recommendations
        };
      }

      return {
        mode: reconstructionMode,
        uploadId: `mock-upload-${Date.now().toString(36)}`,
        files: fileArray,
        fileType: validation.fileType,
        previewReport
      };
    }

    const form = new FormData();
    fileArray.forEach(file => form.append("files", file));
    const uploadResult = await backendJson(ENDPOINTS.upload, {
      method: "POST",
      body: form
    }, ERROR_CODES.uploadFailed);
    if (preprocessing()) {
      const prepared = await preprocessing().prepareReconstructionInput(fileArray);
      uploadResult.previewReport = {
        ...prepared.analysis,
        estimatedQuality: prepared.estimatedQuality,
        warnings: prepared.warnings,
        recommendations: prepared.recommendations
      };
    }
    return uploadResult;
  }

  async function listPatientCases() {
    if (reconstructionMode === "mock") return readMockCases();
    const payload = await backendJson(ENDPOINTS.cases, { method: "GET" }, ERROR_CODES.networkUnavailable);
    return payload?.cases || [];
  }

  async function createPatientCase(caseInput = {}) {
    const patientName = String(caseInput.patientName || "").trim();
    if (!patientName) throw apiError(ERROR_CODES.jobFailed, "patientName is required.");

    if (reconstructionMode === "mock") {
      const timestamp = new Date().toISOString();
      const caseItem = {
        caseId: makeMockCaseId(),
        patientName,
        patientId: String(caseInput.patientId || "").trim(),
        createdAt: timestamp,
        updatedAt: timestamp,
        notes: String(caseInput.notes || "").trim(),
        reconstructionJobs: [],
        reports: [],
        models: [],
        comparisons: [],
        measurements: [],
        landmarks: [],
        surgicalPlans: [],
        simulations: [],
        ownerId: "",
        teamMembers: [],
        permissions: {}
      };
      const owner = normalizeTeamMember({
        name: String(caseInput.ownerName || "Case Owner"),
        role: "owner",
        email: String(caseInput.ownerEmail || "")
      });
      caseItem.ownerId = owner.memberId;
      caseItem.teamMembers = [owner];
      caseItem.permissions = { [owner.memberId]: owner.permissions };
      writeMockCases([caseItem, ...readMockCases()]);
      recordMockAuditEvent({
        caseId: caseItem.caseId,
        action: "case_created",
        entityType: "case",
        entityId: caseItem.caseId,
        details: { patientName: caseItem.patientName, patientId: caseItem.patientId }
      });
      return caseItem;
    }

    return await backendJson(ENDPOINTS.cases, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(caseInput)
    }, ERROR_CODES.jobFailed);
  }

  async function deletePatientCase(caseId) {
    const normalizedCaseId = String(caseId || "").trim();
    if (!normalizedCaseId) throw apiError(ERROR_CODES.jobFailed, "caseId is required.");

    if (reconstructionMode === "mock") {
      const existing = readMockCases().find(item => item.caseId === normalizedCaseId);
      if (!existing) throw apiError(ERROR_CODES.jobFailed, "Case not found.");
      writeMockCases(readMockCases().filter(item => item.caseId !== normalizedCaseId));
      writeMockHistory(readMockHistory().filter(item => item.caseId !== normalizedCaseId));
      writeMockComparisons(readMockComparisons().filter(item => item.caseId !== normalizedCaseId));
      writeMockMeasurements(readMockMeasurements().filter(item => item.caseId !== normalizedCaseId));
      writeMockLandmarks(readMockLandmarks().filter(item => item.caseId !== normalizedCaseId));
      writeMockSurgicalPlans(readMockSurgicalPlans().filter(item => item.caseId !== normalizedCaseId));
      writeMockSurgicalSimulations(readMockSurgicalSimulations().filter(item => item.caseId !== normalizedCaseId));
      writeMockAuditEvents(readMockAuditEvents().filter(item => item.caseId !== normalizedCaseId));
      writeMockClinicalInsights(readMockClinicalInsights().filter(item => item.caseId !== normalizedCaseId));
      return { deleted: true, case: existing };
    }

    return await backendJson(`${ENDPOINTS.cases}/${encodeURIComponent(normalizedCaseId)}`, {
      method: "DELETE"
    }, ERROR_CODES.jobFailed);
  }

  async function listModelComparisons(caseId = "all") {
    const normalizedCase = String(caseId || "all");
    if (reconstructionMode === "mock") {
      return readMockComparisons()
        .filter(item => normalizedCase === "all" || item.caseId === normalizedCase);
    }
    const params = new URLSearchParams();
    if (normalizedCase !== "all") params.set("caseId", normalizedCase);
    const query = params.toString() ? `?${params.toString()}` : "";
    const payload = await backendJson(`${ENDPOINTS.comparisons}${query}`, { method: "GET" }, ERROR_CODES.networkUnavailable);
    return payload?.comparisons || [];
  }

  async function createModelComparison(input = {}) {
    if (reconstructionMode === "mock") {
      const timestamp = new Date().toISOString();
      const before = readMockHistory().find(item => item.jobId === input.beforeJobId);
      const after = readMockHistory().find(item => item.jobId === input.afterJobId);
      if (!before || !after || before.status !== "ready" || after.status !== "ready") {
        throw apiError(ERROR_CODES.jobFailed, "Comparison models must be ready.");
      }
      if (before.caseId !== input.caseId || after.caseId !== input.caseId) {
        throw apiError(ERROR_CODES.jobFailed, "Both comparison models must belong to the selected case.");
      }
      const comparison = {
        comparisonId: makeMockComparisonId(),
        caseId: String(input.caseId || "").trim(),
        beforeJobId: String(input.beforeJobId || "").trim(),
        afterJobId: String(input.afterJobId || "").trim(),
        createdAt: timestamp,
        updatedAt: timestamp,
        notes: String(input.notes || "").trim(),
        comparisonMode: input.comparisonMode || "show_before"
      };
      if (!comparison.caseId || !comparison.beforeJobId || !comparison.afterJobId) {
        throw apiError(ERROR_CODES.jobFailed, "caseId, beforeJobId, and afterJobId are required.");
      }
      writeMockComparisons([comparison, ...readMockComparisons()]);
      return comparison;
    }

    return await backendJson(ENDPOINTS.comparisons, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }, ERROR_CODES.jobFailed);
  }

  async function getModelComparisonReport(comparisonId) {
    if (reconstructionMode === "mock") {
      const comparison = readMockComparisons().find(item => item.comparisonId === comparisonId);
      if (!comparison) throw apiError(ERROR_CODES.jobFailed, "Comparison not found.");
      const jobs = readMockHistory();
      const before = jobs.find(item => item.jobId === comparison.beforeJobId) || {};
      const after = jobs.find(item => item.jobId === comparison.afterJobId) || {};
      addMockReportToCase(comparison.caseId, `${comparison.comparisonId}:comparison-report`);
      return {
        comparisonId: comparison.comparisonId,
        caseId: comparison.caseId,
        createdAt: comparison.createdAt,
        generatedAt: new Date().toISOString(),
        comparisonMode: comparison.comparisonMode,
        notes: comparison.notes || "",
        beforeModel: {
          jobId: before.jobId || comparison.beforeJobId,
          resultGlbUrl: before.resultGlbUrl || "",
          createdAt: before.createdAt || "",
          readinessScore: before.readinessScore || 0,
          readinessLevel: before.readinessLevel || "poor",
          warnings: []
        },
        afterModel: {
          jobId: after.jobId || comparison.afterJobId,
          resultGlbUrl: after.resultGlbUrl || "",
          createdAt: after.createdAt || "",
          readinessScore: after.readinessScore || 0,
          readinessLevel: after.readinessLevel || "poor",
          warnings: []
        },
        warnings: []
      };
    }

    return await backendJson(ENDPOINTS.comparisonReport(comparisonId), { method: "GET" }, ERROR_CODES.jobFailed);
  }

  function measurementMatchesFilter(item, filter = {}) {
    const caseId = String(filter.caseId || "all");
    const jobId = String(filter.jobId || "all");
    const modelId = String(filter.modelId || "all");
    return (caseId === "all" || item.caseId === caseId)
      && (jobId === "all" || item.jobId === jobId)
      && (modelId === "all" || item.modelId === modelId);
  }

  async function listCaseMeasurements(filter = {}) {
    if (reconstructionMode === "mock") {
      return readMockMeasurements()
        .filter(item => measurementMatchesFilter(item, filter))
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    }
    const params = new URLSearchParams();
    if (filter.caseId && filter.caseId !== "all") params.set("caseId", filter.caseId);
    if (filter.jobId && filter.jobId !== "all") params.set("jobId", filter.jobId);
    if (filter.modelId && filter.modelId !== "all") params.set("modelId", filter.modelId);
    const query = params.toString() ? `?${params.toString()}` : "";
    const payload = await backendJson(`${ENDPOINTS.measurements}${query}`, { method: "GET" }, ERROR_CODES.networkUnavailable);
    return payload?.measurements || [];
  }

  async function saveCaseMeasurement(input = {}) {
    if (reconstructionMode === "mock") {
      const timestamp = new Date().toISOString();
      const existing = readMockMeasurements().find(item => item.measurementId === input.measurementId);
      const measurement = {
        measurementId: String(input.measurementId || existing?.measurementId || makeMockMeasurementId()),
        caseId: String(input.caseId || existing?.caseId || "").trim(),
        jobId: String(input.jobId || existing?.jobId || "").trim(),
        modelId: String(input.modelId || existing?.modelId || "").trim(),
        type: String(input.type || existing?.type || "annotation").trim(),
        label: String(input.label ?? existing?.label ?? "").trim(),
        points: Array.isArray(input.points) ? input.points : (existing?.points || []),
        value: input.value === null || input.value === "" || !Number.isFinite(Number(input.value)) ? null : Number(input.value),
        unit: String(input.unit ?? existing?.unit ?? "").trim(),
        landmarksUsed: Array.isArray(input.landmarksUsed) ? input.landmarksUsed.map(String) : (existing?.landmarksUsed || []),
        source: String(input.source ?? existing?.source ?? "manual").trim() || "manual",
        templateId: String(input.templateId ?? existing?.templateId ?? "").trim(),
        templateName: String(input.templateName ?? existing?.templateName ?? "").trim(),
        missingLandmarks: Array.isArray(input.missingLandmarks) ? input.missingLandmarks.map(String) : (existing?.missingLandmarks || []),
        status: ["ready", "missing_landmarks", "needs_review", "calculated", "error"].includes(input.status ?? existing?.status) ? (input.status ?? existing?.status) : "ready",
        warnings: Array.isArray(input.warnings) ? input.warnings.map(String) : (existing?.warnings || []),
        formula: String(input.formula ?? existing?.formula ?? "").trim(),
        description: String(input.description ?? existing?.description ?? "").trim(),
        fromLandmark: String(input.fromLandmark ?? existing?.fromLandmark ?? "").trim(),
        toLandmark: String(input.toLandmark ?? existing?.toLandmark ?? "").trim(),
        optionalThirdLandmark: String(input.optionalThirdLandmark ?? existing?.optionalThirdLandmark ?? "").trim(),
        analysisPresetId: String(input.analysisPresetId ?? existing?.analysisPresetId ?? "").trim(),
        analysisPresetName: String(input.analysisPresetName ?? existing?.analysisPresetName ?? "").trim(),
        calculatedAt: String(input.calculatedAt ?? existing?.calculatedAt ?? "").trim(),
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp
      };
      if (!measurement.caseId || !measurement.jobId || !measurement.modelId) {
        throw apiError(ERROR_CODES.jobFailed, "caseId, jobId, and modelId are required for measurement storage.");
      }
      const allowed = new Set(["distance", "angle", "vector", "point", "annotation", "ratio", "custom"]);
      if (!allowed.has(measurement.type)) {
        throw apiError(ERROR_CODES.jobFailed, "Unsupported measurement type.");
      }
      writeMockMeasurements([measurement, ...readMockMeasurements().filter(item => item.measurementId !== measurement.measurementId)]);
      recordMockAuditEvent({
        caseId: measurement.caseId,
        action: existing ? "measurement_updated" : "measurement_added",
        entityType: "measurement",
        entityId: measurement.measurementId,
        details: { type: measurement.type, label: measurement.label, modelId: measurement.modelId }
      });
      return measurement;
    }

    return await backendJson(ENDPOINTS.measurements, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }, ERROR_CODES.jobFailed);
  }

  async function updateCaseMeasurementLabel(measurementId, label) {
    if (reconstructionMode === "mock") {
      const items = readMockMeasurements();
      const existing = items.find(item => item.measurementId === measurementId);
      if (!existing) throw apiError(ERROR_CODES.jobFailed, "Measurement not found.");
      existing.label = String(label || "").trim() || existing.label;
      existing.updatedAt = new Date().toISOString();
      writeMockMeasurements([existing, ...items.filter(item => item.measurementId !== measurementId)]);
      return existing;
    }
    return await backendJson(ENDPOINTS.measurement(measurementId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label })
    }, ERROR_CODES.jobFailed);
  }

  async function deleteCaseMeasurement(measurementId) {
    if (reconstructionMode === "mock") {
      const existing = readMockMeasurements().find(item => item.measurementId === measurementId);
      writeMockMeasurements(readMockMeasurements().filter(item => item.measurementId !== measurementId));
      return { deleted: Boolean(existing), measurement: existing || null };
    }
    return await backendJson(ENDPOINTS.measurement(measurementId), { method: "DELETE" }, ERROR_CODES.jobFailed);
  }

  async function listCaseLandmarks(filter = {}) {
    if (reconstructionMode === "mock") {
      return readMockLandmarks()
        .filter(item => measurementMatchesFilter(item, filter))
        .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
    }
    const params = new URLSearchParams();
    if (filter.caseId && filter.caseId !== "all") params.set("caseId", filter.caseId);
    if (filter.jobId && filter.jobId !== "all") params.set("jobId", filter.jobId);
    if (filter.modelId && filter.modelId !== "all") params.set("modelId", filter.modelId);
    const query = params.toString() ? `?${params.toString()}` : "";
    const payload = await backendJson(`${ENDPOINTS.landmarks}${query}`, { method: "GET" }, ERROR_CODES.networkUnavailable);
    return payload?.landmarks || [];
  }

  async function saveCaseLandmark(input = {}) {
    if (reconstructionMode === "mock") {
      const timestamp = new Date().toISOString();
      const existing = readMockLandmarks().find(item => item.landmarkId === input.landmarkId);
      const landmark = {
        landmarkId: String(input.landmarkId || existing?.landmarkId || makeMockLandmarkId()),
        caseId: String(input.caseId || existing?.caseId || "").trim(),
        jobId: String(input.jobId || existing?.jobId || "").trim(),
        modelId: String(input.modelId || existing?.modelId || "").trim(),
        name: String(input.name ?? existing?.name ?? "Landmark").trim() || "Landmark",
        category: ["facial", "nasal", "maxillofacial", "orthodontic", "custom"].includes(input.category || existing?.category) ? (input.category || existing?.category) : "custom",
        position3D: {
          x: Number(input.position3D?.x ?? existing?.position3D?.x ?? 0) || 0,
          y: Number(input.position3D?.y ?? existing?.position3D?.y ?? 0) || 0,
          z: Number(input.position3D?.z ?? existing?.position3D?.z ?? 0) || 0
        },
        color: String(input.color ?? existing?.color ?? "#2563eb"),
        description: String(input.description ?? existing?.description ?? "").trim(),
        source: ["manual", "imported", "ai_generated"].includes(input.source || existing?.source) ? (input.source || existing?.source) : "manual",
        visible: (input.status === "hidden" || input.status === "rejected") ? false : (input.visible === undefined ? existing?.visible !== false : input.visible !== false),
        status: ["unplaced", "placed", "hidden", "proposed", "approved", "corrected", "rejected"].includes(input.status || existing?.status) ? (input.status || existing?.status) : "placed",
        templateId: String(input.templateId ?? existing?.templateId ?? "").trim(),
        templateName: String(input.templateName ?? existing?.templateName ?? "").trim(),
        required: Boolean(input.required ?? existing?.required),
        confidence: input.confidence === undefined && existing?.confidence === undefined ? null : Math.max(0, Math.min(100, Number(input.confidence ?? existing?.confidence ?? 0) || 0)),
        detectionMode: ["manual", "ai_assisted", "template_only"].includes(input.detectionMode || existing?.detectionMode) ? (input.detectionMode || existing?.detectionMode) : "manual",
        detectionSource: String(input.detectionSource ?? existing?.detectionSource ?? input.source ?? existing?.source ?? "manual").trim() || "manual",
        approvedByUser: Boolean(input.approvedByUser ?? existing?.approvedByUser),
        correctedByUser: Boolean(input.correctedByUser ?? existing?.correctedByUser),
        analysisPresetId: String(input.analysisPresetId ?? existing?.analysisPresetId ?? "").trim(),
        analysisPresetName: String(input.analysisPresetName ?? existing?.analysisPresetName ?? "").trim(),
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp
      };
      if (!landmark.caseId || !landmark.jobId || !landmark.modelId) {
        throw apiError(ERROR_CODES.jobFailed, "caseId, jobId, and modelId are required for landmark storage.");
      }
      writeMockLandmarks([landmark, ...readMockLandmarks().filter(item => item.landmarkId !== landmark.landmarkId)]);
      const cases = readMockCases();
      const linkedCase = cases.find(item => item.caseId === landmark.caseId);
      if (linkedCase) {
        linkedCase.landmarks = linkedCase.landmarks || [];
        if (!linkedCase.landmarks.includes(landmark.landmarkId)) linkedCase.landmarks.push(landmark.landmarkId);
        linkedCase.landmarkTemplates = linkedCase.landmarkTemplates || [];
        if (landmark.templateId && !linkedCase.landmarkTemplates.includes(landmark.templateId)) linkedCase.landmarkTemplates.push(landmark.templateId);
        linkedCase.updatedAt = timestamp;
        writeMockCases([linkedCase, ...cases.filter(item => item.caseId !== landmark.caseId)]);
      }
      recordMockAuditEvent({
        caseId: landmark.caseId,
        action: existing ? "landmark_updated" : "landmark_added",
        entityType: "landmark",
        entityId: landmark.landmarkId,
        details: { name: landmark.name, modelId: landmark.modelId, status: landmark.status }
      });
      return landmark;
    }

    return await backendJson(ENDPOINTS.landmarks, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }, ERROR_CODES.jobFailed);
  }

  async function deleteCaseLandmark(landmarkId) {
    if (reconstructionMode === "mock") {
      const existing = readMockLandmarks().find(item => item.landmarkId === landmarkId);
      writeMockLandmarks(readMockLandmarks().filter(item => item.landmarkId !== landmarkId));
      if (existing?.caseId) {
        const cases = readMockCases();
        const linkedCase = cases.find(item => item.caseId === existing.caseId);
        if (linkedCase) {
          linkedCase.landmarks = (linkedCase.landmarks || []).filter(id => id !== landmarkId);
          linkedCase.updatedAt = new Date().toISOString();
          writeMockCases([linkedCase, ...cases.filter(item => item.caseId !== existing.caseId)]);
        }
      }
      return { deleted: Boolean(existing), landmark: existing || null };
    }
    return await backendJson(ENDPOINTS.landmark(landmarkId), { method: "DELETE" }, ERROR_CODES.jobFailed);
  }

  async function listLandmarkTemplates() {
    if (reconstructionMode === "mock") {
      return readMockLandmarkTemplates()
        .sort((a, b) => Number(b.builtIn) - Number(a.builtIn) || String(a.name || "").localeCompare(String(b.name || "")));
    }
    const payload = await backendJson(ENDPOINTS.landmarkTemplates, { method: "GET" }, ERROR_CODES.networkUnavailable);
    return payload?.templates || [];
  }

  async function saveLandmarkTemplate(input = {}) {
    if (reconstructionMode === "mock") {
      const timestamp = new Date().toISOString();
      const existing = readMockLandmarkTemplates().find(item => item.templateId === input.templateId);
      const template = {
        templateId: String(input.templateId || existing?.templateId || makeMockLandmarkTemplateId()),
        name: String(input.name ?? existing?.name ?? "Custom Template").trim() || "Custom Template",
        category: ["facial", "nasal", "maxillofacial", "orthodontic", "custom"].includes(input.category || existing?.category) ? (input.category || existing?.category) : "custom",
        description: String(input.description ?? existing?.description ?? "").trim(),
        landmarks: (Array.isArray(input.landmarks) ? input.landmarks : existing?.landmarks || []).map(item => ({
          landmarkName: String(item.landmarkName || item.name || "Landmark").trim() || "Landmark",
          landmarkCategory: ["facial", "nasal", "maxillofacial", "orthodontic", "custom"].includes(item.landmarkCategory || item.category) ? (item.landmarkCategory || item.category) : "custom",
          description: String(item.description || "").trim(),
          required: Boolean(item.required),
          color: String(item.color || "#2563eb")
        })),
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp,
        builtIn: false
      };
      const templates = readMockLandmarkTemplates().filter(item => item.templateId !== template.templateId);
      writeMockLandmarkTemplates([template, ...templates]);
      return template;
    }
    return await backendJson(ENDPOINTS.landmarkTemplates, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }, ERROR_CODES.jobFailed);
  }

  async function deleteLandmarkTemplate(templateId) {
    if (reconstructionMode === "mock") {
      const existing = readMockLandmarkTemplates().find(item => item.templateId === templateId);
      if (!existing || existing.builtIn) return { deleted: false, template: existing || null };
      writeMockLandmarkTemplates(readMockLandmarkTemplates().filter(item => item.templateId !== templateId));
      return { deleted: true, template: existing };
    }
    return await backendJson(ENDPOINTS.landmarkTemplate(templateId), { method: "DELETE" }, ERROR_CODES.jobFailed);
  }

  async function getPatientCaseReport(caseId) {
    if (reconstructionMode === "mock") {
      const caseItem = readMockCases().find(item => item.caseId === caseId);
      if (!caseItem) throw apiError(ERROR_CODES.jobFailed, "Case not found.");
      const jobs = readMockHistory().filter(item => item.caseId === caseId);
      const measurements = readMockMeasurements().filter(item => item.caseId === caseId);
      const landmarks = readMockLandmarks().filter(item => item.caseId === caseId);
      const landmarkTemplateReport = summarizeLandmarkTemplates(landmarks);
      const aiLandmarkReport = summarizeAiLandmarks(landmarks);
      const measurementTemplateReport = summarizeMeasurementTemplates(measurements);
      const autoMeasurementReport = summarizeCalculatedMeasurements(measurements);
      const clinicalAnalysisPresetReport = summarizeClinicalAnalysisPresets(landmarks, measurements);
      const surgicalPlanningNotes = readMockSurgicalPlans().filter(item => item.caseId === caseId);
      const surgicalSimulations = readMockSurgicalSimulations().filter(item => item.caseId === caseId);
      const teamMembers = (caseItem.teamMembers || []).map(member => normalizeTeamMember(member, member));
      const caseOwner = teamMembers.find(member => member.memberId === caseItem.ownerId) || teamMembers.find(member => member.role === "owner") || null;
      const contributors = teamMembers
        .filter(member => member.role !== "viewer")
        .map(member => ({
          memberId: member.memberId,
          name: member.name,
          role: member.role,
          permissions: member.permissions || []
        }));
      const auditEvents = filterMockAuditEvents({ caseId });
      const auditSummary = {
        eventsCount: auditEvents.length,
        actions: auditEvents.reduce((acc, event) => {
          acc[event.action] = (acc[event.action] || 0) + 1;
          return acc;
        }, {}),
        users: auditEvents.reduce((acc, event) => {
          const label = event.userName || event.userId || "Local User";
          acc[label] = (acc[label] || 0) + 1;
          return acc;
        }, {}),
        latestEvents: auditEvents.slice(0, 10)
      };
      const resultModels = jobs
        .filter(item => item.resultGlbUrl)
        .map(item => ({
          jobId: item.jobId,
          modelId: item.resultGlbUrl || item.jobId,
          resultGlbUrl: item.resultGlbUrl || "",
          createdAt: item.createdAt,
          readinessScore: item.readinessScore || 0,
          readinessLevel: item.readinessLevel || "poor",
          warningsCount: item.warningsCount || 0
        }));
      const readinessScores = jobs.map(item => ({
        jobId: item.jobId,
        readinessScore: item.readinessScore || 0,
        readinessLevel: item.readinessLevel || "poor"
      }));
      const warnings = jobs
        .filter(item => Number(item.warningsCount || 0) > 0)
        .map(item => ({
          jobId: item.jobId,
          warningsCount: item.warningsCount || 0,
          readinessLevel: item.readinessLevel || "poor"
        }));
      addMockReportToCase(caseId, `${caseId}:case-report`);
      const productionResult = generateMockProductionReadiness(caseId, { recordAudit: false });
      const timeline = buildMockCaseTimeline(caseId);
      return {
        ...caseItem,
        generatedAt: new Date().toISOString(),
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
        readinessScores,
        warnings,
        comparisons: readMockComparisons().filter(item => item.caseId === caseId),
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
        productionReadiness: productionResult.readiness,
        productionReadinessSummary: productionResult.summary,
        timeline,
        timelineSummary: {
          timelineId: timeline?.timelineId || `timeline-${caseId}`,
          entriesCount: timeline?.entries?.length || 0,
          reconstructionEntriesCount: (timeline?.entries || []).filter(item => item.entryType === "reconstruction").length,
          simulationEntriesCount: (timeline?.entries || []).filter(item => item.entryType === "simulation").length,
          reportEntriesCount: (timeline?.entries || []).filter(item => item.entryType === "report").length,
          measurementSnapshotEntriesCount: (timeline?.entries || []).filter(item => item.entryType === "measurement_snapshot").length,
          noteEntriesCount: (timeline?.entries || []).filter(item => item.entryType === "note").length,
          readinessEntriesCount: (timeline?.entries || []).filter(item => item.entryType === "readiness_check_completed").length
        }
      };
    }
    return await backendJson(ENDPOINTS.caseReport(caseId), { method: "GET" }, ERROR_CODES.jobFailed);
  }

  async function getSystemReport() {
    if (reconstructionMode === "mock") {
      const readiness = readMockProductionReadiness();
      const summary = productionSummary(readiness);
      return {
        reportType: "system_report",
        generatedAt: new Date().toISOString(),
        casesCount: readMockCases().length,
        modelsCount: readMockHistory().length,
        reportsCount: readMockCases().reduce((sum, item) => sum + Number(item.reports?.length || 0), 0),
        backupStatus: { backupVersion: "v1", localBackupSupported: true, cloudSyncEnabled: false },
        auditStatus: { auditLogAvailable: true, eventsCount: readMockAuditEvents().length },
        timelineStatus: { timelineAvailable: true },
        productionReadiness: readiness,
        productionReadinessSummary: summary,
        releaseSummary: {
          releasesCount: readMockReleases().length,
          activeCount: readMockReleases().filter(item => item.status !== "archived").length,
          approvedCount: readMockReleases().filter(item => item.status === "approved").length,
          releaseCandidateCount: readMockReleases().filter(item => item.status === "release_candidate").length
        },
        releases: readMockReleases()
        ,
        installedPlugins: readMockPlugins(),
        installedPluginsSummary: mockPluginSummary()
      };
    }
    return await backendJson(ENDPOINTS.systemReport, { method: "GET" }, ERROR_CODES.jobFailed);
  }

  async function listCaseAuditEvents(caseId, filter = {}) {
    const normalizedCaseId = String(caseId || "").trim();
    if (!normalizedCaseId) throw apiError(ERROR_CODES.jobFailed, "caseId is required.");
    if (reconstructionMode === "mock") {
      return filterMockAuditEvents({
        caseId: normalizedCaseId,
        action: filter.action || "all",
        userId: filter.userId || "all",
        date: filter.date || ""
      });
    }
    const params = new URLSearchParams();
    if (filter.action && filter.action !== "all") params.set("action", filter.action);
    if (filter.userId && filter.userId !== "all") params.set("userId", filter.userId);
    if (filter.date) params.set("date", filter.date);
    const query = params.toString() ? `?${params.toString()}` : "";
    const payload = await backendJson(`${ENDPOINTS.caseAudit(normalizedCaseId)}${query}`, { method: "GET" }, ERROR_CODES.jobFailed);
    return payload?.events || [];
  }

  async function listClinicalInsights(caseId, filter = {}) {
    const normalizedCaseId = String(caseId || "").trim();
    if (!normalizedCaseId) throw apiError(ERROR_CODES.jobFailed, "caseId is required.");
    if (reconstructionMode === "mock") {
      const modelId = String(filter.modelId || "all");
      const status = String(filter.status || "active");
      return readMockClinicalInsights()
        .filter(item => item.caseId === normalizedCaseId)
        .filter(item => modelId === "all" || item.modelId === modelId)
        .filter(item => status === "all" || (status === "active" ? !item.dismissed : item[status] === true))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    }
    const params = new URLSearchParams();
    if (filter.modelId && filter.modelId !== "all") params.set("modelId", filter.modelId);
    if (filter.status && filter.status !== "active") params.set("status", filter.status);
    const query = params.toString() ? `?${params.toString()}` : "";
    const payload = await backendJson(`${ENDPOINTS.caseInsights(normalizedCaseId)}${query}`, { method: "GET" }, ERROR_CODES.jobFailed);
    return payload?.insights || [];
  }

  async function generateClinicalInsights(caseId) {
    const normalizedCaseId = String(caseId || "").trim();
    if (!normalizedCaseId) throw apiError(ERROR_CODES.jobFailed, "caseId is required.");
    if (reconstructionMode === "mock") return generateMockClinicalInsights(normalizedCaseId);
    const payload = await backendJson(ENDPOINTS.generateCaseInsights(normalizedCaseId), { method: "POST" }, ERROR_CODES.jobFailed);
    return payload?.insights || [];
  }

  async function updateClinicalInsight(insightId, changes = {}) {
    const normalizedInsightId = String(insightId || "").trim();
    if (!normalizedInsightId) throw apiError(ERROR_CODES.jobFailed, "insightId is required.");
    if (reconstructionMode === "mock") {
      const timestamp = new Date().toISOString();
      const items = readMockClinicalInsights();
      const existing = items.find(item => item.insightId === normalizedInsightId);
      if (!existing) throw apiError(ERROR_CODES.jobFailed, "Clinical insight not found.");
      const next = {
        ...existing,
        reviewed: changes.reviewed === undefined ? existing.reviewed : Boolean(changes.reviewed),
        dismissed: changes.dismissed === undefined ? existing.dismissed : Boolean(changes.dismissed),
        pinned: changes.pinned === undefined ? existing.pinned : Boolean(changes.pinned),
        reviewedAt: changes.reviewed ? timestamp : existing.reviewedAt || "",
        dismissedAt: changes.dismissed ? timestamp : existing.dismissedAt || ""
      };
      writeMockClinicalInsights([next, ...items.filter(item => item.insightId !== normalizedInsightId)]);
      if (changes.reviewed || changes.dismissed) {
        recordMockAuditEvent({
          caseId: next.caseId,
          action: "insight_acknowledged",
          entityType: "clinical_insight",
          entityId: next.insightId,
          details: { reviewed: next.reviewed, dismissed: next.dismissed, pinned: next.pinned }
        });
      }
      return next;
    }
    return await backendJson(ENDPOINTS.clinicalInsight(normalizedInsightId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes || {})
    }, ERROR_CODES.jobFailed);
  }

  async function listCaseTeamMembers(caseId) {
    const normalizedCaseId = String(caseId || "").trim();
    if (!normalizedCaseId) throw apiError(ERROR_CODES.jobFailed, "caseId is required.");
    if (reconstructionMode === "mock") {
      const caseItem = readMockCases().find(item => item.caseId === normalizedCaseId);
      if (!caseItem) throw apiError(ERROR_CODES.jobFailed, "Case not found.");
      return {
        ownerId: caseItem.ownerId || "",
        permissions: caseItem.permissions || {},
        teamMembers: (caseItem.teamMembers || []).map(member => normalizeTeamMember(member, member))
      };
    }
    return await backendJson(ENDPOINTS.caseTeam(normalizedCaseId), { method: "GET" }, ERROR_CODES.jobFailed);
  }

  async function saveCaseTeamMember(caseId, input = {}) {
    const normalizedCaseId = String(caseId || "").trim();
    if (!normalizedCaseId) throw apiError(ERROR_CODES.jobFailed, "caseId is required.");
    if (reconstructionMode === "mock") {
      const cases = readMockCases();
      const caseItem = cases.find(item => item.caseId === normalizedCaseId);
      if (!caseItem) throw apiError(ERROR_CODES.jobFailed, "Case not found.");
      const existing = (caseItem.teamMembers || []).find(item => item.memberId === input.memberId);
      const member = normalizeTeamMember(input, existing);
      caseItem.teamMembers = [member, ...(caseItem.teamMembers || []).filter(item => item.memberId !== member.memberId)];
      caseItem.permissions = caseItem.permissions || {};
      caseItem.permissions[member.memberId] = member.permissions;
      if (member.role === "owner" || !caseItem.ownerId) caseItem.ownerId = member.memberId;
      caseItem.updatedAt = new Date().toISOString();
      writeMockCases([caseItem, ...cases.filter(item => item.caseId !== normalizedCaseId)]);
      recordMockAuditEvent({
        caseId: normalizedCaseId,
        action: "team_member_added",
        entityType: "team_member",
        entityId: member.memberId,
        details: { name: member.name, role: member.role, email: member.email }
      });
      return member;
    }
    return await backendJson(ENDPOINTS.caseTeam(normalizedCaseId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }, ERROR_CODES.jobFailed);
  }

  async function updateCaseTeamMemberRole(caseId, memberId, role) {
    const normalizedCaseId = String(caseId || "").trim();
    const normalizedMemberId = String(memberId || "").trim();
    if (!normalizedCaseId || !normalizedMemberId) throw apiError(ERROR_CODES.jobFailed, "caseId and memberId are required.");
    if (reconstructionMode === "mock") {
      const cases = readMockCases();
      const caseItem = cases.find(item => item.caseId === normalizedCaseId);
      if (!caseItem) throw apiError(ERROR_CODES.jobFailed, "Case not found.");
      const existing = (caseItem.teamMembers || []).find(item => item.memberId === normalizedMemberId);
      if (!existing) throw apiError(ERROR_CODES.jobFailed, "Team member not found.");
      const nextRole = TEAM_ROLES.includes(role) ? role : existing.role;
      const member = normalizeTeamMember({ ...existing, role: nextRole, permissions: permissionsForRole(nextRole) }, existing);
      caseItem.teamMembers = (caseItem.teamMembers || []).map(item => item.memberId === normalizedMemberId ? member : item);
      caseItem.permissions = caseItem.permissions || {};
      caseItem.permissions[member.memberId] = member.permissions;
      if (nextRole === "owner") caseItem.ownerId = member.memberId;
      caseItem.updatedAt = new Date().toISOString();
      writeMockCases([caseItem, ...cases.filter(item => item.caseId !== normalizedCaseId)]);
      recordMockAuditEvent({
        caseId: normalizedCaseId,
        action: "case_updated",
        entityType: "team_member",
        entityId: member.memberId,
        details: { name: member.name, previousRole: existing.role, role: member.role, email: member.email }
      });
      return member;
    }
    return await backendJson(ENDPOINTS.caseTeamMember(normalizedCaseId, normalizedMemberId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role })
    }, ERROR_CODES.jobFailed);
  }

  async function removeCaseTeamMember(caseId, memberId) {
    const normalizedCaseId = String(caseId || "").trim();
    const normalizedMemberId = String(memberId || "").trim();
    if (!normalizedCaseId || !normalizedMemberId) throw apiError(ERROR_CODES.jobFailed, "caseId and memberId are required.");
    if (reconstructionMode === "mock") {
      const cases = readMockCases();
      const caseItem = cases.find(item => item.caseId === normalizedCaseId);
      if (!caseItem) throw apiError(ERROR_CODES.jobFailed, "Case not found.");
      const existing = (caseItem.teamMembers || []).find(item => item.memberId === normalizedMemberId);
      if (!existing || existing.memberId === caseItem.ownerId) throw apiError(ERROR_CODES.jobFailed, "Team member not found or owner cannot be removed.");
      caseItem.teamMembers = (caseItem.teamMembers || []).filter(item => item.memberId !== normalizedMemberId);
      if (caseItem.permissions) delete caseItem.permissions[normalizedMemberId];
      caseItem.updatedAt = new Date().toISOString();
      writeMockCases([caseItem, ...cases.filter(item => item.caseId !== normalizedCaseId)]);
      recordMockAuditEvent({
        caseId: normalizedCaseId,
        action: "team_member_removed",
        entityType: "team_member",
        entityId: normalizedMemberId,
        details: { name: existing.name, role: existing.role, email: existing.email }
      });
      return { deleted: true, member: existing };
    }
    return await backendJson(ENDPOINTS.caseTeamMember(normalizedCaseId, normalizedMemberId), { method: "DELETE" }, ERROR_CODES.jobFailed);
  }

  async function getPatientCaseTimeline(caseId) {
    const normalizedCaseId = String(caseId || "").trim();
    if (!normalizedCaseId) throw apiError(ERROR_CODES.jobFailed, "caseId is required.");
    if (reconstructionMode === "mock") {
      const timeline = buildMockCaseTimeline(normalizedCaseId);
      if (!timeline) throw apiError(ERROR_CODES.jobFailed, "Case not found.");
      return timeline;
    }
    return await backendJson(ENDPOINTS.caseTimeline(normalizedCaseId), { method: "GET" }, ERROR_CODES.jobFailed);
  }

  async function listSurgicalPlanningNotes(filter = {}) {
    if (reconstructionMode === "mock") {
      const caseId = String(filter.caseId || "all");
      const jobId = String(filter.jobId || "all");
      const modelId = String(filter.modelId || "all");
      return readMockSurgicalPlans()
        .filter(item => caseId === "all" || item.caseId === caseId)
        .filter(item => jobId === "all" || item.jobId === jobId)
        .filter(item => modelId === "all" || item.modelId === modelId)
        .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
    }
    const params = new URLSearchParams();
    if (filter.caseId && filter.caseId !== "all") params.set("caseId", filter.caseId);
    if (filter.jobId && filter.jobId !== "all") params.set("jobId", filter.jobId);
    if (filter.modelId && filter.modelId !== "all") params.set("modelId", filter.modelId);
    const query = params.toString() ? `?${params.toString()}` : "";
    const payload = await backendJson(`${ENDPOINTS.surgicalPlans}${query}`, { method: "GET" }, ERROR_CODES.networkUnavailable);
    return payload?.plans || [];
  }

  async function saveSurgicalPlanningNote(input = {}) {
    if (reconstructionMode === "mock") {
      const timestamp = new Date().toISOString();
      const caseId = String(input.caseId || "").trim();
      const jobId = String(input.jobId || "").trim();
      const caseItem = readMockCases().find(item => item.caseId === caseId);
      const job = jobId ? readMockHistory().find(item => item.jobId === jobId) : null;
      if (!caseItem) throw apiError(ERROR_CODES.jobFailed, "Surgical plan must belong to an existing case.");
      if (jobId && (!job || job.caseId !== caseId)) {
        throw apiError(ERROR_CODES.jobFailed, "Selected model/job must belong to the same case.");
      }
      const existing = readMockSurgicalPlans().find(item => item.planId === input.planId);
      const plan = {
        planId: String(input.planId || existing?.planId || makeMockSurgicalPlanId()),
        caseId,
        jobId,
        modelId: String(input.modelId ?? existing?.modelId ?? "").trim(),
        title: String(input.title ?? existing?.title ?? "").trim(),
        diagnosis: String(input.diagnosis ?? existing?.diagnosis ?? "").trim(),
        procedureType: String(input.procedureType ?? existing?.procedureType ?? "").trim(),
        goals: String(input.goals ?? existing?.goals ?? "").trim(),
        risks: String(input.risks ?? existing?.risks ?? "").trim(),
        notes: String(input.notes ?? existing?.notes ?? "").trim(),
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp
      };
      writeMockSurgicalPlans([plan, ...readMockSurgicalPlans().filter(item => item.planId !== plan.planId)]);
      const cases = readMockCases();
      const updatedCase = cases.find(item => item.caseId === caseId);
      if (updatedCase) {
        updatedCase.surgicalPlans = updatedCase.surgicalPlans || [];
        if (!updatedCase.surgicalPlans.includes(plan.planId)) updatedCase.surgicalPlans.push(plan.planId);
        updatedCase.updatedAt = timestamp;
        writeMockCases([updatedCase, ...cases.filter(item => item.caseId !== caseId)]);
      }
      recordMockAuditEvent({
        caseId,
        action: "note_updated",
        entityType: "surgical_plan",
        entityId: plan.planId,
        details: { title: plan.title, procedureType: plan.procedureType, modelId: plan.modelId }
      });
      return plan;
    }

    return await backendJson(ENDPOINTS.surgicalPlans, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }, ERROR_CODES.jobFailed);
  }

  async function listSurgicalSimulations(filter = {}) {
    if (reconstructionMode === "mock") {
      return readMockSurgicalSimulations()
        .filter(item => simulationMatchesFilter(item, filter))
        .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
    }
    const params = new URLSearchParams();
    if (filter.caseId && filter.caseId !== "all") params.set("caseId", filter.caseId);
    if (filter.jobId && filter.jobId !== "all") params.set("jobId", filter.jobId);
    if (filter.modelId && filter.modelId !== "all") params.set("modelId", filter.modelId);
    const query = params.toString() ? `?${params.toString()}` : "";
    const payload = await backendJson(`${ENDPOINTS.surgicalSimulations}${query}`, { method: "GET" }, ERROR_CODES.networkUnavailable);
    return payload?.simulations || [];
  }

  async function saveSurgicalSimulation(input = {}) {
    if (reconstructionMode === "mock") {
      const timestamp = new Date().toISOString();
      const caseId = String(input.caseId || "").trim();
      const jobId = String(input.jobId || "").trim();
      const caseItem = readMockCases().find(item => item.caseId === caseId);
      const job = jobId ? readMockHistory().find(item => item.jobId === jobId) : null;
      if (!caseItem) throw apiError(ERROR_CODES.jobFailed, "Surgical simulation must belong to an existing case.");
      if (jobId && (!job || job.caseId !== caseId)) {
        throw apiError(ERROR_CODES.jobFailed, "Selected simulation model/job must belong to the same case.");
      }
      const existing = readMockSurgicalSimulations().find(item => item.simulationId === input.simulationId);
      const modelId = String(input.modelId || existing?.modelId || input.originalModelId || job?.resultGlbUrl || jobId || "").trim();
      const simulationId = String(input.simulationId || existing?.simulationId || makeMockSurgicalSimulationId());
      const simulatedModelId = String(input.simulatedModelId || existing?.simulatedModelId || `${modelId || jobId}:simulated:${simulationId}`).trim();
      const warnings = Array.from(new Set([
        ...(Array.isArray(input.warnings) ? input.warnings.map(String) : existing?.warnings || []),
        "Surgical simulation foundation only: simulated mesh deformation is not clinically validated yet.",
        "Mock simulation reuses the source GLB until real soft tissue/bone engines are integrated."
      ]));
      const simulation = {
        simulationId,
        caseId,
        jobId,
        modelId,
        simulationType: ["nasal_adjustment", "chin_adjustment", "jaw_adjustment", "facial_projection", "custom_simulation"].includes(input.simulationType || existing?.simulationType)
          ? (input.simulationType || existing?.simulationType)
          : "custom_simulation",
        parameters: normalizeSimulationParameters(input.parameters || existing?.parameters || {}),
        originalModel: input.originalModel || existing?.originalModel || {
          modelId,
          jobId,
          resultGlbUrl: job?.resultGlbUrl || modelId,
          createdAt: job?.createdAt || timestamp
        },
        simulatedModel: input.simulatedModel || existing?.simulatedModel || {
          modelId: simulatedModelId,
          sourceModelId: modelId,
          resultGlbUrl: input.simulatedModelUrl || job?.resultGlbUrl || modelId,
          createdAt: timestamp
        },
        originalModelId: String(input.originalModelId || existing?.originalModelId || modelId).trim(),
        simulatedModelId,
        comparisonId: String(input.comparisonId || existing?.comparisonId || "").trim(),
        warnings,
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp
      };
      if (!simulation.caseId || !simulation.modelId) {
        throw apiError(ERROR_CODES.jobFailed, "caseId and modelId are required for surgical simulation.");
      }
      writeMockSurgicalSimulations([simulation, ...readMockSurgicalSimulations().filter(item => item.simulationId !== simulation.simulationId)]);
      const cases = readMockCases();
      const updatedCase = cases.find(item => item.caseId === caseId);
      if (updatedCase) {
        updatedCase.simulations = updatedCase.simulations || [];
        if (!updatedCase.simulations.includes(simulation.simulationId)) updatedCase.simulations.push(simulation.simulationId);
        updatedCase.models = updatedCase.models || [];
        [simulation.originalModelId, simulation.simulatedModelId].filter(Boolean).forEach(model => {
          if (!updatedCase.models.includes(model)) updatedCase.models.push(model);
        });
        updatedCase.updatedAt = timestamp;
        writeMockCases([updatedCase, ...cases.filter(item => item.caseId !== caseId)]);
      }
      recordMockAuditEvent({
        caseId,
        action: "simulation_created",
        entityType: "simulation",
        entityId: simulation.simulationId,
        details: { simulationType: simulation.simulationType, modelId: simulation.modelId }
      });
      return simulation;
    }

    return await backendJson(ENDPOINTS.surgicalSimulations, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }, ERROR_CODES.jobFailed);
  }

  async function createBackendReconstructionJob(uploadResult, settings = {}, caseId = "") {
    const settingsValidation = validateReconstructionSettings(settings);
    if (!settingsValidation.ok) {
      throw apiError(ERROR_CODES.jobFailed, settingsValidation.errors.join(" "));
    }
    if (!caseId) throw apiError(ERROR_CODES.jobFailed, "Выберите или создайте case перед reconstruction.");

    if (reconstructionMode === "mock") {
      if (!pipeline()) throw apiError(ERROR_CODES.jobFailed, "Mock reconstruction pipeline не загружен.");
      const created = pipeline().createReconstructionJob(uploadResult?.files || [], settingsValidation.settings, caseId);
      if (!created.ok) {
        throw apiError(ERROR_CODES.jobFailed, created.errors.map(error => error.message).join(" "));
      }
      const job = created.job;
      if (uploadResult?.previewReport) job.preprocessingReport = uploadResult.previewReport;
      job.settings = settingsValidation.settings;
      upsertMockHistoryFromJob(job);
      recordMockAuditEvent({
        caseId,
        action: "model_uploaded",
        entityType: "reconstruction_job",
        entityId: job.jobId,
        details: { filesCount: uploadResult?.files?.length || 0, status: job.status }
      });
      return job;
    }

    // TODO: POST upload result to /api/reconstruction/jobs when backend jobs are implemented.
    return await backendJson(ENDPOINTS.jobs, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...uploadResult, caseId, settings: settingsValidation.settings })
    }, ERROR_CODES.jobFailed);
  }

  async function startBackendReconstructionJob(jobId) {
    if (reconstructionMode === "mock") {
      if (!pipeline()) throw apiError(ERROR_CODES.jobFailed, "Mock reconstruction pipeline не загружен.");
      const job = await pipeline().startReconstructionJob(jobId);
      upsertMockHistoryFromJob(job);
      if (job.caseId) {
        recordMockAuditEvent({
          caseId: job.caseId,
          action: job.status === "ready" ? "reconstruction_completed" : "reconstruction_started",
          entityType: "reconstruction_job",
          entityId: job.jobId,
          details: { status: job.status }
        });
      }
      if (job.status === "error") throw apiError(ERROR_CODES.jobFailed, job.errorMessage || "Job failed.");
      return job;
    }

    // TODO: POST /api/reconstruction/jobs/:jobId/start when backend workers are implemented.
    return await backendJson(ENDPOINTS.startJob(jobId), { method: "POST" }, ERROR_CODES.jobFailed);
  }

  async function approveReconstructionReview(jobId, selectedFrameNames = []) {
    if (reconstructionMode === "mock") {
      if (!pipeline()) throw apiError(ERROR_CODES.jobFailed, "Mock reconstruction pipeline не загружен.");
      const job = await pipeline().approveReviewAndContinue(jobId, selectedFrameNames);
      upsertMockHistoryFromJob(job);
      if (job.caseId) {
        recordMockAuditEvent({
          caseId: job.caseId,
          action: job.status === "ready" ? "reconstruction_completed" : "reconstruction_started",
          entityType: "reconstruction_job",
          entityId: job.jobId,
          details: { status: job.status, reviewedByUser: Boolean(job.reviewedByUser) }
        });
      }
      if (job.status === "error") throw apiError(ERROR_CODES.jobFailed, job.errorMessage || "Job failed.");
      return job;
    }

    return await backendJson(ENDPOINTS.approveReview(jobId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedFrameNames })
    }, ERROR_CODES.jobFailed);
  }

  async function getBackendReconstructionStatus(jobId) {
    if (reconstructionMode === "mock") {
      if (!pipeline()) throw apiError(ERROR_CODES.jobFailed, "Mock reconstruction pipeline не загружен.");
      const job = pipeline().getReconstructionJob(jobId);
      if (!job) throw apiError(ERROR_CODES.jobFailed, "Reconstruction job не найден.");
      return job;
    }

    // TODO: GET /api/reconstruction/jobs/:jobId/status when backend polling is available.
    return await backendJson(ENDPOINTS.status(jobId), { method: "GET" }, ERROR_CODES.networkUnavailable);
  }

  async function getBackendReconstructionResult(jobId) {
    if (reconstructionMode === "mock") {
      const job = await getBackendReconstructionJob(jobId);
      if (job.status !== "ready" || !job.resultGlbUrl) {
        throw apiError(ERROR_CODES.jobFailed, "Reconstruction result ещё не готов.");
      }
      return {
        ...mockReadiness(true),
        jobId,
        caseId: job.caseId || "",
        resultGlbUrl: job.resultGlbUrl,
        rawMeshPath: job.resultGlbUrl,
        cleanedMeshPath: job.resultGlbUrl,
        createdAt: job.updatedAt || job.createdAt,
        inputType: job.fileType || "unknown",
        filesCount: job.uploadedFiles?.length || job.filesCount || 0,
        settings: normalizeReconstructionSettings(job.settings),
        selectedFramesCount: job.selectedFramesCount || 0,
        reconstructionQuality: job.reconstructionQuality || "medium",
        cleanupQuality: job.cleanupQuality || "medium",
        warnings: job.warnings || [],
        metadata: {
          resultModelSource: "mock",
          caseId: job.caseId || "",
          reconstructionMode: "mock",
          cleanupMode: "mock",
          settings: normalizeReconstructionSettings(job.settings)
        },
        checks: {
          exists: true,
          glbExists: true,
          canOpen: true,
          invalid: false,
          expiredOrMissing: false
        },
        job
      };
    }

    // TODO: GET /api/reconstruction/jobs/:jobId/result when backend result storage is available.
    return await backendJson(ENDPOINTS.result(jobId), { method: "GET" }, ERROR_CODES.jobFailed);
  }

  async function getBackendReconstructionReport(jobId) {
    if (reconstructionMode === "mock") {
      const job = await getBackendReconstructionJob(jobId);
      const modelId = job.resultGlbUrl || jobId;
      const landmarks = readMockLandmarks().filter(item => (
        item.caseId === (job.caseId || "")
        && item.jobId === jobId
        && item.modelId === modelId
      ));
      const landmarkTemplateReport = summarizeLandmarkTemplates(landmarks);
      const aiLandmarkReport = summarizeAiLandmarks(landmarks);
      const reportMeasurements = readMockMeasurements().filter(item => (
        item.caseId === (job.caseId || "")
        && item.jobId === jobId
        && item.modelId === modelId
      ));
      const measurementTemplateReport = summarizeMeasurementTemplates(reportMeasurements);
      const autoMeasurementReport = summarizeCalculatedMeasurements(reportMeasurements);
      const clinicalAnalysisPresetReport = summarizeClinicalAnalysisPresets(landmarks, reportMeasurements);
      const surgicalSimulations = readMockSurgicalSimulations().filter(item => (
        item.caseId === (job.caseId || "")
        && (item.jobId === jobId || item.modelId === modelId || item.originalModelId === modelId || item.simulatedModelId === modelId)
      ));
      const report = {
        jobId,
        caseId: job.caseId || "",
        createdAt: job.createdAt || new Date().toISOString(),
        generatedAt: new Date().toISOString(),
        exportFormats: REPORT_EXPORT_FORMATS,
        inputType: job.fileType || "unknown",
        filesCount: job.uploadedFiles?.length || job.filesCount || 0,
        settings: normalizeReconstructionSettings(job.settings),
        videoMetadata: job.videoMetadata || null,
        extractedFramesCount: job.extractedFramesCount || 0,
        selectedFramesCount: job.selectedFramesCount || 0,
        rejectedFramesCount: job.rejectedFramesCount || 0,
        inputSummary: {
          inputType: job.fileType || "unknown",
          filesCount: job.uploadedFiles?.length || job.filesCount || 0,
          files: job.uploadedFiles || []
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
          successfulMasksCount: job.successfulMasksCount || job.masksCount || 0,
          failedMasksCount: job.failedMasksCount || 0,
          averageMaskCoverage: job.averageMaskCoverage || 0,
          segmentationQuality: job.segmentationQuality || "medium",
          warnings: job.segmentationWarnings || []
        },
        reconstructionReport: {
          reconstructionMode: job.reconstructionMode || "mock",
          engineMode: job.engineMode || job.reconstructionMode || "mock",
          engineExitCode: Number.isInteger(job.engineExitCode) ? job.engineExitCode : 0,
          engineCommand: job.engineCommand || "",
          rawMeshPath: job.rawMeshPath ? "raw-model.glb" : "",
          engineName: job.engineName || "PMAS Mock Reconstruction Engine",
          inputFramesCount: job.inputFramesCount || 0,
          reconstructionQuality: job.reconstructionQuality || "medium",
          warnings: job.reconstructionWarnings || []
        },
        conversionReport: {
          inputMeshFormat: job.inputMeshFormat || "glb",
          conversionMode: job.conversionMode || "mock",
          conversionSuccess: job.conversionSuccess !== false,
          outputGlbPath: job.outputGlbPath ? "result.glb" : "models/LeePerrySmith.glb",
          outputFormat: "GLB",
          warnings: job.conversionWarnings || []
        },
        cleanupReport: {
          cleanupMode: job.cleanupMode || "mock",
          cleanupQuality: job.cleanupQuality || "medium",
          resultModelSource: "mock",
          inputMeshPath: job.rawMeshPath ? "raw-model.glb" : "",
          cleanedMeshPath: job.resultGlbUrl || "",
          removedComponentsCount: job.removedComponentsCount || job.removedArtifactsCount || 0,
          removedArtifactsCount: job.removedArtifactsCount || 0,
          holesRepairedCount: job.holesRepairedCount || 0,
          decimationRatio: job.decimationRatio || 1,
          cleanupSuccess: job.cleanupSuccess !== false,
          cleanedModelReady: Boolean(job.resultGlbUrl),
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
        measurements: reportMeasurements,
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
        finalResult: job.status === "ready" && job.resultGlbUrl
          ? await getBackendReconstructionResult(jobId)
          : null,
        readinessScore: job.readinessScore ?? (job.status === "ready" && job.resultGlbUrl ? 70 : 0),
        readinessLevel: job.readinessLevel || (job.status === "ready" && job.resultGlbUrl ? "medium" : "poor"),
        readinessWarnings: mockReadiness(job.status === "ready" && Boolean(job.resultGlbUrl)).readinessWarnings,
        resultGlbUrl: job.status === "ready" ? (job.resultGlbUrl || "") : "",
        warnings: job.warnings || []
      };
      addMockReportToCase(job.caseId, `${jobId}:report`);
      if (job.caseId) {
        recordMockAuditEvent({
          caseId: job.caseId,
          action: "report_exported",
          entityType: "report",
          entityId: `${jobId}:report`,
          details: { jobId }
        });
      }
      return report;
    }

    return await backendJson(ENDPOINTS.report(jobId), { method: "GET" }, ERROR_CODES.jobFailed);
  }

  async function deleteBackendReconstructionResult(jobId) {
    if (reconstructionMode === "mock") {
      const job = await getBackendReconstructionJob(jobId);
      const response = {
        deleted: true,
        result: {
          ...mockReadiness(false),
          jobId,
          resultGlbUrl: "",
          createdAt: new Date().toISOString(),
          inputType: job.fileType || "unknown",
          filesCount: job.uploadedFiles?.length || job.filesCount || 0,
          settings: normalizeReconstructionSettings(job.settings),
          selectedFramesCount: job.selectedFramesCount || 0,
          reconstructionQuality: job.reconstructionQuality || "medium",
          cleanupQuality: job.cleanupQuality || "medium",
          warnings: ["Result deleted in mock UI state."],
          metadata: {
            resultModelSource: "deleted",
            settings: normalizeReconstructionSettings(job.settings)
          },
          checks: {
            exists: false,
            glbExists: false,
            canOpen: false,
            invalid: false,
            expiredOrMissing: true
          }
        }
      };
      upsertMockHistoryFromJob({ ...job, resultGlbUrl: "" }, response.result);
      return response;
    }

    return await backendJson(ENDPOINTS.result(jobId), { method: "DELETE" }, ERROR_CODES.jobFailed);
  }

  async function cancelBackendReconstructionJob(jobId) {
    if (reconstructionMode === "mock") {
      if (!pipeline()) throw apiError(ERROR_CODES.jobFailed, "Mock reconstruction pipeline не загружен.");
      const job = pipeline().cancelReconstructionJob(jobId, "Canceled by user");
      upsertMockHistoryFromJob(job);
      return job;
    }

    // TODO: POST /api/reconstruction/jobs/:jobId/cancel when backend cancellation exists.
    try {
      return await backendJson(ENDPOINTS.cancel(jobId), { method: "POST" }, ERROR_CODES.networkUnavailable);
    } catch (err) {
      throw normalizeBackendError(err, ERROR_CODES.canceledByUser, "Canceled by user.");
    }
  }

  async function applyManualModelAdjustment(jobId, adjustmentValues = {}) {
    if (reconstructionMode === "mock") {
      const job = pipeline()?.getReconstructionJob(jobId);
      if (!job) throw apiError(ERROR_CODES.jobFailed, "Reconstruction job не найден.");
      job.adjustmentApplied = true;
      job.adjustmentValues = adjustmentValues;
      job.adjustedModelPath = job.resultGlbUrl || "models/LeePerrySmith.glb";
      job.status = "ready";
      job.progress = 100;
      upsertMockHistoryFromJob(job);
      return job;
    }

    return await backendJson(ENDPOINTS.applyAdjustment(jobId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adjustmentValues })
    }, ERROR_CODES.jobFailed);
  }

  async function skipManualModelAdjustment(jobId) {
    if (reconstructionMode === "mock") {
      const job = pipeline()?.getReconstructionJob(jobId);
      if (!job) throw apiError(ERROR_CODES.jobFailed, "Reconstruction job не найден.");
      job.adjustmentApplied = false;
      job.adjustmentWarnings = ["Manual adjustment пропущен пользователем; требуется ручная проверка перед измерениями."];
      job.status = "ready";
      job.progress = 100;
      upsertMockHistoryFromJob(job);
      return job;
    }

    return await backendJson(ENDPOINTS.skipAdjustment(jobId), { method: "POST" }, ERROR_CODES.jobFailed);
  }

  async function listBackendReconstructionJobs(filter = "all", caseId = "all") {
    const normalizedFilter = String(filter || "all").toLowerCase();
    const normalizedCase = String(caseId || "all");
    if (reconstructionMode === "mock") {
      const items = readMockHistory();
      return items
        .filter(item => normalizedFilter === "all" || item.status === normalizedFilter)
        .filter(item => normalizedCase === "all" || item.caseId === normalizedCase);
    }

    const params = new URLSearchParams();
    if (normalizedFilter !== "all") params.set("status", normalizedFilter);
    if (normalizedCase !== "all") params.set("caseId", normalizedCase);
    const query = params.toString() ? `?${params.toString()}` : "";
    const payload = await backendJson(`${ENDPOINTS.jobs}${query}`, { method: "GET" }, ERROR_CODES.networkUnavailable);
    return payload?.jobs || [];
  }

  async function getBackendReconstructionJob(jobId) {
    if (reconstructionMode === "mock") {
      const job = pipeline()?.getReconstructionJob(jobId);
      if (job) return job;
      const item = readMockHistory().find(historyItem => historyItem.jobId === jobId);
      if (!item) throw apiError(ERROR_CODES.jobFailed, "Reconstruction job не найден.");
      return {
        ...item,
        settings: normalizeReconstructionSettings(item.settings),
        fileType: item.inputType,
        progress: item.status === "ready" ? 100 : 0,
        resultGlbUrl: item.resultGlbUrl,
        uploadedFiles: []
      };
    }

    return await backendJson(ENDPOINTS.job(jobId), { method: "GET" }, ERROR_CODES.jobFailed);
  }

  async function deleteBackendReconstructionJob(jobId) {
    if (reconstructionMode === "mock") {
      writeMockHistory(readMockHistory().filter(item => item.jobId !== jobId));
      return { deleted: true, jobId };
    }

    return await backendJson(ENDPOINTS.job(jobId), { method: "DELETE" }, ERROR_CODES.jobFailed);
  }

  async function exportFullBackup() {
    if (reconstructionMode === "mock") return await makeMockBackup();
    return await backendJson(ENDPOINTS.backupExport, { method: "GET" }, ERROR_CODES.jobFailed);
  }

  async function previewBackup(input = {}) {
    if (reconstructionMode === "mock") {
      const validation = await validateMockBackup(input);
      if (!validation.ok) {
        const err = apiError(ERROR_CODES.jobFailed, validation.errors.join(" "));
        err.preview = validation.preview;
        throw err;
      }
      return { ok: true, errors: [], preview: validation.preview };
    }
    return await backendJson(ENDPOINTS.backupPreview, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }, ERROR_CODES.jobFailed);
  }

  async function restoreBackup(input = {}, options = {}) {
    if (reconstructionMode === "mock") {
      const validation = await validateMockBackup(input);
      if (!validation.ok) throw apiError(ERROR_CODES.jobFailed, validation.errors.join(" "));
      const snapshot = validation.payload.data || {};
      const mode = options.mode === "selected" ? "selected" : "full";
      const selected = new Set((options.caseIds || []).map(String).filter(Boolean));
      const caseIds = mode === "selected"
        ? new Set((snapshot.cases || []).map(item => item.caseId).filter(caseId => selected.has(caseId)))
        : new Set((snapshot.cases || []).map(item => item.caseId).filter(Boolean));
      const merge = (current, incoming, idKey, caseKey = "caseId") => [
        ...incoming.filter(item => caseIds.has(item[caseKey] || item.caseId)),
        ...current.filter(item => !caseIds.has(item[caseKey] || item.caseId) && mode !== "full")
      ].filter((item, index, arr) => arr.findIndex(other => other[idKey] === item[idKey]) === index);
      writeMockCases(mode === "full" ? (snapshot.cases || []) : merge(readMockCases(), snapshot.cases || [], "caseId"));
      writeMockHistory(mode === "full" ? (snapshot.jobs || []) : merge(readMockHistory(), snapshot.jobs || [], "jobId"));
      writeMockComparisons(mode === "full" ? (snapshot.comparisons || []) : merge(readMockComparisons(), snapshot.comparisons || [], "comparisonId"));
      writeMockMeasurements(mode === "full" ? (snapshot.measurements || []) : merge(readMockMeasurements(), snapshot.measurements || [], "measurementId"));
      writeMockLandmarks(mode === "full" ? (snapshot.landmarks || []) : merge(readMockLandmarks(), snapshot.landmarks || [], "landmarkId"));
      writeMockLandmarkTemplates(snapshot.landmarkTemplates || readMockLandmarkTemplates());
      writeMockSurgicalPlans(mode === "full" ? (snapshot.surgicalPlans || []) : merge(readMockSurgicalPlans(), snapshot.surgicalPlans || [], "planId"));
      writeMockSurgicalSimulations(mode === "full" ? (snapshot.simulations || []) : merge(readMockSurgicalSimulations(), snapshot.simulations || [], "simulationId"));
      writeMockClinicalInsights(mode === "full" ? (snapshot.clinicalInsights || []) : merge(readMockClinicalInsights(), snapshot.clinicalInsights || [], "insightId"));
      writeMockQaChecks(mode === "full" ? (snapshot.qaChecks || []) : merge(readMockQaChecks(), snapshot.qaChecks || [], "checkId"));
      writeMockProductionReadiness(mode === "full" ? (snapshot.productionReadiness || []) : merge(readMockProductionReadiness(), snapshot.productionReadiness || [], "readinessId"));
      writeMockReleases(mode === "full" ? (snapshot.releases || []) : merge(readMockReleases(), snapshot.releases || [], "releaseId"));
      writeMockPlugins(mode === "full" ? (snapshot.plugins || []) : merge(readMockPlugins(), snapshot.plugins || [], "pluginId"));
      writeMockAuditEvents(mode === "full" ? (snapshot.auditEvents || []) : merge(readMockAuditEvents(), snapshot.auditEvents || [], "eventId"));
      caseIds.forEach(caseId => {
        recordMockAuditEvent({ caseId, action: "backup_restored", entityType: "backup", entityId: validation.preview.backupId || "imported-backup", details: { mode, restoredCasesCount: caseIds.size } });
        recordMockAuditEvent({ caseId, action: "backup_imported", entityType: "backup", entityId: validation.preview.backupId || "imported-backup", details: { mode, restoredCasesCount: caseIds.size } });
      });
      return { restored: true, preview: validation.preview, restoredCasesCount: caseIds.size, caseIds: Array.from(caseIds) };
    }
    return await backendJson(ENDPOINTS.backupRestore, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backup: input, mode: options.mode || "full", caseIds: options.caseIds || [] })
    }, ERROR_CODES.jobFailed);
  }

  async function listQaChecks(caseId, filter = {}) {
    const normalizedCaseId = String(caseId || "").trim();
    if (!normalizedCaseId) throw apiError(ERROR_CODES.jobFailed, "caseId is required.");
    if (reconstructionMode === "mock") {
      const status = String(filter.status || "all");
      return readMockQaChecks()
        .filter(item => item.caseId === normalizedCaseId)
        .filter(item => status === "all" || item.status === status)
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    }
    const params = new URLSearchParams();
    if (filter.status && filter.status !== "all") params.set("status", filter.status);
    const query = params.toString() ? `?${params.toString()}` : "";
    const payload = await backendJson(`${ENDPOINTS.caseQa(normalizedCaseId)}${query}`, { method: "GET" }, ERROR_CODES.jobFailed);
    return payload?.checks || [];
  }

  async function runQaValidation(caseId) {
    const normalizedCaseId = String(caseId || "").trim();
    if (!normalizedCaseId) throw apiError(ERROR_CODES.jobFailed, "caseId is required.");
    if (reconstructionMode === "mock") return generateMockQaChecks(normalizedCaseId);
    return await backendJson(ENDPOINTS.runCaseQa(normalizedCaseId), { method: "POST" }, ERROR_CODES.jobFailed);
  }

  async function resolveQaCheck(checkId) {
    const normalizedCheckId = String(checkId || "").trim();
    if (!normalizedCheckId) throw apiError(ERROR_CODES.jobFailed, "checkId is required.");
    if (reconstructionMode === "mock") {
      const items = readMockQaChecks();
      const existing = items.find(item => item.checkId === normalizedCheckId);
      if (!existing) throw apiError(ERROR_CODES.jobFailed, "QA check not found.");
      const next = { ...existing, resolved: true, resolvedAt: new Date().toISOString(), status: existing.status === "failed" ? "warning" : existing.status };
      writeMockQaChecks([next, ...items.filter(item => item.checkId !== normalizedCheckId)]);
      recordMockAuditEvent({ caseId: next.caseId, action: "qa_issue_resolved", entityType: "qa_check", entityId: next.checkId, details: { category: next.category, title: next.title } });
      return next;
    }
    return await backendJson(ENDPOINTS.resolveQaCheck(normalizedCheckId), { method: "PATCH" }, ERROR_CODES.jobFailed);
  }

  async function listProductionReadiness(caseId, filter = {}) {
    const normalizedCaseId = String(caseId || "").trim();
    if (!normalizedCaseId) throw apiError(ERROR_CODES.jobFailed, "caseId is required.");
    if (reconstructionMode === "mock") {
      const scope = String(filter.scope || "all");
      return readMockProductionReadiness()
        .filter(item => item.caseId === normalizedCaseId)
        .filter(item => scope === "all" || item.scope === scope)
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    }
    const params = new URLSearchParams();
    if (filter.scope && filter.scope !== "all") params.set("scope", filter.scope);
    const query = params.toString() ? `?${params.toString()}` : "";
    const payload = await backendJson(`${ENDPOINTS.caseReadiness(normalizedCaseId)}${query}`, { method: "GET" }, ERROR_CODES.jobFailed);
    return payload?.readiness || [];
  }

  async function runProductionReadiness(caseId, options = {}) {
    const normalizedCaseId = String(caseId || "").trim();
    if (!normalizedCaseId) throw apiError(ERROR_CODES.jobFailed, "caseId is required.");
    if (reconstructionMode === "mock") return generateMockProductionReadiness(normalizedCaseId);
    return await backendJson(ENDPOINTS.runCaseReadiness(normalizedCaseId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scopes: options.scopes || ["case", "model", "report", "system"],
        modelId: options.modelId || "",
        reportId: options.reportId || ""
      })
    }, ERROR_CODES.jobFailed);
  }

  async function listReleases(filter = {}) {
    if (reconstructionMode === "mock") {
      const status = String(filter.status || "all");
      const caseId = String(filter.caseId || "all");
      return readMockReleases()
        .filter(item => status === "all" || item.status === status)
        .filter(item => caseId === "all" || mockReleaseCaseIds(item).includes(caseId))
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    }
    const params = new URLSearchParams();
    if (filter.status && filter.status !== "all") params.set("status", filter.status);
    if (filter.caseId && filter.caseId !== "all") params.set("caseId", filter.caseId);
    const query = params.toString() ? `?${params.toString()}` : "";
    const payload = await backendJson(`${ENDPOINTS.releases}${query}`, { method: "GET" }, ERROR_CODES.jobFailed);
    return payload?.releases || [];
  }

  async function createRelease(input = {}) {
    if (reconstructionMode === "mock") {
      const snapshot = mockReleaseSnapshot();
      const validation = validateMockRelease(snapshot);
      const version = ["v0.1", "v0.5", "v0.9", "v1.0", "v1.1"].includes(input.version) ? input.version : "v0.1";
      const release = {
        releaseId: makeMockReleaseId(),
        version,
        name: input.name || `PMAS ${version}`,
        description: input.description || "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: input.status === "release_candidate" && !validation.ok ? "testing" : input.status || "draft",
        readinessScore: snapshot.readiness.readinessScore,
        qaScore: snapshot.qaData.qaScore,
        notes: input.notes || "",
        snapshot,
        validation,
        history: [{ eventId: `release-event-${Date.now().toString(36)}`, eventType: "release_created", createdAt: new Date().toISOString(), details: { casesCount: snapshot.cases.length } }]
      };
      writeMockReleases([release, ...readMockReleases()]);
      recordMockReleaseAction(release, "release_created", { validationOk: validation.ok });
      return release;
    }
    return await backendJson(ENDPOINTS.releases, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }, ERROR_CODES.jobFailed);
  }

  async function updateReleaseStatus(releaseId, status, notes = "") {
    const normalizedReleaseId = String(releaseId || "").trim();
    if (!normalizedReleaseId) throw apiError(ERROR_CODES.jobFailed, "releaseId is required.");
    if (reconstructionMode === "mock") {
      const releases = readMockReleases();
      const existing = releases.find(item => item.releaseId === normalizedReleaseId);
      if (!existing) throw apiError(ERROR_CODES.jobFailed, "Release candidate not found.");
      const validation = validateMockRelease(existing.snapshot || {});
      if (status === "release_candidate" && !validation.ok) {
        const err = apiError(ERROR_CODES.jobFailed, "Release validation failed.");
        err.release = { ...existing, validation: { ...validation, blocked: true } };
        throw err;
      }
      const eventType = status === "archived" ? "release_archived" : status === "release_candidate" || status === "approved" ? "release_promoted" : "release_updated";
      const next = {
        ...existing,
        status,
        notes: notes || existing.notes || "",
        updatedAt: new Date().toISOString(),
        validation,
        history: [...(existing.history || []), { eventId: `release-event-${Date.now().toString(36)}`, eventType, createdAt: new Date().toISOString(), details: { status } }]
      };
      writeMockReleases([next, ...releases.filter(item => item.releaseId !== normalizedReleaseId)]);
      recordMockReleaseAction(next, eventType, { validationOk: validation.ok });
      return next;
    }
    return await backendJson(ENDPOINTS.releaseStatus(normalizedReleaseId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, notes })
    }, ERROR_CODES.jobFailed);
  }

  async function archiveRelease(releaseId) {
    if (reconstructionMode === "mock") return updateReleaseStatus(releaseId, "archived");
    return await backendJson(ENDPOINTS.releaseArchive(releaseId), { method: "POST" }, ERROR_CODES.jobFailed);
  }

  async function cloneRelease(releaseId) {
    const normalizedReleaseId = String(releaseId || "").trim();
    if (!normalizedReleaseId) throw apiError(ERROR_CODES.jobFailed, "releaseId is required.");
    if (reconstructionMode === "mock") {
      const releases = readMockReleases();
      const existing = releases.find(item => item.releaseId === normalizedReleaseId);
      if (!existing) throw apiError(ERROR_CODES.jobFailed, "Release candidate not found.");
      const clone = {
        ...existing,
        releaseId: makeMockReleaseId(),
        name: `${existing.name || existing.version} clone`,
        status: "draft",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        history: [{ eventId: `release-event-${Date.now().toString(36)}`, eventType: "release_created", createdAt: new Date().toISOString(), details: { clonedFrom: existing.releaseId } }]
      };
      writeMockReleases([clone, ...releases]);
      recordMockReleaseAction(clone, "release_created", { clonedFrom: existing.releaseId });
      return clone;
    }
    return await backendJson(ENDPOINTS.releaseClone(normalizedReleaseId), { method: "POST" }, ERROR_CODES.jobFailed);
  }

  async function getReleaseReport(releaseId) {
    const normalizedReleaseId = String(releaseId || "").trim();
    if (!normalizedReleaseId) throw apiError(ERROR_CODES.jobFailed, "releaseId is required.");
    if (reconstructionMode === "mock") {
      const release = readMockReleases().find(item => item.releaseId === normalizedReleaseId);
      if (!release) throw apiError(ERROR_CODES.jobFailed, "Release candidate not found.");
      return {
        reportType: "release_summary_report",
        generatedAt: new Date().toISOString(),
        release,
        snapshotSummary: {
          casesCount: release.snapshot?.cases?.length || 0,
          reportsCount: release.snapshot?.reports?.length || 0,
          templatesCount: release.snapshot?.templates?.landmarkTemplates?.length || 0,
          qaChecksCount: release.snapshot?.qaData?.checks?.length || 0,
          readinessChecksCount: release.snapshot?.readiness?.items?.length || 0
        },
        validation: release.validation || {},
        timelineEvents: release.history || []
      };
    }
    return await backendJson(ENDPOINTS.releaseReport(normalizedReleaseId), { method: "GET" }, ERROR_CODES.jobFailed);
  }

  async function listPlugins(filter = {}) {
    if (reconstructionMode === "mock") {
      const category = String(filter.category || "all");
      const enabled = String(filter.enabled ?? "all");
      const plugins = readMockPlugins()
        .filter(item => category === "all" || item.category === category)
        .filter(item => enabled === "all" || String(Boolean(item.enabled)) === enabled)
        .sort((a, b) => Number(b.builtIn) - Number(a.builtIn) || String(a.name).localeCompare(String(b.name)));
      return { plugins, summary: mockPluginSummary(plugins) };
    }
    const params = new URLSearchParams();
    if (filter.category && filter.category !== "all") params.set("category", filter.category);
    if (filter.enabled !== undefined && filter.enabled !== "all") params.set("enabled", String(filter.enabled));
    const query = params.toString() ? `?${params.toString()}` : "";
    return await backendJson(`${ENDPOINTS.plugins}${query}`, { method: "GET" }, ERROR_CODES.jobFailed);
  }

  async function registerPlugin(input = {}) {
    if (reconstructionMode === "mock") {
      const plugins = readMockPlugins();
      const plugin = normalizeMockPlugin(input);
      if (!plugin.pluginId) throw apiError(ERROR_CODES.jobFailed, "pluginId is required.");
      if (plugins.some(item => item.pluginId === plugin.pluginId)) throw apiError(ERROR_CODES.jobFailed, `Plugin ${plugin.pluginId} is already registered.`);
      if (plugin.compatibleVersion !== "v1") throw apiError(ERROR_CODES.jobFailed, `Unsupported plugin API version: ${plugin.compatibleVersion}.`);
      const missing = plugin.dependencies.filter(dep => !plugins.some(item => item.pluginId === dep));
      if (missing.length) throw apiError(ERROR_CODES.jobFailed, `Missing dependencies: ${missing.join(", ")}.`);
      writeMockPlugins([plugin, ...plugins.filter(item => !item.builtIn)]);
      recordMockPluginAudit(plugin, "plugin_registered");
      return plugin;
    }
    return await backendJson(ENDPOINTS.plugins, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }, ERROR_CODES.jobFailed);
  }

  async function enablePlugin(pluginId) {
    const normalizedPluginId = String(pluginId || "").trim();
    if (!normalizedPluginId) throw apiError(ERROR_CODES.jobFailed, "pluginId is required.");
    if (reconstructionMode === "mock") {
      const plugins = readMockPlugins();
      const existing = plugins.find(item => item.pluginId === normalizedPluginId);
      if (!existing) throw apiError(ERROR_CODES.jobFailed, "Plugin not found.");
      const next = { ...existing, enabled: true, updatedAt: new Date().toISOString() };
      writeMockPlugins([next, ...plugins.filter(item => item.pluginId !== normalizedPluginId && !item.builtIn)]);
      recordMockPluginAudit(next, "plugin_enabled");
      return next;
    }
    return await backendJson(ENDPOINTS.pluginEnable(normalizedPluginId), { method: "POST" }, ERROR_CODES.jobFailed);
  }

  async function disablePlugin(pluginId) {
    const normalizedPluginId = String(pluginId || "").trim();
    if (!normalizedPluginId) throw apiError(ERROR_CODES.jobFailed, "pluginId is required.");
    if (reconstructionMode === "mock") {
      const plugins = readMockPlugins();
      const existing = plugins.find(item => item.pluginId === normalizedPluginId);
      if (!existing) throw apiError(ERROR_CODES.jobFailed, "Plugin not found.");
      const next = { ...existing, enabled: false, updatedAt: new Date().toISOString() };
      writeMockPlugins([next, ...plugins.filter(item => item.pluginId !== normalizedPluginId && !item.builtIn)]);
      recordMockPluginAudit(next, "plugin_disabled");
      return next;
    }
    return await backendJson(ENDPOINTS.pluginDisable(normalizedPluginId), { method: "POST" }, ERROR_CODES.jobFailed);
  }

  async function unregisterPlugin(pluginId) {
    const normalizedPluginId = String(pluginId || "").trim();
    if (!normalizedPluginId) throw apiError(ERROR_CODES.jobFailed, "pluginId is required.");
    if (reconstructionMode === "mock") {
      const plugins = readMockPlugins();
      const existing = plugins.find(item => item.pluginId === normalizedPluginId && !item.builtIn);
      if (!existing) throw apiError(ERROR_CODES.jobFailed, "Plugin not found or built-in plugin cannot be unregistered.");
      writeMockPlugins(plugins.filter(item => item.pluginId !== normalizedPluginId && !item.builtIn));
      return { deleted: true, plugin: existing };
    }
    return await backendJson(ENDPOINTS.plugin(normalizedPluginId), { method: "DELETE" }, ERROR_CODES.jobFailed);
  }

  function updatePipelineBadge() {
    try {
      const badge = document.getElementById("reconstructionPipelineBadge");
      if (!badge) return;
      badge.textContent = reconstructionMode === "backend"
        ? "PMAS Native Engine"
        : "Mock pipeline (offline)";
    } catch (err) {
      console.warn("Unable to update reconstruction pipeline badge.", err);
    }
  }

  function setMode(mode) {
    if (mode !== "mock" && mode !== "backend") {
      throw apiError(ERROR_CODES.jobFailed, `Unsupported reconstruction mode: ${mode}`);
    }
    reconstructionMode = mode;
    updatePipelineBadge();
    try {
      window.dispatchEvent(new CustomEvent("pmas-reconstruction-mode-changed", { detail: { mode } }));
    } catch (err) {
      console.warn("Unable to dispatch reconstruction mode event.", err);
    }
    return reconstructionMode;
  }

  function initModeFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      const mode = params.get("reconstructionMode");
      if (mode === "mock" || mode === "backend") {
        setMode(mode);
        return true;
      }
    } catch (err) {
      console.warn("Unable to read reconstruction mode from URL.", err);
    }
    return false;
  }

  async function autoDetectBackend() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const response = await fetch(ENDPOINTS.health, { method: "GET", signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) return false;
      const payload = await response.json();
      if (payload && payload.ok) {
        setMode("backend");
        return true;
      }
    } catch (err) {
      // Backend unreachable — stay in offline mock mode.
    }
    return false;
  }

  const modeForcedByUrl = initModeFromUrl();
  const initBadgeAndMode = () => {
    updatePipelineBadge();
    if (!modeForcedByUrl) autoDetectBackend();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initBadgeAndMode);
  } else {
    initBadgeAndMode();
  }

  window.PMASReconstructionApi = {
    get mode() { return reconstructionMode; },
    setMode,
    endpoints: ENDPOINTS,
    reportExportFormats: REPORT_EXPORT_FORMATS,
    defaultReconstructionSettings: DEFAULT_RECONSTRUCTION_SETTINGS,
    normalizeReconstructionSettings,
    validateReconstructionSettings,
    listPatientCases,
    createPatientCase,
    deletePatientCase,
    getPatientCaseReport,
    getSystemReport,
    listCaseAuditEvents,
    listClinicalInsights,
    generateClinicalInsights,
    updateClinicalInsight,
    listQaChecks,
    runQaValidation,
    resolveQaCheck,
    listProductionReadiness,
    runProductionReadiness,
    listReleases,
    createRelease,
    updateReleaseStatus,
    archiveRelease,
    cloneRelease,
    getReleaseReport,
    listPlugins,
    registerPlugin,
    enablePlugin,
    disablePlugin,
    unregisterPlugin,
    listCaseTeamMembers,
    saveCaseTeamMember,
    updateCaseTeamMemberRole,
    removeCaseTeamMember,
    getPatientCaseTimeline,
    listModelComparisons,
    createModelComparison,
    getModelComparisonReport,
    listCaseMeasurements,
    saveCaseMeasurement,
    updateCaseMeasurementLabel,
    deleteCaseMeasurement,
    listCaseLandmarks,
    saveCaseLandmark,
    deleteCaseLandmark,
    listLandmarkTemplates,
    saveLandmarkTemplate,
    deleteLandmarkTemplate,
    listSurgicalPlanningNotes,
    saveSurgicalPlanningNote,
    listSurgicalSimulations,
    saveSurgicalSimulation,
    errorCodes: ERROR_CODES,
    uploadReconstructionFiles,
    createBackendReconstructionJob,
    startBackendReconstructionJob,
    approveReconstructionReview,
    getBackendReconstructionStatus,
    getBackendReconstructionResult,
    getBackendReconstructionReport,
    deleteBackendReconstructionResult,
    listBackendReconstructionJobs,
    getBackendReconstructionJob,
    deleteBackendReconstructionJob,
    applyManualModelAdjustment,
    skipManualModelAdjustment,
    cancelBackendReconstructionJob,
    exportFullBackup,
    previewBackup,
    restoreBackup
  };
})();
