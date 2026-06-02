(function () {
  const state = {
    selectedFiles: [],
    uploadResult: null,
    currentJobId: null,
    currentJob: null,
    currentResult: null,
    currentReport: null,
    historyItems: [],
    historyFilter: "all",
    settings: null,
    checklist: null,
    lastUploadError: "",
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

  function statusRank(status) {
    return status === "failed" ? 3 : status === "warning" ? 2 : 1;
  }

  function worstStatus(statuses) {
    return statuses.reduce((worst, status) => statusRank(status) > statusRank(worst) ? status : worst, "passed");
  }

  function getChecklistReport(job = currentJob()) {
    return job?.preprocessingReport || state.uploadResult?.previewReport || null;
  }

  function fileExtension(file) {
    return String(file?.extension || file?.name || "").split(".").pop().toLowerCase();
  }

  function isChecklistImage(file) {
    return ["jpg", "jpeg", "png"].includes(fileExtension(file));
  }

  function isChecklistVideo(file) {
    return ["mp4", "mov", "webm"].includes(fileExtension(file));
  }

  function normalizeInputType(inputType) {
    if (inputType === "images") return "photos";
    return inputType || "unknown";
  }

  function hasCriticalWarning(warnings) {
    return (warnings || []).some(warning =>
      /unsupported|не поддерж|unreadable|corrupt|поврежд|validation failed|unknown input/i.test(String(warning))
    );
  }

  function getResolutionItems(report) {
    return [
      ...(report?.imageMetadata || []),
      ...(report?.videoMetadata || [])
    ];
  }

  function buildChecklist(job = currentJob()) {
    const report = getChecklistReport(job);
    const files = job ? (job.uploadedFiles || job.files || []) : state.selectedFiles;
    const fileCount = files.length;
    const unsupportedFiles = files.filter(file => !isChecklistImage(file) && !isChecklistVideo(file));
    const warnings = [
      ...(report?.warnings || []),
      ...(job?.warnings || [])
    ];
    const inputType = normalizeInputType(report?.inputType || job?.fileType || state.uploadResult?.fileType || "unknown");
    const estimatedQuality = report?.estimatedQuality || "medium";
    const photoCount = Number(report?.photoCount ?? files.filter(isChecklistImage).length);
    const videoCount = Number(report?.videoCount ?? files.filter(isChecklistVideo).length);
    const videoMeta = report?.videoMetadata?.[0] || job?.videoMetadata || null;
    const duration = videoMeta?.duration;
    const resolutionItems = getResolutionItems(report);
    const hasUnknownResolution = fileCount > 0 && (!resolutionItems.length || resolutionItems.some(item => !item.width || !item.height));
    const hasLowResolution = resolutionItems.some(item => item.width && item.height && (item.width < 720 || item.height < 720));
    const checklist = [];

    checklist.push({
      id: "files",
      label: "Files uploaded",
      status: fileCount ? "passed" : "failed",
      reason: fileCount ? `${fileCount} file(s) selected.` : "Загрузите хотя бы один файл."
    });

    checklist.push({
      id: "format",
      label: "Supported format",
      status: state.lastUploadError || unsupportedFiles.length ? "failed" : fileCount ? "passed" : "failed",
      reason: state.lastUploadError
        || (unsupportedFiles.length
          ? `Неподдерживаемый формат: ${unsupportedFiles.map(file => file.name || fileExtension(file)).join(", ")}.`
          : fileCount
            ? "Форматы прошли проверку."
            : "Файлы ещё не проверены.")
    });

    let enoughStatus = "failed";
    let enoughReason = "Нужно загрузить фото или видео.";
    if (inputType === "photos" || inputType === "images") {
      if (photoCount < 10) {
        enoughStatus = "failed";
        enoughReason = "Фото меньше 10: reconstruction запускать рано.";
      } else if (photoCount < 20) {
        enoughStatus = "warning";
        enoughReason = "Фото 10–19: можно запускать, но лучше 20–40.";
      } else {
        enoughStatus = "passed";
        enoughReason = "Количество фото достаточно.";
      }
    } else if (inputType === "video") {
      if (duration != null && duration < 10) {
        enoughStatus = "failed";
        enoughReason = "Видео короче 10 секунд.";
      } else if (duration == null) {
        enoughStatus = "warning";
        enoughReason = "Длительность видео не прочитана.";
      } else if (duration < 20 || duration > 40) {
        enoughStatus = "warning";
        enoughReason = "Видео вне рекомендуемых 20–40 секунд.";
      } else {
        enoughStatus = "passed";
        enoughReason = "Длительность видео подходит.";
      }
    } else if (inputType === "mixed") {
      enoughStatus = photoCount >= 10 || videoCount >= 1 ? "warning" : "failed";
      enoughReason = enoughStatus === "failed"
        ? "Для mixed input недостаточно данных."
        : "Mixed input допустим, но проверьте покрытие.";
    } else if (fileCount) {
      enoughStatus = "failed";
      enoughReason = "Input type не определён.";
    }
    checklist.push({ id: "enough", label: "Enough input data", status: enoughStatus, reason: enoughReason });

    checklist.push({
      id: "resolution",
      label: "Acceptable resolution",
      status: hasLowResolution || hasUnknownResolution ? "warning" : fileCount ? "passed" : "failed",
      reason: hasLowResolution
        ? "Низкое разрешение может ухудшить качество модели."
        : hasUnknownResolution
          ? "Разрешение части файлов не удалось прочитать."
          : fileCount
            ? "Разрешение выглядит приемлемым."
            : "Нет файлов для проверки разрешения."
    });

    checklist.push({
      id: "critical",
      label: "No critical warnings",
      status: hasCriticalWarning(warnings) || (fileCount && inputType === "unknown") ? "failed" : warnings.length ? "warning" : fileCount ? "passed" : "failed",
      reason: hasCriticalWarning(warnings)
        ? "Есть критичные предупреждения preprocessing."
        : fileCount && inputType === "unknown"
          ? "Input type неизвестен."
          : warnings.length
            ? "Есть предупреждения, но запуск разрешён."
            : fileCount
              ? "Критичных предупреждений нет."
              : "Нет данных для проверки."
    });

    checklist.push({
      id: "lighting",
      label: "Recommended lighting",
      status: estimatedQuality === "good" ? "passed" : fileCount ? "warning" : "failed",
      reason: estimatedQuality === "good"
        ? "Качество input выглядит хорошим."
        : fileCount
          ? "Избегайте размытия и плохого света."
          : "Сначала загрузите файлы."
    });

    checklist.push({
      id: "angle",
      label: "Recommended angle coverage",
      status: (inputType === "photos" || inputType === "images") && photoCount >= 20 ? "passed" : inputType === "video" && duration >= 20 && duration <= 40 ? "passed" : fileCount ? "warning" : "failed",
      reason: ((inputType === "photos" || inputType === "images") && photoCount >= 20) || (inputType === "video" && duration >= 20 && duration <= 40)
        ? "Покрытие углов выглядит достаточным."
        : fileCount
          ? "Снимайте голову по кругу с разных углов."
          : "Нет данных для оценки покрытия."
    });

    const overall = worstStatus(checklist.map(item => item.status));
    const failedItem = checklist.find(item => item.status === "failed");
    const warningItem = checklist.find(item => item.status === "warning");
    const canStart = fileCount > 0 && !failedItem;
    return {
      items: checklist,
      overall,
      canStart,
      reason: failedItem
        ? `Start disabled: ${failedItem.reason}`
        : warningItem
          ? "Можно запускать, но есть предупреждения."
          : "Input готов к запуску."
    };
  }

  function renderChecklist(job = currentJob()) {
    const checklist = buildChecklist(job);
    state.checklist = checklist;
    const list = byId("reconstructionChecklist");
    const summary = byId("reconstructionChecklistSummary");

    if (summary) {
      summary.textContent = checklist.reason;
      summary.className = `reconstruction-checklist-summary ${checklist.overall}`;
    }
    if (list) {
      list.innerHTML = checklist.items.map(item => `<div class="reconstruction-checklist-row">
        <div class="reconstruction-checklist-label">${escapeHtml(item.label)}</div>
        <span class="badge reconstruction-checklist-status-${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>
        <div class="reconstruction-checklist-reason">${escapeHtml(item.reason)}</div>
      </div>`).join("");
    }
    return checklist;
  }

  function formatDuration(seconds) {
    if (seconds === null || seconds === undefined || seconds === "") return "—";
    const value = Number(seconds);
    if (!Number.isFinite(value)) return "—";
    return `${value.toFixed(value >= 10 ? 0 : 1)} s`;
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("ru-RU", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function normalizeSettings(settings) {
    return api()?.normalizeReconstructionSettings
      ? api().normalizeReconstructionSettings(settings)
      : {
        processingMode: "balanced",
        inputTypePreference: "auto",
        maxFrames: 40,
        frameExtractionRate: 1,
        cleanupStrength: "medium",
        targetModelQuality: "preview",
        saveIntermediateFiles: false
      };
  }

  function readSettings() {
    const settings = normalizeSettings({
      processingMode: byId("reconstructionProcessingMode")?.value,
      inputTypePreference: byId("reconstructionInputPreference")?.value,
      maxFrames: byId("reconstructionMaxFrames")?.value,
      frameExtractionRate: byId("reconstructionFrameRate")?.value,
      cleanupStrength: byId("reconstructionCleanupStrength")?.value,
      targetModelQuality: byId("reconstructionTargetQuality")?.value,
      saveIntermediateFiles: Boolean(byId("reconstructionSaveIntermediateFiles")?.checked)
    });
    state.settings = settings;
    return settings;
  }

  function settingsSummary(settings) {
    const normalized = normalizeSettings(settings);
    return `${normalized.processingMode} · ${normalized.inputTypePreference} · ${normalized.maxFrames} frames · ${normalized.frameExtractionRate} fps · ${normalized.cleanupStrength} · ${normalized.targetModelQuality} · intermediates ${normalized.saveIntermediateFiles ? "on" : "off"}`;
  }

  function renderSettings(job = null) {
    const settings = normalizeSettings(job?.settings || state.settings || readSettings());
    const summary = settingsSummary(settings);
    const statusSummary = byId("reconstructionSettingsSummary");
    const resultSummary = byId("reconstructionResultSettings");
    if (statusSummary) statusSummary.textContent = summary;
    if (resultSummary) resultSummary.textContent = summary;
  }

  function setSettingsDisabled(disabled) {
    [
      "reconstructionProcessingMode",
      "reconstructionInputPreference",
      "reconstructionMaxFrames",
      "reconstructionFrameRate",
      "reconstructionCleanupStrength",
      "reconstructionTargetQuality",
      "reconstructionSaveIntermediateFiles"
    ].forEach(id => {
      const el = byId(id);
      if (el) el.disabled = disabled;
    });
  }

  function renderHistory() {
    const list = byId("reconstructionHistoryList");
    if (!list) return;

    document.querySelectorAll("#reconstructionHistoryFilters [data-filter]").forEach(button => {
      button.classList.toggle("active", button.dataset.filter === state.historyFilter);
    });

    if (!state.historyItems.length) {
      list.innerHTML = '<div class="hint">История reconstruction jobs пока пустая.</div>';
      return;
    }

    list.innerHTML = state.historyItems.map(item => {
      const status = STATUS_LABELS[item.status] || item.status || "—";
      const canOpen = item.status === "ready" && Boolean(item.resultGlbUrl);
      const quality = `${item.reconstructionQuality || "—"} / ${item.cleanupQuality || "—"}`;
      const readiness = item.readinessLevel
        ? `${item.readinessLevel}${Number.isFinite(Number(item.readinessScore)) ? ` ${Math.round(Number(item.readinessScore))}/100` : ""}`
        : "—";
      return `<div class="reconstruction-history-row" data-job-id="${escapeHtml(item.jobId)}">
        <div class="reconstruction-history-main">
          <strong>${formatDateTime(item.createdAt)}</strong>
          <div class="reconstruction-history-id">${escapeHtml(item.jobId)}</div>
        </div>
        <div class="reconstruction-history-cell">${escapeHtml(item.inputType || "unknown")}</div>
        <div class="reconstruction-history-cell"><span class="badge">${escapeHtml(status)}</span></div>
        <div class="reconstruction-history-cell">${escapeHtml(quality)}</div>
        <div class="reconstruction-history-cell">${escapeHtml(readiness)}</div>
        <div class="reconstruction-history-cell">${escapeHtml(settingsSummary(item.settings))}</div>
        <div class="reconstruction-history-cell">${Number(item.warningsCount || 0)} warnings</div>
        <div class="reconstruction-history-actions">
          <button class="btn btn-sm btn-primary" data-history-action="open" ${canOpen ? "" : "disabled"}>Open Result</button>
          <button class="btn btn-sm" data-history-action="report">View Report</button>
          <button class="btn btn-sm" data-history-action="download-report">Download Report</button>
          <button class="btn btn-sm btn-danger" data-history-action="delete">Delete</button>
        </div>
      </div>`;
    }).join("");
  }

  async function loadHistory() {
    if (!api()) return;
    try {
      state.historyItems = await api().listBackendReconstructionJobs(state.historyFilter);
      renderHistory();
    } catch (err) {
      const list = byId("reconstructionHistoryList");
      if (list) list.innerHTML = `<div class="reconstruction-error">${escapeHtml(apiErrorMessage(err, "History unavailable."))}</div>`;
    }
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
    const downloadReport = byId("btnDownloadReconstructionReport");
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
    setQualityBadge("reconstructionReadinessLevel", result?.readinessLevel || job?.readinessLevel || "");
    byId("reconstructionReadinessScore").textContent = Number.isFinite(Number(result?.readinessScore))
      ? `${Math.round(Number(result.readinessScore))}/100`
      : "—";
    byId("reconstructionCanVisualize").textContent = result?.canUseForVisualization ? "Yes" : "No";
    byId("reconstructionCanMeasure").textContent = result?.canUseForMeasurements === true
      ? "Yes"
      : result?.canUseForMeasurements === "caution"
        ? "Caution"
        : "No";
    renderQualityList("reconstructionResultWarnings", result?.warnings || []);
    renderQualityList("reconstructionReadinessWarnings", result?.readinessWarnings || []);

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
    if (downloadReport) downloadReport.style.display = showResult ? "inline-flex" : "none";
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
    renderSettings(job);
    const checklist = renderChecklist(job);

    if (start) start.disabled = !state.selectedFiles.length || !state.currentJobId || state.busy || !checklist.canStart;
    if (retry) retry.style.display = status === "error" || status === "canceled" ? "inline-flex" : "none";
    if (cancel) cancel.style.display = ACTIVE_STATUSES.has(status) && state.busy ? "inline-flex" : "none";
    setSettingsDisabled(ACTIVE_STATUSES.has(status) && state.busy);
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
        : status === "uploaded" && (checklist.overall === "failed" || checklist.overall === "warning")
          ? checklist.reason
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
        const job = await api().createBackendReconstructionJob(uploadResult, readSettings());
        state.selectedFiles = nextFiles;
        state.uploadResult = uploadResult;
        state.currentJobId = job.jobId;
        state.currentJob = job;
        state.currentResult = null;
        state.currentReport = null;
        state.lastUploadError = "";
        setError("");
        renderJob(job);
        await loadHistory();
        if (state.uploadResult?.previewReport) renderQualityReport(state.uploadResult.previewReport);
      } catch (err) {
        state.lastUploadError = apiErrorMessage(err, "Upload failed.");
        setError(state.lastUploadError);
        renderChecklist(currentJob());
        renderFiles();
      }
    } else {
      resetJobUi();
    }
  }

  async function startCurrentJob() {
    if (!api() || !state.currentJobId || state.busy) return;
    const checklist = buildChecklist(currentJob());
    if (!checklist.canStart) {
      setError(checklist.reason);
      renderChecklist(currentJob());
      return;
    }
    state.busy = true;
    state.settings = readSettings();
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
      await loadHistory();
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
      const job = await api().createBackendReconstructionJob(state.uploadResult, readSettings());
      state.currentJobId = job.jobId;
      state.currentJob = job;
      state.currentResult = null;
      state.currentReport = null;
      renderJob(job);
      await loadHistory();
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
      if (["ready", "error", "canceled"].includes(job.status)) await loadHistory();
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
      await loadHistory();
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
    state.settings = readSettings();
    state.lastUploadError = "";
    state.busy = false;
    stopJobPolling();
    const input = byId("reconstructionFileInput");
    if (input) input.value = "";
    setError("");
    resetJobUi();
    renderSettings();
  }

  async function waitFor3DViewer() {
    const started = Date.now();
    while (Date.now() - started < 5000) {
      if (window._3d && typeof window._3d.openModel === "function") return window._3d;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return null;
  }

  async function openResultUrlIn3DViewer(resultUrl, jobId, readinessLevel = "") {
    const viewer = await waitFor3DViewer();
    if (!viewer) {
      setError("3D viewer ещё не готов. Откройте вкладку 3D Модель и повторите.");
      return;
    }
    viewer.openModel(resultUrl, `reconstruction:${jobId}`);
    byId("reconstructionStageBadge").textContent = "Opened";
    if (readinessLevel === "poor") {
      setError("Модель открыта только для визуальной проверки. Для измерений требуется повторная реконструкция или ручная проверка.");
      setStatusText("Open in 3D viewer: модель открыта с readiness warning.");
    } else {
      setStatusText("Open in 3D viewer: GLB открыт в PMAS 3D viewer.");
    }
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
    await openResultUrlIn3DViewer(resultUrl, job.jobId, state.currentResult?.readinessLevel || job.readinessLevel || "");
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

  async function showReport(jobId) {
    if (!api() || !jobId) return;
    const modal = byId("reconstructionReportModal");
    const pre = byId("reconstructionReportJson");
    try {
      const report = await api().getBackendReconstructionReport(jobId);
      state.currentReport = report;
      if (pre) pre.textContent = JSON.stringify(report, null, 2);
      if (modal) modal.style.display = "flex";
    } catch (err) {
      setError(apiErrorMessage(err, "Report unavailable."));
    }
  }

  async function viewCurrentReport() {
    await showReport(state.currentJobId);
  }

  function triggerJsonDownload(report, jobId) {
    const safeJobId = String(jobId || "job").replace(/[^\w.-]+/g, "_");
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pmas-reconstruction-report-${safeJobId}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function downloadReport(jobId) {
    if (!api() || !jobId) return;
    try {
      const report = await api().getBackendReconstructionReport(jobId);
      // TODO: Future PDF/DOCX reconstruction exports should consume this report JSON, not the existing 2D/3D clinical export functions.
      triggerJsonDownload(report, jobId);
      setStatusText("Reconstruction JSON report downloaded.");
    } catch (err) {
      setError(apiErrorMessage(err, "Report download failed."));
    }
  }

  async function downloadCurrentReport() {
    await downloadReport(state.currentJobId);
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
      await loadHistory();
    } catch (err) {
      setError(apiErrorMessage(err, "Delete result failed."));
    }
  }

  async function openHistoryResult(jobId) {
    const item = state.historyItems.find(historyItem => historyItem.jobId === jobId);
    if (!item?.resultGlbUrl) {
      setError("History result GLB недоступен.");
      return;
    }
    await openResultUrlIn3DViewer(item.resultGlbUrl, item.jobId, item.readinessLevel || "");
  }

  async function deleteHistoryJob(jobId) {
    if (!api() || !jobId) return;
    try {
      await api().deleteBackendReconstructionJob(jobId);
      if (state.currentJobId === jobId) clearReconstruction();
      await loadHistory();
      setStatusText("History item deleted.");
    } catch (err) {
      setError(apiErrorMessage(err, "Delete history job failed."));
    }
  }

  async function handleHistoryClick(event) {
    const button = event.target.closest("[data-history-action]");
    if (!button) return;
    const row = button.closest("[data-job-id]");
    const jobId = row?.dataset?.jobId;
    if (!jobId) return;
    const action = button.dataset.historyAction;
    if (action === "open") await openHistoryResult(jobId);
    if (action === "report") await showReport(jobId);
    if (action === "download-report") await downloadReport(jobId);
    if (action === "delete") await deleteHistoryJob(jobId);
  }

  async function handleHistoryFilter(event) {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    state.historyFilter = button.dataset.filter || "all";
    await loadHistory();
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
    byId("btnDownloadReconstructionReport")?.addEventListener("click", downloadCurrentReport);
    byId("btnDeleteReconstructionResult")?.addEventListener("click", deleteCurrentResult);
    byId("btnStartNewReconstruction")?.addEventListener("click", clearReconstruction);
    byId("btnCloseReconstructionReport")?.addEventListener("click", closeReportModal);
    byId("reconstructionHistoryList")?.addEventListener("click", handleHistoryClick);
    byId("reconstructionHistoryFilters")?.addEventListener("click", handleHistoryFilter);
    [
      "reconstructionProcessingMode",
      "reconstructionInputPreference",
      "reconstructionMaxFrames",
      "reconstructionFrameRate",
      "reconstructionCleanupStrength",
      "reconstructionTargetQuality",
      "reconstructionSaveIntermediateFiles"
    ].forEach(id => {
      byId(id)?.addEventListener("change", () => {
        state.settings = readSettings();
        renderJob(currentJob());
      });
    });
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

    state.settings = readSettings();
    resetJobUi();
    loadHistory();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
