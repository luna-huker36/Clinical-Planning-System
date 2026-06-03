(function () {
  let reconstructionMode = "mock";
  const MOCK_HISTORY_KEY = "pmas.reconstruction.history.v1";
  const MOCK_CASES_KEY = "pmas.reconstruction.cases.v1";
  const MOCK_COMPARISONS_KEY = "pmas.reconstruction.comparisons.v1";
  const MOCK_MEASUREMENTS_KEY = "pmas.reconstruction.measurements.v1";
  const MOCK_LANDMARKS_KEY = "pmas.reconstruction.landmarks.v1";
  const MOCK_SURGICAL_PLANS_KEY = "pmas.reconstruction.surgical-plans.v1";
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
    upload: "/api/reconstruction/upload",
    cases: "/api/reconstruction/cases",
    caseReport: caseId => `/api/reconstruction/cases/${encodeURIComponent(caseId)}/report`,
    comparisons: "/api/reconstruction/comparisons",
    comparisonReport: comparisonId => `/api/reconstruction/comparisons/${encodeURIComponent(comparisonId)}/report`,
    measurements: "/api/reconstruction/measurements",
    measurement: measurementId => `/api/reconstruction/measurements/${encodeURIComponent(measurementId)}`,
    landmarks: "/api/reconstruction/landmarks",
    landmark: landmarkId => `/api/reconstruction/landmarks/${encodeURIComponent(landmarkId)}`,
    surgicalPlans: "/api/reconstruction/surgical-plans",
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
        surgicalPlans: []
      };
      writeMockCases([caseItem, ...readMockCases()]);
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
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp
      };
      if (!measurement.caseId || !measurement.jobId || !measurement.modelId) {
        throw apiError(ERROR_CODES.jobFailed, "caseId, jobId, and modelId are required for measurement storage.");
      }
      const allowed = new Set(["distance", "angle", "vector", "point", "annotation"]);
      if (!allowed.has(measurement.type)) {
        throw apiError(ERROR_CODES.jobFailed, "Unsupported measurement type.");
      }
      writeMockMeasurements([measurement, ...readMockMeasurements().filter(item => item.measurementId !== measurement.measurementId)]);
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
        visible: input.visible === undefined ? existing?.visible !== false : input.visible !== false,
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
        linkedCase.updatedAt = timestamp;
        writeMockCases([linkedCase, ...cases.filter(item => item.caseId !== landmark.caseId)]);
      }
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

  async function getPatientCaseReport(caseId) {
    if (reconstructionMode === "mock") {
      const caseItem = readMockCases().find(item => item.caseId === caseId);
      if (!caseItem) throw apiError(ERROR_CODES.jobFailed, "Case not found.");
      const jobs = readMockHistory().filter(item => item.caseId === caseId);
      const measurements = readMockMeasurements().filter(item => item.caseId === caseId);
      const landmarks = readMockLandmarks().filter(item => item.caseId === caseId);
      const surgicalPlanningNotes = readMockSurgicalPlans().filter(item => item.caseId === caseId);
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
      return {
        ...caseItem,
        generatedAt: new Date().toISOString(),
        reconstructionJobs: jobs,
        jobs,
        resultModels,
        readinessScores,
        warnings,
        comparisons: readMockComparisons().filter(item => item.caseId === caseId),
        measurements,
        measurementsCount: measurements.length,
        landmarks,
        landmarksCount: landmarks.length,
        surgicalPlanningNotes,
        surgicalPlanningNotesCount: surgicalPlanningNotes.length
      };
    }
    return await backendJson(ENDPOINTS.caseReport(caseId), { method: "GET" }, ERROR_CODES.jobFailed);
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
      return plan;
    }

    return await backendJson(ENDPOINTS.surgicalPlans, {
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
        measurements: readMockMeasurements().filter(item => (
          item.caseId === (job.caseId || "")
          && item.jobId === jobId
          && item.modelId === modelId
        )),
        landmarks: readMockLandmarks().filter(item => (
          item.caseId === (job.caseId || "")
          && item.jobId === jobId
          && item.modelId === modelId
        )),
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

  function setMode(mode) {
    if (mode !== "mock" && mode !== "backend") {
      throw apiError(ERROR_CODES.jobFailed, `Unsupported reconstruction mode: ${mode}`);
    }
    reconstructionMode = mode;
    return reconstructionMode;
  }

  function initModeFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      const mode = params.get("reconstructionMode");
      if (mode === "mock" || mode === "backend") setMode(mode);
    } catch (err) {
      console.warn("Unable to read reconstruction mode from URL.", err);
    }
  }

  initModeFromUrl();

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
    listSurgicalPlanningNotes,
    saveSurgicalPlanningNote,
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
    cancelBackendReconstructionJob
  };
})();
