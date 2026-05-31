(function () {
  let reconstructionMode = "mock";

  const ENDPOINTS = {
    upload: "/api/reconstruction/upload",
    jobs: "/api/reconstruction/jobs",
    startJob: jobId => `/api/reconstruction/jobs/${encodeURIComponent(jobId)}/start`,
    status: jobId => `/api/reconstruction/jobs/${encodeURIComponent(jobId)}/status`,
    result: jobId => `/api/reconstruction/jobs/${encodeURIComponent(jobId)}/result`,
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

    // TODO: POST files to /api/reconstruction/upload when backend storage exists.
    const form = new FormData();
    fileArray.forEach(file => form.append("files", file));
    return await backendJson(ENDPOINTS.upload, {
      method: "POST",
      body: form
    }, ERROR_CODES.uploadFailed);
  }

  async function createBackendReconstructionJob(uploadResult) {
    if (reconstructionMode === "mock") {
      if (!pipeline()) throw apiError(ERROR_CODES.jobFailed, "Mock reconstruction pipeline не загружен.");
      const created = pipeline().createReconstructionJob(uploadResult?.files || []);
      if (!created.ok) {
        throw apiError(ERROR_CODES.jobFailed, created.errors.map(error => error.message).join(" "));
      }
      const job = created.job;
      if (uploadResult?.previewReport) job.preprocessingReport = uploadResult.previewReport;
      return job;
    }

    // TODO: POST upload result to /api/reconstruction/jobs when backend jobs are implemented.
    return await backendJson(ENDPOINTS.jobs, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(uploadResult)
    }, ERROR_CODES.jobFailed);
  }

  async function startBackendReconstructionJob(jobId) {
    if (reconstructionMode === "mock") {
      if (!pipeline()) throw apiError(ERROR_CODES.jobFailed, "Mock reconstruction pipeline не загружен.");
      const job = await pipeline().startReconstructionJob(jobId);
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
      const job = await getBackendReconstructionStatus(jobId);
      if (job.status !== "ready" || !job.resultGlbUrl) {
        throw apiError(ERROR_CODES.jobFailed, "Reconstruction result ещё не готов.");
      }
      return {
        jobId,
        resultGlbUrl: job.resultGlbUrl,
        job
      };
    }

    // TODO: GET /api/reconstruction/jobs/:jobId/result when backend result storage is available.
    return await backendJson(ENDPOINTS.result(jobId), { method: "GET" }, ERROR_CODES.jobFailed);
  }

  async function cancelBackendReconstructionJob(jobId) {
    if (reconstructionMode === "mock") {
      if (!pipeline()) throw apiError(ERROR_CODES.jobFailed, "Mock reconstruction pipeline не загружен.");
      return pipeline().cancelReconstructionJob(jobId, "Canceled by user");
    }

    // TODO: POST /api/reconstruction/jobs/:jobId/cancel when backend cancellation exists.
    try {
      return await backendJson(ENDPOINTS.cancel(jobId), { method: "POST" }, ERROR_CODES.networkUnavailable);
    } catch (err) {
      throw normalizeBackendError(err, ERROR_CODES.canceledByUser, "Canceled by user.");
    }
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
    errorCodes: ERROR_CODES,
    uploadReconstructionFiles,
    createBackendReconstructionJob,
    startBackendReconstructionJob,
    getBackendReconstructionStatus,
    getBackendReconstructionResult,
    cancelBackendReconstructionJob
  };
})();
