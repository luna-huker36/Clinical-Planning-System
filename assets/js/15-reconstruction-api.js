(function () {
  let reconstructionMode = "mock";
  const MOCK_HISTORY_KEY = "pmas.reconstruction.history.v1";
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
    jobs: "/api/reconstruction/jobs",
    job: jobId => `/api/reconstruction/jobs/${encodeURIComponent(jobId)}`,
    startJob: jobId => `/api/reconstruction/jobs/${encodeURIComponent(jobId)}/start`,
    status: jobId => `/api/reconstruction/jobs/${encodeURIComponent(jobId)}/status`,
    result: jobId => `/api/reconstruction/jobs/${encodeURIComponent(jobId)}/result`,
    report: jobId => `/api/reconstruction/jobs/${encodeURIComponent(jobId)}/report`,
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

  function countWarnings(job) {
    return new Set([
      ...(job?.warnings || []),
      ...(job?.frameQualityReport?.warnings || []),
      ...(job?.segmentationWarnings || []),
      ...(job?.reconstructionWarnings || []),
      ...(job?.cleanupWarnings || [])
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

  async function createBackendReconstructionJob(uploadResult, settings = {}) {
    const settingsValidation = validateReconstructionSettings(settings);
    if (!settingsValidation.ok) {
      throw apiError(ERROR_CODES.jobFailed, settingsValidation.errors.join(" "));
    }

    if (reconstructionMode === "mock") {
      if (!pipeline()) throw apiError(ERROR_CODES.jobFailed, "Mock reconstruction pipeline не загружен.");
      const created = pipeline().createReconstructionJob(uploadResult?.files || [], settingsValidation.settings);
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
      body: JSON.stringify({ ...uploadResult, settings: settingsValidation.settings })
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
      return {
        jobId,
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
        segmentationReport: {
          segmentationMode: job.segmentationMode || "mock",
          masksCount: job.masksCount || 0,
          segmentationQuality: job.segmentationQuality || "medium",
          warnings: job.segmentationWarnings || []
        },
        reconstructionReport: {
          reconstructionMode: job.reconstructionMode || "mock",
          engineName: job.engineName || "PMAS Mock Reconstruction Engine",
          inputFramesCount: job.inputFramesCount || 0,
          reconstructionQuality: job.reconstructionQuality || "medium",
          warnings: job.reconstructionWarnings || []
        },
        cleanupReport: {
          cleanupMode: job.cleanupMode || "mock",
          cleanupQuality: job.cleanupQuality || "medium",
          resultModelSource: "mock",
          warnings: job.cleanupWarnings || []
        },
        finalResult: job.status === "ready" && job.resultGlbUrl
          ? await getBackendReconstructionResult(jobId)
          : null,
        readinessScore: job.readinessScore ?? (job.status === "ready" && job.resultGlbUrl ? 70 : 0),
        readinessLevel: job.readinessLevel || (job.status === "ready" && job.resultGlbUrl ? "medium" : "poor"),
        readinessWarnings: mockReadiness(job.status === "ready" && Boolean(job.resultGlbUrl)).readinessWarnings,
        resultGlbUrl: job.status === "ready" ? (job.resultGlbUrl || "") : "",
        warnings: job.warnings || []
      };
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

  async function listBackendReconstructionJobs(filter = "all") {
    const normalizedFilter = String(filter || "all").toLowerCase();
    if (reconstructionMode === "mock") {
      const items = readMockHistory();
      return normalizedFilter === "all"
        ? items
        : items.filter(item => item.status === normalizedFilter);
    }

    const query = normalizedFilter === "all" ? "" : `?status=${encodeURIComponent(normalizedFilter)}`;
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
    errorCodes: ERROR_CODES,
    uploadReconstructionFiles,
    createBackendReconstructionJob,
    startBackendReconstructionJob,
    getBackendReconstructionStatus,
    getBackendReconstructionResult,
    getBackendReconstructionReport,
    deleteBackendReconstructionResult,
    listBackendReconstructionJobs,
    getBackendReconstructionJob,
    deleteBackendReconstructionJob,
    cancelBackendReconstructionJob
  };
})();
