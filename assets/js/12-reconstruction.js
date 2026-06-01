(function () {
  const state = {
    selectedFiles: [],
    uploadResult: null,
    currentJobId: null,
    currentJob: null,
    currentResult: null,
    currentReport: null,
    busy: false,
    pollTimer: null
  };

  const STATUS_LABELS = {
    idle: "Idle",
    uploaded: "Uploaded",
    validating: "Validating",
    analyzing: "Analyzing",
    preparing: "Preparing",
    extracting_frames: "Extracting frames",
    analyzing_frames: "Analyzing frames",
    segmenting_head: "Segmenting head",
    queued: "Queued",
    reconstructing_3d: "Reconstructing 3D",
    cleaning_mesh: "Cleaning mesh",
    exporting: "Exporting",
    ready: "Ready",
    canceled: "Canceled",
    error: "Error",
    opened: "Opened"
  };

  const PIPELINE_ORDER = ["uploaded", "validating", "analyzing", "preparing", "extracting_frames", "analyzing_frames", "segmenting_head", "queued", "reconstructing_3d", "cleaning_mesh", "exporting", "ready", "canceled"];
  const ACTIVE_STATUSES = new Set(["validating", "analyzing", "preparing", "extracting_frames", "analyzing_frames", "segmenting_head", "queued", "reconstructing_3d", "cleaning_mesh", "exporting"]);

  function byId(id) {
    return document.getElementById(id);
  }

  function api() {
    return window.PMASReconstructionApi;
  }

  function currentJob() {
    return state.currentJob || null;
  }

  function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[ch]));
  }

  function setError(message, tone = "error") {
    const el = byId("reconstructionError");
    if (!el) return;
    el.textContent = message || "";
    el.style.display = message ? "block" : "none";
    el.classList.toggle("canceled", tone === "canceled");
  }

  function setStatusText(message) {
    const status = byId("reconstructionStatus");
    if (status) status.textContent = message;
  }

  function setProgress(value) {
    const progress = Math.max(0, Math.min(100, Number(value) || 0));
    const bar = byId("reconstructionProgressBar");
    const label = byId("reconstructionProgressValue");
    if (bar) bar.style.width = `${progress}%`;
    if (label) label.textContent = `${Math.round(progress)}%`;
  }

  function updateSteps(status) {
    document.querySelectorAll(".reconstruction-step").forEach(step => {
      const currentIndex = PIPELINE_ORDER.indexOf(status);
      const stepIndex = PIPELINE_ORDER.indexOf(step.dataset.stage);
      step.classList.toggle("active", step.dataset.stage === status);
      step.classList.toggle("done", currentIndex >= 0 && stepIndex >= 0 && stepIndex < currentIndex);
    });
  }

  function renderFiles() {
    const list = byId("reconstructionFileList");
    const count = byId("reconstructionFileCount");
    const job = currentJob();
    const files = job ? (job.uploadedFiles || job.files || []) : state.selectedFiles;

    if (count) count.textContent = files.length;
    if (!list) return;

    if (!files.length) {
      list.innerHTML = '<div class="hint">Файлы ещё не загружены.</div>';
      return;
    }

    list.innerHTML = files.map(file => {
      const ext = (file.extension || file.name.split(".").pop() || "").toUpperCase();
      return `<div class="reconstruction-file-row">
        <div>
          <strong>${escapeHtml(file.name)}</strong>
          <div class="hint">${ext} • ${formatBytes(file.size)}</div>
        </div>
        <span class="badge">${job ? escapeHtml(job.fileType) : "selected"}</span>
      </div>`;
    }).join("");
  }

  function renderQualityList(id, items) {
    const el = byId(id);
    if (!el) return;
    if (!items || !items.length) {
      el.textContent = "—";
      return;
    }
    el.innerHTML = items.map(item => `<div>• ${escapeHtml(item)}</div>`).join("");
  }

  function formatDuration(seconds) {
    if (seconds === null || seconds === undefined || seconds === "") return "—";
    const value = Number(seconds);
    if (!Number.isFinite(value)) return "—";
    return `${value.toFixed(value >= 10 ? 0 : 1)} s`;
  }

  function renderVideoPreprocessing(job) {
    const duration = byId("reconstructionVideoDuration");
    const frames = byId("reconstructionExtractedFrames");
    const resolution = byId("reconstructionFrameResolution");
    const metadata = job?.videoMetadata || null;

    if (duration) duration.textContent = metadata ? formatDuration(metadata.duration) : "—";
    if (frames) frames.textContent = String(job?.extractedFramesCount || 0);
    if (resolution) {
      resolution.textContent = metadata?.width && metadata?.height
        ? `${metadata.width} × ${metadata.height}`
        : "—";
    }
  }

  function renderFrameQuality(job) {
    const report = job?.frameQualityReport || null;
    const total = byId("reconstructionTotalFrames");
    const selected = byId("reconstructionSelectedFrames");
    const rejected = byId("reconstructionRejectedFrames");
    const score = byId("reconstructionFrameQualityScore");

    if (total) total.textContent = String(report?.totalFrames || 0);
    if (selected) selected.textContent = String(job?.selectedFramesCount ?? report?.selectedFramesCount ?? 0);
    if (rejected) rejected.textContent = String(job?.rejectedFramesCount ?? report?.rejectedFramesCount ?? 0);
    if (score) {
      const value = report?.qualityScore;
      score.textContent = Number.isFinite(Number(value)) ? `${Math.round(Number(value))}/100` : "—";
    }
  }

  function renderSegmentation(job) {
    const masks = byId("reconstructionMasksCount");
    const quality = byId("reconstructionSegmentationQuality");
    const segmentationQuality = job?.segmentationQuality || "";

    if (masks) masks.textContent = String(job?.masksCount || 0);
    if (quality) {
      quality.textContent = segmentationQuality || "—";
      quality.className = segmentationQuality
        ? `badge reconstruction-quality-${segmentationQuality}`
        : "badge";
    }
  }

  function renderReconstructionEngine(job) {
    const mode = byId("reconstructionEngineMode");
    const frames = byId("reconstructionInputFrames");
    const quality = byId("reconstructionEngineQuality");
    const reconstructionQuality = job?.reconstructionQuality || "";

    if (mode) mode.textContent = job?.reconstructionMode || "—";
    if (frames) frames.textContent = String(job?.inputFramesCount || 0);
    if (quality) {
      quality.textContent = reconstructionQuality || "—";
      quality.className = reconstructionQuality
        ? `badge reconstruction-quality-${reconstructionQuality}`
        : "badge";
    }
  }

  function renderCleanup(job) {
    const quality = byId("reconstructionCleanupQuality");
    const source = byId("reconstructionResultModelSource");
    const cleanupQuality = job?.cleanupQuality || "";

    if (quality) {
      quality.textContent = cleanupQuality || "—";
      quality.className = cleanupQuality
        ? `badge reconstruction-quality-${cleanupQuality}`
        : "badge";
    }
    if (source) source.textContent = job?.resultModelSource || "—";
  }

  function setQualityBadge(id, value) {
    const el = byId(id);
    if (!el) return;
    el.textContent = value || "—";
    el.className = value ? `badge reconstruction-quality-${value}` : "badge";
  }

  function renderResultCard(job) {
    const resultCard = byId("reconstructionResult");
    const result = state.currentResult;
    const showResult = job?.status === "ready" || Boolean(result);
    const checks = result?.checks || {};
    const canOpen = Boolean(checks.canOpen && result?.resultGlbUrl);
    const resultStatus = byId("reconstructionResultStatus");
    const open = byId("btnOpenReconstruction3d");
    const download = byId("btnDownloadReconstructionGlb");
    const viewReport = byId("btnViewReconstructionReport");
    const deleteResult = byId("btnDeleteReconstructionResult");
    const startNew = byId("btnStartNewReconstruction");

    if (resultCard) resultCard.style.display = showResult ? "block" : "none";
    if (!showResult) return;

    byId("reconstructionResultJobId").textContent = result?.jobId || job?.jobId || "—";
    byId("reconstructionResultName").textContent = result?.resultGlbUrl || job?.resultGlbUrl || "Result deleted or missing";
    byId("reconstructionResultSelectedFrames").textContent = String(result?.selectedFramesCount ?? job?.selectedFramesCount ?? 0);
    byId("reconstructionResultSource").textContent = result?.metadata?.resultModelSource || job?.resultModelSource || "—";
    setQualityBadge("reconstructionResultReconstructionQuality", result?.reconstructionQuality || job?.reconstructionQuality || "");
    setQualityBadge("reconstructionResultCleanupQuality", result?.cleanupQuality || job?.cleanupQuality || "");
    renderQualityList("reconstructionResultWarnings", result?.warnings || []);

    if (resultStatus) {
      if (canOpen) {
        resultStatus.textContent = "GLB ready";
        resultStatus.className = "badge badge-info";
      } else if (checks.expiredOrMissing) {
        resultStatus.textContent = "Result missing";
        resultStatus.className = "badge";
      } else {
        resultStatus.textContent = "Invalid result";
        resultStatus.className = "badge reconstruction-quality-poor";
      }
    }

    if (open) open.style.display = canOpen ? "inline-flex" : "none";
    if (download) {
      download.style.display = canOpen ? "inline-flex" : "none";
      download.href = canOpen ? result.resultGlbUrl : "#";
    }
    if (viewReport) viewReport.style.display = showResult ? "inline-flex" : "none";
    if (deleteResult) deleteResult.style.display = result?.checks?.exists ? "inline-flex" : "none";
    if (startNew) startNew.style.display = "inline-flex";
  }

  function renderQualityReport(report) {
    const inputType = byId("reconstructionQualityInputType");
    const fileCount = byId("reconstructionQualityFileCount");
    const qualityBadge = byId("reconstructionQualityBadge");

    if (!report) {
      if (inputType) inputType.textContent = "—";
      if (fileCount) fileCount.textContent = "0";
      if (qualityBadge) {
        qualityBadge.textContent = "—";
        qualityBadge.className = "badge";
      }
      renderQualityList("reconstructionWarnings", []);
      renderQualityList("reconstructionRecommendations", []);
      renderVideoPreprocessing(null);
      renderFrameQuality(null);
      renderSegmentation(null);
      renderReconstructionEngine(null);
      renderCleanup(null);
      return;
    }

    const quality = report.estimatedQuality || "medium";
    if (inputType) inputType.textContent = report.inputType || "—";
    if (fileCount) fileCount.textContent = String(report.fileCount || 0);
    if (qualityBadge) {
      qualityBadge.textContent = quality;
      qualityBadge.className = `badge reconstruction-quality-${quality}`;
    }
    renderQualityList("reconstructionWarnings", report.warnings || []);
    renderQualityList("reconstructionRecommendations", report.recommendations || []);
  }

  function renderJob(job) {
    const status = job?.status || "idle";
    const progress = job?.progress || 0;
    const retry = byId("btnRetryReconstruction");
    const cancel = byId("btnCancelReconstruction");
    const start = byId("btnStartReconstruction");
    const badge = byId("reconstructionStageBadge");

    if (badge) badge.textContent = STATUS_LABELS[status] || status;
    byId("reconstructionJobId").textContent = job?.jobId || "—";
    byId("reconstructionJobStatus").textContent = STATUS_LABELS[status] || status;
    byId("reconstructionJobFileType").textContent = job?.fileType || "—";
    setProgress(progress);
    updateSteps(status);
    const backendReport = job ? {
      inputType: job.fileType || "—",
      fileCount: (job.uploadedFiles || job.files || []).length,
      estimatedQuality: "medium",
      warnings: [
        ...(job.warnings || []),
        ...(job.frameQualityReport?.warnings || []),
        ...(job.segmentationWarnings || []),
        ...(job.reconstructionWarnings || []),
        ...(job.cleanupWarnings || [])
      ],
      recommendations: []
    } : null;
    const report = job?.preprocessingReport || state.uploadResult?.previewReport || backendReport;
    const mergedWarnings = [
      ...(report?.warnings || []),
      ...(job?.warnings || []),
      ...(job?.frameQualityReport?.warnings || []),
      ...(job?.segmentationWarnings || []),
      ...(job?.reconstructionWarnings || []),
      ...(job?.cleanupWarnings || [])
    ];
    renderQualityReport(report ? { ...report, warnings: Array.from(new Set(mergedWarnings)) } : null);
    renderVideoPreprocessing(job);
    renderFrameQuality(job);
    renderSegmentation(job);
    renderReconstructionEngine(job);
    renderCleanup(job);

    if (start) start.disabled = !state.selectedFiles.length || state.busy;
    if (retry) retry.style.display = status === "error" || status === "canceled" ? "inline-flex" : "none";
    if (cancel) cancel.style.display = ACTIVE_STATUSES.has(status) && state.busy ? "inline-flex" : "none";
    renderResultCard(job);

    if (status === "error") {
      setError(job?.errorMessage || "Reconstruction pipeline завершился с ошибкой.");
      setStatusText("Error: обработка остановлена. Можно повторить Retry.");
    } else if (status === "canceled") {
      setError(job?.errorMessage || "Canceled by user.", "canceled");
      setStatusText("Canceled by user: обработка остановлена.");
    } else {
      setError("");
      const text = status === "idle"
        ? "Загрузите фото или видео головы."
        : `${STATUS_LABELS[status] || status}: job ${job.jobId}`;
      setStatusText(text);
    }
    renderFiles();
  }

  function resetJobUi() {
    state.currentResult = null;
    state.currentReport = null;
    renderJob(null);
    setProgress(0);
    renderQualityReport(null);
  }

  function startJobPolling() {
    stopJobPolling();
    state.pollTimer = window.setInterval(() => {
      pollCurrentJob();
      if (!state.busy) stopJobPolling();
    }, 120);
  }

  function stopJobPolling() {
    if (!state.pollTimer) return;
    window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  function apiErrorMessage(err, fallback = "Reconstruction API error.") {
    const code = err?.code ? `${err.code}: ` : "";
    return `${code}${err?.message || fallback}`;
  }

  async function addFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    if (!api()) {
      setError("Reconstruction API adapter не загружен.");
      return;
    }

    const accepted = [];
    for (const file of incoming) {
      const duplicate = state.selectedFiles.some(item =>
        item.name === file.name && item.size === file.size && item.lastModified === file.lastModified
      );
      if (!duplicate) accepted.push(file);
    }

    const nextFiles = [...state.selectedFiles, ...accepted];
    state.busy = false;

    if (nextFiles.length) {
      try {
        const uploadResult = await api().uploadReconstructionFiles(nextFiles);
        const job = await api().createBackendReconstructionJob(uploadResult);
        state.selectedFiles = nextFiles;
        state.uploadResult = uploadResult;
        state.currentJobId = job.jobId;
        state.currentJob = job;
        state.currentResult = null;
        state.currentReport = null;
        setError("");
        renderJob(job);
        if (state.uploadResult?.previewReport) renderQualityReport(state.uploadResult.previewReport);
      } catch (err) {
        setError(apiErrorMessage(err, "Upload failed."));
        renderFiles();
      }
    } else {
      resetJobUi();
    }
  }

  async function startCurrentJob() {
    if (!api() || !state.currentJobId || state.busy) return;
    state.busy = true;
    state.currentResult = null;
    state.currentReport = null;
    renderJob(currentJob());
    startJobPolling();
    try {
      const job = await api().startBackendReconstructionJob(state.currentJobId);
      state.currentJob = job;
      state.busy = false;
      stopJobPolling();
      renderJob(job);
      if (job.status === "ready") await refreshCurrentResult();
    } catch (err) {
      state.busy = false;
      stopJobPolling();
      await pollCurrentJob();
      setError(apiErrorMessage(err, "Job failed."));
    }
  }

  async function retryCurrentJob() {
    if (!api() || !state.uploadResult || state.busy) return;
    try {
      const job = await api().createBackendReconstructionJob(state.uploadResult);
      state.currentJobId = job.jobId;
      state.currentJob = job;
      state.currentResult = null;
      state.currentReport = null;
      renderJob(job);
      await startCurrentJob();
    } catch (err) {
      setError(apiErrorMessage(err, "Job failed."));
    }
  }

  async function pollCurrentJob() {
    if (!api() || !state.currentJobId) return null;
    try {
      const job = await api().getBackendReconstructionStatus(state.currentJobId);
      state.currentJob = job;
      renderJob(job);
      if (job.status === "ready" && !state.currentResult) await refreshCurrentResult();
      return job;
    } catch (err) {
      setError(apiErrorMessage(err, "Network/backend unavailable."));
      return null;
    }
  }

  async function cancelCurrentJob() {
    if (!api() || !state.currentJobId || !state.busy) return;
    try {
      const job = await api().cancelBackendReconstructionJob(state.currentJobId);
      state.currentJob = job;
      state.busy = false;
      stopJobPolling();
      renderJob(job);
    } catch (err) {
      setError(apiErrorMessage(err, "Canceled by user."));
    }
  }

  function clearReconstruction() {
    state.selectedFiles = [];
    state.uploadResult = null;
    state.currentJobId = null;
    state.currentJob = null;
    state.currentResult = null;
    state.currentReport = null;
    state.busy = false;
    stopJobPolling();
    const input = byId("reconstructionFileInput");
    if (input) input.value = "";
    setError("");
    resetJobUi();
  }

  async function waitFor3DViewer() {
    const started = Date.now();
    while (Date.now() - started < 5000) {
      if (window._3d && typeof window._3d.openModel === "function") return window._3d;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return null;
  }

  async function openIn3DViewer() {
    const job = currentJob();
    const resultUrl = state.currentResult?.checks?.canOpen
      ? state.currentResult.resultGlbUrl
      : job?.resultGlbUrl;
    if (!job || job.status !== "ready" || !resultUrl) {
      setError("Сначала дождитесь статуса Ready и доступного GLB.");
      return;
    }
    const viewer = await waitFor3DViewer();
    if (!viewer) {
      setError("3D viewer ещё не готов. Откройте вкладку 3D Модель и повторите.");
      return;
    }
    viewer.openModel(resultUrl, `reconstruction:${job.jobId}`);
    byId("reconstructionStageBadge").textContent = "Opened";
    setStatusText("Open in 3D viewer: GLB открыт в PMAS 3D viewer.");
  }

  async function refreshCurrentResult() {
    if (!api() || !state.currentJobId) return null;
    try {
      const result = await api().getBackendReconstructionResult(state.currentJobId);
      state.currentResult = result;
      renderResultCard(currentJob());
      return result;
    } catch (err) {
      setError(apiErrorMessage(err, "Result unavailable."));
      state.currentResult = {
        jobId: state.currentJobId,
        resultGlbUrl: "",
        checks: { exists: false, glbExists: false, canOpen: false, invalid: true, expiredOrMissing: false },
        warnings: [err?.message || "Result unavailable."]
      };
      renderResultCard(currentJob());
      return null;
    }
  }

  async function viewCurrentReport() {
    if (!api() || !state.currentJobId) return;
    const modal = byId("reconstructionReportModal");
    const pre = byId("reconstructionReportJson");
    try {
      const report = await api().getBackendReconstructionReport(state.currentJobId);
      state.currentReport = report;
      if (pre) pre.textContent = JSON.stringify(report, null, 2);
      if (modal) modal.style.display = "flex";
    } catch (err) {
      setError(apiErrorMessage(err, "Report unavailable."));
    }
  }

  function closeReportModal() {
    const modal = byId("reconstructionReportModal");
    if (modal) modal.style.display = "none";
  }

  async function deleteCurrentResult() {
    if (!api() || !state.currentJobId) return;
    try {
      const response = await api().deleteBackendReconstructionResult(state.currentJobId);
      state.currentResult = response?.result || response;
      if (state.currentJob) {
        state.currentJob.resultGlbUrl = "";
        state.currentJob.resultModelSource = "deleted";
      }
      setStatusText("Result deleted: GLB artifact removed, report metadata kept.");
      renderResultCard(currentJob());
    } catch (err) {
      setError(apiErrorMessage(err, "Delete result failed."));
    }
  }

  function bind() {
    const input = byId("reconstructionFileInput");
    const dropzone = byId("reconstructionDropzone");
    byId("btnStartReconstruction")?.addEventListener("click", startCurrentJob);
    byId("btnRetryReconstruction")?.addEventListener("click", retryCurrentJob);
    byId("btnCancelReconstruction")?.addEventListener("click", cancelCurrentJob);
    byId("btnClearReconstruction")?.addEventListener("click", clearReconstruction);
    byId("btnOpenReconstruction3d")?.addEventListener("click", openIn3DViewer);
    byId("btnDownloadReconstructionGlb")?.addEventListener("click", event => {
      if (!state.currentResult?.checks?.canOpen) {
        event.preventDefault();
        setError("GLB result недоступен для скачивания.");
      }
    });
    byId("btnViewReconstructionReport")?.addEventListener("click", viewCurrentReport);
    byId("btnDeleteReconstructionResult")?.addEventListener("click", deleteCurrentResult);
    byId("btnStartNewReconstruction")?.addEventListener("click", clearReconstruction);
    byId("btnCloseReconstructionReport")?.addEventListener("click", closeReportModal);
    byId("reconstructionReportModal")?.addEventListener("click", event => {
      if (event.target?.id === "reconstructionReportModal") closeReportModal();
    });

    input?.addEventListener("change", event => addFiles(event.target.files));

    ["dragenter", "dragover"].forEach(type => {
      dropzone?.addEventListener(type, event => {
        event.preventDefault();
        dropzone.classList.add("drag-over");
      });
    });
    ["dragleave", "drop"].forEach(type => {
      dropzone?.addEventListener(type, event => {
        event.preventDefault();
        dropzone.classList.remove("drag-over");
      });
    });
    dropzone?.addEventListener("drop", event => addFiles(event.dataTransfer.files));

    resetJobUi();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
