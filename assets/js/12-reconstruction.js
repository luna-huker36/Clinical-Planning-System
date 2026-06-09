(function () {
  const SESSION_STORAGE_KEY = "pmas.reconstruction.patient-case-session.v1";
  const ACCESS_MODE_STORAGE_KEY = "pmas.reconstruction.access-mode.v1";
  const BACKUP_META_STORAGE_KEY = "pmas.reconstruction.backup-meta.v1";
  const DEMO_CASE_ID = "demo-case-head-planning";
  const DEMO_JOB_ID = "demo-recon-head-model";
  const DEMO_MODEL_URL = "models/LeePerrySmith.glb";
  const state = {
    selectedFiles: [],
    uploadResult: null,
    currentJobId: null,
    currentJob: null,
    currentResult: null,
    currentReport: null,
    cases: [],
    currentCaseId: "",
    caseTeam: {
      ownerId: "",
      teamMembers: [],
      permissions: {}
    },
    auditEvents: [],
    auditActionFilter: "all",
    auditUserFilter: "all",
    auditDateFilter: "",
    clinicalAnalysisPresets: [],
    currentAnalysisPreset: null,
    analysisPresetReportDraft: null,
    clinicalReportTemplates: [],
    clinicalReportDraft: null,
    comparisons: [],
    comparisonModels: [],
    currentComparison: null,
    caseMeasurements: [],
    measurementTemplates: [],
    caseLandmarks: [],
    landmarkTemplates: [],
    currentLandmarkTemplateId: "",
    landmarkDetectionMode: "ai_assisted",
    activeMeasurementContext: null,
    surgicalPlanningNotes: [],
    surgicalSimulations: [],
    clinicalInsights: [],
    qaChecks: [],
    qaSummary: null,
    productionReadiness: [],
    productionReadinessSummary: null,
    releases: [],
    plugins: [],
    pluginSummary: null,
    backupPreview: null,
    backupImportDraft: null,
    caseTimeline: null,
    currentSimulation: null,
    currentSurgicalPlanId: "",
    currentCaseReport: null,
    caseDashboardSearch: "",
    caseDashboardStatusFilter: "all",
    caseDashboardSort: "updated_desc",
    historyItems: [],
    historyFilter: "all",
    historyCaseFilter: "all",
    reviewSelection: new Set(),
    reviewJobId: null,
    settings: null,
    checklist: null,
    lastUploadError: "",
    busy: false,
    pollTimer: null,
    accessMode: "demo"
  };
  state.restoreCandidate = null;
  state.restoringSession = false;
  state.autoSaveTimer = null;

  const STATUS_LABELS = {
    idle: "Idle",
    uploaded: "Uploaded",
    validating: "Validating",
    analyzing: "Analyzing",
    preparing: "Preparing",
    extracting_frames: "Extracting frames",
    analyzing_frames: "Analyzing frames",
    segmenting_head: "Segmenting head",
    review_required: "Input review",
    queued: "Queued",
    reconstructing_3d: "Reconstructing 3D",
    cleaning_mesh: "Cleaning mesh",
    aligning_model: "Aligning model",
    manual_adjustment_required: "Manual adjustment required",
    exporting: "Exporting",
    ready: "Ready",
    canceled: "Canceled",
    error: "Error",
    opened: "Opened"
  };

  const PIPELINE_ORDER = ["uploaded", "validating", "analyzing", "preparing", "extracting_frames", "analyzing_frames", "segmenting_head", "review_required", "queued", "reconstructing_3d", "cleaning_mesh", "aligning_model", "manual_adjustment_required", "exporting", "ready", "canceled"];
  const ACTIVE_STATUSES = new Set(["validating", "analyzing", "preparing", "extracting_frames", "analyzing_frames", "segmenting_head", "queued", "reconstructing_3d", "cleaning_mesh", "aligning_model", "exporting"]);
  const WAIT_STATUSES = new Set(["review_required", "manual_adjustment_required", "ready", "canceled", "error"]);
  const DEMO_CASES = Object.freeze([{
    caseId: DEMO_CASE_ID,
    patientName: "Demo Patient",
    patientId: "DEMO-001",
    createdAt: "2026-01-01T09:00:00.000Z",
    updatedAt: "2026-01-01T09:30:00.000Z",
    notes: "Demo mode sample case. Do not store real patient data.",
    reconstructionJobs: [DEMO_JOB_ID],
    reports: ["demo-case-report"],
    models: [DEMO_MODEL_URL],
    comparisons: [],
    measurements: [],
    landmarks: [],
    landmarkTemplates: [],
    surgicalPlans: [],
    simulations: [],
    ownerId: "demo-member-owner",
    teamMembers: [{
      memberId: "demo-member-owner",
      name: "Demo Owner",
      role: "owner",
      email: "demo-owner@pmas.local",
      permissions: ["view_case", "edit_case", "add_measurements", "edit_measurements", "add_notes", "export_reports", "run_reconstruction", "run_simulation"],
      createdAt: "2026-01-01T09:00:00.000Z",
      updatedAt: "2026-01-01T09:00:00.000Z"
    }],
    permissions: {
      "demo-member-owner": ["view_case", "edit_case", "add_measurements", "edit_measurements", "add_notes", "export_reports", "run_reconstruction", "run_simulation"]
    }
  }]);
  const DEMO_HISTORY = Object.freeze([{
    jobId: DEMO_JOB_ID,
    caseId: DEMO_CASE_ID,
    createdAt: "2026-01-01T09:10:00.000Z",
    status: "ready",
    inputType: "demo",
    filesCount: 1,
    resultGlbUrl: DEMO_MODEL_URL,
    reconstructionQuality: "demo",
    cleanupQuality: "demo",
    warningsCount: 1,
    readinessScore: 72,
    readinessLevel: "medium",
    settings: {
      processingMode: "balanced",
      inputTypePreference: "auto",
      maxFrames: 40,
      frameExtractionRate: 1,
      cleanupStrength: "medium",
      targetModelQuality: "preview",
      saveIntermediateFiles: false
    }
  }]);

  function byId(id) {
    return document.getElementById(id);
  }

  function api() {
    return window.PMASReconstructionApi;
  }

  function currentJob() {
    return state.currentJob || null;
  }

  function safeJsonParse(value, fallback = null) {
    try {
      return JSON.parse(value);
    } catch (err) {
      return fallback;
    }
  }

  function readSavedSession() {
    return safeJsonParse(localStorage.getItem(SESSION_STORAGE_KEY), null);
  }

  function writeSavedSession(snapshot) {
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(snapshot));
    } catch (err) {
      console.warn("Unable to save reconstruction session.", err);
    }
  }

  function clearSavedSession() {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }

  function hasRecoverableSession(snapshot) {
    return Boolean(snapshot?.caseId || snapshot?.currentJobId || snapshot?.activeMeasurementContext?.modelId || snapshot?.surgicalDraft?.hasContent || snapshot?.simulationDraft?.hasContent);
  }

  function setInputValue(id, value) {
    const el = byId(id);
    if (el) el.value = value ?? "";
  }

  function setCheckboxValue(id, value) {
    const el = byId(id);
    if (el) el.checked = Boolean(value);
  }

  function isDemoMode() {
    return state.accessMode === "demo";
  }

  function isDoctorMode() {
    return state.accessMode === "doctor";
  }

  function isAdminMode() {
    return state.accessMode === "admin";
  }

  function canSavePatientData() {
    return isDoctorMode() || isAdminMode();
  }

  function readAccessMode() {
    const saved = localStorage.getItem(ACCESS_MODE_STORAGE_KEY);
    return ["demo", "doctor", "admin"].includes(saved) ? saved : "demo";
  }

  function writeAccessMode(mode) {
    localStorage.setItem(ACCESS_MODE_STORAGE_KEY, mode);
  }

  function modeDescription() {
    if (isDemoMode()) return "Demo mode: test cases and model viewing only. Real patient data is not saved.";
    if (isDoctorMode()) return "Doctor mode: patient cases, measurements, surgical notes, and case reports are enabled.";
    return "Admin mode: doctor workflow plus reconstruction settings, engine settings, and debug/report logs.";
  }

  function setModeBlocked(message) {
    setError(message);
    setStatusText(message);
  }

  function readComparisonDraft() {
    return {
      beforeJobId: byId("comparisonBeforeModel")?.value || "",
      afterJobId: byId("comparisonAfterModel")?.value || "",
      comparisonMode: byId("comparisonMode")?.value || "show_before",
      notes: byId("comparisonNotes")?.value || ""
    };
  }

  function applyComparisonDraft(draft = {}) {
    setInputValue("comparisonBeforeModel", draft.beforeJobId || "");
    setInputValue("comparisonAfterModel", draft.afterJobId || "");
    setInputValue("comparisonMode", draft.comparisonMode || "show_before");
    setInputValue("comparisonNotes", draft.notes || "");
    renderComparisonDetails();
  }

  function readSurgicalDraftForSession() {
    const draft = {
      ...readSurgicalPlanningForm(),
      planId: state.currentSurgicalPlanId || ""
    };
    draft.hasContent = Boolean([
      draft.title,
      draft.diagnosis,
      draft.procedureType,
      draft.goals,
      draft.risks,
      draft.notes
    ].some(value => String(value || "").trim()));
    return draft;
  }

  function readSimulationDraftForSession() {
    const draft = readSurgicalSimulationForm();
    draft.hasContent = Boolean(draft.jobId || draft.simulationType !== "nasal_adjustment" || Object.values(draft.parameters || {}).some(value => String(value || "").trim() && String(value) !== "0" && String(value) !== "1"));
    return draft;
  }

  function readSelectedFileDraft() {
    return state.selectedFiles.map(file => ({
      name: file.name || "",
      size: file.size || 0,
      type: file.type || file.mimetype || "",
      lastModified: file.lastModified || null
    }));
  }

  function buildSessionSnapshot() {
    // TODO: In backend mode, mirror this local snapshot to server-side persistence once auth/user sessions exist.
    const job = currentJob();
    const snapshot = {
      version: 1,
      savedAt: new Date().toISOString(),
      mode: api()?.mode || "mock",
      accessMode: state.accessMode,
      caseId: state.currentCaseId || "",
      currentJobId: state.currentJobId || job?.jobId || "",
      currentJobStatus: job?.status || "",
      activeMeasurementContext: state.activeMeasurementContext || null,
      selectedFiles: readSelectedFileDraft(),
      settings: state.settings || readSettings(),
      reviewDraft: {
        jobId: state.reviewJobId || "",
        selectedFrames: Array.from(state.reviewSelection || [])
      },
      manualAdjustmentDraft: readManualAdjustmentValues(),
      surgicalDraft: readSurgicalDraftForSession(),
      simulationDraft: readSimulationDraftForSession(),
      comparisonDraft: readComparisonDraft(),
      currentComparisonId: state.currentComparison?.comparisonId || "",
      dashboardDraft: {
        search: state.caseDashboardSearch || "",
        statusFilter: state.caseDashboardStatusFilter || "all",
        sort: state.caseDashboardSort || "updated_desc"
      },
      historyDraft: {
        statusFilter: state.historyFilter || "all",
        caseFilter: state.historyCaseFilter || "all"
      },
      measurementsCount: state.caseMeasurements.length,
      landmarksCount: state.caseLandmarks.length,
      surgicalNotesCount: state.surgicalPlanningNotes.length,
      surgicalSimulationsCount: state.surgicalSimulations.length,
      timelineEntriesCount: state.caseTimeline?.entries?.length || 0,
      teamMembersCount: state.caseTeam?.teamMembers?.length || 0
    };
    return snapshot;
  }

  function saveCurrentSessionNow() {
    if (state.restoringSession) return;
    const snapshot = buildSessionSnapshot();
    if (hasRecoverableSession(snapshot)) writeSavedSession(snapshot);
  }

  function scheduleSessionAutoSave() {
    if (state.restoringSession) return;
    window.clearTimeout(state.autoSaveTimer);
    state.autoSaveTimer = window.setTimeout(saveCurrentSessionNow, 250);
  }

  function renderSessionRecoveryPrompt(snapshot = state.restoreCandidate) {
    const box = byId("reconstructionSessionRecovery");
    const summary = byId("reconstructionSessionRecoverySummary");
    if (!box) return;
    if (!hasRecoverableSession(snapshot)) {
      box.style.display = "none";
      return;
    }
    const caseItem = state.cases.find(item => item.caseId === snapshot.caseId);
    const patient = caseItem?.patientName || snapshot.caseId || "last case";
    const savedAt = formatDateTime(snapshot.savedAt);
    if (summary) {
      summary.textContent = `${patient} · ${snapshot.currentJobStatus || "draft"} · saved ${savedAt}`;
    }
    box.style.display = "flex";
  }

  function hideSessionRecoveryPrompt() {
    const box = byId("reconstructionSessionRecovery");
    if (box) box.style.display = "none";
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
      list.innerHTML = '<div class="hint">Файлы ещё не выбраны.</div>';
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

  function frameName(frame) {
    return String(frame?.fileName || frame?.name || "").trim();
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

  function applySettingsDraft(settings = {}) {
    const normalized = normalizeSettings(settings);
    setInputValue("reconstructionProcessingMode", normalized.processingMode);
    setInputValue("reconstructionInputPreference", normalized.inputTypePreference);
    setInputValue("reconstructionMaxFrames", String(normalized.maxFrames));
    setInputValue("reconstructionFrameRate", String(normalized.frameExtractionRate));
    setInputValue("reconstructionCleanupStrength", normalized.cleanupStrength);
    setInputValue("reconstructionTargetQuality", normalized.targetModelQuality);
    setCheckboxValue("reconstructionSaveIntermediateFiles", normalized.saveIntermediateFiles);
    state.settings = normalized;
    renderSettings();
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

  function currentCase() {
    return state.cases.find(item => item.caseId === state.currentCaseId) || null;
  }

  const TEAM_ROLES = ["owner", "surgeon", "assistant", "viewer"];

  function teamRoleLabel(role) {
    return String(role || "viewer").replace(/_/g, " ");
  }

  function renderCaseTeam() {
    const summary = byId("caseTeamSummary");
    const list = byId("caseTeamList");
    const members = state.caseTeam?.teamMembers || [];
    const owner = members.find(member => member.memberId === state.caseTeam?.ownerId) || members.find(member => member.role === "owner");
    if (summary) {
      summary.textContent = state.currentCaseId
        ? `owner ${owner?.name || "not assigned"} · ${members.length} member(s)`
        : "Select a case to manage team access.";
    }
    if (!list) return;
    if (!members.length) {
      list.innerHTML = '<div class="hint">No team members yet.</div>';
      return;
    }
    list.innerHTML = members.map(member => `
      <div class="reconstruction-history-row" data-team-member-id="${escapeHtml(member.memberId)}">
        <div class="reconstruction-history-main">
          <strong>${escapeHtml(member.name || "Team member")}</strong>
          <div class="reconstruction-history-id">${escapeHtml(member.email || "no email")}</div>
          <div class="reconstruction-history-id">${escapeHtml(member.memberId)}</div>
        </div>
        <div class="reconstruction-history-cell">
          <select class="reconstruction-setting-control" data-team-role ${member.memberId === state.caseTeam?.ownerId ? "disabled" : ""}>
            ${TEAM_ROLES.map(role => `<option value="${escapeHtml(role)}" ${role === member.role ? "selected" : ""}>${escapeHtml(teamRoleLabel(role))}</option>`).join("")}
          </select>
        </div>
        <div class="reconstruction-history-cell">${escapeHtml((member.permissions || []).join(", ") || "view_case")}</div>
        <div class="reconstruction-history-actions">
          <button class="btn btn-sm" data-team-action="change-role" ${member.memberId === state.caseTeam?.ownerId ? "disabled" : ""}>change role</button>
          <button class="btn btn-sm btn-danger" data-team-action="remove" ${member.memberId === state.caseTeam?.ownerId ? "disabled" : ""}>remove</button>
        </div>
      </div>
    `).join("");
  }

  const AUDIT_ACTION_LABELS = {
    case_created: "case created",
    case_updated: "case updated",
    model_uploaded: "model uploaded",
    reconstruction_started: "reconstruction started",
    reconstruction_completed: "reconstruction completed",
    landmark_added: "landmark added",
    landmark_updated: "landmark updated",
    measurement_added: "measurement added",
    measurement_updated: "measurement updated",
    note_updated: "note updated",
    report_exported: "report exported",
    simulation_created: "simulation created",
    team_member_added: "team member added",
    team_member_removed: "team member removed",
    insight_created: "insight created",
    insight_acknowledged: "insight acknowledged",
    backup_created: "backup created",
    backup_imported: "backup imported",
    backup_restored: "backup restored",
    qa_run: "QA run",
    qa_issue_resolved: "QA issue resolved",
    readiness_check_run: "readiness check run",
    release_action: "release action",
    plugin_enabled: "plugin enabled",
    plugin_disabled: "plugin disabled",
    plugin_registered: "plugin registered"
  };

  const INSIGHT_CATEGORY_LABELS = {
    facial_analysis: "facial analysis",
    symmetry: "symmetry",
    measurements: "measurements",
    reconstruction_quality: "reconstruction quality",
    landmark_quality: "landmark quality",
    planning: "planning",
    custom: "custom"
  };

  const INSIGHT_SEVERITY_LABELS = {
    info: "info",
    warning: "warning",
    attention: "attention"
  };

  function renderAuditFilters() {
    const actionSelect = byId("auditActionFilter");
    const userSelect = byId("auditUserFilter");
    const dateInput = byId("auditDateFilter");
    if (actionSelect) actionSelect.value = state.auditActionFilter || "all";
    if (dateInput) dateInput.value = state.auditDateFilter || "";
    if (userSelect) {
      const users = Array.from(new Map((state.auditEvents || []).map(event => [
        event.userId || "local-user",
        event.userName || event.userId || "Local User"
      ])).entries());
      userSelect.innerHTML = ['<option value="all">All users</option>']
        .concat(users.map(([userId, userName]) => `<option value="${escapeHtml(userId)}">${escapeHtml(userName)}</option>`))
        .join("");
      userSelect.value = users.some(([userId]) => userId === state.auditUserFilter) ? state.auditUserFilter : "all";
    }
  }

  function renderAuditLog() {
    const summary = byId("auditLogSummary");
    const list = byId("auditLogList");
    const events = state.auditEvents || [];
    if (summary) {
      summary.textContent = state.currentCaseId
        ? `${events.length} event(s) · action ${state.auditActionFilter || "all"} · user ${state.auditUserFilter || "all"}`
        : "Select a case to view activity.";
    }
    renderAuditFilters();
    if (!list) return;
    if (!events.length) {
      list.innerHTML = '<div class="hint">No audit events yet.</div>';
      return;
    }
    list.innerHTML = events.map(event => `
      <div class="reconstruction-history-row" data-audit-event-id="${escapeHtml(event.eventId)}">
        <div class="reconstruction-history-main">
          <strong>${escapeHtml(AUDIT_ACTION_LABELS[event.action] || event.action || "case updated")}</strong>
          <div class="reconstruction-history-id">${escapeHtml(formatDateTime(event.timestamp))}</div>
          <div class="reconstruction-history-id">${escapeHtml(event.eventId)}</div>
        </div>
        <div class="reconstruction-history-cell">${escapeHtml(event.userName || event.userId || "Local User")}</div>
        <div class="reconstruction-history-cell">${escapeHtml(event.entityType || "case")}</div>
        <div class="reconstruction-history-cell">${escapeHtml(event.entityId || "—")}</div>
      </div>
    `).join("");
  }

  async function loadAuditLog() {
    if (isDemoMode()) {
      state.auditEvents = state.currentCaseId === DEMO_CASE_ID
        ? [{
          eventId: "audit-demo-case-created",
          caseId: DEMO_CASE_ID,
          userId: "demo-member-owner",
          userName: "Demo Owner",
          action: "case_created",
          entityType: "case",
          entityId: DEMO_CASE_ID,
          timestamp: DEMO_CASES[0].createdAt,
          details: { mode: "demo" }
        }]
        : [];
      renderAuditLog();
      return;
    }
    if (!api()?.listCaseAuditEvents || !state.currentCaseId) {
      state.auditEvents = [];
      renderAuditLog();
      return;
    }
    try {
      state.auditEvents = await api().listCaseAuditEvents(state.currentCaseId, {
        action: state.auditActionFilter || "all",
        userId: state.auditUserFilter || "all",
        date: state.auditDateFilter || ""
      });
      renderAuditLog();
    } catch (err) {
      state.auditEvents = [];
      renderAuditLog();
      setError(apiErrorMessage(err, "Audit log unavailable."));
    }
  }

  async function handleAuditFilterChange() {
    state.auditActionFilter = byId("auditActionFilter")?.value || "all";
    state.auditUserFilter = byId("auditUserFilter")?.value || "all";
    state.auditDateFilter = byId("auditDateFilter")?.value || "";
    await loadAuditLog();
    scheduleSessionAutoSave();
  }

  function readBackupMeta() {
    return safeJsonParse(localStorage.getItem(BACKUP_META_STORAGE_KEY), { count: 0, lastBackup: null });
  }

  function writeBackupMeta(meta) {
    try {
      localStorage.setItem(BACKUP_META_STORAGE_KEY, JSON.stringify(meta));
    } catch (err) {
      console.warn("Unable to save backup metadata.", err);
    }
  }

  function renderBackupRecovery() {
    const summary = byId("backupRecoverySummary");
    const previewBox = byId("backupPreviewBox");
    const meta = readBackupMeta();
    if (summary) {
      const last = meta.lastBackup;
      summary.textContent = last
        ? `last backup ${formatDateTime(last.createdAt)} · ${last.casesCount || 0} cases · ${last.modelsCount || 0} models · backups exported ${meta.count || 0}`
        : `No local backup exported yet · backups exported ${meta.count || 0}`;
    }
    if (!previewBox) return;
    const preview = state.backupPreview;
    if (!preview) {
      previewBox.innerHTML = '<div class="hint">Import preview will appear here.</div>';
      return;
    }
    const cases = preview.casePreview || [];
    previewBox.innerHTML = `
      <div class="reconstruction-history-row">
        <div class="reconstruction-history-main">
          <strong>PMAS Backup ${escapeHtml(preview.version || "—")}</strong>
          <div class="reconstruction-history-id">${escapeHtml(preview.backupId || "backup")} · ${escapeHtml(formatDateTime(preview.createdAt))}</div>
          <div class="reconstruction-history-id">checksum ${escapeHtml(String(preview.checksum || "").slice(0, 16))}... · file ${Math.round(Number(preview.fileSize || 0) / 1024)} KB</div>
        </div>
        <div class="reconstruction-history-cell">${Number(preview.casesCount || 0)} cases</div>
        <div class="reconstruction-history-cell">${Number(preview.modelsCount || 0)} models</div>
        <div class="reconstruction-history-cell">${Number(preview.reportsCount || 0)} reports</div>
      </div>
      ${cases.length ? cases.map(item => `
        <label class="reconstruction-history-row" data-backup-case-id="${escapeHtml(item.caseId)}">
          <div class="reconstruction-history-main">
            <strong><input type="checkbox" data-backup-case-check value="${escapeHtml(item.caseId)}" checked /> ${escapeHtml(item.patientName || "Unnamed patient")}</strong>
            <div class="reconstruction-history-id">${escapeHtml(item.caseId)} · ${escapeHtml(item.patientId || "no patient id")}</div>
          </div>
          <div class="reconstruction-history-cell">${Number(item.jobsCount || 0)} jobs</div>
          <div class="reconstruction-history-cell">${Number(item.modelsCount || 0)} models</div>
          <div class="reconstruction-history-cell">${Number(item.reportsCount || 0)} reports</div>
        </label>
      `).join("") : '<div class="hint">Backup contains no patient cases.</div>'}
    `;
  }

  function downloadBackupJson(backup) {
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeId = String(backup?.backupId || "pmas-backup").replace(/[^\w.-]+/g, "_");
    link.href = url;
    link.download = `${safeId}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function exportFullBackup() {
    if (!api()?.exportFullBackup) return;
    try {
      const backup = await api().exportFullBackup();
      downloadBackupJson(backup);
      const meta = readBackupMeta();
      writeBackupMeta({ count: Number(meta.count || 0) + 1, lastBackup: backup });
      state.backupPreview = {
        backupId: backup.backupId,
        version: backup.version,
        createdAt: backup.createdAt,
        casesCount: backup.casesCount,
        modelsCount: backup.modelsCount,
        reportsCount: backup.reportsCount,
        fileSize: backup.fileSize,
        checksum: backup.checksum,
        casePreview: (backup.payload?.data?.cases || []).map(item => ({
          caseId: item.caseId,
          patientName: item.patientName || "",
          patientId: item.patientId || "",
          jobsCount: Number(item.reconstructionJobs?.length || 0),
          modelsCount: Number(item.models?.length || 0),
          reportsCount: Number(item.reports?.length || 0)
        }))
      };
      state.backupImportDraft = backup;
      renderBackupRecovery();
      await loadAuditLog();
      setStatusText("Full PMAS backup exported.");
    } catch (err) {
      setError(apiErrorMessage(err, "Backup export failed."));
    }
  }

  function readBackupImportDraftFromText() {
    const text = byId("backupImportText")?.value || "";
    if (!text.trim()) return state.backupImportDraft;
    return safeJsonParse(text, null);
  }

  async function previewImportedBackup() {
    if (!api()?.previewBackup) return;
    const draft = readBackupImportDraftFromText();
    if (!draft) {
      setError("Paste or import a PMAS Backup JSON first.");
      return;
    }
    try {
      const result = await api().previewBackup(draft);
      state.backupPreview = result.preview;
      state.backupImportDraft = draft;
      renderBackupRecovery();
      setStatusText("Backup preview validated.");
    } catch (err) {
      state.backupPreview = err.preview || null;
      renderBackupRecovery();
      setError(apiErrorMessage(err, "Backup preview failed."));
    }
  }

  async function restoreImportedBackup() {
    if (!api()?.restoreBackup) return;
    const draft = state.backupImportDraft || readBackupImportDraftFromText();
    if (!draft || !state.backupPreview) {
      setError("Preview a valid PMAS Backup JSON before restore.");
      return;
    }
    const mode = byId("backupRestoreMode")?.value || "full";
    const caseIds = Array.from(document.querySelectorAll("[data-backup-case-check]:checked")).map(input => input.value);
    if (mode === "selected" && !caseIds.length) {
      setError("Select at least one case to restore.");
      return;
    }
    try {
      const result = await api().restoreBackup(draft, { mode, caseIds });
      state.currentCaseId = result.caseIds?.[0] || "";
      state.currentCaseReport = null;
      await loadCases();
      await Promise.all([
        loadComparisonModels(),
        loadComparisons(),
        loadHistory(),
        loadCaseTeam(),
        loadAuditLog(),
        loadClinicalInsights(),
        loadQaDashboard(),
        loadProductionReadiness(),
        loadReleases(),
        loadPlugins(),
        loadSurgicalPlanningNotes(),
        loadSurgicalSimulations(),
        loadCaseTimeline(),
        loadCaseLandmarks(),
        loadLandmarkTemplates()
      ]);
      renderBackupRecovery();
      renderClinicalReportBuilder();
      setStatusText(`Backup restored: ${result.restoredCasesCount || 0} case(s).`);
      scheduleSessionAutoSave();
    } catch (err) {
      setError(apiErrorMessage(err, "Backup restore failed."));
    }
  }

  async function handleBackupFileImport(event) {
    const file = event.target?.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setInputValue("backupImportText", text);
      state.backupImportDraft = safeJsonParse(text, null);
      await previewImportedBackup();
    } catch (err) {
      setError("Backup file could not be read.");
    } finally {
      event.target.value = "";
    }
  }

  function computeQaSummary(checks = state.qaChecks || []) {
    const active = checks.filter(item => !item.resolved);
    const warningsCount = active.filter(item => item.status === "warning").length;
    const failuresCount = active.filter(item => item.status === "failed").length;
    const passedCount = active.filter(item => item.status === "passed").length;
    const criticalCount = active.filter(item => item.severity === "critical").length;
    const qaScore = Math.max(0, Math.min(100, 100 - failuresCount * 18 - warningsCount * 7 - criticalCount * 15));
    return {
      qaScore,
      readinessLevel: qaScore >= 90 ? "excellent" : qaScore >= 75 ? "good" : qaScore >= 50 ? "medium" : "poor",
      warningsCount,
      failuresCount,
      passedCount,
      checksCount: active.length
    };
  }

  function qaBadgeClass(levelOrStatus) {
    if (levelOrStatus === "excellent" || levelOrStatus === "good" || levelOrStatus === "passed") return "badge-success";
    if (levelOrStatus === "poor" || levelOrStatus === "failed" || levelOrStatus === "critical") return "badge-danger";
    return "badge-info";
  }

  function renderQaDashboard() {
    const summary = state.qaSummary || computeQaSummary();
    const list = byId("qaChecksList");
    const summaryEl = byId("qaDashboardSummary");
    if (summaryEl) {
      summaryEl.textContent = state.currentCaseId
        ? `${summary.checksCount || 0} check(s) · technical/product validation only`
        : "Select a patient case to run technical QA checks.";
    }
    byId("qaScoreValue").textContent = Number.isFinite(Number(summary.qaScore)) ? `${Math.round(Number(summary.qaScore))}/100` : "—";
    const badge = byId("qaReadinessBadge");
    if (badge) {
      badge.className = `badge ${qaBadgeClass(summary.readinessLevel)}`;
      badge.textContent = summary.readinessLevel || "—";
    }
    byId("qaWarningsCount").textContent = String(summary.warningsCount || 0);
    byId("qaFailuresCount").textContent = String(summary.failuresCount || 0);
    byId("qaPassedCount").textContent = String(summary.passedCount || 0);
    if (!list) return;
    const checks = state.qaChecks || [];
    if (!checks.length) {
      list.innerHTML = '<div class="hint">No QA checks yet.</div>';
      return;
    }
    list.innerHTML = checks.map(check => `
      <div class="reconstruction-history-row ${check.resolved ? "is-muted" : ""}" data-qa-check-id="${escapeHtml(check.checkId)}">
        <div class="reconstruction-history-main">
          <strong>${escapeHtml(check.title || "QA check")}</strong>
          <div class="reconstruction-history-id">${escapeHtml(check.description || "—")}</div>
          <div class="reconstruction-history-id">${escapeHtml(check.checkId)} · ${escapeHtml(formatDateTime(check.createdAt))}</div>
        </div>
        <div class="reconstruction-history-cell"><span class="badge ${escapeHtml(qaBadgeClass(check.status))}">${escapeHtml(check.status || "warning")}</span></div>
        <div class="reconstruction-history-cell">${escapeHtml(check.category || "system")}</div>
        <div class="reconstruction-history-cell">${escapeHtml(check.severity || "medium")}</div>
        <div class="reconstruction-history-actions">
          <button class="btn btn-sm" data-qa-action="resolve" ${check.resolved || check.status === "passed" ? "disabled" : ""}>resolve</button>
        </div>
      </div>
    `).join("");
  }

  async function loadQaDashboard() {
    if (!api()?.listQaChecks || !state.currentCaseId) {
      state.qaChecks = [];
      state.qaSummary = null;
      renderQaDashboard();
      return;
    }
    try {
      state.qaChecks = await api().listQaChecks(state.currentCaseId, { status: "all" });
      state.qaSummary = computeQaSummary(state.qaChecks);
      renderQaDashboard();
    } catch (err) {
      state.qaChecks = [];
      state.qaSummary = null;
      renderQaDashboard();
      setError(apiErrorMessage(err, "QA checks unavailable."));
    }
  }

  async function runQaValidationFromUi() {
    if (!api()?.runQaValidation || !state.currentCaseId) {
      setError("Select a patient case before running QA validation.");
      return;
    }
    try {
      const result = await api().runQaValidation(state.currentCaseId);
      state.qaChecks = result.checks || [];
      state.qaSummary = result.summary || computeQaSummary(state.qaChecks);
      renderQaDashboard();
      await loadAuditLog();
      await loadCaseTimeline();
      state.currentCaseReport = null;
      renderClinicalReportBuilder();
      setStatusText("QA validation completed.");
    } catch (err) {
      setError(apiErrorMessage(err, "QA validation failed."));
    }
  }

  async function handleQaCheckClick(event) {
    const button = event.target.closest("[data-qa-action]");
    if (!button || !api()?.resolveQaCheck) return;
    const row = button.closest("[data-qa-check-id]");
    const checkId = row?.dataset?.qaCheckId || "";
    if (!checkId) return;
    try {
      await api().resolveQaCheck(checkId);
      await loadQaDashboard();
      await loadAuditLog();
      await loadCaseTimeline();
      state.currentCaseReport = null;
      renderClinicalReportBuilder();
      setStatusText("QA issue marked as resolved.");
    } catch (err) {
      setError(apiErrorMessage(err, "QA issue resolve failed."));
    }
  }

  function computeProductionReadinessSummary(items = state.productionReadiness || []) {
    const passedChecks = items.reduce((sum, item) => sum + Number(item.passedChecks || 0), 0);
    const failedChecks = items.reduce((sum, item) => sum + Number(item.failedChecks || 0), 0);
    const warnings = items.reduce((sum, item) => sum + Number(item.warnings || 0), 0);
    const productionScore = items.length
      ? Math.round(items.reduce((sum, item) => sum + Number(item.productionScore || item.score || 0), 0) / items.length)
      : 0;
    return {
      productionScore,
      readinessLevel: productionScore >= 90 ? "production_ready" : productionScore >= 75 ? "ready" : productionScore >= 50 ? "limited" : "not_ready",
      passedChecks,
      failedChecks,
      warnings,
      scopes: items.length
    };
  }

  function productionReadinessBadgeClass(levelOrStatus) {
    if (levelOrStatus === "production_ready" || levelOrStatus === "ready" || levelOrStatus === "passed") return "badge-success";
    if (levelOrStatus === "not_ready" || levelOrStatus === "failed") return "badge-danger";
    return "badge-info";
  }

  function renderProductionReadiness() {
    const summary = state.productionReadinessSummary || computeProductionReadinessSummary();
    const summaryEl = byId("productionReadinessSummary");
    const list = byId("productionReadinessList");
    if (summaryEl) {
      summaryEl.textContent = state.currentCaseId
        ? `${summary.scopes || 0} scope(s) · internal PMAS readiness only`
        : "Select a patient case to check working readiness.";
    }
    byId("productionScoreValue").textContent = Number.isFinite(Number(summary.productionScore)) ? `${Math.round(Number(summary.productionScore))}/100` : "—";
    const badge = byId("productionReadinessBadge");
    if (badge) {
      badge.className = `badge ${productionReadinessBadgeClass(summary.readinessLevel)}`;
      badge.textContent = summary.readinessLevel || "—";
    }
    byId("productionPassedCount").textContent = String(summary.passedChecks || 0);
    byId("productionWarningsCount").textContent = String(summary.warnings || 0);
    byId("productionFailuresCount").textContent = String(summary.failedChecks || 0);
    if (!list) return;
    const items = state.productionReadiness || [];
    if (!items.length) {
      list.innerHTML = '<div class="hint">No production readiness checks yet.</div>';
      return;
    }
    list.innerHTML = items.map(item => `
      <div class="reconstruction-history-row" data-readiness-id="${escapeHtml(item.readinessId)}">
        <div class="reconstruction-history-main">
          <strong>${escapeHtml(String(item.scope || "case").replace(/_/g, " "))}</strong>
          <div class="reconstruction-history-id">${escapeHtml(item.readinessId)} · ${escapeHtml(formatDateTime(item.createdAt))}</div>
          <div class="reconstruction-history-id">${Number(item.checks?.length || 0)} check(s) · model ${escapeHtml(item.modelId || "—")}</div>
        </div>
        <div class="reconstruction-history-cell"><span class="badge ${escapeHtml(productionReadinessBadgeClass(item.level || item.readinessLevel))}">${escapeHtml(item.level || item.readinessLevel || "limited")}</span></div>
        <div class="reconstruction-history-cell">${Math.round(Number(item.score || item.productionScore || 0))}/100</div>
        <div class="reconstruction-history-cell">passed ${Number(item.passedChecks || 0)} · warnings ${Number(item.warnings || 0)} · failed ${Number(item.failedChecks || 0)}</div>
      </div>
      ${(item.checks || []).map(check => `
        <div class="reconstruction-history-row is-muted">
          <div class="reconstruction-history-main">
            <strong>${escapeHtml(check.title || "Readiness check")}</strong>
            <div class="reconstruction-history-id">${escapeHtml(check.description || "—")}</div>
          </div>
          <div class="reconstruction-history-cell"><span class="badge ${escapeHtml(productionReadinessBadgeClass(check.status))}">${escapeHtml(check.status || "warning")}</span></div>
          <div class="reconstruction-history-cell">${escapeHtml(check.scope || item.scope || "case")}</div>
          <div class="reconstruction-history-cell"></div>
        </div>
      `).join("")}
    `).join("");
  }

  async function loadProductionReadiness() {
    if (!api()?.listProductionReadiness || !state.currentCaseId) {
      state.productionReadiness = [];
      state.productionReadinessSummary = null;
      renderProductionReadiness();
      return;
    }
    try {
      state.productionReadiness = await api().listProductionReadiness(state.currentCaseId, { scope: "all" });
      state.productionReadinessSummary = computeProductionReadinessSummary(state.productionReadiness);
      renderProductionReadiness();
    } catch (err) {
      state.productionReadiness = [];
      state.productionReadinessSummary = null;
      renderProductionReadiness();
      setError(apiErrorMessage(err, "Production readiness unavailable."));
    }
  }

  async function runProductionReadinessFromUi() {
    if (!api()?.runProductionReadiness || !state.currentCaseId) {
      setError("Select a patient case before running production readiness.");
      return;
    }
    try {
      const result = await api().runProductionReadiness(state.currentCaseId);
      state.productionReadiness = result.readiness || [];
      state.productionReadinessSummary = result.summary || computeProductionReadinessSummary(state.productionReadiness);
      renderProductionReadiness();
      await loadAuditLog();
      await loadCaseTimeline();
      state.currentCaseReport = null;
      renderClinicalReportBuilder();
      setStatusText("Production readiness check completed.");
    } catch (err) {
      setError(apiErrorMessage(err, "Production readiness check failed."));
    }
  }

  const RELEASE_STATUS_LABELS = {
    draft: "draft",
    testing: "testing",
    release_candidate: "release candidate",
    approved: "approved",
    archived: "archived"
  };

  function releaseBadgeClass(status) {
    if (status === "approved" || status === "release_candidate") return "badge-success";
    if (status === "archived") return "badge-danger";
    return "badge-info";
  }

  function readReleaseForm() {
    return {
      version: byId("releaseVersion")?.value || "v0.1",
      name: byId("releaseName")?.value || "",
      status: byId("releaseStatus")?.value || "draft",
      description: byId("releaseDescription")?.value || "",
      notes: byId("releaseNotes")?.value || ""
    };
  }

  function renderReleaseManager() {
    const list = byId("releaseManagerList");
    const summary = byId("releaseManagerSummary");
    const releases = state.releases || [];
    const active = releases.filter(item => item.status !== "archived");
    if (summary) {
      summary.textContent = `${releases.length} release(s) · ${active.length} active · internal PMAS version snapshots`;
    }
    if (!list) return;
    if (!releases.length) {
      list.innerHTML = '<div class="hint">No releases yet.</div>';
      return;
    }
    list.innerHTML = releases.map(release => `
      <div class="reconstruction-history-row" data-release-id="${escapeHtml(release.releaseId)}">
        <div class="reconstruction-history-main">
          <strong>${escapeHtml(release.version || "v0.1")} · ${escapeHtml(release.name || "PMAS release")}</strong>
          <div class="reconstruction-history-id">${escapeHtml(release.releaseId)} · ${escapeHtml(formatDateTime(release.createdAt))}</div>
          <div class="reconstruction-history-id">${escapeHtml(release.description || release.notes || "—")}</div>
        </div>
        <div class="reconstruction-history-cell"><span class="badge ${escapeHtml(releaseBadgeClass(release.status))}">${escapeHtml(RELEASE_STATUS_LABELS[release.status] || release.status || "draft")}</span></div>
        <div class="reconstruction-history-cell">QA ${Math.round(Number(release.qaScore || 0))}/100</div>
        <div class="reconstruction-history-cell">readiness ${Math.round(Number(release.readinessScore || 0))}/100</div>
        <div class="reconstruction-history-actions">
          <button class="btn btn-sm" data-release-action="promote" ${release.status === "release_candidate" || release.status === "approved" || release.status === "archived" ? "disabled" : ""}>candidate</button>
          <button class="btn btn-sm" data-release-action="clone">clone</button>
          <button class="btn btn-sm" data-release-action="export">export</button>
          <button class="btn btn-sm btn-danger" data-release-action="archive" ${release.status === "archived" ? "disabled" : ""}>archive</button>
        </div>
      </div>
      ${(release.validation?.checks || []).map(check => `
        <div class="reconstruction-history-row is-muted">
          <div class="reconstruction-history-main">
            <strong>${escapeHtml(check.title || "Release check")}</strong>
            <div class="reconstruction-history-id">${escapeHtml(check.description || "—")}</div>
          </div>
          <div class="reconstruction-history-cell"><span class="badge ${escapeHtml(check.status === "passed" ? "badge-success" : "badge-danger")}">${escapeHtml(check.status || "failed")}</span></div>
          <div class="reconstruction-history-cell"></div>
          <div class="reconstruction-history-cell"></div>
        </div>
      `).join("")}
    `).join("");
  }

  async function loadReleases() {
    if (!api()?.listReleases) {
      state.releases = [];
      renderReleaseManager();
      return;
    }
    try {
      state.releases = await api().listReleases({ status: "all" });
      renderReleaseManager();
    } catch (err) {
      state.releases = [];
      renderReleaseManager();
      setError(apiErrorMessage(err, "Release Manager unavailable."));
    }
  }

  async function createReleaseFromUi() {
    if (!api()?.createRelease) return;
    try {
      const release = await api().createRelease(readReleaseForm());
      await loadReleases();
      await loadAuditLog();
      await loadCaseTimeline();
      setStatusText(`Release created: ${release.version} · ${release.status}`);
    } catch (err) {
      setError(apiErrorMessage(err, "Release creation failed."));
    }
  }

  function downloadReleaseReport(report) {
    const releaseId = String(report?.release?.releaseId || "release").replace(/[^\w.-]+/g, "_");
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pmas-release-summary-${releaseId}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function handleReleaseClick(event) {
    const button = event.target.closest("[data-release-action]");
    if (!button) return;
    const row = button.closest("[data-release-id]");
    const releaseId = row?.dataset?.releaseId || "";
    if (!releaseId) return;
    const action = button.dataset.releaseAction;
    try {
      if (action === "promote") {
        const release = await api().updateReleaseStatus(releaseId, "release_candidate");
        if (release.validation?.blocked) {
          state.releases = [release, ...state.releases.filter(item => item.releaseId !== release.releaseId)];
          renderReleaseManager();
          setError("Release validation failed. Resolve failed checks before promotion.");
          return;
        }
        setStatusText("Release promoted to release_candidate.");
      }
      if (action === "archive") {
        await api().archiveRelease(releaseId);
        setStatusText("Release archived.");
      }
      if (action === "clone") {
        await api().cloneRelease(releaseId);
        setStatusText("Release cloned as draft.");
      }
      if (action === "export") {
        const report = await api().getReleaseReport(releaseId);
        downloadReleaseReport(report);
        setStatusText("Release Summary Report exported.");
      }
      await loadReleases();
      await loadAuditLog();
      await loadCaseTimeline();
    } catch (err) {
      const blocked = err.release || err.details || null;
      if (blocked?.validation?.checks) {
        state.releases = [blocked, ...state.releases.filter(item => item.releaseId !== blocked.releaseId)];
        renderReleaseManager();
      }
      setError(apiErrorMessage(err, "Release action failed."));
    }
  }

  function pluginBadgeClass(plugin) {
    if (!plugin?.enabled) return "badge-danger";
    if (plugin.builtIn) return "badge-success";
    return "badge-info";
  }

  function readPluginForm() {
    return {
      pluginId: byId("pluginIdInput")?.value || "",
      name: byId("pluginNameInput")?.value || "",
      version: byId("pluginVersionInput")?.value || "v1",
      category: byId("pluginCategoryInput")?.value || "custom",
      author: byId("pluginAuthorInput")?.value || "",
      description: byId("pluginDescriptionInput")?.value || "",
      compatibleVersion: "v1",
      extensionPoints: (byId("pluginExtensionPointsInput")?.value || "")
        .split(",")
        .map(item => item.trim())
        .filter(Boolean),
      dependencies: []
    };
  }

  function renderPluginManager() {
    const list = byId("pluginManagerList");
    const summary = byId("pluginManagerSummary");
    const plugins = state.plugins || [];
    const pluginSummary = state.pluginSummary || {};
    if (summary) {
      summary.textContent = `${pluginSummary.pluginsCount || plugins.length} plugin(s) · ${pluginSummary.enabledCount || plugins.filter(item => item.enabled).length} enabled · ${pluginSummary.builtInCount || plugins.filter(item => item.builtIn).length} built-in`;
    }
    if (!list) return;
    if (!plugins.length) {
      list.innerHTML = '<div class="hint">No plugins registered.</div>';
      return;
    }
    list.innerHTML = plugins.map(plugin => `
      <div class="reconstruction-history-row" data-plugin-id="${escapeHtml(plugin.pluginId)}">
        <div class="reconstruction-history-main">
          <strong>${escapeHtml(plugin.name || "PMAS Plugin")}</strong>
          <div class="reconstruction-history-id">${escapeHtml(plugin.pluginId)} · ${escapeHtml(plugin.author || "Unknown")}</div>
          <div class="reconstruction-history-id">${escapeHtml(plugin.description || "—")}</div>
        </div>
        <div class="reconstruction-history-cell">${escapeHtml(plugin.version || "v1")}</div>
        <div class="reconstruction-history-cell">${escapeHtml(plugin.category || "custom")}</div>
        <div class="reconstruction-history-cell"><span class="badge ${escapeHtml(pluginBadgeClass(plugin))}">${plugin.enabled ? "enabled" : "disabled"}${plugin.builtIn ? " · built-in" : ""}</span></div>
        <div class="reconstruction-history-actions">
          <button class="btn btn-sm" data-plugin-action="enable" ${plugin.enabled ? "disabled" : ""}>enable</button>
          <button class="btn btn-sm" data-plugin-action="disable" ${!plugin.enabled ? "disabled" : ""}>disable</button>
          <button class="btn btn-sm btn-danger" data-plugin-action="unregister" ${plugin.builtIn ? "disabled" : ""}>unregister</button>
        </div>
      </div>
      <div class="reconstruction-history-row is-muted">
        <div class="reconstruction-history-main">
          <strong>Extension points</strong>
          <div class="reconstruction-history-id">${escapeHtml((plugin.extensionPoints || []).join(", ") || "none")}</div>
        </div>
        <div class="reconstruction-history-cell">API ${escapeHtml(plugin.compatibleVersion || "v1")}</div>
        <div class="reconstruction-history-cell">deps ${(plugin.dependencies || []).length}</div>
        <div class="reconstruction-history-cell"></div>
      </div>
    `).join("");
  }

  async function loadPlugins() {
    if (!api()?.listPlugins) {
      state.plugins = [];
      state.pluginSummary = null;
      renderPluginManager();
      return;
    }
    try {
      const result = await api().listPlugins({ category: "all", enabled: "all" });
      state.plugins = result.plugins || [];
      state.pluginSummary = result.summary || null;
      renderPluginManager();
    } catch (err) {
      state.plugins = [];
      state.pluginSummary = null;
      renderPluginManager();
      setError(apiErrorMessage(err, "Plugin Manager unavailable."));
    }
  }

  async function registerPluginFromUi() {
    if (!api()?.registerPlugin) return;
    try {
      const plugin = await api().registerPlugin(readPluginForm());
      setInputValue("pluginIdInput", "");
      setInputValue("pluginNameInput", "");
      setInputValue("pluginAuthorInput", "");
      setInputValue("pluginDescriptionInput", "");
      setInputValue("pluginExtensionPointsInput", "");
      await loadPlugins();
      await loadAuditLog();
      setStatusText(`Plugin registered: ${plugin.name}`);
    } catch (err) {
      setError(apiErrorMessage(err, "Plugin registration failed."));
    }
  }

  async function handlePluginClick(event) {
    const button = event.target.closest("[data-plugin-action]");
    if (!button) return;
    const row = button.closest("[data-plugin-id]");
    const pluginId = row?.dataset?.pluginId || "";
    if (!pluginId) return;
    try {
      if (button.dataset.pluginAction === "enable") {
        await api().enablePlugin(pluginId);
        setStatusText("Plugin enabled.");
      }
      if (button.dataset.pluginAction === "disable") {
        await api().disablePlugin(pluginId);
        setStatusText("Plugin disabled.");
      }
      if (button.dataset.pluginAction === "unregister") {
        await api().unregisterPlugin(pluginId);
        setStatusText("Plugin unregistered.");
      }
      await loadPlugins();
      await loadAuditLog();
    } catch (err) {
      setError(apiErrorMessage(err, "Plugin action failed."));
    }
  }

  function insightSeverityClass(severity) {
    if (severity === "warning") return "badge-danger";
    if (severity === "attention") return "badge-info";
    return "";
  }

  function renderClinicalInsights() {
    const summary = byId("clinicalInsightsSummary");
    const list = byId("clinicalInsightsList");
    const insights = state.clinicalInsights || [];
    const active = insights.filter(item => !item.dismissed);
    if (summary) {
      summary.textContent = state.currentCaseId
        ? `${active.length} active observation(s) · ${insights.filter(item => item.pinned).length} pinned · ${insights.filter(item => item.reviewed).length} reviewed`
        : "Select a patient case to generate structured observations.";
    }
    if (!list) return;
    if (!insights.length) {
      list.innerHTML = '<div class="hint">No clinical insights yet.</div>';
      return;
    }
    list.innerHTML = insights.map(insight => `
      <div class="reconstruction-history-row ${insight.dismissed ? "is-muted" : ""}" data-insight-id="${escapeHtml(insight.insightId)}">
        <div class="reconstruction-history-main">
          <strong>${escapeHtml(insight.pinned ? `PIN · ${insight.title}` : insight.title)}</strong>
          <div class="reconstruction-history-id">${escapeHtml(insight.description || "—")}</div>
          <div class="reconstruction-history-id">${escapeHtml(insight.insightId)} · ${escapeHtml(formatDateTime(insight.createdAt))}</div>
        </div>
        <div class="reconstruction-history-cell">
          <span class="badge ${escapeHtml(insightSeverityClass(insight.severity))}">${escapeHtml(INSIGHT_SEVERITY_LABELS[insight.severity] || insight.severity || "info")}</span>
        </div>
        <div class="reconstruction-history-cell">${escapeHtml(INSIGHT_CATEGORY_LABELS[insight.category] || insight.category || "custom")}</div>
        <div class="reconstruction-history-cell">${escapeHtml(insight.source || "clinical_insights_engine")}</div>
        <div class="reconstruction-history-actions">
          <button class="btn btn-sm" data-insight-action="review" ${insight.reviewed ? "disabled" : ""}>reviewed</button>
          <button class="btn btn-sm" data-insight-action="pin">${insight.pinned ? "unpin" : "pin"}</button>
          <button class="btn btn-sm btn-danger" data-insight-action="dismiss" ${insight.dismissed ? "disabled" : ""}>dismiss</button>
        </div>
      </div>
    `).join("");
  }

  async function loadClinicalInsights(options = {}) {
    if (isDemoMode()) {
      state.clinicalInsights = state.currentCaseId === DEMO_CASE_ID ? [{
        insightId: "demo-insight-readiness",
        caseId: DEMO_CASE_ID,
        modelId: DEMO_MODEL_URL,
        category: "reconstruction_quality",
        severity: "attention",
        title: "Readiness score требует внимания.",
        description: "Demo observation: readiness 72/100 should be reviewed before planning use.",
        source: "demo:readiness",
        createdAt: DEMO_HISTORY[0].createdAt,
        reviewed: false,
        dismissed: false,
        pinned: false
      }] : [];
      renderClinicalInsights();
      return;
    }
    if (!api()?.listClinicalInsights || !state.currentCaseId) {
      state.clinicalInsights = [];
      renderClinicalInsights();
      return;
    }
    try {
      if (options.generate && api().generateClinicalInsights) {
        state.clinicalInsights = await api().generateClinicalInsights(state.currentCaseId);
      } else {
        state.clinicalInsights = await api().listClinicalInsights(state.currentCaseId, { status: "active" });
      }
      renderClinicalInsights();
    } catch (err) {
      state.clinicalInsights = [];
      renderClinicalInsights();
      setError(apiErrorMessage(err, "Clinical insights unavailable."));
    }
  }

  async function generateClinicalInsightsFromUi() {
    if (!state.currentCaseId) {
      setError("Select a patient case before generating clinical insights.");
      return;
    }
    if (isDemoMode()) {
      setStatusText("Demo mode shows sample clinical insights only.");
      await loadClinicalInsights();
      return;
    }
    await loadClinicalInsights({ generate: true });
    await loadAuditLog();
    await loadCaseTimeline();
    state.currentCaseReport = null;
    renderClinicalReportBuilder();
    setStatusText("Clinical insights generated.");
  }

  async function handleClinicalInsightClick(event) {
    const button = event.target.closest("[data-insight-action]");
    if (!button || !api()?.updateClinicalInsight) return;
    const row = button.closest("[data-insight-id]");
    const insightId = row?.dataset?.insightId || "";
    const existing = state.clinicalInsights.find(item => item.insightId === insightId);
    if (!existing) return;
    if (isDemoMode()) {
      setStatusText("Demo mode: clinical insight actions are disabled.");
      return;
    }
    const action = button.dataset.insightAction;
    const changes = action === "review"
      ? { reviewed: true }
      : action === "dismiss"
        ? { dismissed: true }
        : { pinned: !existing.pinned };
    try {
      await api().updateClinicalInsight(insightId, changes);
      await loadClinicalInsights();
      await loadAuditLog();
      await loadCaseTimeline();
      state.currentCaseReport = null;
      renderClinicalReportBuilder();
      setStatusText("Clinical insight updated.");
    } catch (err) {
      setError(apiErrorMessage(err, "Clinical insight update failed."));
    }
  }

  function renderCaseSummary() {
    const box = byId("reconstructionCaseSummary");
    if (!box) return;
    const caseItem = currentCase();
    updateCaseReportButtons();
    if (!caseItem) {
      box.innerHTML = '<div class="hint">Select or create a case before reconstruction.</div>';
      renderCaseTeam();
      return;
    }
    box.innerHTML = [
      ["Patient", caseItem.patientName || "—"],
      ["Case ID", caseItem.caseId || "—"],
      ["Created", formatDateTime(caseItem.createdAt)],
      ["Jobs", String(caseItem.reconstructionJobs?.length || 0)],
      ["Models", String(caseItem.models?.length || 0)],
      ["Simulations", String(caseItem.simulations?.length || 0)],
      ["Timeline", String(state.caseTimeline?.entries?.length || 0)],
      ["Team", String(state.caseTeam?.teamMembers?.length || caseItem.teamMembers?.length || 0)],
      ["Plans", String(caseItem.surgicalPlans?.length || 0)]
    ].map(([label, value]) => `<div class="reconstruction-case-stat"><span class="label-sm">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
    renderComparisonOptions();
    renderCaseTeam();
    renderClinicalReportBuilder();
    scheduleSessionAutoSave();
  }

  function updateCaseReportButtons() {
    const hasCase = Boolean(state.currentCaseId);
    ["btnViewCaseReport", "btnDownloadCaseJsonReport"].forEach(id => {
      const button = byId(id);
      if (button) button.disabled = !hasCase || (id === "btnDownloadCaseJsonReport" && isDemoMode());
    });
    const pdf = byId("btnExportCasePdfReport");
    if (pdf) pdf.disabled = !hasCase || !window.jspdf?.jsPDF || isDemoMode();
    const docxButton = byId("btnExportCaseDocxReport");
    if (docxButton) docxButton.disabled = !hasCase || !window.docx || isDemoMode();
  }

  function renderAccessModeUi() {
    const select = byId("reconstructionAccessMode");
    if (select) select.value = state.accessMode;
    const description = byId("reconstructionModeDescription");
    if (description) description.textContent = modeDescription();
    const warning = byId("reconstructionDemoWarning");
    if (warning) warning.style.display = isDemoMode() ? "block" : "none";
    const watermark = byId("reconstructionDemoWatermark");
    if (watermark) watermark.style.display = isDemoMode() ? "block" : "none";
    const adminDebug = byId("reconstructionAdminDebug");
    if (adminDebug) adminDebug.style.display = isAdminMode() ? "block" : "none";
    const settingsCard = byId("reconstructionSettingsCard");
    if (settingsCard) settingsCard.classList.toggle("reconstruction-admin-locked", !isAdminMode());
    setSettingsDisabled(!isAdminMode());
    ["btnCreateReconstructionCase", "btnStartReconstruction", "btnDashboardCreateCase"].forEach(id => {
      const button = byId(id);
      if (button) button.disabled = isDemoMode();
    });
    renderChecklist(currentJob());
    updateCaseReportButtons();
    renderAdminDebugLog();
  }

  function renderAdminDebugLog() {
    const summary = byId("adminDebugSummary");
    const log = byId("adminDebugLog");
    if (!isAdminMode()) return;
    if (summary) summary.textContent = `mode ${state.accessMode} · jobs ${state.historyItems.length} · cases ${state.cases.length}`;
    if (log) {
      log.textContent = JSON.stringify({
        mode: state.accessMode,
        currentCaseId: state.currentCaseId,
        currentJobId: state.currentJobId,
        currentJobStatus: currentJob()?.status || "",
        activeModel: state.activeMeasurementContext || null,
        reportsLoaded: Boolean(state.currentReport || state.currentCaseReport),
        reconstructionMode: api()?.mode || "mock"
      }, null, 2);
    }
  }

  function caseJobs(caseId) {
    return state.historyItems.filter(item => item.caseId === caseId);
  }

  function caseLastStatus(caseId) {
    const jobs = caseJobs(caseId)
      .slice()
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    return jobs[0]?.status || "no_jobs";
  }

  function caseDashboardRows() {
    const search = state.caseDashboardSearch.trim().toLowerCase();
    const statusFilter = state.caseDashboardStatusFilter || "all";
    const rows = state.cases
      .map(caseItem => ({
        ...caseItem,
        lastStatus: caseLastStatus(caseItem.caseId),
        jobs: caseJobs(caseItem.caseId)
      }))
      .filter(caseItem => {
        if (!search) return true;
        return String(caseItem.patientName || "").toLowerCase().includes(search)
          || String(caseItem.patientId || "").toLowerCase().includes(search);
      })
      .filter(caseItem => statusFilter === "all" || caseItem.lastStatus === statusFilter);
    rows.sort((a, b) => {
      const direction = state.caseDashboardSort === "updated_asc" ? 1 : -1;
      return direction * String(a.updatedAt || "").localeCompare(String(b.updatedAt || ""));
    });
    return rows;
  }

  function renderCaseDashboard() {
    const list = byId("caseDashboardList");
    const search = byId("caseDashboardSearch");
    const status = byId("caseDashboardStatusFilter");
    const sort = byId("caseDashboardSort");
    if (search) search.value = state.caseDashboardSearch;
    if (status) status.value = state.caseDashboardStatusFilter;
    if (sort) sort.value = state.caseDashboardSort;
    if (!list) return;

    const rows = caseDashboardRows();
    if (!rows.length) {
      list.innerHTML = '<div class="hint">No patient cases match the current filters.</div>';
      return;
    }

    list.innerHTML = rows.map(caseItem => {
      const lastStatus = caseItem.lastStatus === "no_jobs"
        ? "No jobs"
        : (STATUS_LABELS[caseItem.lastStatus] || caseItem.lastStatus);
      return `<div class="reconstruction-history-row" data-case-id="${escapeHtml(caseItem.caseId)}">
        <div class="reconstruction-history-main">
          <strong>${escapeHtml(caseItem.patientName || "Unnamed patient")}</strong>
          <div class="reconstruction-history-id">patient ${escapeHtml(caseItem.patientId || "—")}</div>
          <div class="reconstruction-history-id">case ${escapeHtml(caseItem.caseId)}</div>
        </div>
        <div class="reconstruction-history-cell">${escapeHtml(formatDateTime(caseItem.createdAt))}</div>
        <div class="reconstruction-history-cell">${escapeHtml(formatDateTime(caseItem.updatedAt))}</div>
        <div class="reconstruction-history-cell">${Number(caseItem.models?.length || 0)} models</div>
        <div class="reconstruction-history-cell">${Number(caseItem.measurements?.length || 0)} measurements</div>
        <div class="reconstruction-history-cell">${Number(caseItem.landmarks?.length || 0)} landmarks</div>
        <div class="reconstruction-history-cell">${Number(caseItem.reports?.length || 0)} reports</div>
        <div class="reconstruction-history-cell"><span class="badge">${escapeHtml(lastStatus)}</span></div>
        <div class="reconstruction-history-actions">
          <button class="btn btn-sm btn-primary" data-case-action="open">Open Case</button>
          <button class="btn btn-sm" data-case-action="export" ${isDemoMode() ? "disabled" : ""}>Export Case Report</button>
          <button class="btn btn-sm btn-danger" data-case-action="delete" ${isDemoMode() ? "disabled" : ""}>Delete Case</button>
        </div>
      </div>`;
    }).join("");
  }

  function readyCaseModels() {
    return state.comparisonModels;
  }

  function modelOptionLabel(item) {
    const score = Number.isFinite(Number(item.readinessScore)) ? ` · ${Math.round(Number(item.readinessScore))}/100` : "";
    return `${formatDateTime(item.createdAt)} · ${item.jobId}${score}`;
  }

  function selectedComparisonModel(id) {
    const jobId = byId(id)?.value || "";
    return readyCaseModels().find(item => item.jobId === jobId) || null;
  }

  function renderComparisonModelDetails(targetId, item) {
    const el = byId(targetId);
    if (!el) return;
    if (!item) {
      el.textContent = "—";
      return;
    }
    const score = Number.isFinite(Number(item.readinessScore)) ? `${Math.round(Number(item.readinessScore))}/100` : "—";
    el.innerHTML = [
      `<div><strong>${escapeHtml(item.jobId)}</strong></div>`,
      `<div>Date: ${escapeHtml(formatDateTime(item.createdAt))}</div>`,
      `<div>Readiness: ${escapeHtml(item.readinessLevel || "—")} ${escapeHtml(score)}</div>`,
      `<div>Warnings: ${Number(item.warningsCount || 0)}</div>`
    ].join("");
  }

  function renderComparisonOptions() {
    const beforeSelect = byId("comparisonBeforeModel");
    const afterSelect = byId("comparisonAfterModel");
    if (!beforeSelect || !afterSelect) return;
    const currentBefore = beforeSelect.value;
    const currentAfter = afterSelect.value;
    const models = readyCaseModels();
    const options = ['<option value="">Select model...</option>']
      .concat(models.map(item => `<option value="${escapeHtml(item.jobId)}">${escapeHtml(modelOptionLabel(item))}</option>`));
    beforeSelect.innerHTML = options.join("");
    afterSelect.innerHTML = options.join("");
    beforeSelect.value = models.some(item => item.jobId === currentBefore) ? currentBefore : "";
    afterSelect.value = models.some(item => item.jobId === currentAfter) ? currentAfter : "";
    renderComparisonDetails();
    renderSurgicalPlanningModelOptions();
    renderSurgicalSimulationModelOptions();
  }

  function renderComparisonDetails() {
    const before = selectedComparisonModel("comparisonBeforeModel");
    const after = selectedComparisonModel("comparisonAfterModel");
    const summary = byId("comparisonSummary");
    if (summary) {
      summary.textContent = state.currentCaseId
        ? `${readyCaseModels().length} ready model(s) available in this case.`
        : "Select a case before creating a comparison.";
    }
    renderComparisonModelDetails("comparisonBeforeDetails", before);
    renderComparisonModelDetails("comparisonAfterDetails", after);
  }

  function measurementValueText(item) {
    const unit = item?.unit ? ` ${item.unit}` : "";
    if (!Number.isFinite(Number(item?.value))) return "—";
    const value = Number(item.value);
    return `${value.toFixed(item.type === "angle" ? 1 : 4)}${unit}`;
  }

  function measurementSourceLandmarkText(item) {
    const names = [item.fromLandmark, item.toLandmark, item.optionalThirdLandmark].filter(Boolean);
    if (names.length) return names.join(", ");
    if (!Array.isArray(item.landmarksUsed) || !item.landmarksUsed.length) return "";
    return item.landmarksUsed.map(id => {
      const landmark = state.caseLandmarks.find(candidate => candidate.landmarkId === id);
      return landmark?.name || id;
    }).join(", ");
  }

  function renderCaseMeasurements() {
    const summary = byId("caseMeasurementsSummary");
    const list = byId("caseMeasurementsList");
    const context = state.activeMeasurementContext;
    if (summary) {
      summary.textContent = context?.caseId
        ? `case ${context.caseId} · model ${context.jobId || "—"} · ${state.caseMeasurements.length} measurement(s)`
        : "Open a model from a case to load measurements.";
    }
    if (!list) return;
    if (!state.caseMeasurements.length) {
      list.innerHTML = '<div class="hint">No case measurements yet.</div>';
      return;
    }
    list.innerHTML = state.caseMeasurements.map(item => `
      <div class="reconstruction-history-row" data-measurement-id="${escapeHtml(item.measurementId)}">
        <div class="reconstruction-history-main">
          <strong>${escapeHtml(item.label || item.type || "Measurement")}</strong>
          <div class="reconstruction-history-id">${escapeHtml(item.measurementId)}</div>
          ${item.templateName ? `<div class="reconstruction-history-id">template: ${escapeHtml(item.templateName)}</div>` : ""}
          ${measurementSourceLandmarkText(item) ? `<div class="reconstruction-history-id">landmarks: ${escapeHtml(measurementSourceLandmarkText(item))}</div>` : ""}
          ${item.warnings?.length ? `<div class="reconstruction-history-id">warning: ${escapeHtml(item.warnings.join("; "))}</div>` : ""}
        </div>
        <div class="reconstruction-history-cell">${escapeHtml(item.type || "—")}</div>
        <div class="reconstruction-history-cell">${escapeHtml(measurementValueText(item))}</div>
        <div class="reconstruction-history-cell">${escapeHtml(item.status || "ready")}</div>
        <div class="reconstruction-history-cell">${escapeHtml(item.source || "manual")}</div>
        <div class="reconstruction-history-actions">
          <button class="btn btn-sm" data-measurement-action="edit-label">edit label</button>
          <button class="btn btn-sm btn-danger" data-measurement-action="delete">delete</button>
        </div>
      </div>
    `).join("");
  }

  async function loadCaseMeasurements(context = state.activeMeasurementContext, syncViewer = true) {
    if (!api()?.listCaseMeasurements || !context?.caseId || !context?.jobId || !context?.modelId) {
      state.caseMeasurements = [];
      renderCaseMeasurements();
      renderMeasurementTemplates();
      renderClinicalAnalysisPresets();
      return;
    }
    try {
      state.caseMeasurements = await api().listCaseMeasurements(context);
      renderCaseMeasurements();
      renderMeasurementTemplates();
      renderClinicalAnalysisPresets();
      if (syncViewer && window._3d?.loadCaseMeasurements) {
        window._3d.loadCaseMeasurements(state.caseMeasurements);
      }
    } catch (err) {
      setError(apiErrorMessage(err, "Measurements unavailable."));
    }
  }

  async function handleMeasurementBridge(payload = {}) {
    const context = state.activeMeasurementContext;
    const measurement = payload.measurement || {};
    if (!context?.caseId || !context?.jobId || !context?.modelId || !measurement.measurementId) return;
    if (isDemoMode()) {
      setStatusText("Demo mode: measurement tools are available, but measurements are not saved.");
      return;
    }
    try {
      if (payload.action === "delete") {
        await api().deleteCaseMeasurement(measurement.measurementId);
      } else {
        await api().saveCaseMeasurement({
          ...measurement,
          caseId: context.caseId,
          jobId: context.jobId,
          modelId: context.modelId
        });
      }
      await loadCaseMeasurements(context, false);
      await loadClinicalInsights({ generate: true });
      scheduleSessionAutoSave();
    } catch (err) {
      setError(apiErrorMessage(err, "Measurement save failed."));
    }
  }

  async function handleMeasurementAction(event) {
    const button = event.target.closest("[data-measurement-action]");
    if (!button || !api()) return;
    const row = button.closest("[data-measurement-id]");
    const measurementId = row?.dataset?.measurementId;
    if (!measurementId) return;
    try {
      if (button.dataset.measurementAction === "delete") {
        await api().deleteCaseMeasurement(measurementId);
      }
      if (button.dataset.measurementAction === "edit-label") {
        const existing = state.caseMeasurements.find(item => item.measurementId === measurementId);
        const label = window.prompt("Measurement label", existing?.label || "");
        if (label === null) return;
        await api().updateCaseMeasurementLabel(measurementId, label);
      }
      await loadCaseMeasurements(state.activeMeasurementContext, true);
      await loadClinicalInsights({ generate: true });
      setStatusText("Case measurements updated.");
      scheduleSessionAutoSave();
    } catch (err) {
      setError(apiErrorMessage(err, "Measurement update failed."));
    }
  }

  const DEFAULT_MEASUREMENT_TEMPLATES = Object.freeze([
    {
      templateId: "measurement-template-facial-basic",
      name: "Facial Basic Measurements",
      category: "facial",
      description: "Core distances from basic facial landmarks.",
      requiredLandmarks: ["Nasion", "Pronasale", "Pogonion", "Left Zygion", "Right Zygion"],
      measurements: [
        { measurementName: "Nasion to Pronasale", type: "distance", fromLandmark: "Nasion", toLandmark: "Pronasale", formula: "distance", unit: "model units", description: "Nasal projection reference distance." },
        { measurementName: "Pronasale to Pogonion", type: "distance", fromLandmark: "Pronasale", toLandmark: "Pogonion", formula: "distance", unit: "model units", description: "Midface to chin soft tissue distance." },
        { measurementName: "Bizygomatic width", type: "distance", fromLandmark: "Left Zygion", toLandmark: "Right Zygion", formula: "distance", unit: "model units", description: "Facial width estimate." }
      ]
    },
    {
      templateId: "measurement-template-nasal-analysis",
      name: "Nasal Analysis Measurements",
      category: "nasal",
      description: "Nasal profile distances and angle.",
      requiredLandmarks: ["Nasion", "Rhinion", "Pronasale", "Subnasale"],
      measurements: [
        { measurementName: "Nasal dorsum length", type: "distance", fromLandmark: "Nasion", toLandmark: "Rhinion", formula: "distance", unit: "model units", description: "Upper nasal dorsum length." },
        { measurementName: "Tip projection", type: "distance", fromLandmark: "Subnasale", toLandmark: "Pronasale", formula: "distance", unit: "model units", description: "Nasal tip projection." },
        { measurementName: "Nasolabial angle", type: "angle", fromLandmark: "Pronasale", toLandmark: "Nasion", optionalThirdLandmark: "Subnasale", formula: "angle", unit: "deg", description: "Approximate profile angle using Subnasale as vertex." }
      ]
    },
    {
      templateId: "measurement-template-orthognathic",
      name: "Orthognathic Measurements",
      category: "orthodontic",
      description: "Jaw relation and lower face references.",
      requiredLandmarks: ["Subnasale", "Pogonion", "Menton", "Left Gonion", "Right Gonion"],
      measurements: [
        { measurementName: "Lower facial height", type: "distance", fromLandmark: "Subnasale", toLandmark: "Menton", formula: "distance", unit: "model units", description: "Lower facial vertical reference." },
        { measurementName: "Mandibular width", type: "distance", fromLandmark: "Left Gonion", toLandmark: "Right Gonion", formula: "distance", unit: "model units", description: "Mandibular transverse width." },
        { measurementName: "Chin vector", type: "vector", fromLandmark: "Subnasale", toLandmark: "Pogonion", formula: "vector_magnitude", unit: "model units", description: "Soft tissue chin vector magnitude." }
      ]
    },
    {
      templateId: "measurement-template-maxillofacial",
      name: "Maxillofacial Measurements",
      category: "maxillofacial",
      description: "Broader craniofacial contour and symmetry references.",
      requiredLandmarks: ["Nasion", "Left Orbitale", "Right Orbitale", "Menton"],
      measurements: [
        { measurementName: "Orbital width", type: "distance", fromLandmark: "Left Orbitale", toLandmark: "Right Orbitale", formula: "distance", unit: "model units", description: "Orbital transverse reference." },
        { measurementName: "Facial height", type: "distance", fromLandmark: "Nasion", toLandmark: "Menton", formula: "distance", unit: "model units", description: "Upper-to-lower facial height." },
        { measurementName: "Height to orbital width ratio", type: "ratio", fromLandmark: "Nasion", toLandmark: "Menton", formula: "Nasion-Menton/Left Orbitale-Right Orbitale", unit: "ratio", description: "Simple proportional index." }
      ]
    },
    {
      templateId: "measurement-template-custom",
      name: "Custom Measurements",
      category: "custom",
      description: "Starter custom measurement set.",
      requiredLandmarks: ["Custom Point 1"],
      measurements: [
        { measurementName: "Custom point marker", type: "custom", fromLandmark: "Custom Point 1", toLandmark: "Custom Point 1", formula: "point", unit: "", description: "Template placeholder measurement." }
      ]
    }
  ]);

  const DEFAULT_CLINICAL_ANALYSIS_PRESETS = Object.freeze([
    {
      presetId: "analysis-preset-facial-basic",
      name: "Facial Basic Analysis",
      category: "facial",
      description: "Basic facial landmarking, distances, and case report draft.",
      landmarkTemplateId: "template-facial-basic",
      measurementTemplateId: "measurement-template-facial-basic",
      reportTemplateId: "case-report-facial-basic",
      requiredModelQuality: "medium",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    {
      presetId: "analysis-preset-nasal",
      name: "Nasal Analysis",
      category: "nasal",
      description: "Nasal landmark proposals, nasal measurements, and report draft.",
      landmarkTemplateId: "template-nasal-analysis",
      measurementTemplateId: "measurement-template-nasal-analysis",
      reportTemplateId: "case-report-nasal",
      requiredModelQuality: "medium",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    {
      presetId: "analysis-preset-orthognathic",
      name: "Orthognathic Planning",
      category: "orthodontic",
      description: "Orthognathic landmark proposals, jaw measurements, and planning report draft.",
      landmarkTemplateId: "template-orthognathic-analysis",
      measurementTemplateId: "measurement-template-orthognathic",
      reportTemplateId: "case-report-orthognathic",
      requiredModelQuality: "good",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    {
      presetId: "analysis-preset-maxillofacial",
      name: "Maxillofacial Analysis",
      category: "maxillofacial",
      description: "Maxillofacial landmarks, proportional measurements, and report draft.",
      landmarkTemplateId: "template-maxillofacial-analysis",
      measurementTemplateId: "measurement-template-maxillofacial",
      reportTemplateId: "case-report-maxillofacial",
      requiredModelQuality: "good",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    {
      presetId: "analysis-preset-custom",
      name: "Custom Analysis",
      category: "custom",
      description: "Custom landmark and measurement starter workflow.",
      landmarkTemplateId: "template-custom",
      measurementTemplateId: "measurement-template-custom",
      reportTemplateId: "case-report-custom",
      requiredModelQuality: "medium",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
  ]);

  const CLINICAL_REPORT_SECTIONS = Object.freeze([
    { sectionId: "case_info", label: "Patient / Case Info" },
    { sectionId: "case_team", label: "Case Team" },
    { sectionId: "case_audit", label: "Audit Summary" },
    { sectionId: "backup_status", label: "Backup Status" },
    { sectionId: "qa_summary", label: "QA Summary" },
    { sectionId: "production_readiness", label: "Production Readiness Summary" },
    { sectionId: "reconstruction_summary", label: "Reconstruction Summary" },
    { sectionId: "model_readiness", label: "Model Readiness" },
    { sectionId: "landmarks_summary", label: "Landmarks Summary" },
    { sectionId: "measurements_summary", label: "Measurements Summary" },
    { sectionId: "clinical_insights", label: "Clinical Insights" },
    { sectionId: "case_timeline", label: "Case Timeline" },
    { sectionId: "before_after_comparison", label: "Before / After Comparison" },
    { sectionId: "surgical_simulation", label: "Surgical Simulation" },
    { sectionId: "surgical_planning_notes", label: "Surgical Planning Notes" },
    { sectionId: "warnings", label: "Warnings" },
    { sectionId: "doctor_notes", label: "Doctor Notes" }
  ]);

  const DEFAULT_REPORT_TEMPLATES = Object.freeze([
    {
      reportTemplateId: "case-report-facial-basic",
      name: "Facial Basic Clinical Report",
      category: "facial",
      sections: CLINICAL_REPORT_SECTIONS.map(item => item.sectionId),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    {
      reportTemplateId: "case-report-nasal",
      name: "Nasal Analysis Clinical Report",
      category: "nasal",
      sections: CLINICAL_REPORT_SECTIONS.map(item => item.sectionId),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    {
      reportTemplateId: "case-report-orthognathic",
      name: "Orthognathic Planning Clinical Report",
      category: "orthodontic",
      sections: CLINICAL_REPORT_SECTIONS.map(item => item.sectionId),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    {
      reportTemplateId: "case-report-maxillofacial",
      name: "Maxillofacial Clinical Report",
      category: "maxillofacial",
      sections: CLINICAL_REPORT_SECTIONS.map(item => item.sectionId),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    {
      reportTemplateId: "case-report-custom",
      name: "Custom Clinical Report",
      category: "custom",
      sections: CLINICAL_REPORT_SECTIONS.map(item => item.sectionId),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
  ]);

  function qualityScoreRequirement(quality) {
    if (quality === "good") return 80;
    if (quality === "medium") return 50;
    return 0;
  }

  function activeReadinessScore() {
    const job = currentJob();
    const result = state.currentResult;
    const contextJob = state.historyItems.find(item => item.jobId === state.activeMeasurementContext?.jobId);
    return Number(result?.readinessScore ?? job?.readinessScore ?? contextJob?.readinessScore ?? 0);
  }

  function analysisPresetWarnings(preset) {
    const warnings = [];
    const context = state.activeMeasurementContext || {};
    if (!context.caseId || !context.jobId || !context.modelId) warnings.push("Open a case model first.");
    const score = activeReadinessScore();
    const requiredScore = qualityScoreRequirement(preset.requiredModelQuality);
    if (score && score < requiredScore) warnings.push(`Readiness score ${Math.round(score)}/100 is below ${preset.requiredModelQuality}.`);
    if (!score && requiredScore) warnings.push(`Model readiness is unknown; ${preset.requiredModelQuality} quality is recommended.`);
    return warnings;
  }

  function presetTemplateDetails(preset) {
    const landmarkTemplate = state.landmarkTemplates.find(item => item.templateId === preset.landmarkTemplateId);
    const measurementTemplate = (state.measurementTemplates.length ? state.measurementTemplates : DEFAULT_MEASUREMENT_TEMPLATES)
      .find(item => item.templateId === preset.measurementTemplateId);
    return { landmarkTemplate, measurementTemplate };
  }

  function renderClinicalAnalysisPresets() {
    const list = byId("clinicalAnalysisPresetsList");
    const summary = byId("clinicalAnalysisPresetsSummary");
    const presets = state.clinicalAnalysisPresets.length ? state.clinicalAnalysisPresets : DEFAULT_CLINICAL_ANALYSIS_PRESETS;
    if (summary) {
      summary.textContent = state.activeMeasurementContext?.caseId
        ? `${presets.length} preset(s) available · readiness ${Math.round(activeReadinessScore() || 0)}/100`
        : "Open a case model to apply a clinical analysis preset.";
    }
    if (!list) return;
    list.innerHTML = presets.map(preset => {
      const { landmarkTemplate, measurementTemplate } = presetTemplateDetails(preset);
      const warnings = analysisPresetWarnings(preset);
      return `
        <div class="reconstruction-history-row" data-analysis-preset-id="${escapeHtml(preset.presetId)}">
          <div class="reconstruction-history-main">
            <strong>${escapeHtml(preset.name)}</strong>
            <div class="reconstruction-history-id">${escapeHtml(preset.description || "")}</div>
            <div class="reconstruction-history-id">landmarks: ${escapeHtml((landmarkTemplate?.landmarks || []).map(item => item.landmarkName).join(", ") || "template missing")}</div>
          </div>
          <div class="reconstruction-history-cell">${escapeHtml(preset.category || "custom")}</div>
          <div class="reconstruction-history-cell">${Number(measurementTemplate?.measurements?.length || 0)} measurements</div>
          <div class="reconstruction-history-cell">quality: ${escapeHtml(preset.requiredModelQuality || "medium")}${warnings.length ? ` · ${escapeHtml(warnings.join(" "))}` : ""}</div>
          <div class="reconstruction-history-actions">
            <button class="btn btn-sm" data-analysis-preset-action="apply">apply</button>
          </div>
        </div>
      `;
    }).join("");
  }

  async function applyClinicalAnalysisPreset(preset) {
    const warnings = analysisPresetWarnings(preset);
    const hardBlock = warnings.some(item => item.includes("Open a case model"));
    if (hardBlock) {
      setError(warnings.join(" "));
      renderClinicalAnalysisPresets();
      return;
    }
    const { landmarkTemplate, measurementTemplate } = presetTemplateDetails(preset);
    if (!landmarkTemplate || !measurementTemplate) {
      setError("Clinical preset template dependencies are missing.");
      return;
    }
    state.currentAnalysisPreset = preset;
    state.analysisPresetReportDraft = {
      presetId: preset.presetId,
      name: preset.name,
      category: preset.category,
      reportTemplateId: preset.reportTemplateId,
      warnings: warnings.slice(),
      startedAt: new Date().toISOString()
    };
    try {
      state.currentLandmarkTemplateId = landmarkTemplate.templateId;
      setInputValue("aiLandmarkTemplateSelect", landmarkTemplate.templateId);
      setInputValue("landmarkDetectionMode", "ai_assisted");
      state.landmarkDetectionMode = "ai_assisted";
      await runAiLandmarkDetection();
      await loadCaseLandmarks(state.activeMeasurementContext, true);
      await applyMeasurementTemplate(measurementTemplate);
      await recalculateAllMeasurementsForModel(state.activeMeasurementContext?.modelId);
      const generatedLandmarks = state.caseLandmarks.filter(item => item.analysisPresetId === preset.presetId);
      const generatedMeasurements = state.caseMeasurements.filter(item => item.analysisPresetId === preset.presetId);
      state.analysisPresetReportDraft = {
        ...state.analysisPresetReportDraft,
        generatedLandmarksCount: generatedLandmarks.length,
        generatedMeasurementsCount: generatedMeasurements.length,
        completedAt: new Date().toISOString()
      };
      state.clinicalReportDraft = buildClinicalReportSnapshot(state.currentCaseReport || {});
      renderClinicalAnalysisPresets();
      renderClinicalReportBuilder();
      setStatusText(`Clinical analysis preset applied: ${preset.name}. Report draft prepared.`);
    } catch (err) {
      setError(apiErrorMessage(err, "Clinical analysis preset failed."));
    } finally {
      state.currentAnalysisPreset = null;
    }
  }

  async function handleClinicalAnalysisPresetAction(event) {
    const button = event.target.closest("[data-analysis-preset-action]");
    if (!button) return;
    const row = button.closest("[data-analysis-preset-id]");
    const presetId = row?.dataset?.analysisPresetId || "";
    const preset = (state.clinicalAnalysisPresets.length ? state.clinicalAnalysisPresets : DEFAULT_CLINICAL_ANALYSIS_PRESETS)
      .find(item => item.presetId === presetId);
    if (!preset) return;
    if (button.dataset.analysisPresetAction === "apply") await applyClinicalAnalysisPreset(preset);
  }

  function reportTemplates() {
    return state.clinicalReportTemplates.length ? state.clinicalReportTemplates : DEFAULT_REPORT_TEMPLATES;
  }

  function selectedReportTemplate() {
    const selectedId = byId("clinicalReportTemplateSelect")?.value || state.analysisPresetReportDraft?.reportTemplateId || "case-report-custom";
    return reportTemplates().find(item => item.reportTemplateId === selectedId) || reportTemplates()[0];
  }

  function clinicalReportSelectedSections() {
    const checked = Array.from(document.querySelectorAll("[data-clinical-report-section]:checked")).map(input => input.value);
    return checked.length ? checked : selectedReportTemplate()?.sections || CLINICAL_REPORT_SECTIONS.map(item => item.sectionId);
  }

  function selectedAnalysisPresetForReport(report = state.currentCaseReport) {
    const fromDraft = state.analysisPresetReportDraft?.presetId
      ? { presetId: state.analysisPresetReportDraft.presetId, name: state.analysisPresetReportDraft.name }
      : null;
    return fromDraft || report?.selectedAnalysisPresets?.[0] || report?.clinicalAnalysisPresetReport?.selectedAnalysisPresets?.[0] || null;
  }

  function renderClinicalReportBuilder() {
    const templateSelect = byId("clinicalReportTemplateSelect");
    const checklist = byId("clinicalReportSectionsChecklist");
    const summary = byId("clinicalReportBuilderSummary");
    const templates = reportTemplates();
    const selectedTemplateId = templateSelect?.value || state.analysisPresetReportDraft?.reportTemplateId || templates[0]?.reportTemplateId || "";
    if (templateSelect) {
      templateSelect.innerHTML = templates.map(template => `<option value="${escapeHtml(template.reportTemplateId)}">${escapeHtml(template.name)}</option>`).join("");
      templateSelect.value = templates.some(item => item.reportTemplateId === selectedTemplateId) ? selectedTemplateId : templates[0]?.reportTemplateId || "";
    }
    if (checklist) {
      const enabled = new Set(state.clinicalReportDraft?.enabledSections || selectedReportTemplate()?.sections || CLINICAL_REPORT_SECTIONS.map(item => item.sectionId));
      checklist.innerHTML = CLINICAL_REPORT_SECTIONS.map(section => `
        <label class="reconstruction-setting-toggle">
          <input type="checkbox" data-clinical-report-section value="${escapeHtml(section.sectionId)}" ${enabled.has(section.sectionId) ? "checked" : ""} />
          <span>${escapeHtml(section.label)}</span>
        </label>
      `).join("");
    }
    const caseText = state.currentCaseId || "no case";
    const modelText = state.activeMeasurementContext?.jobId || "no model";
    const preset = selectedAnalysisPresetForReport();
    if (summary) summary.textContent = `case ${caseText} · model ${modelText} · preset ${preset?.name || "not selected"}`;
    renderClinicalReportPreview(state.clinicalReportDraft || buildClinicalReportSnapshot());
  }

  function buildClinicalReportSnapshot(report = state.currentCaseReport || {}) {
    const template = selectedReportTemplate() || DEFAULT_REPORT_TEMPLATES[0];
    const enabledSections = clinicalReportSelectedSections();
    const preset = selectedAnalysisPresetForReport(report);
    return {
      reportDraftId: `clinical-report-draft-${Date.now().toString(36)}`,
      reportTemplate: {
        reportTemplateId: template?.reportTemplateId || "",
        name: template?.name || "",
        category: template?.category || "",
        sections: enabledSections,
        createdAt: template?.createdAt || "",
        updatedAt: template?.updatedAt || ""
      },
      caseId: state.currentCaseId || report.caseId || "",
      patientName: report.patientName || currentCase()?.patientName || "",
      patientId: report.patientId || currentCase()?.patientId || "",
      model: state.activeMeasurementContext || null,
      analysisPreset: preset,
      enabledSections,
      doctorNotes: byId("clinicalReportDoctorNotes")?.value || "",
      generatedAt: new Date().toISOString(),
      sections: {
        case_info: {
          caseId: state.currentCaseId || report.caseId || "",
          patientName: report.patientName || currentCase()?.patientName || "",
          patientId: report.patientId || currentCase()?.patientId || "",
          createdAt: report.createdAt || currentCase()?.createdAt || "",
          updatedAt: report.updatedAt || currentCase()?.updatedAt || ""
        },
        case_team: {
          owner: report.caseOwner || (state.caseTeam?.teamMembers || []).find(member => member.memberId === state.caseTeam?.ownerId) || null,
          teamMembers: report.teamMembers || state.caseTeam?.teamMembers || [],
          contributors: report.contributors || (state.caseTeam?.teamMembers || []).filter(member => member.role !== "viewer")
        },
        case_audit: {
          auditSummary: report.auditSummary || {},
          auditEvents: report.auditEvents || state.auditEvents || []
        },
        backup_status: report.backupStatus || {
          backupVersion: "v1",
          localBackupSupported: true,
          cloudSyncEnabled: false,
          includedData: ["Patient Cases", "Reconstruction Jobs", "Models Metadata", "Measurements", "Landmarks", "Reports", "Timeline", "Surgical Notes", "Simulations", "Clinical Insights"]
        },
        qa_summary: {
          qaSummary: report.qaSummary || state.qaSummary || computeQaSummary(state.qaChecks),
          qaChecks: report.qaChecks || state.qaChecks || []
        },
        production_readiness: {
          summary: report.productionReadinessSummary || state.productionReadinessSummary || computeProductionReadinessSummary(state.productionReadiness),
          readiness: report.productionReadiness || state.productionReadiness || []
        },
        reconstruction_summary: report.reconstructionJobs || report.jobs || [],
        model_readiness: report.readinessScores || [],
        landmarks_summary: {
          landmarks: report.landmarks || state.caseLandmarks,
          landmarkTemplateReport: report.landmarkTemplateReport || {},
          aiLandmarkReport: report.aiLandmarkReport || {}
        },
        measurements_summary: {
          measurements: report.measurements || state.caseMeasurements,
          measurementTemplateReport: report.measurementTemplateReport || {},
          autoMeasurementReport: report.autoMeasurementReport || {}
        },
        clinical_insights: report.clinicalInsights || state.clinicalInsights,
        case_timeline: report.timeline || state.caseTimeline || null,
        before_after_comparison: report.comparisons || state.comparisons,
        surgical_simulation: report.surgicalSimulations || state.surgicalSimulations,
        surgical_planning_notes: report.surgicalPlanningNotes || state.surgicalPlanningNotes,
        warnings: [
          ...(report.warnings || []),
          ...(report.clinicalAnalysisPresetReport?.warnings || []),
          ...(report.autoMeasurementReport?.warnings || []),
          ...(report.simulationWarnings || []),
          ...((report.surgicalSimulations || state.surgicalSimulations || []).flatMap(item => item.warnings || []))
        ],
        doctor_notes: byId("clinicalReportDoctorNotes")?.value || ""
      }
    };
  }

  function clinicalReportDraftToHtml(draft) {
    const sectionLabel = id => CLINICAL_REPORT_SECTIONS.find(item => item.sectionId === id)?.label || id;
    const table = (headers, rows) => `
      <table style="width:100%;border-collapse:collapse;margin:8px 0 14px">
        <thead><tr>${headers.map(header => `<th style="text-align:left;border-bottom:1px solid #cbd5e1;padding:6px">${escapeHtml(header)}</th>`).join("")}</tr></thead>
        <tbody>${rows.length ? rows.map(row => `<tr>${row.map(cell => `<td style="border-bottom:1px solid #e2e8f0;padding:6px;vertical-align:top">${escapeHtml(cell ?? "—")}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}" style="padding:6px;color:#64748b">No data</td></tr>`}</tbody>
      </table>
    `;
    const renderSection = sectionId => {
      const content = draft.sections?.[sectionId];
      if (sectionId === "case_info") {
        return table(["Field", "Value"], [
          ["Patient", content?.patientName || draft.patientName || "—"],
          ["Patient ID", content?.patientId || draft.patientId || "—"],
          ["Case ID", content?.caseId || draft.caseId || "—"],
          ["Created", formatDateTime(content?.createdAt)],
          ["Updated", formatDateTime(content?.updatedAt)],
          ["Generated", formatDateTime(draft.generatedAt)]
        ]);
      }
      if (sectionId === "reconstruction_summary") {
        return table(["Job", "Status", "Readiness", "Warnings"], (content || []).map(job => [
          job.jobId || "—",
          job.status || "—",
          `${job.readinessLevel || "—"} ${Number.isFinite(Number(job.readinessScore)) ? Math.round(Number(job.readinessScore)) + "/100" : ""}`,
          String(job.warningsCount || 0)
        ]));
      }
      if (sectionId === "case_team") {
        return table(["Member", "Role", "Email", "Permissions"], (content?.teamMembers || []).map(member => [
          member.name || member.memberId || "—",
          teamRoleLabel(member.role),
          member.email || "—",
          (member.permissions || []).join(", ") || "view_case"
        ]));
      }
      if (sectionId === "case_audit") {
        return table(["Time", "User", "Action", "Entity"], (content?.auditEvents || content?.auditSummary?.latestEvents || []).map(event => [
          formatDateTime(event.timestamp),
          event.userName || event.userId || "Local User",
          AUDIT_ACTION_LABELS[event.action] || event.action || "case updated",
          `${event.entityType || "case"} ${event.entityId || ""}`.trim()
        ]));
      }
      if (sectionId === "backup_status") {
        return table(["Field", "Value"], [
          ["Backup version", content?.backupVersion || "v1"],
          ["Local backup supported", content?.localBackupSupported ? "yes" : "no"],
          ["Cloud sync", content?.cloudSyncEnabled ? "enabled" : "disabled"],
          ["Included data", (content?.includedData || []).join(", ") || "—"]
        ]);
      }
      if (sectionId === "qa_summary") {
        const qa = content?.qaSummary || {};
        return table(["Field", "Value"], [
          ["QA score", Number.isFinite(Number(qa.qaScore)) ? `${Math.round(Number(qa.qaScore))}/100` : "—"],
          ["Readiness level", qa.readinessLevel || "—"],
          ["Warnings", String(qa.warningsCount || 0)],
          ["Failures", String(qa.failuresCount || 0)],
          ["Passed checks", String(qa.passedCount || 0)]
        ]) + table(["Status", "Severity", "Category", "Check"], (content?.qaChecks || []).map(item => [
          item.status || "warning",
          item.severity || "medium",
          item.category || "system",
          item.title || "QA check"
        ]));
      }
      if (sectionId === "production_readiness") {
        const summary = content?.summary || {};
        return table(["Field", "Value"], [
          ["Production score", Number.isFinite(Number(summary.productionScore)) ? `${Math.round(Number(summary.productionScore))}/100` : "—"],
          ["Readiness level", summary.readinessLevel || "—"],
          ["Passed checks", String(summary.passedChecks || 0)],
          ["Warnings", String(summary.warnings || 0)],
          ["Failed checks", String(summary.failedChecks || 0)]
        ]) + table(["Scope", "Level", "Score", "Checks"], (content?.readiness || []).map(item => [
          item.scope || "case",
          item.level || item.readinessLevel || "limited",
          Number.isFinite(Number(item.score || item.productionScore)) ? `${Math.round(Number(item.score || item.productionScore))}/100` : "—",
          (item.checks || []).map(check => `${check.status || "warning"}: ${check.title || "check"}`).join("; ") || "—"
        ]));
      }
      if (sectionId === "model_readiness") {
        return table(["Job", "Score", "Level"], (content || []).map(item => [
          item.jobId || "—",
          Number.isFinite(Number(item.readinessScore)) ? `${Math.round(Number(item.readinessScore))}/100` : "—",
          item.readinessLevel || "—"
        ]));
      }
      if (sectionId === "landmarks_summary") {
        return table(["Landmark", "Category", "Status", "Confidence"], (content?.landmarks || []).map(item => [
          item.name || item.landmarkId,
          item.category || "custom",
          item.status || "placed",
          confidenceText(item.confidence)
        ]));
      }
      if (sectionId === "measurements_summary") {
        return table(["Measurement", "Type", "Value", "Status", "Formula"], (content?.measurements || []).map(item => [
          item.label || item.measurementId,
          item.type || "—",
          measurementValueText(item),
          item.status || "ready",
          item.formula || "—"
        ]));
      }
      if (sectionId === "clinical_insights") {
        return table(["Title", "Severity", "Category", "Source", "Description"], (content || []).map(item => [
          item.title || "Clinical observation",
          INSIGHT_SEVERITY_LABELS[item.severity] || item.severity || "info",
          INSIGHT_CATEGORY_LABELS[item.category] || item.category || "custom",
          item.source || "clinical_insights_engine",
          item.description || "—"
        ]));
      }
      if (sectionId === "before_after_comparison") {
        return table(["Comparison", "Before", "After", "Mode"], (content || []).map(item => [
          item.comparisonId || "—",
          item.beforeJobId || "—",
          item.afterJobId || "—",
          item.comparisonMode || "—"
        ]));
      }
      if (sectionId === "case_timeline") {
        return table(["Date", "Type", "Model", "Description"], (content?.entries || []).map(item => [
          formatDateTime(item.createdAt),
          item.entryType || "—",
          item.modelId || item.reconstructionJobId || "—",
          item.description || item.title || "—"
        ]));
      }
      if (sectionId === "surgical_simulation") {
        return table(["Simulation", "Type", "Parameters", "Before", "Simulated", "Warnings"], (content || []).map(item => [
          item.simulationId || "—",
          simulationTypeLabel(item.simulationType),
          simulationParameterSummary(item.parameters || {}),
          item.jobId || item.originalModelId || item.modelId || "—",
          item.simulatedModelId || item.simulatedModel?.modelId || "—",
          (item.warnings || []).join("; ") || "—"
        ]));
      }
      if (sectionId === "surgical_planning_notes") {
        return table(["Plan", "Procedure", "Diagnosis", "Notes"], (content || []).map(item => [
          item.title || item.planId || "—",
          item.procedureType || "—",
          item.diagnosis || "—",
          item.notes || "—"
        ]));
      }
      if (sectionId === "warnings") {
        const warnings = Array.from(new Set((content || []).map(item => typeof item === "string" ? item : JSON.stringify(item))));
        return `<div style="border:1px solid #f59e0b;background:#fffbeb;padding:10px;border-radius:6px">${warnings.length ? warnings.map(item => `<div>• ${escapeHtml(item)}</div>`).join("") : "No warnings"}</div>`;
      }
      if (sectionId === "doctor_notes") return `<p>${escapeHtml(draft.doctorNotes || "—")}</p>`;
      return `<pre>${escapeHtml(JSON.stringify(content ?? null, null, 2))}</pre>`;
    };
    const rows = (draft.enabledSections || []).map(sectionId => {
      return `<section style="margin:18px 0"><h4 style="margin:0 0 8px;color:#0f172a">${escapeHtml(sectionLabel(sectionId))}</h4>${renderSection(sectionId)}</section>`;
    }).join("");
    return `
      <article class="clinical-report-preview" style="font-family:Inter,Arial,sans-serif;line-height:1.45;color:#1e293b">
        <h2 style="margin:0 0 4px;color:#0f172a">PMAS Clinical Report</h2>
        <h3 style="margin:0 0 12px;color:#334155">${escapeHtml(draft.reportTemplate?.name || "Clinical Report")}</h3>
        <p><strong>Case:</strong> ${escapeHtml(draft.caseId || "—")} · <strong>Patient:</strong> ${escapeHtml(draft.patientName || "—")} · <strong>Model:</strong> ${escapeHtml(draft.model?.jobId || "—")} · <strong>Generated:</strong> ${escapeHtml(formatDateTime(draft.generatedAt))}</p>
        <p><strong>Analysis preset:</strong> ${escapeHtml(draft.analysisPreset?.name || "—")}</p>
        ${rows}
      </article>
    `;
  }

  function clinicalReportTextSections(draft) {
    const label = id => CLINICAL_REPORT_SECTIONS.find(item => item.sectionId === id)?.label || id;
    const lines = [
      "PMAS Clinical Report",
      draft.reportTemplate?.name || "Clinical Report",
      `Case: ${draft.caseId || "—"}`,
      `Patient: ${draft.patientName || "—"} (${draft.patientId || "—"})`,
      `Model: ${draft.model?.jobId || "—"}`,
      `Analysis preset: ${draft.analysisPreset?.name || "—"}`,
      `Generated: ${formatDateTime(draft.generatedAt)}`,
      ""
    ];
    (draft.enabledSections || []).forEach(sectionId => {
      lines.push(label(sectionId));
      if (sectionId === "doctor_notes") lines.push(draft.doctorNotes || "—");
      else if (sectionId === "warnings") lines.push(...((draft.sections?.warnings || []).map(item => typeof item === "string" ? item : JSON.stringify(item))));
      else lines.push(JSON.stringify(draft.sections?.[sectionId] ?? null, null, 2));
      lines.push("");
    });
    return lines;
  }

  function renderClinicalReportPreview(draft) {
    const preview = byId("clinicalReportPreview");
    if (!preview) return;
    preview.innerHTML = draft ? clinicalReportDraftToHtml(draft) : "No clinical report preview yet.";
  }

  async function saveClinicalReportDraft() {
    const report = state.currentCaseId ? await fetchCaseReport(state.currentCaseId) : null;
    state.clinicalReportDraft = buildClinicalReportSnapshot(report || {});
    renderClinicalReportPreview(state.clinicalReportDraft);
    setStatusText("Clinical report draft saved.");
    return state.clinicalReportDraft;
  }

  async function previewClinicalReport() {
    const draft = await saveClinicalReportDraft();
    renderClinicalReportPreview(draft);
    setStatusText("Clinical report preview updated.");
  }

  function downloadClinicalReportJson() {
    const draft = state.clinicalReportDraft || buildClinicalReportSnapshot();
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${draft.caseId || "case"}-clinical-report-draft.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatusText("Clinical report JSON exported.");
  }

  function exportClinicalReportHtml() {
    const draft = state.clinicalReportDraft || buildClinicalReportSnapshot();
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(draft.reportTemplate?.name || "Clinical Report")}</title></head><body>${clinicalReportDraftToHtml(draft)}</body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${draft.caseId || "case"}-clinical-report-draft.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatusText("Clinical report HTML exported.");
  }

  async function exportClinicalReportPdf() {
    const draft = state.clinicalReportDraft || await saveClinicalReportDraft();
    if (!window.jspdf?.jsPDF) {
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>PMAS Clinical Report</title></head><body>${clinicalReportDraftToHtml(draft)}<script>window.print()</script></body></html>`;
      const printWindow = window.open("", "_blank");
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
        setStatusText("PDF library unavailable. Opened HTML print fallback.");
      } else {
        setError("PDF export unavailable: browser blocked HTML print fallback.");
      }
      return;
    }
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF("p", "mm", "a4");
    const lines = clinicalReportTextSections(draft);
    let y = 14;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(14);
    pdf.text("PMAS Clinical Report", 10, y);
    y += 8;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    lines.forEach(line => {
      pdf.splitTextToSize(line, 185).forEach(part => {
        if (y > 284) {
          pdf.addPage();
          y = 12;
        }
        pdf.text(part, 10, y);
        y += 4.5;
      });
    });
    pdf.save(`${draft.caseId || "case"}-clinical-report-draft.pdf`);
    setStatusText("Clinical report PDF exported.");
  }

  async function exportClinicalReportDocx() {
    const draft = state.clinicalReportDraft || await saveClinicalReportDraft();
    if (!window.docx) {
      setError("DOCX export unavailable: docx.js library is not loaded.");
      return;
    }
    const D = window.docx;
    const paragraphs = clinicalReportTextSections(draft).map((line, index) => new D.Paragraph({
      children: [new D.TextRun({ text: line || " ", bold: index === 0 })],
      spacing: { after: line ? 80 : 40 }
    }));
    const doc = new D.Document({ sections: [{ children: paragraphs }] });
    const blob = await D.Packer.toBlob(doc);
    saveAs(blob, `${draft.caseId || "case"}-clinical-report-draft.docx`);
    setStatusText("Clinical report DOCX exported.");
  }

  function normalizeLandmarkName(name) {
    return String(name || "").trim().toLowerCase();
  }

  function usableLandmark(landmark) {
    return Boolean(landmark) && !["unplaced", "hidden", "rejected"].includes(landmark.status) && landmark.visible !== false;
  }

  function findLandmarkByName(name) {
    const normalized = normalizeLandmarkName(name);
    return state.caseLandmarks.find(item => normalizeLandmarkName(item.name) === normalized && usableLandmark(item)) || null;
  }

  function distanceBetween(a, b) {
    const pa = a?.position3D || {};
    const pb = b?.position3D || {};
    return Math.sqrt(
      Math.pow(Number(pa.x || 0) - Number(pb.x || 0), 2)
      + Math.pow(Number(pa.y || 0) - Number(pb.y || 0), 2)
      + Math.pow(Number(pa.z || 0) - Number(pb.z || 0), 2)
    );
  }

  function calculateDistanceBetweenLandmarks(landmarkA, landmarkB) {
    return distanceBetween(landmarkA, landmarkB);
  }

  function calculateAngleBetweenLandmarks(landmarkA, landmarkB, landmarkC) {
    return angleBetween(landmarkA, landmarkB, landmarkC);
  }

  function calculateVectorBetweenLandmarks(landmarkA, landmarkB) {
    const pa = landmarkA?.position3D || {};
    const pb = landmarkB?.position3D || {};
    return {
      x: Number(pb.x || 0) - Number(pa.x || 0),
      y: Number(pb.y || 0) - Number(pa.y || 0),
      z: Number(pb.z || 0) - Number(pa.z || 0),
      magnitude: calculateDistanceBetweenLandmarks(landmarkA, landmarkB)
    };
  }

  function calculateRatio(valueA, valueB) {
    const a = Number(valueA);
    const b = Number(valueB);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
    return a / b;
  }

  function angleBetween(a, vertex, c) {
    const pa = a?.position3D || {};
    const pv = vertex?.position3D || {};
    const pc = c?.position3D || {};
    const va = [Number(pa.x || 0) - Number(pv.x || 0), Number(pa.y || 0) - Number(pv.y || 0), Number(pa.z || 0) - Number(pv.z || 0)];
    const vc = [Number(pc.x || 0) - Number(pv.x || 0), Number(pc.y || 0) - Number(pv.y || 0), Number(pc.z || 0) - Number(pv.z || 0)];
    const dot = va.reduce((sum, value, index) => sum + value * vc[index], 0);
    const ma = Math.sqrt(va.reduce((sum, value) => sum + value * value, 0));
    const mc = Math.sqrt(vc.reduce((sum, value) => sum + value * value, 0));
    if (!ma || !mc) return 0;
    return Math.acos(Math.max(-1, Math.min(1, dot / (ma * mc)))) * 180 / Math.PI;
  }

  function calculateMeasurementTemplateValue(item) {
    const from = findLandmarkByName(item.fromLandmark);
    const to = findLandmarkByName(item.toLandmark);
    const third = item.optionalThirdLandmark ? findLandmarkByName(item.optionalThirdLandmark) : null;
    if (item.type === "angle") return angleBetween(from, third, to);
    if (item.type === "ratio") {
      const [top, bottom] = String(item.formula || "").split("/");
      const pairDistance = part => {
        const [aName, bName] = String(part || "").split("-").map(value => value.trim());
        const a = findLandmarkByName(aName);
        const b = findLandmarkByName(bName);
        return a && b ? distanceBetween(a, b) : 0;
      };
      const denominator = pairDistance(bottom);
      return denominator ? pairDistance(top) / denominator : null;
    }
    if (item.type === "custom") return from && to ? distanceBetween(from, to) : 0;
    return distanceBetween(from, to);
  }

  function findLandmarkForMeasurement(nameOrId) {
    const raw = String(nameOrId || "").trim();
    if (!raw) return null;
    return state.caseLandmarks.find(item => item.landmarkId === raw) || findLandmarkByName(raw);
  }

  function measurementLandmarkNames(measurement) {
    if (measurement.type === "ratio" && measurement.formula) {
      return String(measurement.formula)
        .split("/")
        .flatMap(part => String(part || "").split("-"))
        .map(value => value.trim())
        .filter(Boolean);
    }
    if (measurement.fromLandmark || measurement.toLandmark || measurement.optionalThirdLandmark) {
      return [measurement.fromLandmark, measurement.toLandmark, measurement.optionalThirdLandmark].filter(Boolean);
    }
    return Array.isArray(measurement.landmarksUsed) ? measurement.landmarksUsed : [];
  }

  function recalculateMeasurementObject(measurement) {
    if (!measurement?.landmarksUsed?.length && !measurement?.fromLandmark && !measurement?.toLandmark) return measurement;
    const names = measurementLandmarkNames(measurement);
    const landmarks = names.map(findLandmarkForMeasurement);
    const missing = names.filter((name, index) => !usableLandmark(landmarks[index]));
    const warnings = landmarks
      .filter(Boolean)
      .filter(item => item.status === "proposed" || (item.detectionMode === "ai_assisted" && !item.approvedByUser))
      .map(item => `${item.name || item.landmarkId} is proposed/not approved`);
    if (missing.length) {
      return {
        ...measurement,
        value: null,
        status: "missing_landmarks",
        missingLandmarks: missing,
        warnings,
        calculatedAt: new Date().toISOString()
      };
    }
    let value = null;
    if (measurement.type === "angle") value = calculateAngleBetweenLandmarks(landmarks[0], landmarks[1], landmarks[2]);
    else if (measurement.type === "vector") value = calculateVectorBetweenLandmarks(landmarks[0], landmarks[1]).magnitude;
    else if (measurement.type === "ratio") {
      const [top, bottom] = String(measurement.formula || "").split("/");
      const pairDistance = part => {
        const [aName, bName] = String(part || "").split("-").map(value => value.trim());
        const a = findLandmarkForMeasurement(aName);
        const b = findLandmarkForMeasurement(bName);
        return a && b ? calculateDistanceBetweenLandmarks(a, b) : null;
      };
      value = calculateRatio(pairDistance(top), pairDistance(bottom));
    } else {
      value = calculateDistanceBetweenLandmarks(landmarks[0], landmarks[1]);
    }
    return {
      ...measurement,
      value,
      points: landmarks.filter(Boolean).map(item => item.position3D),
      landmarksUsed: landmarks.filter(Boolean).map(item => item.landmarkId),
      status: warnings.length ? "needs_review" : "calculated",
      missingLandmarks: [],
      warnings,
      calculatedAt: new Date().toISOString()
    };
  }

  async function recalculateMeasurement(measurementId) {
    const measurement = state.caseMeasurements.find(item => item.measurementId === measurementId);
    if (!measurement) return null;
    const next = recalculateMeasurementObject(measurement);
    if (isDemoMode()) {
      state.caseMeasurements = state.caseMeasurements.map(item => item.measurementId === measurementId ? next : item);
      renderCaseMeasurements();
      return next;
    }
    await api().saveCaseMeasurement(next);
    return next;
  }

  async function recalculateAllMeasurementsForModel(modelId = state.activeMeasurementContext?.modelId) {
    const recalculable = state.caseMeasurements.filter(item => (
      (!modelId || item.modelId === modelId)
      && (item.landmarksUsed?.length || item.fromLandmark || item.toLandmark)
    ));
    if (!recalculable.length) return [];
    const updated = recalculable.map(recalculateMeasurementObject);
    if (isDemoMode()) {
      const byId = new Map(updated.map(item => [item.measurementId, item]));
      state.caseMeasurements = state.caseMeasurements.map(item => byId.get(item.measurementId) || item);
      renderCaseMeasurements();
      return updated;
    }
    for (const item of updated) await api().saveCaseMeasurement(item);
    await loadCaseMeasurements(state.activeMeasurementContext, true);
    return updated;
  }

  window.PMASAutoMeasurements = {
    calculateDistanceBetweenLandmarks,
    calculateAngleBetweenLandmarks,
    calculateVectorBetweenLandmarks,
    calculateRatio,
    recalculateMeasurement,
    recalculateAllMeasurementsForModel
  };

  function measurementTemplateMissing(template) {
    return (template.requiredLandmarks || []).filter(name => !findLandmarkByName(name));
  }

  function measurementTemplateWarnings(template) {
    return (template.requiredLandmarks || []).filter(name => {
      const landmark = findLandmarkByName(name);
      return landmark?.status === "proposed";
    });
  }

  function renderMeasurementTemplates() {
    const summary = byId("measurementTemplatesSummary");
    const list = byId("measurementTemplatesList");
    const context = state.activeMeasurementContext;
    const templates = state.measurementTemplates.length ? state.measurementTemplates : DEFAULT_MEASUREMENT_TEMPLATES;
    if (summary) {
      summary.textContent = context?.caseId
        ? `${templates.length} measurement template(s) · ${state.caseLandmarks.length} landmark(s) available`
        : "Open a case model with landmarks to generate measurements.";
    }
    if (!list) return;
    list.innerHTML = templates.map(template => {
      const missing = measurementTemplateMissing(template);
      const warnings = measurementTemplateWarnings(template);
      return `
        <div class="reconstruction-history-row" data-measurement-template-id="${escapeHtml(template.templateId)}">
          <div class="reconstruction-history-main">
            <strong>${escapeHtml(template.name)}</strong>
            <div class="reconstruction-history-id">${escapeHtml(template.description || "")}</div>
            <div class="reconstruction-history-id">required: ${escapeHtml((template.requiredLandmarks || []).join(", ") || "none")}</div>
          </div>
          <div class="reconstruction-history-cell">${escapeHtml(template.category || "custom")}</div>
          <div class="reconstruction-history-cell">${Number(template.measurements?.length || 0)} measurements</div>
          <div class="reconstruction-history-cell">${missing.length ? `missing: ${escapeHtml(missing.join(", "))}` : "ready"}${warnings.length ? ` · proposed: ${escapeHtml(warnings.join(", "))}` : ""}</div>
          <div class="reconstruction-history-actions">
            <button class="btn btn-sm" data-measurement-template-action="apply" ${missing.length ? "disabled" : ""}>apply</button>
          </div>
        </div>
      `;
    }).join("");
  }

  async function applyMeasurementTemplate(template) {
    const context = state.activeMeasurementContext || {};
    if (!context.caseId || !context.jobId || !context.modelId) {
      setError("Open a case model before applying measurement templates.");
      return;
    }
    const missing = measurementTemplateMissing(template);
    if (missing.length) {
      setError(`Missing landmarks: ${missing.join(", ")}`);
      renderMeasurementTemplates();
      return;
    }
    const warnings = measurementTemplateWarnings(template);
    const generated = [];
    try {
      for (const item of template.measurements || []) {
        const from = findLandmarkByName(item.fromLandmark);
        const to = findLandmarkByName(item.toLandmark);
        const third = item.optionalThirdLandmark ? findLandmarkByName(item.optionalThirdLandmark) : null;
        const landmarksUsed = [from, to, third].filter(Boolean).map(landmark => landmark.landmarkId);
        const points = [from, to, third].filter(Boolean).map(landmark => landmark.position3D);
        const value = calculateMeasurementTemplateValue(item);
        const measurement = recalculateMeasurementObject({
          caseId: context.caseId,
          jobId: context.jobId,
          modelId: context.modelId,
          type: item.type || "custom",
          label: item.measurementName || item.type || "Template measurement",
          points,
          landmarksUsed,
          value,
          unit: item.unit || "",
          source: "template",
          templateId: template.templateId,
          templateName: template.name,
          missingLandmarks: [],
          formula: item.formula || "",
          description: item.description || "",
          fromLandmark: item.fromLandmark || "",
          toLandmark: item.toLandmark || "",
          optionalThirdLandmark: item.optionalThirdLandmark || "",
          analysisPresetId: state.currentAnalysisPreset?.presetId || "",
          analysisPresetName: state.currentAnalysisPreset?.name || "",
          status: warnings.length ? "needs_review" : "calculated",
          warnings: warnings.map(name => `${name} is proposed/not approved`),
          calculatedAt: new Date().toISOString()
        });
        if (isDemoMode()) {
          generated.push({
            ...measurement,
            measurementId: `demo-template-measurement-${Date.now().toString(36)}-${generated.length}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
        } else {
          generated.push(await api().saveCaseMeasurement(measurement));
        }
      }
      if (isDemoMode()) {
        state.caseMeasurements = [...generated, ...state.caseMeasurements];
        renderCaseMeasurements();
      } else {
        await loadCaseMeasurements(state.activeMeasurementContext, true);
        await loadCases();
      }
      renderMeasurementTemplates();
      const warningText = warnings.length ? ` Proposed landmarks used: ${warnings.join(", ")}.` : "";
      setStatusText(`Measurement template applied: ${generated.length} measurement(s).${warningText}`);
    } catch (err) {
      setError(apiErrorMessage(err, "Measurement template apply failed."));
    }
  }

  async function handleMeasurementTemplateAction(event) {
    const button = event.target.closest("[data-measurement-template-action]");
    if (!button) return;
    const row = button.closest("[data-measurement-template-id]");
    const templateId = row?.dataset?.measurementTemplateId || "";
    const template = (state.measurementTemplates.length ? state.measurementTemplates : DEFAULT_MEASUREMENT_TEMPLATES)
      .find(item => item.templateId === templateId);
    if (!template) return;
    if (button.dataset.measurementTemplateAction === "apply") await applyMeasurementTemplate(template);
  }

  function renderLandmarkTemplates() {
    const summary = byId("landmarkTemplatesSummary");
    const list = byId("landmarkTemplatesList");
    const context = state.activeMeasurementContext;
    if (summary) {
      summary.textContent = context?.caseId
        ? `${state.landmarkTemplates.length} template(s) available · current model ${context.jobId || "—"}`
        : `${state.landmarkTemplates.length} template(s) available · open a case model to apply`;
    }
    if (!list) return;
    if (!state.landmarkTemplates.length) {
      list.innerHTML = '<div class="hint">No landmark templates loaded.</div>';
      return;
    }
    list.innerHTML = state.landmarkTemplates.map(template => `
      <div class="reconstruction-history-row" data-landmark-template-id="${escapeHtml(template.templateId)}">
        <div class="reconstruction-history-main">
          <strong>${escapeHtml(template.name || "Landmark Template")}</strong>
          <div class="reconstruction-history-id">${escapeHtml(template.templateId || "")}</div>
          <div class="reconstruction-history-id">${escapeHtml(template.description || "")}</div>
        </div>
        <div class="reconstruction-history-cell">${escapeHtml(template.category || "custom")}</div>
        <div class="reconstruction-history-cell">${Number(template.landmarks?.length || 0)} landmarks</div>
        <div class="reconstruction-history-cell">${template.builtIn ? "built-in" : "custom"}</div>
        <div class="reconstruction-history-actions">
          <button class="btn btn-sm" data-landmark-template-action="apply">Apply Template</button>
          <button class="btn btn-sm" data-landmark-template-action="duplicate">Duplicate</button>
          <button class="btn btn-sm" data-landmark-template-action="edit">Edit</button>
          <button class="btn btn-sm btn-danger" data-landmark-template-action="delete" ${template.builtIn ? "disabled" : ""}>Delete Custom</button>
        </div>
      </div>
    `).join("");
    renderAiTemplateOptions();
  }

  function renderAiTemplateOptions() {
    const select = byId("aiLandmarkTemplateSelect");
    if (!select) return;
    const current = select.value || state.currentLandmarkTemplateId || "";
    select.innerHTML = ['<option value="">No template selected</option>']
      .concat(state.landmarkTemplates.map(template => `<option value="${escapeHtml(template.templateId)}">${escapeHtml(template.name || template.templateId)}</option>`))
      .join("");
    select.value = state.landmarkTemplates.some(item => item.templateId === current) ? current : "";
  }

  function aiLandmarkItems() {
    return state.caseLandmarks.filter(item => (
      item.detectionMode === "ai_assisted"
      || item.source === "ai_generated"
      || ["proposed", "approved", "corrected", "rejected"].includes(item.status)
    ));
  }

  function confidenceText(value) {
    return Number.isFinite(Number(value)) ? `${Math.round(Number(value))}%` : "—";
  }

  function renderAiLandmarkDetection() {
    const summary = byId("aiLandmarkDetectionSummary");
    const list = byId("aiLandmarkDetectionList");
    const modeSelect = byId("landmarkDetectionMode");
    if (modeSelect) modeSelect.value = state.landmarkDetectionMode || "ai_assisted";
    renderAiTemplateOptions();
    const items = aiLandmarkItems();
    const average = items.length
      ? Math.round(items.reduce((sum, item) => sum + (Number(item.confidence) || 0), 0) / items.length)
      : 0;
    if (summary) {
      summary.textContent = `${items.length} AI proposal(s) · approved ${items.filter(item => item.status === "approved").length} · corrected ${items.filter(item => item.status === "corrected").length} · rejected ${items.filter(item => item.status === "rejected").length} · avg confidence ${average || 0}%`;
    }
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<div class="hint">No AI landmark proposals yet.</div>';
      return;
    }
    list.innerHTML = items.map(item => `
      <div class="reconstruction-history-row" data-ai-landmark-id="${escapeHtml(item.landmarkId)}">
        <div class="reconstruction-history-main">
          <strong><span style="color:${escapeHtml(aiLandmarkColor(item))}">●</span> ${escapeHtml(item.name || "Landmark")}</strong>
          <div class="reconstruction-history-id">${escapeHtml(item.templateName || item.templateId || "no template")}</div>
          <div class="reconstruction-history-id">${escapeHtml(item.detectionSource || "PMAS AI Landmark Detection")}</div>
        </div>
        <div class="reconstruction-history-cell">${confidenceText(item.confidence)}</div>
        <div class="reconstruction-history-cell">${escapeHtml(item.status || "proposed")}</div>
        <div class="reconstruction-history-cell">${escapeHtml(landmarkCoordsText(item))}</div>
        <div class="reconstruction-history-actions">
          <button class="btn btn-sm" data-ai-landmark-action="approve" ${item.status === "approved" ? "disabled" : ""}>approve</button>
          <button class="btn btn-sm" data-ai-landmark-action="correct">edit position</button>
          <button class="btn btn-sm btn-danger" data-ai-landmark-action="reject" ${item.status === "rejected" ? "disabled" : ""}>reject</button>
        </div>
      </div>
    `).join("");
  }

  function aiLandmarkColor(landmark) {
    if (landmark?.status === "approved") return "#16a34a";
    if (landmark?.status === "corrected") return "#0ea5e9";
    if (landmark?.status === "rejected") return "#94a3b8";
    if (landmark?.status === "proposed") return "#f59e0b";
    return landmark?.color || "#2563eb";
  }

  async function loadLandmarkTemplates() {
    if (!api()?.listLandmarkTemplates) {
      state.landmarkTemplates = [];
      renderLandmarkTemplates();
      return;
    }
    try {
      state.landmarkTemplates = await api().listLandmarkTemplates();
      renderLandmarkTemplates();
      renderClinicalAnalysisPresets();
    } catch (err) {
      setError(apiErrorMessage(err, "Landmark templates unavailable."));
    }
  }

  function templateEditorPayload(template = {}) {
    return {
      templateId: template.templateId || "",
      name: template.name || "Custom Template",
      category: template.category || "custom",
      description: template.description || "",
      landmarks: Array.isArray(template.landmarks) ? template.landmarks : [{
        landmarkName: "Custom Point",
        landmarkCategory: "custom",
        description: "",
        required: false,
        color: "#64748b"
      }]
    };
  }

  function readTemplateFromPrompt(title, template) {
    const raw = window.prompt(title, JSON.stringify(templateEditorPayload(template), null, 2));
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw);
      return { ...parsed, landmarks: Array.isArray(parsed.landmarks) ? parsed.landmarks : [] };
    } catch (err) {
      setError("Template JSON is invalid.");
      return null;
    }
  }

  async function saveLandmarkTemplateRecord(template) {
    if (isDemoMode()) {
      const timestamp = new Date().toISOString();
      const next = {
        ...template,
        templateId: template.templateId || `demo-template-${Date.now().toString(36)}`,
        builtIn: false,
        createdAt: template.createdAt || timestamp,
        updatedAt: timestamp
      };
      state.landmarkTemplates = [next, ...state.landmarkTemplates.filter(item => item.templateId !== next.templateId)];
      renderLandmarkTemplates();
      setStatusText("Demo mode: template changed for this session only.");
      return next;
    }
    const saved = await api().saveLandmarkTemplate(template);
    await loadLandmarkTemplates();
    setStatusText("Landmark template saved.");
    return saved;
  }

  async function createLandmarkTemplate() {
    const template = readTemplateFromPrompt("New landmark template JSON", {
      name: "Custom Template",
      category: "custom",
      description: "Custom landmark set.",
      landmarks: [{ landmarkName: "Custom Point", landmarkCategory: "custom", description: "", required: false, color: "#64748b" }]
    });
    if (!template) return;
    delete template.templateId;
    delete template.builtIn;
    try {
      await saveLandmarkTemplateRecord(template);
    } catch (err) {
      setError(apiErrorMessage(err, "Landmark template save failed."));
    }
  }

  async function applyLandmarkTemplate(template) {
    const context = state.activeMeasurementContext || {};
    if (!context.caseId || !context.jobId || !context.modelId) {
      setError("Open a case model before applying landmark templates.");
      return;
    }
    const items = Array.isArray(template.landmarks) ? template.landmarks : [];
    if (!items.length) {
      setError("Template has no landmarks.");
      return;
    }
    const timestamp = new Date().toISOString();
    const records = items.map(item => ({
      caseId: context.caseId,
      jobId: context.jobId,
      modelId: context.modelId,
      name: item.landmarkName || "Landmark",
      category: item.landmarkCategory || "custom",
      position3D: { x: 0, y: 0, z: 0 },
      color: item.color || "#2563eb",
      description: item.description || "",
      source: "imported",
      visible: true,
      status: "unplaced",
      detectionMode: "template_only",
      detectionSource: "landmark_template",
      confidence: null,
      approvedByUser: false,
      correctedByUser: false,
      analysisPresetId: state.currentAnalysisPreset?.presetId || "",
      analysisPresetName: state.currentAnalysisPreset?.name || "",
      templateId: template.templateId,
      templateName: template.name || template.templateId,
      required: Boolean(item.required),
      createdAt: timestamp,
      updatedAt: timestamp
    }));
    try {
      state.currentLandmarkTemplateId = template.templateId;
      setInputValue("aiLandmarkTemplateSelect", template.templateId);
      if (isDemoMode()) {
        const demoRecords = records.map((item, index) => ({
          ...item,
          landmarkId: `demo-landmark-${Date.now().toString(36)}-${index}`
        }));
        state.caseLandmarks = [...demoRecords, ...state.caseLandmarks];
        renderLandmarks();
        if (window._3d?.loadLandmarks) window._3d.loadLandmarks(state.caseLandmarks);
        if (window._3d?.setPendingLandmark) window._3d.setPendingLandmark(demoRecords[0]);
        setStatusText("Demo mode: template applied for this session only.");
        return;
      }
      for (const record of records) await api().saveCaseLandmark(record);
      await loadCaseLandmarks(state.activeMeasurementContext, true);
      await loadCases();
      const firstPending = state.caseLandmarks.find(item => item.templateId === template.templateId && item.status === "unplaced");
      if (window._3d?.setPendingLandmark) window._3d.setPendingLandmark(firstPending || null);
      setStatusText(`Landmark template applied: ${template.name || template.templateId}.`);
    } catch (err) {
      setError(apiErrorMessage(err, "Landmark template apply failed."));
    }
  }

  async function handleLandmarkTemplateAction(event) {
    const button = event.target.closest("[data-landmark-template-action]");
    if (!button) return;
    const row = button.closest("[data-landmark-template-id]");
    const templateId = row?.dataset?.landmarkTemplateId || "";
    const template = state.landmarkTemplates.find(item => item.templateId === templateId);
    if (!template) return;
    const action = button.dataset.landmarkTemplateAction;
    if (action === "apply") await applyLandmarkTemplate(template);
    if (action === "duplicate") {
      const copy = { ...templateEditorPayload(template), templateId: "", name: `${template.name || "Template"} Copy`, builtIn: false };
      await saveLandmarkTemplateRecord(copy);
    }
    if (action === "edit") {
      const edited = readTemplateFromPrompt("Edit landmark template JSON", template);
      if (edited) await saveLandmarkTemplateRecord({ ...edited, templateId: template.templateId, builtIn: false });
    }
    if (action === "delete" && !template.builtIn) {
      if (isDemoMode()) {
        state.landmarkTemplates = state.landmarkTemplates.filter(item => item.templateId !== templateId);
        renderLandmarkTemplates();
        return;
      }
      await api().deleteLandmarkTemplate(templateId);
      await loadLandmarkTemplates();
    }
  }

  function proposedLandmarkPosition(index, total) {
    const spread = Math.max(1, total - 1);
    return {
      x: Number((((index / spread) - 0.5) * 0.18).toFixed(3)),
      y: Number((0.12 - (index % 4) * 0.035).toFixed(3)),
      z: Number((0.08 + (index % 3) * 0.025).toFixed(3))
    };
  }

  function aiConfidenceFor(index, total) {
    const base = 92 - index * 4 + Math.min(6, total);
    return Math.max(58, Math.min(96, base));
  }

  async function runAiLandmarkDetection() {
    // TODO: replace mock proposals with facial, craniofacial, maxillofacial, and custom landmark models.
    const context = state.activeMeasurementContext || {};
    const mode = byId("landmarkDetectionMode")?.value || state.landmarkDetectionMode || "ai_assisted";
    const templateId = byId("aiLandmarkTemplateSelect")?.value || state.currentLandmarkTemplateId || "";
    const template = state.landmarkTemplates.find(item => item.templateId === templateId);
    state.landmarkDetectionMode = mode;
    if (!context.caseId || !context.jobId || !context.modelId) {
      setError("Open a case model before running AI landmark detection.");
      return;
    }
    if (!template) {
      setError("Select a landmark template before running AI landmark detection.");
      return;
    }
    if (mode === "manual") {
      setStatusText("Manual mode: use the Landmarks panel to place points.");
      return;
    }
    if (mode === "template_only") {
      await applyLandmarkTemplate(template);
      setStatusText("Template-only mode: expected landmarks created without AI positions.");
      return;
    }
    const items = Array.isArray(template.landmarks) ? template.landmarks : [];
    if (!items.length) {
      setError("Selected template has no landmarks.");
      return;
    }
    const timestamp = new Date().toISOString();
    const proposals = items.map((item, index) => {
      const existing = state.caseLandmarks.find(landmark => (
        landmark.templateId === template.templateId
        && (landmark.name || "").toLowerCase() === String(item.landmarkName || "").toLowerCase()
        && landmark.jobId === context.jobId
        && landmark.modelId === context.modelId
      ));
      return {
        landmarkId: existing?.landmarkId || "",
        caseId: context.caseId,
        jobId: context.jobId,
        modelId: context.modelId,
        name: item.landmarkName || "Landmark",
        category: item.landmarkCategory || "custom",
        position3D: existing?.correctedByUser ? existing.position3D : proposedLandmarkPosition(index, items.length),
        color: item.color || "#f59e0b",
        description: item.description || "",
        source: "ai_generated",
        detectionSource: "PMAS AI Landmark Detection Mock",
        detectionMode: "ai_assisted",
        visible: true,
        status: existing?.correctedByUser ? "corrected" : "proposed",
        confidence: aiConfidenceFor(index, items.length),
        approvedByUser: Boolean(existing?.approvedByUser),
        correctedByUser: Boolean(existing?.correctedByUser),
        analysisPresetId: state.currentAnalysisPreset?.presetId || existing?.analysisPresetId || "",
        analysisPresetName: state.currentAnalysisPreset?.name || existing?.analysisPresetName || "",
        templateId: template.templateId,
        templateName: template.name || template.templateId,
        required: Boolean(item.required),
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp
      };
    });
    try {
      state.currentLandmarkTemplateId = template.templateId;
      if (isDemoMode()) {
        const demoProposals = proposals.map((item, index) => ({
          ...item,
          landmarkId: item.landmarkId || `demo-ai-landmark-${Date.now().toString(36)}-${index}`
        }));
        const proposalIds = new Set(demoProposals.map(item => item.landmarkId));
        state.caseLandmarks = [
          ...demoProposals,
          ...state.caseLandmarks.filter(item => !proposalIds.has(item.landmarkId) && item.templateId !== template.templateId)
        ];
        renderLandmarks();
        renderAiLandmarkDetection();
        if (window._3d?.loadLandmarks) window._3d.loadLandmarks(state.caseLandmarks);
        setStatusText("Demo mode: AI landmark proposals generated for this session.");
        return;
      }
      for (const proposal of proposals) await api().saveCaseLandmark(proposal);
      await loadCaseLandmarks(state.activeMeasurementContext, true);
      await loadClinicalInsights({ generate: true });
      await loadCases();
      setStatusText(`AI landmark proposals generated: ${proposals.length}.`);
    } catch (err) {
      setError(apiErrorMessage(err, "AI landmark detection failed."));
    }
  }

  async function handleAiLandmarkAction(event) {
    const button = event.target.closest("[data-ai-landmark-action]");
    if (!button) return;
    const row = button.closest("[data-ai-landmark-id]");
    const landmarkId = row?.dataset?.aiLandmarkId || "";
    const landmark = state.caseLandmarks.find(item => item.landmarkId === landmarkId);
    if (!landmark) return;
    const action = button.dataset.aiLandmarkAction;
    if (action === "approve") {
      await updateLandmark(landmark, {
        status: "approved",
        approvedByUser: true,
        correctedByUser: false,
        visible: true
      });
    }
    if (action === "reject") {
      await updateLandmark(landmark, {
        status: "rejected",
        approvedByUser: false,
        visible: false
      });
    }
    if (action === "correct") {
      const raw = window.prompt("Correct landmark position x,y,z", landmarkCoordsText({ ...landmark, status: "placed" }));
      if (raw === null) return;
      const parts = raw.split(",").map(value => Number(value.trim()));
      if (parts.length < 3 || parts.some(value => Number.isNaN(value))) {
        setError("Use coordinates in x,y,z format.");
        return;
      }
      await updateLandmark(landmark, {
        position3D: { x: parts[0], y: parts[1], z: parts[2] },
        status: "corrected",
        approvedByUser: true,
        correctedByUser: true,
        visible: true
      });
    }
  }

  function landmarkCoordsText(landmark) {
    if (landmark?.status === "unplaced") return "unplaced";
    if (landmark?.status === "rejected") return "rejected";
    const p = landmark?.position3D || {};
    return [p.x, p.y, p.z].map(value => Number(value || 0).toFixed(3)).join(", ");
  }

  function renderLandmarks() {
    const summary = byId("landmarksSummary");
    const list = byId("landmarksList");
    const context = state.activeMeasurementContext;
    if (summary) {
      summary.textContent = context?.caseId
        ? `case ${context.caseId} · model ${context.jobId || "—"} · ${state.caseLandmarks.length} landmark(s)`
        : "Open a model from a case to manage landmarks.";
    }
    if (!list) return;
    if (!state.caseLandmarks.length) {
      list.innerHTML = '<div class="hint">No landmarks yet.</div>';
      renderAiLandmarkDetection();
      renderMeasurementTemplates();
      renderClinicalAnalysisPresets();
      return;
    }
    list.innerHTML = state.caseLandmarks.map(item => `
      <div class="reconstruction-history-row" data-landmark-id="${escapeHtml(item.landmarkId)}">
        <div class="reconstruction-history-main">
          <strong><span style="color:${escapeHtml(aiLandmarkColor(item))}">●</span> ${escapeHtml(item.name || "Landmark")}</strong>
          <div class="reconstruction-history-id">${escapeHtml(item.landmarkId)}</div>
          <div class="reconstruction-history-id">${escapeHtml(item.description || "")}</div>
          ${item.templateName ? `<div class="reconstruction-history-id">template: ${escapeHtml(item.templateName)}${item.required ? " · required" : ""}</div>` : ""}
          ${item.detectionMode === "ai_assisted" ? `<div class="reconstruction-history-id">AI confidence: ${confidenceText(item.confidence)} · ${escapeHtml(item.detectionSource || "AI")}</div>` : ""}
        </div>
        <div class="reconstruction-history-cell">${escapeHtml(item.category || "custom")}</div>
        <div class="reconstruction-history-cell">${escapeHtml(landmarkCoordsText(item))}</div>
        <div class="reconstruction-history-cell">${escapeHtml(item.status || "placed")}</div>
        <div class="reconstruction-history-cell">${escapeHtml(item.source || "manual")} · ${item.visible === false ? "hidden" : "visible"}</div>
        <div class="reconstruction-history-actions">
          <button class="btn btn-sm" data-landmark-action="select">select</button>
          <button class="btn btn-sm" data-landmark-action="place">${item.status === "placed" ? "move" : "place"}</button>
          <button class="btn btn-sm" data-landmark-action="rename">rename</button>
          <button class="btn btn-sm" data-landmark-action="description">description</button>
          <button class="btn btn-sm" data-landmark-action="toggle">${item.visible === false ? "show" : "hide"}</button>
          <button class="btn btn-sm btn-danger" data-landmark-action="delete" ${isDemoMode() ? "disabled" : ""}>delete</button>
        </div>
      </div>
    `).join("");
    renderAiLandmarkDetection();
    renderMeasurementTemplates();
    renderClinicalAnalysisPresets();
  }

  async function loadCaseLandmarks(context = state.activeMeasurementContext, syncViewer = true) {
    if (!api()?.listCaseLandmarks || !context?.caseId || !context?.jobId || !context?.modelId) {
      state.caseLandmarks = [];
      renderLandmarks();
      renderAiLandmarkDetection();
      renderMeasurementTemplates();
      renderClinicalAnalysisPresets();
      if (syncViewer && window._3d?.loadLandmarks) window._3d.loadLandmarks([]);
      return;
    }
    try {
      state.caseLandmarks = isDemoMode() ? [] : await api().listCaseLandmarks(context);
      renderLandmarks();
      renderAiLandmarkDetection();
      renderMeasurementTemplates();
      renderClinicalAnalysisPresets();
      if (syncViewer && window._3d?.loadLandmarks) window._3d.loadLandmarks(state.caseLandmarks);
    } catch (err) {
      setError(apiErrorMessage(err, "Landmarks unavailable."));
    }
  }

  function readLandmarkForm() {
    const context = state.activeMeasurementContext || {};
    return {
      caseId: context.caseId || state.currentCaseId || "",
      jobId: context.jobId || "",
      modelId: context.modelId || "",
      name: byId("landmarkName")?.value || "Landmark",
      category: byId("landmarkCategory")?.value || "custom",
      position3D: {
        x: Number(byId("landmarkX")?.value) || 0,
        y: Number(byId("landmarkY")?.value) || 0,
        z: Number(byId("landmarkZ")?.value) || 0
      },
      color: byId("landmarkColor")?.value || "#2563eb",
      description: byId("landmarkDescription")?.value || "",
      source: byId("landmarkSource")?.value || "manual",
      visible: true,
      status: "placed"
    };
  }

  function applyLandmarkForm(landmark) {
    if (!landmark) return;
    setInputValue("landmarkName", landmark.name || "");
    setInputValue("landmarkCategory", landmark.category || "custom");
    setInputValue("landmarkColor", landmark.color || "#2563eb");
    setInputValue("landmarkSource", landmark.source || "manual");
    setInputValue("landmarkX", Number(landmark.position3D?.x || 0).toFixed(3));
    setInputValue("landmarkY", Number(landmark.position3D?.y || 0).toFixed(3));
    setInputValue("landmarkZ", Number(landmark.position3D?.z || 0).toFixed(3));
    setInputValue("landmarkDescription", landmark.description || "");
  }

  async function saveLandmarkRecord(landmark) {
    if (isDemoMode()) {
      const demoLandmark = {
        ...landmark,
        landmarkId: `demo-landmark-${Date.now().toString(36)}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      state.caseLandmarks = [demoLandmark, ...state.caseLandmarks];
      renderLandmarks();
      renderAiLandmarkDetection();
      if (window._3d?.loadLandmarks) window._3d.loadLandmarks(state.caseLandmarks);
      setStatusText("Demo mode: landmark displayed for this session only.");
      return demoLandmark;
    }
    if (!canSavePatientData()) {
      setModeBlocked("Demo mode cannot save patient landmarks.");
      return null;
    }
    const saved = await api().saveCaseLandmark(landmark);
    await loadCaseLandmarks(state.activeMeasurementContext, true);
    await loadClinicalInsights({ generate: true });
    await loadCases();
    setStatusText("Landmark saved.");
    return saved;
  }

  async function createLandmarkFromForm() {
    const landmark = readLandmarkForm();
    if (!landmark.caseId || !landmark.jobId || !landmark.modelId) {
      setError("Open a case model before creating landmarks.");
      return;
    }
    try {
      await saveLandmarkRecord(landmark);
    } catch (err) {
      setError(apiErrorMessage(err, "Landmark save failed."));
    }
  }

  async function updateLandmark(landmark, patch) {
    const next = { ...landmark, ...patch };
    try {
      if (isDemoMode()) {
        state.caseLandmarks = state.caseLandmarks.map(item => item.landmarkId === next.landmarkId ? next : item);
        renderLandmarks();
        renderAiLandmarkDetection();
        if (window._3d?.loadLandmarks) window._3d.loadLandmarks(state.caseLandmarks);
        await recalculateAllMeasurementsForModel(state.activeMeasurementContext?.modelId);
        return;
      }
      await api().saveCaseLandmark(next);
      await loadCaseLandmarks(state.activeMeasurementContext, true);
      await recalculateAllMeasurementsForModel(state.activeMeasurementContext?.modelId);
      await loadClinicalInsights({ generate: true });
    } catch (err) {
      setError(apiErrorMessage(err, "Landmark update failed."));
    }
  }

  async function handleLandmarkAction(event) {
    const button = event.target.closest("[data-landmark-action]");
    if (!button) return;
    const row = button.closest("[data-landmark-id]");
    const landmarkId = row?.dataset?.landmarkId || "";
    const landmark = state.caseLandmarks.find(item => item.landmarkId === landmarkId);
    if (!landmark) return;
    const action = button.dataset.landmarkAction;
    if (action === "select") {
      applyLandmarkForm(landmark);
      if (window._3d?.selectLandmark) window._3d.selectLandmark(landmarkId);
      if (landmark.status === "unplaced" && window._3d?.setPendingLandmark) window._3d.setPendingLandmark(landmark);
    }
    if (action === "place") {
      const current = landmarkCoordsText({ ...landmark, status: "placed" });
      const raw = window.prompt("Landmark position x,y,z", current);
      if (raw !== null) {
        const parts = raw.split(",").map(value => Number(value.trim()));
        if (parts.length < 3 || parts.some(value => Number.isNaN(value))) {
          setError("Use coordinates in x,y,z format.");
        } else {
          await updateLandmark(landmark, {
            position3D: { x: parts[0], y: parts[1], z: parts[2] },
            status: landmark.detectionMode === "ai_assisted" ? "corrected" : "placed",
            visible: true,
            approvedByUser: landmark.detectionMode === "ai_assisted" ? true : landmark.approvedByUser,
            correctedByUser: landmark.detectionMode === "ai_assisted" ? true : landmark.correctedByUser
          });
        }
      }
    }
    if (action === "rename") {
      const name = window.prompt("Landmark name", landmark.name || "");
      if (name !== null) await updateLandmark(landmark, { name });
    }
    if (action === "description") {
      const description = window.prompt("Landmark description", landmark.description || "");
      if (description !== null) await updateLandmark(landmark, { description });
    }
    if (action === "toggle") await updateLandmark(landmark, { visible: landmark.visible === false });
    if (action === "delete") {
      if (isDemoMode()) return;
      await api().deleteCaseLandmark(landmarkId);
      await loadCaseLandmarks(state.activeMeasurementContext, true);
      await loadCases();
    }
  }

  function renderSurgicalPlanningModelOptions() {
    const select = byId("surgicalPlanModel");
    if (!select) return;
    const currentValue = select.value || state.activeMeasurementContext?.jobId || "";
    const models = readyCaseModels();
    select.innerHTML = ['<option value="">No model selected</option>']
      .concat(models.map(item => `<option value="${escapeHtml(item.jobId)}">${escapeHtml(modelOptionLabel(item))}</option>`))
      .join("");
    select.value = models.some(item => item.jobId === currentValue) ? currentValue : "";
  }

  function readSurgicalPlanningForm() {
    const jobId = byId("surgicalPlanModel")?.value || "";
    const model = readyCaseModels().find(item => item.jobId === jobId);
    return {
      planId: state.currentSurgicalPlanId || "",
      caseId: state.currentCaseId || "",
      jobId,
      modelId: model?.resultGlbUrl || (jobId ? state.activeMeasurementContext?.modelId || jobId : ""),
      title: byId("surgicalPlanTitle")?.value || "",
      diagnosis: byId("surgicalDiagnosis")?.value || "",
      procedureType: byId("surgicalProcedureType")?.value || "",
      goals: byId("surgicalGoals")?.value || "",
      risks: byId("surgicalRisks")?.value || "",
      notes: byId("surgicalNotes")?.value || ""
    };
  }

  function applySurgicalPlanningForm(plan = null) {
    state.currentSurgicalPlanId = plan?.planId || "";
    const fields = {
      surgicalPlanTitle: plan?.title || "",
      surgicalDiagnosis: plan?.diagnosis || "",
      surgicalProcedureType: plan?.procedureType || "",
      surgicalGoals: plan?.goals || "",
      surgicalRisks: plan?.risks || "",
      surgicalNotes: plan?.notes || ""
    };
    Object.entries(fields).forEach(([id, value]) => {
      const el = byId(id);
      if (el) el.value = value;
    });
    renderSurgicalPlanningModelOptions();
    const select = byId("surgicalPlanModel");
    if (select) select.value = plan?.jobId && readyCaseModels().some(item => item.jobId === plan.jobId) ? plan.jobId : "";
  }

  function renderSurgicalPlanningNotes() {
    const summary = byId("surgicalPlanningSummary");
    const list = byId("surgicalPlanningNotesList");
    if (summary) {
      const modelText = byId("surgicalPlanModel")?.value
        ? ` · linked model ${byId("surgicalPlanModel").value}`
        : "";
      summary.textContent = state.currentCaseId
        ? `case ${state.currentCaseId}${modelText} · ${state.surgicalPlanningNotes.length} plan(s)`
        : "Select a case to save clinical planning notes.";
    }
    if (!list) return;
    if (!state.surgicalPlanningNotes.length) {
      list.innerHTML = '<div class="hint">No surgical planning notes yet.</div>';
      return;
    }
    list.innerHTML = state.surgicalPlanningNotes.map(plan => `
      <div class="reconstruction-history-row" data-surgical-plan-id="${escapeHtml(plan.planId)}">
        <div class="reconstruction-history-main">
          <strong>${escapeHtml(plan.title || plan.procedureType || "Surgical plan")}</strong>
          <div class="reconstruction-history-id">${escapeHtml(plan.planId)}</div>
          <div class="reconstruction-history-id">${plan.jobId ? `model ${escapeHtml(plan.jobId)}` : "case level plan"}</div>
        </div>
        <div class="reconstruction-history-cell">${escapeHtml(plan.procedureType || "—")}</div>
        <div class="reconstruction-history-cell">${escapeHtml(formatDateTime(plan.updatedAt || plan.createdAt))}</div>
        <div class="reconstruction-history-actions">
          <button class="btn btn-sm" data-surgical-plan-action="edit">edit</button>
        </div>
      </div>
    `).join("");
  }

  async function loadSurgicalPlanningNotes() {
    if (isDemoMode()) {
      state.surgicalPlanningNotes = [];
      renderSurgicalPlanningModelOptions();
      renderSurgicalPlanningNotes();
      return;
    }
    if (!api()?.listSurgicalPlanningNotes || !state.currentCaseId) {
      state.surgicalPlanningNotes = [];
      renderSurgicalPlanningModelOptions();
      renderSurgicalPlanningNotes();
      return;
    }
    try {
      state.surgicalPlanningNotes = await api().listSurgicalPlanningNotes({ caseId: state.currentCaseId });
      renderSurgicalPlanningModelOptions();
      renderSurgicalPlanningNotes();
    } catch (err) {
      setError(apiErrorMessage(err, "Surgical planning notes unavailable."));
    }
  }

  async function saveSurgicalPlanningNotes() {
    if (!api()?.saveSurgicalPlanningNote || !state.currentCaseId) {
      setError("Select a case before saving surgical planning notes.");
      return;
    }
    if (!canSavePatientData()) {
      setModeBlocked("Demo mode is not intended for storing real patient data.");
      return;
    }
    try {
      const plan = await api().saveSurgicalPlanningNote(readSurgicalPlanningForm());
      state.currentSurgicalPlanId = plan.planId;
      await loadSurgicalPlanningNotes();
      await loadCaseTimeline();
      await loadAuditLog();
      await loadCases();
      setStatusText("Surgical planning notes saved.");
      scheduleSessionAutoSave();
    } catch (err) {
      setError(apiErrorMessage(err, "Surgical planning notes save failed."));
    }
  }

  function handleSurgicalPlanningClick(event) {
    const button = event.target.closest("[data-surgical-plan-action]");
    if (!button) return;
    const row = button.closest("[data-surgical-plan-id]");
    const planId = row?.dataset?.surgicalPlanId;
    const plan = state.surgicalPlanningNotes.find(item => item.planId === planId);
    if (plan) {
      applySurgicalPlanningForm(plan);
      renderSurgicalPlanningNotes();
    }
  }

  function simulationTypeLabel(type) {
    return String(type || "custom_simulation").replace(/_/g, " ");
  }

  function simulationParameterSummary(parameters = {}) {
    const normalized = {
      moveX: Number(parameters.moveX) || 0,
      moveY: Number(parameters.moveY) || 0,
      moveZ: Number(parameters.moveZ) || 0,
      rotateX: Number(parameters.rotateX) || 0,
      rotateY: Number(parameters.rotateY) || 0,
      rotateZ: Number(parameters.rotateZ) || 0,
      scale: Number(parameters.scale) || 1
    };
    return `move ${normalized.moveX}/${normalized.moveY}/${normalized.moveZ} · rotate ${normalized.rotateX}/${normalized.rotateY}/${normalized.rotateZ} · scale ${normalized.scale}`;
  }

  function renderSurgicalSimulationModelOptions() {
    const select = byId("surgicalSimulationBeforeModel");
    if (!select) return;
    const currentValue = select.value || state.activeMeasurementContext?.jobId || "";
    const models = readyCaseModels();
    select.innerHTML = ['<option value="">Select before model...</option>']
      .concat(models.map(item => `<option value="${escapeHtml(item.jobId)}">${escapeHtml(modelOptionLabel(item))}</option>`))
      .join("");
    select.value = models.some(item => item.jobId === currentValue) ? currentValue : "";
    renderSurgicalSimulation();
  }

  function readSurgicalSimulationForm() {
    const jobId = byId("surgicalSimulationBeforeModel")?.value || "";
    const model = readyCaseModels().find(item => item.jobId === jobId);
    return {
      caseId: state.currentCaseId || "",
      jobId,
      modelId: model?.resultGlbUrl || "",
      simulationType: byId("surgicalSimulationType")?.value || "nasal_adjustment",
      parameters: {
        moveX: Number(byId("simulationMoveX")?.value) || 0,
        moveY: Number(byId("simulationMoveY")?.value) || 0,
        moveZ: Number(byId("simulationMoveZ")?.value) || 0,
        rotateX: Number(byId("simulationRotateX")?.value) || 0,
        rotateY: Number(byId("simulationRotateY")?.value) || 0,
        rotateZ: Number(byId("simulationRotateZ")?.value) || 0,
        scale: Number(byId("simulationScale")?.value) || 1,
        customParameters: byId("simulationCustomParameters")?.value || ""
      }
    };
  }

  function applySurgicalSimulationDraft(draft = {}) {
    setInputValue("surgicalSimulationType", draft.simulationType || "nasal_adjustment");
    setInputValue("simulationMoveX", draft.parameters?.moveX ?? 0);
    setInputValue("simulationMoveY", draft.parameters?.moveY ?? 0);
    setInputValue("simulationMoveZ", draft.parameters?.moveZ ?? 0);
    setInputValue("simulationRotateX", draft.parameters?.rotateX ?? 0);
    setInputValue("simulationRotateY", draft.parameters?.rotateY ?? 0);
    setInputValue("simulationRotateZ", draft.parameters?.rotateZ ?? 0);
    setInputValue("simulationScale", draft.parameters?.scale ?? 1);
    setInputValue("simulationCustomParameters", draft.parameters?.customParameters || "");
    renderSurgicalSimulationModelOptions();
    const select = byId("surgicalSimulationBeforeModel");
    if (select && draft.jobId && readyCaseModels().some(item => item.jobId === draft.jobId)) select.value = draft.jobId;
    renderSurgicalSimulation();
  }

  function renderSurgicalSimulation() {
    const summary = byId("surgicalSimulationSummary");
    const list = byId("surgicalSimulationList");
    const draft = readSurgicalSimulationForm();
    if (summary) {
      summary.textContent = state.currentCaseId
        ? `case ${state.currentCaseId} · ${state.surgicalSimulations.length} simulation(s) · ${simulationParameterSummary(draft.parameters)}`
        : "Select a case and ready model to prepare a surgical simulation.";
    }
    if (!list) return;
    if (!state.surgicalSimulations.length) {
      list.innerHTML = '<div class="hint">No surgical simulations yet.</div>';
      return;
    }
    list.innerHTML = state.surgicalSimulations.map(simulation => `
      <div class="reconstruction-history-row" data-simulation-id="${escapeHtml(simulation.simulationId)}">
        <div class="reconstruction-history-main">
          <strong>${escapeHtml(simulationTypeLabel(simulation.simulationType))}</strong>
          <div class="reconstruction-history-id">${escapeHtml(simulation.simulationId)}</div>
          <div class="reconstruction-history-id">before ${escapeHtml(simulation.jobId || simulation.originalModelId || "—")} · simulated ${escapeHtml(simulation.simulatedModelId || "—")}</div>
        </div>
        <div class="reconstruction-history-cell">${escapeHtml(simulationParameterSummary(simulation.parameters))}</div>
        <div class="reconstruction-history-cell">${Number(simulation.warnings?.length || 0)} warnings</div>
        <div class="reconstruction-history-cell">${escapeHtml(formatDateTime(simulation.updatedAt || simulation.createdAt))}</div>
        <div class="reconstruction-history-actions">
          <button class="btn btn-sm" data-simulation-action="open-before">before</button>
          <button class="btn btn-sm" data-simulation-action="open-simulated">simulated</button>
          <button class="btn btn-sm" data-simulation-action="use-comparison">compare</button>
        </div>
      </div>
    `).join("");
  }

  async function loadSurgicalSimulations() {
    if (isDemoMode()) {
      state.surgicalSimulations = [];
      renderSurgicalSimulationModelOptions();
      renderSurgicalSimulation();
      return;
    }
    if (!api()?.listSurgicalSimulations || !state.currentCaseId) {
      state.surgicalSimulations = [];
      renderSurgicalSimulationModelOptions();
      renderSurgicalSimulation();
      return;
    }
    try {
      state.surgicalSimulations = await api().listSurgicalSimulations({ caseId: state.currentCaseId });
      renderSurgicalSimulationModelOptions();
      renderSurgicalSimulation();
    } catch (err) {
      setError(apiErrorMessage(err, "Surgical simulations unavailable."));
    }
  }

  async function runSurgicalSimulation() {
    if (!api()?.saveSurgicalSimulation || !state.currentCaseId) {
      setError("Select a case before running surgical simulation.");
      return;
    }
    if (!canSavePatientData()) {
      setModeBlocked("Demo mode cannot save surgical simulations.");
      return;
    }
    const draft = readSurgicalSimulationForm();
    const model = readyCaseModels().find(item => item.jobId === draft.jobId);
    if (!model?.resultGlbUrl) {
      setError("Select a ready before model before running simulation.");
      return;
    }
    try {
      const simulation = await api().saveSurgicalSimulation({
        ...draft,
        modelId: model.resultGlbUrl,
        originalModelId: model.resultGlbUrl,
        simulatedModelId: `${model.resultGlbUrl}:simulation:${Date.now().toString(36)}`,
        originalModel: {
          modelId: model.resultGlbUrl,
          jobId: model.jobId,
          resultGlbUrl: model.resultGlbUrl,
          createdAt: model.createdAt,
          readinessScore: model.readinessScore || 0,
          warningsCount: model.warningsCount || 0
        },
        simulatedModel: {
          sourceModelId: model.resultGlbUrl,
          resultGlbUrl: model.resultGlbUrl,
          createdAt: new Date().toISOString()
        },
        warnings: [
          "Foundation only: simulated model metadata is stored; real mesh deformation is a future integration.",
          "Existing PMAS viewer is reused and opens the available GLB for review."
        ]
      });
      state.currentSimulation = simulation;
      await loadSurgicalSimulations();
      await loadCases();
      await loadComparisonModels();
      await loadCaseTimeline();
      await loadAuditLog();
      await loadClinicalInsights({ generate: true });
      state.currentCaseReport = null;
      state.clinicalReportDraft = buildClinicalReportSnapshot(state.currentCaseReport || {});
      renderClinicalReportBuilder();
      setStatusText(`Surgical simulation saved: ${simulation.simulationId}`);
      scheduleSessionAutoSave();
    } catch (err) {
      setError(apiErrorMessage(err, "Surgical simulation failed."));
    }
  }

  async function openSurgicalSimulationModel(simulation, kind) {
    const model = kind === "simulated" ? simulation?.simulatedModel : simulation?.originalModel;
    const resultUrl = model?.resultGlbUrl || simulation?.modelId || "";
    const label = kind === "simulated" ? (simulation?.simulatedModelId || simulation?.simulationId) : (simulation?.jobId || simulation?.originalModelId || simulation?.modelId);
    if (!resultUrl) {
      setError(`Simulation ${kind} model is not available.`);
      return;
    }
    await openResultUrlIn3DViewer(resultUrl, label, "");
    setStatusText(`Surgical simulation ${kind} model opened in existing PMAS viewer.`);
  }

  async function handleSurgicalSimulationClick(event) {
    const button = event.target.closest("[data-simulation-action]");
    if (!button) return;
    const row = button.closest("[data-simulation-id]");
    const simulationId = row?.dataset?.simulationId || "";
    const simulation = state.surgicalSimulations.find(item => item.simulationId === simulationId);
    if (!simulation) return;
    const action = button.dataset.simulationAction;
    if (action === "open-before") await openSurgicalSimulationModel(simulation, "before");
    if (action === "open-simulated") await openSurgicalSimulationModel(simulation, "simulated");
    if (action === "use-comparison") {
      setInputValue("comparisonBeforeModel", simulation.jobId || "");
      setInputValue("comparisonMode", "overlay");
      setInputValue("comparisonNotes", `Surgical simulation ${simulation.simulationId}: ${simulationTypeLabel(simulation.simulationType)}. Simulated model ${simulation.simulatedModelId || "metadata only"}.`);
      renderComparisonDetails();
      setStatusText("Simulation linked to Before/After Comparison metadata. Existing viewer opens one GLB at a time until real simulated GLB export is integrated.");
    }
  }

  function demoCaseTimeline() {
    const entries = DEMO_HISTORY.map(item => ({
      entryId: `timeline-entry-${item.jobId}`,
      caseId: DEMO_CASE_ID,
      modelId: item.resultGlbUrl || item.jobId,
      reconstructionJobId: item.jobId,
      entryType: "reconstruction",
      title: "Demo reconstruction",
      description: `Demo model · readiness ${item.readinessLevel || "medium"}`,
      createdAt: item.createdAt
    }));
    return {
      timelineId: `timeline-${DEMO_CASE_ID}`,
      caseId: DEMO_CASE_ID,
      entries,
      createdAt: entries[entries.length - 1]?.createdAt || DEMO_CASES[0].createdAt,
      updatedAt: entries[0]?.createdAt || DEMO_CASES[0].updatedAt
    };
  }

  function timelineTypeLabel(type) {
    const labels = {
      reconstruction: "reconstruction",
      simulation: "simulation",
      report: "report",
      measurement_snapshot: "measurement snapshot",
      note: "note",
      insight_generated: "insight generated",
      insight_reviewed: "insight reviewed",
      qa_check_completed: "QA check completed",
      qa_issue_detected: "QA issue detected",
      readiness_check_completed: "readiness check completed",
      release_created: "release created",
      release_promoted: "release promoted",
      release_archived: "release archived"
    };
    return labels[type] || String(type || "note").replace(/_/g, " ");
  }

  function timelineComparableEntries() {
    return (state.caseTimeline?.entries || [])
      .filter(item => item.entryType === "reconstruction" || item.entryType === "simulation")
      .filter(item => item.reconstructionJobId || item.modelId)
      .slice()
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }

  function previousTimelineModelEntry(entry) {
    const comparable = timelineComparableEntries();
    const index = comparable.findIndex(item => item.entryId === entry.entryId);
    return index >= 0 ? comparable[index + 1] || null : null;
  }

  function renderCaseTimeline() {
    const summary = byId("caseTimelineSummary");
    const list = byId("caseTimelineList");
    const entries = state.caseTimeline?.entries || [];
    if (summary) {
      summary.textContent = state.currentCaseId
        ? `${entries.length} timeline event(s) · ${state.caseTimeline?.timelineId || `timeline-${state.currentCaseId}`}`
        : "Select a patient case to view the timeline.";
    }
    if (!list) return;
    if (!entries.length) {
      list.innerHTML = '<div class="hint">No timeline events yet.</div>';
      return;
    }
    list.innerHTML = entries.map(entry => {
      const canOpen = ["reconstruction", "simulation", "report", "measurement_snapshot", "note"].includes(entry.entryType);
      const canCompare = Boolean(previousTimelineModelEntry(entry));
      return `
        <div class="reconstruction-history-row" data-timeline-entry-id="${escapeHtml(entry.entryId)}">
          <div class="reconstruction-history-main">
            <strong>${escapeHtml(entry.title || timelineTypeLabel(entry.entryType))}</strong>
            <div class="reconstruction-history-id">${escapeHtml(formatDateTime(entry.createdAt))}</div>
            <div class="reconstruction-history-id">model ${escapeHtml(entry.modelId || entry.reconstructionJobId || "—")}</div>
          </div>
          <div class="reconstruction-history-cell">${escapeHtml(timelineTypeLabel(entry.entryType))}</div>
          <div class="reconstruction-history-cell">${escapeHtml(entry.description || "—")}</div>
          <div class="reconstruction-history-actions">
            <button class="btn btn-sm" data-timeline-action="open" ${canOpen ? "" : "disabled"}>Open</button>
            <button class="btn btn-sm" data-timeline-action="compare-previous" ${canCompare ? "" : "disabled"}>Compare With Previous</button>
          </div>
        </div>
      `;
    }).join("");
  }

  async function loadCaseTimeline() {
    if (isDemoMode()) {
      state.caseTimeline = state.currentCaseId === DEMO_CASE_ID ? demoCaseTimeline() : null;
      renderCaseTimeline();
      return;
    }
    if (!api()?.getPatientCaseTimeline || !state.currentCaseId) {
      state.caseTimeline = null;
      renderCaseTimeline();
      return;
    }
    try {
      state.caseTimeline = await api().getPatientCaseTimeline(state.currentCaseId);
      renderCaseTimeline();
    } catch (err) {
      state.caseTimeline = null;
      renderCaseTimeline();
      setError(apiErrorMessage(err, "Case timeline unavailable."));
    }
  }

  async function openTimelineEntry(entry) {
    if (!entry) return;
    if (entry.entryType === "reconstruction") {
      if (entry.reconstructionJobId) await openHistoryResult(entry.reconstructionJobId);
      else if (entry.modelId) await openResultUrlIn3DViewer(entry.modelId, entry.entryId, "");
      return;
    }
    if (entry.entryType === "simulation") {
      const simulation = state.surgicalSimulations.find(item => item.simulationId && entry.entryId.includes(item.simulationId))
        || state.surgicalSimulations.find(item => item.simulatedModelId === entry.modelId || item.modelId === entry.modelId);
      if (simulation) await openSurgicalSimulationModel(simulation, "simulated");
      else setError("Timeline simulation is not loaded.");
      return;
    }
    if (entry.entryType === "report") {
      const historyItem = state.historyItems.find(item => item.jobId === entry.reconstructionJobId);
      if (historyItem) await showReport(entry.reconstructionJobId);
      else await viewCaseReport(entry.caseId || state.currentCaseId);
      return;
    }
    if (entry.entryType === "measurement_snapshot") {
      const context = {
        caseId: entry.caseId || state.currentCaseId,
        jobId: entry.reconstructionJobId || "",
        modelId: entry.modelId || ""
      };
      state.activeMeasurementContext = context;
      await loadCaseMeasurements(context, true);
      setStatusText(`Measurement snapshot loaded: ${entry.description || entry.modelId || entry.entryId}`);
      return;
    }
    if (entry.entryType === "note") {
      const plan = state.surgicalPlanningNotes.find(item => item.planId && entry.entryId.includes(item.planId));
      if (plan) applySurgicalPlanningForm(plan);
      setStatusText(`Timeline note opened: ${entry.title || "note"}`);
    }
  }

  async function compareTimelineWithPrevious(entry) {
    const previous = previousTimelineModelEntry(entry);
    if (!previous) {
      setError("No previous model is available in this case timeline.");
      return;
    }
    const beforeJobId = previous.reconstructionJobId || "";
    const afterJobId = entry.reconstructionJobId || "";
    if (!beforeJobId || !afterJobId || beforeJobId === afterJobId) {
      setInputValue("comparisonBeforeModel", beforeJobId);
      setInputValue("comparisonAfterModel", afterJobId);
      setInputValue("comparisonMode", "overlay");
      setInputValue("comparisonNotes", `Timeline comparison: ${previous.title || previous.entryId} -> ${entry.title || entry.entryId}.`);
      renderComparisonDetails();
      setStatusText("Timeline comparison prepared as metadata. Select two ready reconstruction jobs to save a formal comparison.");
      return;
    }
    setInputValue("comparisonBeforeModel", beforeJobId);
    setInputValue("comparisonAfterModel", afterJobId);
    setInputValue("comparisonMode", "overlay");
    setInputValue("comparisonNotes", `Timeline comparison: ${previous.title || previous.entryId} -> ${entry.title || entry.entryId}.`);
    renderComparisonDetails();
    setStatusText("Compare With Previous prepared in the existing Before/After Comparison panel.");
  }

  async function handleCaseTimelineClick(event) {
    const button = event.target.closest("[data-timeline-action]");
    if (!button) return;
    const row = button.closest("[data-timeline-entry-id]");
    const entryId = row?.dataset?.timelineEntryId || "";
    const entry = (state.caseTimeline?.entries || []).find(item => item.entryId === entryId);
    if (!entry) return;
    if (button.dataset.timelineAction === "open") await openTimelineEntry(entry);
    if (button.dataset.timelineAction === "compare-previous") await compareTimelineWithPrevious(entry);
  }

  async function setAccessMode(mode) {
    if (!["demo", "doctor", "admin"].includes(mode)) return;
    state.accessMode = mode;
    writeAccessMode(mode);
    state.currentCaseId = "";
    state.currentJobId = null;
    state.currentJob = null;
    state.currentResult = null;
    state.activeMeasurementContext = null;
    state.caseMeasurements = [];
    state.surgicalPlanningNotes = [];
    state.surgicalSimulations = [];
    state.caseTimeline = null;
    state.caseTeam = { ownerId: "", teamMembers: [], permissions: {} };
    state.auditEvents = [];
    state.productionReadiness = [];
    state.productionReadinessSummary = null;
    state.releases = [];
    state.plugins = [];
    state.pluginSummary = null;
    applySurgicalPlanningForm(null);
    applySurgicalSimulationDraft({});
    resetJobUi();
    renderAccessModeUi();
    await loadCases();
    await loadHistory();
    await loadComparisonModels();
    await loadComparisons();
    await loadCaseTeam();
    await loadAuditLog();
    await loadClinicalInsights();
    await loadQaDashboard();
    await loadProductionReadiness();
    await loadReleases();
    await loadPlugins();
    await loadSurgicalPlanningNotes();
    await loadSurgicalSimulations();
    await loadCaseTimeline();
    await loadCaseMeasurements();
    setStatusText(`Current Mode: ${mode}`);
  }

  async function loadComparisons() {
    if (isDemoMode()) {
      state.comparisons = [];
      return;
    }
    if (!api()?.listModelComparisons || !state.currentCaseId) {
      state.comparisons = [];
      return;
    }
    try {
      state.comparisons = await api().listModelComparisons(state.currentCaseId);
    } catch (err) {
      setError(apiErrorMessage(err, "Comparisons unavailable."));
    }
  }

  async function loadComparisonModels() {
    if (isDemoMode()) {
      state.comparisonModels = state.currentCaseId === DEMO_CASE_ID ? DEMO_HISTORY.map(item => ({ ...item, settings: { ...item.settings } })) : [];
      renderComparisonOptions();
      renderSurgicalPlanningModelOptions();
      renderSurgicalSimulationModelOptions();
      return;
    }
    if (!api()?.listBackendReconstructionJobs || !state.currentCaseId) {
      state.comparisonModels = [];
      renderComparisonOptions();
      renderSurgicalSimulationModelOptions();
      return;
    }
    try {
      state.comparisonModels = await api().listBackendReconstructionJobs("ready", state.currentCaseId);
      renderComparisonOptions();
      renderSurgicalPlanningModelOptions();
      renderSurgicalSimulationModelOptions();
    } catch (err) {
      state.comparisonModels = [];
      renderComparisonOptions();
      renderSurgicalPlanningModelOptions();
      renderSurgicalSimulationModelOptions();
      setError(apiErrorMessage(err, "Comparison models unavailable."));
    }
  }

  function renderCaseOptions() {
    const select = byId("reconstructionCaseSelect");
    const historySelect = byId("reconstructionHistoryCaseFilter");
    const options = ['<option value="">Create or select a case...</option>']
      .concat(state.cases.map(item => `<option value="${escapeHtml(item.caseId)}">${escapeHtml(item.patientName || "Unnamed patient")} · ${escapeHtml(item.caseId)}</option>`));
    if (select) {
      select.innerHTML = options.join("");
      select.value = state.currentCaseId || "";
    }
    if (historySelect) {
      historySelect.innerHTML = ['<option value="all">All cases</option>']
        .concat(state.cases.map(item => `<option value="${escapeHtml(item.caseId)}">${escapeHtml(item.patientName || "Unnamed patient")}</option>`))
        .join("");
      historySelect.value = state.historyCaseFilter || "all";
    }
    renderCaseSummary();
    renderCaseDashboard();
  }

  async function loadCases() {
    if (!api()?.listPatientCases) return;
    try {
      state.cases = isDemoMode() ? DEMO_CASES.map(item => ({ ...item })) : await api().listPatientCases();
      if (state.currentCaseId && !state.cases.some(item => item.caseId === state.currentCaseId)) {
        state.currentCaseId = "";
      }
      renderCaseOptions();
      renderCaseDashboard();
      renderAccessModeUi();
    } catch (err) {
      setError(apiErrorMessage(err, "Cases unavailable."));
    }
  }

  async function loadCaseTeam() {
    if (isDemoMode()) {
      const caseItem = state.currentCaseId === DEMO_CASE_ID ? DEMO_CASES[0] : null;
      state.caseTeam = {
        ownerId: caseItem?.ownerId || "",
        teamMembers: caseItem?.teamMembers ? caseItem.teamMembers.map(member => ({ ...member, permissions: [...(member.permissions || [])] })) : [],
        permissions: caseItem?.permissions || {}
      };
      renderCaseTeam();
      renderCaseSummary();
      return;
    }
    if (!api()?.listCaseTeamMembers || !state.currentCaseId) {
      state.caseTeam = { ownerId: "", teamMembers: [], permissions: {} };
      renderCaseTeam();
      renderCaseSummary();
      return;
    }
    try {
      const team = await api().listCaseTeamMembers(state.currentCaseId);
      state.caseTeam = {
        ownerId: team.ownerId || "",
        teamMembers: team.teamMembers || [],
        permissions: team.permissions || {}
      };
      renderCaseTeam();
      renderCaseSummary();
    } catch (err) {
      setError(apiErrorMessage(err, "Case team unavailable."));
    }
  }

  async function addCaseTeamMember() {
    if (!api()?.saveCaseTeamMember || !state.currentCaseId) {
      setError("Select a case before adding team members.");
      return;
    }
    if (!canSavePatientData()) {
      setModeBlocked("Demo mode cannot save real patient team data.");
      return;
    }
    const input = {
      name: byId("caseTeamMemberName")?.value || "",
      email: byId("caseTeamMemberEmail")?.value || "",
      role: byId("caseTeamMemberRole")?.value || "viewer"
    };
    if (!input.name.trim()) {
      setError("Team member name is required.");
      return;
    }
    try {
      await api().saveCaseTeamMember(state.currentCaseId, input);
      setInputValue("caseTeamMemberName", "");
      setInputValue("caseTeamMemberEmail", "");
      setInputValue("caseTeamMemberRole", "viewer");
      await loadCaseTeam();
      await loadAuditLog();
      await loadCases();
      state.currentCaseReport = null;
      setStatusText("Case team member added.");
      scheduleSessionAutoSave();
    } catch (err) {
      setError(apiErrorMessage(err, "Team member save failed."));
    }
  }

  async function handleCaseTeamClick(event) {
    const button = event.target.closest("[data-team-action]");
    if (!button || !state.currentCaseId) return;
    if (!canSavePatientData()) {
      setModeBlocked("Demo mode cannot modify case team data.");
      return;
    }
    const row = button.closest("[data-team-member-id]");
    const memberId = row?.dataset?.teamMemberId || "";
    if (!memberId) return;
    const action = button.dataset.teamAction;
    try {
      if (action === "change-role") {
        const role = row.querySelector("[data-team-role]")?.value || "viewer";
        await api().updateCaseTeamMemberRole(state.currentCaseId, memberId, role);
        setStatusText("Case team member role updated.");
      }
      if (action === "remove") {
        await api().removeCaseTeamMember(state.currentCaseId, memberId);
        setStatusText("Case team member removed.");
      }
      await loadCaseTeam();
      await loadAuditLog();
      await loadCases();
      state.currentCaseReport = null;
      scheduleSessionAutoSave();
    } catch (err) {
      setError(apiErrorMessage(err, "Case team update failed."));
    }
  }

  async function createCaseFromForm() {
    if (!api()?.createPatientCase || state.busy) return;
    if (!canSavePatientData()) {
      setModeBlocked("Demo mode is not intended for storing real patient data.");
      return;
    }
    const patientName = byId("reconstructionCasePatientName")?.value || "";
    const patientId = byId("reconstructionCasePatientId")?.value || "";
    const notes = byId("reconstructionCaseNotes")?.value || "";
    try {
      const caseItem = await api().createPatientCase({ patientName, patientId, notes });
      state.currentCaseId = caseItem.caseId;
      await loadCases();
      await loadComparisonModels();
      await loadHistory();
      await loadCaseTeam();
      await loadAuditLog();
      await loadClinicalInsights();
      await loadQaDashboard();
      await loadProductionReadiness();
      await loadReleases();
      await loadPlugins();
      await loadSurgicalPlanningNotes();
      await loadSurgicalSimulations();
      await loadCaseTimeline();
      applySurgicalPlanningForm(null);
      applySurgicalSimulationDraft({});
      setStatusText(`Case selected: ${caseItem.patientName}`);
      await prepareSelectedFilesForUpload();
      scheduleSessionAutoSave();
    } catch (err) {
      setError(apiErrorMessage(err, "Case creation failed."));
    }
  }

  async function openCaseFromDashboard(caseId) {
    if (!caseId) return;
    state.currentCaseId = caseId;
    state.currentSurgicalPlanId = "";
    state.activeMeasurementContext = null;
    applySurgicalPlanningForm(null);
    applySurgicalSimulationDraft({});
    renderCaseOptions();
    renderJob(currentJob());
    await Promise.all([
      loadComparisonModels(),
      loadComparisons(),
      loadCaseMeasurements(),
      loadCaseLandmarks(),
      loadCaseTeam(),
      loadAuditLog(),
      loadClinicalInsights(),
      loadQaDashboard(),
      loadProductionReadiness(),
      loadReleases(),
      loadPlugins(),
      loadSurgicalPlanningNotes(),
      loadSurgicalSimulations(),
      loadCaseTimeline()
    ]);
    setStatusText(`Case opened: ${currentCase()?.patientName || caseId}`);
    await prepareSelectedFilesForUpload();
    scheduleSessionAutoSave();
  }

  function resetCaseFormForCreate() {
    state.currentCaseId = "";
    state.currentSurgicalPlanId = "";
    state.caseTimeline = null;
    state.caseTeam = { ownerId: "", teamMembers: [], permissions: {} };
    state.auditEvents = [];
    state.clinicalInsights = [];
    state.productionReadiness = [];
    state.productionReadinessSummary = null;
    state.releases = [];
    state.plugins = [];
    state.pluginSummary = null;
    ["reconstructionCasePatientName", "reconstructionCasePatientId", "reconstructionCaseNotes"].forEach(id => {
      const el = byId(id);
      if (el) el.value = "";
    });
    applySurgicalPlanningForm(null);
    applySurgicalSimulationDraft({});
    renderCaseOptions();
    renderCaseDashboard();
    renderCaseTeam();
    renderCaseTimeline();
    renderProductionReadiness();
    renderReleaseManager();
    renderPluginManager();
    setStatusText("Ready to create a new patient case.");
    scheduleSessionAutoSave();
  }

  async function deleteCaseFromDashboard(caseId) {
    if (!api()?.deletePatientCase || !caseId) return;
    if (!canSavePatientData()) {
      setModeBlocked("Demo mode cannot delete patient cases.");
      return;
    }
    const caseItem = state.cases.find(item => item.caseId === caseId);
    const label = caseItem?.patientName ? `${caseItem.patientName} (${caseId})` : caseId;
    if (!window.confirm(`Delete case ${label}? This removes linked reconstruction jobs, reports, measurements, comparisons, and surgical notes from the case store.`)) return;
    try {
      await api().deletePatientCase(caseId);
      if (state.currentCaseId === caseId) {
        state.currentCaseId = "";
        state.currentJobId = null;
        state.currentJob = null;
        state.currentResult = null;
        state.currentReport = null;
        state.currentCaseReport = null;
        state.activeMeasurementContext = null;
        state.caseTimeline = null;
        state.caseTeam = { ownerId: "", teamMembers: [], permissions: {} };
        state.auditEvents = [];
        state.clinicalInsights = [];
        state.productionReadiness = [];
        state.productionReadinessSummary = null;
        state.releases = [];
        state.plugins = [];
        state.pluginSummary = null;
        applySurgicalPlanningForm(null);
        applySurgicalSimulationDraft({});
        resetJobUi();
      }
      await loadCases();
      await loadHistory();
      await loadComparisonModels();
      await loadComparisons();
      await loadCaseTeam();
      await loadAuditLog();
      await loadClinicalInsights();
    await loadQaDashboard();
    await loadProductionReadiness();
    await loadReleases();
    await loadPlugins();
    await loadSurgicalPlanningNotes();
      await loadSurgicalSimulations();
      await loadCaseTimeline();
      await loadCaseMeasurements();
      await loadCaseLandmarks();
      setStatusText("Patient case deleted.");
      scheduleSessionAutoSave();
    } catch (err) {
      setError(apiErrorMessage(err, "Case delete failed."));
    }
  }

  async function handleCaseDashboardClick(event) {
    const button = event.target.closest("[data-case-action]");
    if (!button) return;
    const row = button.closest("[data-case-id]");
    const caseId = row?.dataset?.caseId || "";
    if (!caseId) return;
    const action = button.dataset.caseAction;
    if (action === "open") await openCaseFromDashboard(caseId);
    if (action === "export") await downloadCaseJsonReport(caseId);
    if (action === "delete") await deleteCaseFromDashboard(caseId);
  }

  async function handleCaseDashboardFilter() {
    state.caseDashboardSearch = byId("caseDashboardSearch")?.value || "";
    state.caseDashboardStatusFilter = byId("caseDashboardStatusFilter")?.value || "all";
    state.caseDashboardSort = byId("caseDashboardSort")?.value || "updated_desc";
    renderCaseDashboard();
    scheduleSessionAutoSave();
  }

  function applyManualAdjustmentDraft(values = {}) {
    Object.entries({
      manualRotationX: values.rotationX ?? 0,
      manualRotationY: values.rotationY ?? 0,
      manualRotationZ: values.rotationZ ?? 0,
      manualPositionX: values.positionX ?? 0,
      manualPositionY: values.positionY ?? 0,
      manualPositionZ: values.positionZ ?? 0,
      manualScale: values.scale ?? 1
    }).forEach(([id, value]) => setInputValue(id, String(value)));
  }

  async function restoreSavedSession(snapshot = state.restoreCandidate) {
    if (!hasRecoverableSession(snapshot)) return;
    state.restoringSession = true;
    try {
      state.currentCaseId = snapshot.caseId || "";
      state.currentJobId = snapshot.currentJobId || "";
      state.activeMeasurementContext = snapshot.activeMeasurementContext || null;
      state.reviewJobId = snapshot.reviewDraft?.jobId || "";
      state.reviewSelection = new Set(snapshot.reviewDraft?.selectedFrames || []);
      state.caseDashboardSearch = snapshot.dashboardDraft?.search || "";
      state.caseDashboardStatusFilter = snapshot.dashboardDraft?.statusFilter || "all";
      state.caseDashboardSort = snapshot.dashboardDraft?.sort || "updated_desc";
      state.historyFilter = snapshot.historyDraft?.statusFilter || "all";
      state.historyCaseFilter = snapshot.historyDraft?.caseFilter || "all";
      if (snapshot.accessMode && ["demo", "doctor", "admin"].includes(snapshot.accessMode)) {
        state.accessMode = snapshot.accessMode;
        writeAccessMode(snapshot.accessMode);
        renderAccessModeUi();
      }
      applySettingsDraft(snapshot.settings || {});
      applyManualAdjustmentDraft(snapshot.manualAdjustmentDraft || {});
      await loadCases();
      await loadHistory();
      renderCaseOptions();
      renderCaseDashboard();

      if (state.currentJobId && api()?.getBackendReconstructionJob) {
        try {
          const job = await api().getBackendReconstructionJob(state.currentJobId);
          state.currentJob = job;
          state.currentJobId = job.jobId;
          renderJob(job);
          if (job.status === "ready") await fetchResult();
          if (ACTIVE_STATUSES.has(job.status)) {
            state.busy = true;
            startJobPolling();
          }
        } catch (err) {
          setError(apiErrorMessage(err, "Saved reconstruction job unavailable."));
        }
      }

      await loadComparisonModels();
      await loadComparisons();
      applyComparisonDraft(snapshot.comparisonDraft || {});
      await loadCaseTeam();
      await loadAuditLog();
      await loadClinicalInsights();
      await loadSurgicalPlanningNotes();
      applySurgicalPlanningForm(snapshot.surgicalDraft?.hasContent ? snapshot.surgicalDraft : null);
      await loadSurgicalSimulations();
      applySurgicalSimulationDraft(snapshot.simulationDraft?.hasContent ? snapshot.simulationDraft : {});
      await loadCaseTimeline();
      await loadCaseMeasurements(snapshot.activeMeasurementContext || state.activeMeasurementContext, false);
      await loadCaseLandmarks(snapshot.activeMeasurementContext || state.activeMeasurementContext, true);

      const modelContext = snapshot.activeMeasurementContext;
      if (modelContext?.modelId && modelContext?.jobId) {
        await openResultUrlIn3DViewer(modelContext.modelId, modelContext.jobId, snapshot.currentJobStatus === "ready" ? "" : "poor");
      }
      hideSessionRecoveryPrompt();
      setStatusText("Last Patient Case session restored.");
    } finally {
      state.restoringSession = false;
      saveCurrentSessionNow();
    }
  }

  function startCleanSession() {
    clearSavedSession();
    state.restoreCandidate = null;
    hideSessionRecoveryPrompt();
    clearReconstruction();
    resetCaseFormForCreate();
    setStatusText("Started clean Patient Case session.");
  }

  function renderHistory() {
    const list = byId("reconstructionHistoryList");
    if (!list) return;

    document.querySelectorAll("#reconstructionHistoryFilters [data-filter]").forEach(button => {
      button.classList.toggle("active", button.dataset.filter === state.historyFilter);
    });
    const caseFilter = byId("reconstructionHistoryCaseFilter");
    if (caseFilter) caseFilter.value = state.historyCaseFilter || "all";

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
          <div class="reconstruction-history-id">case ${escapeHtml(item.caseId || "—")}</div>
        </div>
        <div class="reconstruction-history-cell">${escapeHtml(item.inputType || "unknown")}</div>
        <div class="reconstruction-history-cell"><span class="badge">${escapeHtml(status)}</span></div>
        <div class="reconstruction-history-cell">${escapeHtml(quality)}</div>
        <div class="reconstruction-history-cell">${escapeHtml(readiness)}</div>
        <div class="reconstruction-history-cell">${escapeHtml(settingsSummary(item.settings))}</div>
        <div class="reconstruction-history-cell">${Number(item.warningsCount || 0)} warnings</div>
        <div class="reconstruction-history-actions">
          <button class="btn btn-sm btn-primary" data-history-action="open" ${canOpen ? "" : "disabled"}>Open Result</button>
          <button class="btn btn-sm" data-history-action="report" ${isDemoMode() ? "disabled" : ""}>View Report</button>
          <button class="btn btn-sm" data-history-action="download-report" ${isDemoMode() ? "disabled" : ""}>Download Report</button>
          <button class="btn btn-sm" data-history-action="download-case-report" ${item.caseId && !isDemoMode() ? "" : "disabled"}>Download Case Report</button>
          <button class="btn btn-sm btn-danger" data-history-action="delete" ${isDemoMode() ? "disabled" : ""}>Delete</button>
        </div>
      </div>`;
    }).join("");
  }

  async function loadHistory() {
    if (!api()) return;
    try {
      state.historyItems = isDemoMode()
        ? DEMO_HISTORY
          .filter(item => state.historyFilter === "all" || item.status === state.historyFilter)
          .filter(item => state.historyCaseFilter === "all" || item.caseId === state.historyCaseFilter)
          .map(item => ({ ...item, settings: { ...item.settings } }))
        : await api().listBackendReconstructionJobs(state.historyFilter, state.historyCaseFilter);
      renderHistory();
      renderCaseDashboard();
      renderAdminDebugLog();
    } catch (err) {
      const list = byId("reconstructionHistoryList");
      if (list) list.innerHTML = `<div class="reconstruction-error">${escapeHtml(apiErrorMessage(err, "History unavailable."))}</div>`;
      renderCaseDashboard();
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
    const mode = byId("reconstructionSegmentationMode");
    const masks = byId("reconstructionMasksCount");
    const successful = byId("reconstructionSuccessfulMasks");
    const failed = byId("reconstructionFailedMasks");
    const coverage = byId("reconstructionMaskCoverage");
    const quality = byId("reconstructionSegmentationQuality");
    const segmentationQuality = job?.segmentationQuality || "";

    if (mode) mode.textContent = job?.segmentationMode || "—";
    if (masks) masks.textContent = String(job?.masksCount || 0);
    if (successful) successful.textContent = String(job?.successfulMasksCount || 0);
    if (failed) failed.textContent = String(job?.failedMasksCount || 0);
    if (coverage) {
      const value = Number(job?.averageMaskCoverage);
      coverage.textContent = Number.isFinite(value) && value > 0 ? `${Math.round(value * 100)}%` : "—";
    }
    if (quality) {
      quality.textContent = segmentationQuality || "—";
      quality.className = segmentationQuality
        ? `badge reconstruction-quality-${segmentationQuality}`
        : "badge";
    }
  }

  function renderReconstructionEngine(job) {
    const mode = byId("reconstructionEngineMode");
    const externalStatus = byId("reconstructionExternalEngineStatus");
    const rawMeshStatus = byId("reconstructionRawMeshStatus");
    const conversionStatus = byId("reconstructionConversionStatus");
    const conversionOutput = byId("reconstructionConversionOutput");
    const frames = byId("reconstructionInputFrames");
    const quality = byId("reconstructionEngineQuality");
    const reconstructionQuality = job?.reconstructionQuality || "";

    if (mode) mode.textContent = job?.engineMode || job?.reconstructionMode || "—";
    if (externalStatus) {
      const exitCode = job?.engineExitCode;
      externalStatus.textContent = Number.isInteger(exitCode)
        ? `exit ${exitCode}`
        : job?.engineCommand
          ? "configured"
          : "mock";
    }
    if (rawMeshStatus) rawMeshStatus.textContent = job?.rawMeshPath ? "found" : "not found";
    if (conversionStatus) {
      conversionStatus.textContent = job?.conversionSuccess
        ? `${job.conversionMode || "mock"} ready`
        : job?.conversionMode
          ? `${job.conversionMode} pending`
          : "—";
    }
    if (conversionOutput) conversionOutput.textContent = job?.outputGlbPath ? "GLB" : "—";
    if (frames) frames.textContent = String(job?.inputFramesCount || 0);
    if (quality) {
      quality.textContent = reconstructionQuality || "—";
      quality.className = reconstructionQuality
        ? `badge reconstruction-quality-${reconstructionQuality}`
        : "badge";
    }
  }

  function renderCleanup(job) {
    const mode = byId("reconstructionCleanupMode");
    const success = byId("reconstructionCleanupSuccess");
    const ready = byId("reconstructionCleanedModelReady");
    const alignmentStatus = byId("reconstructionAlignmentStatus");
    const modelCentered = byId("reconstructionModelCentered");
    const scaleNormalized = byId("reconstructionScaleNormalized");
    const orientationStatus = byId("reconstructionOrientationStatus");
    const quality = byId("reconstructionCleanupQuality");
    const source = byId("reconstructionResultModelSource");
    const cleanupQuality = job?.cleanupQuality || "";

    if (mode) mode.textContent = job?.cleanupMode || "—";
    if (success) success.textContent = job?.cleanupSuccess ? "yes" : job?.cleanupMode ? "pending" : "—";
    if (ready) ready.textContent = job?.cleanedMeshPath || job?.resultGlbUrl ? "ready" : "not ready";
    if (alignmentStatus) alignmentStatus.textContent = job?.alignmentMode ? `${job.alignmentMode}${job.alignmentSuccess ? " ready" : " fallback"}` : "—";
    if (modelCentered) modelCentered.textContent = job?.modelCentered ? "yes" : job?.alignmentMode ? "no" : "—";
    if (scaleNormalized) scaleNormalized.textContent = job?.scaleNormalized ? "yes" : job?.alignmentMode ? "no" : "—";
    if (orientationStatus) orientationStatus.textContent = job?.orientationStatus || "—";
    if (quality) {
      quality.textContent = cleanupQuality || "—";
      quality.className = cleanupQuality
        ? `badge reconstruction-quality-${cleanupQuality}`
        : "badge";
    }
    if (source) source.textContent = job?.resultModelSource || "—";
  }

  function readManualAdjustmentValues() {
    return {
      rotationX: Number(byId("manualRotationX")?.value) || 0,
      rotationY: Number(byId("manualRotationY")?.value) || 0,
      rotationZ: Number(byId("manualRotationZ")?.value) || 0,
      positionX: Number(byId("manualPositionX")?.value) || 0,
      positionY: Number(byId("manualPositionY")?.value) || 0,
      positionZ: Number(byId("manualPositionZ")?.value) || 0,
      scale: Number(byId("manualScale")?.value) || 1
    };
  }

  function resetManualAdjustmentInputs() {
    [
      ["manualRotationX", 0],
      ["manualRotationY", 0],
      ["manualRotationZ", 0],
      ["manualPositionX", 0],
      ["manualPositionY", 0],
      ["manualPositionZ", 0],
      ["manualScale", 1]
    ].forEach(([id, value]) => {
      const input = byId(id);
      if (input) input.value = String(value);
    });
  }

  function renderManualAdjustment(job) {
    const card = byId("reconstructionManualAdjustment");
    const status = byId("reconstructionManualAdjustmentStatus");
    const visible = job?.status === "manual_adjustment_required";
    if (card) card.style.display = visible ? "block" : "none";
    if (status && visible) {
      const warnings = [
        ...(job.alignmentWarnings || []),
        ...(job.adjustmentWarnings || [])
      ];
      status.textContent = warnings.length
        ? `Manual adjustment required: ${warnings[0]}`
        : "Manual adjustment required before final export.";
    }
  }

  function ensureReviewSelection(job) {
    if (!job || job.status !== "review_required") return;
    if (state.reviewJobId === job.jobId && state.reviewSelection.size) return;
    state.reviewJobId = job.jobId;
    state.reviewSelection = new Set((job.selectedFrames || []).map(frameName).filter(Boolean));
  }

  function renderFrameReviewList(id, frames, sourceLabel) {
    const list = byId(id);
    if (!list) return;
    if (!frames?.length) {
      list.innerHTML = `<div class="hint">No ${escapeHtml(sourceLabel)} frames.</div>`;
      return;
    }

    list.innerHTML = frames.map(frame => {
      const name = frameName(frame);
      const checked = state.reviewSelection.has(name);
      const quality = Number.isFinite(Number(frame.qualityScore)) ? `${Math.round(Number(frame.qualityScore))}/100` : "—";
      const reason = frame.rejectionReason ? `<div class="hint">${escapeHtml(frame.rejectionReason)}</div>` : "";
      const thumb = frame.frameUrl
        ? `<img src="${escapeHtml(frame.frameUrl)}" alt="${escapeHtml(name)}" />`
        : `<span>${escapeHtml(name || "frame")}</span>`;
      return `<div class="reconstruction-review-item ${checked ? "" : "excluded"}">
        <div class="reconstruction-review-thumb">${thumb}</div>
        <div class="reconstruction-review-meta">
          <label class="reconstruction-review-toggle">
            <input type="checkbox" data-review-frame="${escapeHtml(name)}" ${checked ? "checked" : ""} />
            <span>${escapeHtml(name || "frame")}</span>
          </label>
          <span class="badge">quality ${escapeHtml(quality)}</span>
          ${reason}
        </div>
      </div>`;
    }).join("");
  }

  function renderMaskReview(job) {
    const list = byId("reconstructionMasksReview");
    if (!list) return;
    const masks = job?.segmentationMasks || [];
    if (!masks.length) {
      list.innerHTML = '<div class="hint">Masks will appear after segmentation.</div>';
      return;
    }

    list.innerHTML = masks.map(mask => {
      const selected = state.reviewSelection.has(mask.frameName || "");
      const coverage = Number(mask.coverage);
      const quality = mask.success ? (coverage >= 0.08 && coverage <= 0.75 ? "medium" : "warning") : "failed";
      const statusClass = quality === "failed" ? "failed" : "warning";
      const thumb = mask.maskUrl
        ? `<img src="${escapeHtml(mask.maskUrl)}" alt="${escapeHtml(mask.maskName || "mask")}" />`
        : `<span>${escapeHtml(mask.maskName || "mask")}</span>`;
      return `<div class="reconstruction-review-item ${selected ? "" : "excluded"}">
        <div class="reconstruction-review-thumb">${thumb}</div>
        <div class="reconstruction-review-meta">
          <strong>${escapeHtml(mask.frameName || "frame")}</strong>
          <span class="badge reconstruction-checklist-status-${escapeHtml(statusClass)}">mask ${escapeHtml(quality)}</span>
          <span class="hint">coverage ${Number.isFinite(coverage) ? `${Math.round(coverage * 100)}%` : "—"}</span>
          ${mask.warning ? `<span class="hint">${escapeHtml(mask.warning)}</span>` : ""}
        </div>
      </div>`;
    }).join("");
  }

  function renderInputReview(job) {
    const card = byId("reconstructionInputReview");
    const visible = job?.status === "review_required";
    if (card) card.style.display = visible ? "block" : "none";
    if (!visible) return;

    ensureReviewSelection(job);
    const selectedFrames = job.selectedFrames || [];
    const rejectedFrames = job.rejectedFrames || [];
    const allFrames = [...selectedFrames, ...rejectedFrames];
    const selectedCount = state.reviewSelection.size;
    const rejectedCount = allFrames.filter(frame => !state.reviewSelection.has(frameName(frame))).length;

    byId("reconstructionReviewSelectedCount").textContent = String(selectedCount);
    byId("reconstructionReviewRejectedCount").textContent = String(rejectedCount);
    byId("reconstructionReviewMasksCount").textContent = String(job.masksCount || job.segmentationMasks?.length || 0);
    byId("reconstructionReviewSummary").textContent = `${selectedCount} frame(s) selected for reconstruction. Review masks before approving.`;
    renderFrameReviewList("reconstructionSelectedFramesReview", selectedFrames, "selected");
    renderFrameReviewList("reconstructionRejectedFramesReview", rejectedFrames, "rejected");
    renderMaskReview(job);
    renderQualityList("reconstructionReviewWarnings", [
      ...(job.warnings || []),
      ...(job.frameQualityReport?.warnings || []),
      ...(job.segmentationWarnings || [])
    ]);
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
    byId("reconstructionResultAdjustmentApplied").textContent = result?.metadata?.adjustmentApplied || job?.adjustmentApplied ? "yes" : "no";
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
    renderManualAdjustment(job);
    renderInputReview(job);
    renderSettings(job);
    const checklist = renderChecklist(job);

    if (start) start.disabled = isDemoMode() || !state.currentCaseId || !state.selectedFiles.length || !state.currentJobId || state.busy || !checklist.canStart || status === "review_required";
    if (retry) retry.style.display = status === "error" || status === "canceled" ? "inline-flex" : "none";
    if (cancel) cancel.style.display = ACTIVE_STATUSES.has(status) && state.busy ? "inline-flex" : "none";
    setSettingsDisabled(!isAdminMode() || (ACTIVE_STATUSES.has(status) && state.busy));
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
        : status === "review_required"
          ? "Input review: проверьте кадры и маски перед reconstruction."
        : status === "uploaded" && (checklist.overall === "failed" || checklist.overall === "warning")
          ? checklist.reason
          : `${STATUS_LABELS[status] || status}: job ${job.jobId}`;
      setStatusText(text);
    }
    renderFiles();
    scheduleSessionAutoSave();
  }

  function resetJobUi() {
    state.currentResult = null;
    state.currentReport = null;
    state.currentCaseReport = null;
    state.reviewSelection = new Set();
    state.reviewJobId = null;
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

  async function prepareSelectedFilesForUpload() {
    if (!api()) {
      setError("Reconstruction API adapter не загружен.");
      return;
    }
    if (!state.selectedFiles.length) {
      renderJob(currentJob());
      return;
    }
    if (isDemoMode()) {
      setModeBlocked("Загрузка файлов пациента отключена в Demo mode. Выберите Doctor mode вверху страницы, затем создайте или выберите patient case.");
      renderFiles();
      return;
    }
    if (!state.currentCaseId) {
      setError("Сначала создайте или выберите patient case, затем загрузите фото/видео для reconstruction.");
      renderCaseSummary();
      renderFiles();
      return;
    }

    state.busy = false;
    try {
      const uploadResult = await api().uploadReconstructionFiles(state.selectedFiles);
      const job = await api().createBackendReconstructionJob(uploadResult, readSettings(), state.currentCaseId);
      state.uploadResult = uploadResult;
      state.currentJobId = job.jobId;
      state.currentJob = job;
      state.currentResult = null;
      state.currentReport = null;
      state.reviewSelection = new Set();
      state.reviewJobId = null;
      state.lastUploadError = "";
      setError("");
      renderJob(job);
      await loadCases();
      await loadComparisonModels();
      await loadHistory();
      if (state.uploadResult?.previewReport) renderQualityReport(state.uploadResult.previewReport);
    } catch (err) {
      state.lastUploadError = apiErrorMessage(err, "Upload failed.");
      setError(state.lastUploadError);
      renderChecklist(currentJob());
      renderFiles();
    }
  }

  async function addFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    const accepted = [];
    for (const file of incoming) {
      const duplicate = state.selectedFiles.some(item =>
        item.name === file.name && item.size === file.size && item.lastModified === file.lastModified
      );
      if (!duplicate) accepted.push(file);
    }

    const nextFiles = [...state.selectedFiles, ...accepted];
    state.selectedFiles = nextFiles;
    state.uploadResult = null;
    state.currentJobId = "";
    state.currentJob = null;
    state.currentResult = null;
    state.currentReport = null;
    renderJob(null);
    renderFiles();

    if (!nextFiles.length) {
      resetJobUi();
      return;
    }

    await prepareSelectedFilesForUpload();
  }

  async function startCurrentJob() {
    if (!api() || !state.currentJobId || state.busy) return;
    if (isDemoMode()) {
      setModeBlocked("В Demo mode можно открывать тестовые модели, но нельзя запускать reconstruction для patient files. Выберите Doctor mode.");
      return;
    }
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
    state.reviewSelection = new Set();
    state.reviewJobId = null;
    renderJob(currentJob());
    startJobPolling();
    try {
      const job = await api().startBackendReconstructionJob(state.currentJobId);
      state.currentJob = job;
      if (WAIT_STATUSES.has(job.status)) {
        state.busy = false;
        stopJobPolling();
      }
      renderJob(job);
      await loadCases();
      await loadComparisonModels();
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
      const job = await api().createBackendReconstructionJob(state.uploadResult, readSettings(), state.currentCaseId || currentJob()?.caseId || "");
      state.currentJobId = job.jobId;
      state.currentJob = job;
      state.currentResult = null;
      state.currentReport = null;
      renderJob(job);
      await loadCases();
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
      if (WAIT_STATUSES.has(job.status)) {
        state.busy = false;
        stopJobPolling();
      }
      return job;
    } catch (err) {
      setError(apiErrorMessage(err, "Network/backend unavailable."));
      return null;
    }
  }

  async function cancelCurrentJob() {
    if (!api() || !state.currentJobId) return;
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

  async function approveReview() {
    if (!api() || !state.currentJobId || state.busy) return;
    if (!state.reviewSelection.size) {
      setError("Выберите хотя бы один кадр перед reconstruction.");
      return;
    }

    state.busy = true;
    renderJob(currentJob());
    startJobPolling();
    try {
      const job = await api().approveReconstructionReview(state.currentJobId, Array.from(state.reviewSelection));
      state.currentJob = job;
      if (WAIT_STATUSES.has(job.status)) {
        state.busy = false;
        stopJobPolling();
      }
      renderJob(job);
      await loadHistory();
      if (job.status === "ready") await refreshCurrentResult();
    } catch (err) {
      state.busy = false;
      stopJobPolling();
      setError(apiErrorMessage(err, "Review approve failed."));
      await pollCurrentJob();
    }
  }

  async function rerunAnalysisFromReview() {
    if (state.busy) return;
    await retryCurrentJob();
  }

  function handleReviewToggle(event) {
    const input = event.target.closest("[data-review-frame]");
    if (!input) return;
    const name = input.dataset.reviewFrame;
    if (!name) return;
    if (input.checked) state.reviewSelection.add(name);
    else state.reviewSelection.delete(name);
    renderInputReview(currentJob());
    scheduleSessionAutoSave();
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
    const historyItem = state.historyItems.find(item => item.jobId === jobId);
    const caseId = currentJob()?.jobId === jobId
      ? (currentJob()?.caseId || state.currentCaseId)
      : (historyItem?.caseId || state.currentCaseId);
    state.activeMeasurementContext = {
      caseId: caseId || "",
      jobId,
      modelId: resultUrl
    };
    if (viewer.setCaseMeasurementContext) viewer.setCaseMeasurementContext(state.activeMeasurementContext);
    await loadCaseMeasurements(state.activeMeasurementContext, true);
    await loadCaseLandmarks(state.activeMeasurementContext, true);
    renderClinicalAnalysisPresets();
    renderLandmarkTemplates();
    renderSurgicalPlanningModelOptions();
    renderSurgicalSimulationModelOptions();
    const surgicalModelSelect = byId("surgicalPlanModel");
    if (surgicalModelSelect && readyCaseModels().some(item => item.jobId === jobId)) {
      surgicalModelSelect.value = jobId;
      renderSurgicalPlanningNotes();
    }
    byId("reconstructionStageBadge").textContent = "Opened";
    if (readinessLevel === "poor") {
      setError("Модель открыта только для визуальной проверки. Для измерений требуется повторная реконструкция или ручная проверка.");
      setStatusText("Open in 3D viewer: модель открыта с readiness warning.");
    } else {
      setStatusText("Open in 3D viewer: GLB открыт в PMAS 3D viewer.");
    }
    scheduleSessionAutoSave();
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

  async function previewManualAdjustment() {
    const job = currentJob();
    const resultUrl = job?.resultGlbUrl || job?.publicCleanedMeshUrl || "";
    if (!job || job.status !== "manual_adjustment_required" || !resultUrl) {
      setError("Manual adjustment preview недоступен: aligned GLB ещё не готов.");
      return;
    }
    await openResultUrlIn3DViewer(resultUrl, job.jobId, job.readinessLevel || "");
  }

  async function applyManualAdjustment() {
    if (!api() || !state.currentJobId || state.busy) return;
    state.busy = true;
    try {
      const job = await api().applyManualModelAdjustment(state.currentJobId, readManualAdjustmentValues());
      state.currentJob = job;
      state.busy = false;
      renderJob(job);
      await loadHistory();
      if (job.status === "ready") await refreshCurrentResult();
    } catch (err) {
      state.busy = false;
      setError(apiErrorMessage(err, "Manual adjustment failed."));
    }
  }

  async function skipManualAdjustment() {
    if (!api() || !state.currentJobId || state.busy) return;
    state.busy = true;
    try {
      const job = await api().skipManualModelAdjustment(state.currentJobId);
      state.currentJob = job;
      state.busy = false;
      renderJob(job);
      await loadHistory();
      if (job.status === "ready") await refreshCurrentResult();
    } catch (err) {
      state.busy = false;
      setError(apiErrorMessage(err, "Manual adjustment skip failed."));
    }
  }

  async function refreshCurrentResult() {
    if (!api() || !state.currentJobId) return null;
    try {
      const result = await api().getBackendReconstructionResult(state.currentJobId);
      state.currentResult = result;
      renderResultCard(currentJob());
      await loadCases();
      await loadComparisonModels();
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
      const title = byId("reconstructionReportModalTitle");
      if (title) title.textContent = "Reconstruction Report";
      if (pre) pre.textContent = JSON.stringify(report, null, 2);
      if (modal) modal.style.display = "flex";
      await loadCases();
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
      await loadCases();
      setStatusText("Reconstruction JSON report downloaded.");
    } catch (err) {
      setError(apiErrorMessage(err, "Report download failed."));
    }
  }

  async function downloadCurrentReport() {
    await downloadReport(state.currentJobId);
  }

  async function createComparisonFromForm() {
    if (!api()?.createModelComparison || !state.currentCaseId) {
      setError("Select a case before creating a comparison.");
      return;
    }
    if (!canSavePatientData()) {
      setModeBlocked("Demo mode cannot save before/after comparisons.");
      return;
    }
    const beforeJobId = byId("comparisonBeforeModel")?.value || "";
    const afterJobId = byId("comparisonAfterModel")?.value || "";
    if (!beforeJobId || !afterJobId || beforeJobId === afterJobId) {
      setError("Select two different ready models from the same case.");
      return;
    }
    try {
      const comparison = await api().createModelComparison({
        caseId: state.currentCaseId,
        beforeJobId,
        afterJobId,
        comparisonMode: byId("comparisonMode")?.value || "show_before",
        notes: byId("comparisonNotes")?.value || ""
      });
      state.currentComparison = comparison;
      await loadComparisons();
      await loadCases();
      await loadComparisonModels();
      setStatusText(`Comparison saved: ${comparison.comparisonId}`);
      scheduleSessionAutoSave();
    } catch (err) {
      setError(apiErrorMessage(err, "Comparison creation failed."));
    }
  }

  async function openComparisonModel(kind) {
    const model = selectedComparisonModel(kind === "after" ? "comparisonAfterModel" : "comparisonBeforeModel");
    if (!model?.resultGlbUrl) {
      setError(`Select a ${kind} model first.`);
      return;
    }
    await openResultUrlIn3DViewer(model.resultGlbUrl, model.jobId, model.readinessLevel || "");
    const mode = byId("comparisonMode")?.value || "show_before";
    if (mode === "overlay" || mode === "side_by_side") {
      setStatusText(`${mode} saved in comparison metadata. Existing PMAS viewer opens one model at a time.`);
    }
  }

  async function downloadComparisonReport() {
    if (!api()?.getModelComparisonReport) return;
    let comparison = state.currentComparison;
    if (!comparison) {
      await createComparisonFromForm();
      comparison = state.currentComparison;
    }
    if (!comparison?.comparisonId) return;
    try {
      const report = await api().getModelComparisonReport(comparison.comparisonId);
      triggerJsonDownload(report, comparison.comparisonId);
      await loadCases();
      setStatusText("Comparison JSON report downloaded.");
    } catch (err) {
      setError(apiErrorMessage(err, "Comparison report failed."));
    }
  }

  function closeReportModal() {
    const modal = byId("reconstructionReportModal");
    if (modal) modal.style.display = "none";
  }

  function caseReportFileStem(report) {
    const patient = String(report?.patientName || "patient").replace(/[^\w.-]+/g, "_");
    const caseId = String(report?.caseId || "case").replace(/[^\w.-]+/g, "_");
    return `pmas-case-report-${patient}-${caseId}`;
  }

  function caseReportTextLines(report) {
    const jobs = report?.reconstructionJobs || report?.jobs || [];
    const models = report?.resultModels || report?.models || [];
    const teamMembers = report?.teamMembers || [];
    const owner = report?.caseOwner || teamMembers.find(member => member.memberId === report?.ownerId) || teamMembers.find(member => member.role === "owner") || null;
    const contributors = report?.contributors || teamMembers.filter(member => member.role !== "viewer");
    const auditSummary = report?.auditSummary || {};
    const auditEvents = report?.auditEvents || auditSummary.latestEvents || [];
    const backupStatus = report?.backupStatus || {};
    const qaSummary = report?.qaSummary || state.qaSummary || {};
    const qaChecks = report?.qaChecks || state.qaChecks || [];
    const productionSummary = report?.productionReadinessSummary || state.productionReadinessSummary || {};
    const productionReadiness = report?.productionReadiness || state.productionReadiness || [];
    const releaseSummary = report?.releaseSummary || {};
    const releases = report?.releaseCandidates || state.releases || [];
    const measurements = report?.measurements || [];
    const measurementTemplateReport = report?.measurementTemplateReport || {};
    const autoMeasurementReport = report?.autoMeasurementReport || {};
    const clinicalAnalysisPresetReport = report?.clinicalAnalysisPresetReport || {};
    const landmarks = report?.landmarks || [];
    const landmarkTemplateReport = report?.landmarkTemplateReport || {};
    const aiLandmarkReport = report?.aiLandmarkReport || {};
    const timeline = report?.timeline || null;
    const comparisons = report?.comparisons || [];
    const simulations = report?.surgicalSimulations || [];
    const plans = report?.surgicalPlanningNotes || [];
    const clinicalInsights = report?.clinicalInsights || state.clinicalInsights || [];
    const warnings = report?.warnings || [];
    const lines = [
      "PMAS Patient Case Report",
      "",
      `Case ID: ${report?.caseId || "—"}`,
      `Patient: ${report?.patientName || "—"}`,
      `Patient ID: ${report?.patientId || "—"}`,
      `Created: ${formatDateTime(report?.createdAt)}`,
      `Updated: ${formatDateTime(report?.updatedAt)}`,
      `Generated: ${formatDateTime(report?.generatedAt)}`,
      `Case owner: ${owner?.name || "—"} (${owner?.email || "—"})`,
      `Team members: ${teamMembers.length}`,
      ...teamMembers.map(member => `- ${member.name || member.memberId}: ${teamRoleLabel(member.role)} · ${(member.permissions || []).join(", ") || "view_case"}`),
      `Contributors: ${contributors.map(member => member.name || member.memberId).join(", ") || "none"}`,
      `Audit events: ${Number(auditSummary.eventsCount || auditEvents.length || 0)}`,
      ...auditEvents.slice(0, 20).map(event => `- ${formatDateTime(event.timestamp)} · ${event.userName || event.userId || "Local User"} · ${AUDIT_ACTION_LABELS[event.action] || event.action} · ${event.entityType || "case"} ${event.entityId || ""}`),
      `Backup status: version ${backupStatus.backupVersion || "v1"} · local backup ${backupStatus.localBackupSupported === false ? "disabled" : "supported"} · cloud sync ${backupStatus.cloudSyncEnabled ? "enabled" : "disabled"}`,
      `QA summary: score ${Number.isFinite(Number(qaSummary.qaScore)) ? Math.round(Number(qaSummary.qaScore)) + "/100" : "—"} · readiness ${qaSummary.readinessLevel || "—"} · warnings ${qaSummary.warningsCount || 0} · failures ${qaSummary.failuresCount || 0}`,
      ...qaChecks.slice(0, 30).map(item => `- [${item.status || "warning"}:${item.severity || "medium"}] ${item.category || "system"} · ${item.title || "QA check"} · ${item.description || "—"}`),
      `Production readiness: score ${Number.isFinite(Number(productionSummary.productionScore)) ? Math.round(Number(productionSummary.productionScore)) + "/100" : "—"} · level ${productionSummary.readinessLevel || "—"} · warnings ${productionSummary.warnings || 0} · failures ${productionSummary.failedChecks || 0}`,
      ...productionReadiness.slice(0, 20).map(item => `- [${item.scope || "case"}] ${item.level || item.readinessLevel || "limited"} · ${Math.round(Number(item.score || item.productionScore || 0))}/100 · passed ${item.passedChecks || 0}, warnings ${item.warnings || 0}, failed ${item.failedChecks || 0}`),
      `Release summary: ${releaseSummary.releasesCount || releases.length || 0} release(s) · active ${releaseSummary.activeCount || releases.filter(item => item.status !== "archived").length || 0} · approved ${releaseSummary.approvedCount || 0}`,
      ...releases.slice(0, 20).map(item => `- ${item.version || "v0.1"} · ${item.status || "draft"} · QA ${Math.round(Number(item.qaScore || 0))}/100 · readiness ${Math.round(Number(item.readinessScore || 0))}/100 · ${item.name || item.releaseId}`),
      `Selected analysis presets: ${Number(clinicalAnalysisPresetReport.selectedAnalysisPresets?.length || report?.selectedAnalysisPresets?.length || 0)}`,
      ...(clinicalAnalysisPresetReport.selectedAnalysisPresets || report?.selectedAnalysisPresets || []).map(item => `- ${item.name || item.presetId}: landmarks ${item.generatedLandmarksCount || 0}, measurements ${item.generatedMeasurementsCount || 0}`),
      `Analysis preset warnings: ${(clinicalAnalysisPresetReport.warnings || []).join("; ") || "none"}`,
      "",
      `Reconstruction jobs: ${jobs.length}`,
      ...jobs.map(job => `- ${job.jobId}: ${job.status || "—"}, readiness ${job.readinessLevel || "—"} ${Number.isFinite(Number(job.readinessScore)) ? Math.round(Number(job.readinessScore)) + "/100" : "—"}, warnings ${job.warningsCount || 0}`),
      "",
      `Result models: ${models.length}`,
      ...models.map(model => `- ${model.jobId || model}: ${model.resultGlbUrl || model.modelId || model}`),
      "",
      `Measurements: ${measurements.length}`,
      `Measurement templates used: ${Number(measurementTemplateReport.templatesUsed?.length || 0)}`,
      `Generated measurements: ${Number(measurementTemplateReport.generatedMeasurementsCount || report?.generatedMeasurementsCount || 0)}`,
      `Measurement template missing landmarks: ${(measurementTemplateReport.missingLandmarks || []).join(", ") || "none"}`,
      `Calculated measurements: ${Number(autoMeasurementReport.calculatedMeasurementsCount || 0)}`,
      `Formulas used: ${(autoMeasurementReport.formulasUsed || []).join(", ") || "none"}`,
      `Auto measurement warnings: ${(autoMeasurementReport.warnings || []).join("; ") || "none"}`,
      ...measurements.map(item => `- ${item.label || item.type || item.measurementId}: ${item.type || "—"} ${measurementValueText(item)} [${item.status || "ready"}]${item.formula ? ` formula=${item.formula}` : ""}`),
      "",
      `Clinical insights: ${clinicalInsights.length}`,
      ...clinicalInsights.map(item => `- [${item.severity || "info"}] ${item.title || "Clinical observation"} · ${item.category || "custom"} · ${item.source || "clinical_insights_engine"} · ${item.description || "—"}`),
      "",
      `Case timeline entries: ${timeline?.entries?.length || report?.timelineSummary?.entriesCount || 0}`,
      ...(timeline?.entries || []).map(item => `- ${formatDateTime(item.createdAt)} · ${timelineTypeLabel(item.entryType)} · ${item.modelId || item.reconstructionJobId || "—"} · ${item.description || item.title || "—"}`),
      "",
      `Landmarks: ${landmarks.length}`,
      `Landmark templates used: ${Number(landmarkTemplateReport.templatesUsed?.length || 0)}`,
      `Placed landmarks: ${Number(landmarkTemplateReport.placedLandmarksCount || report?.placedLandmarksCount || 0)}`,
      `Missing landmarks: ${Number(landmarkTemplateReport.missingLandmarksCount || report?.missingLandmarksCount || 0)}`,
      `AI proposed landmarks: ${Number(aiLandmarkReport.proposedCount || 0)}`,
      `AI approved landmarks: ${Number(aiLandmarkReport.approvedCount || report?.aiApprovedLandmarksCount || 0)}`,
      `AI corrected landmarks: ${Number(aiLandmarkReport.correctedCount || report?.aiCorrectedLandmarksCount || 0)}`,
      `AI rejected landmarks: ${Number(aiLandmarkReport.rejectedCount || report?.aiRejectedLandmarksCount || 0)}`,
      `AI average confidence: ${Number(aiLandmarkReport.averageConfidence || report?.aiAverageConfidence || 0)}%`,
      ...landmarks.map(item => `- ${item.name || item.landmarkId}: ${item.category || "custom"} @ ${landmarkCoordsText(item)} (${item.status || "placed"}, ${item.source || "manual"})`),
      "",
      `Before/After comparisons: ${comparisons.length}`,
      ...comparisons.map(item => `- ${item.comparisonId}: before ${item.beforeJobId}, after ${item.afterJobId}, mode ${item.comparisonMode || "—"}`),
      "",
      `Surgical simulations: ${simulations.length}`,
      ...simulations.flatMap(item => [
        `- ${item.simulationId}: ${simulationTypeLabel(item.simulationType)}`,
        `  Parameters: ${simulationParameterSummary(item.parameters || {})}`,
        `  Before model: ${item.jobId || item.originalModelId || item.modelId || "—"}`,
        `  Simulated model: ${item.simulatedModelId || item.simulatedModel?.modelId || "—"}`,
        `  Warnings: ${(item.warnings || []).join("; ") || "none"}`
      ]),
      "",
      `Surgical planning notes: ${plans.length}`,
      ...plans.flatMap(plan => [
        `- ${plan.title || plan.planId}`,
        `  Procedure: ${plan.procedureType || "—"}`,
        `  Diagnosis: ${plan.diagnosis || "—"}`,
        `  Goals: ${plan.goals || "—"}`,
        `  Risks: ${plan.risks || "—"}`,
        `  Notes: ${plan.notes || "—"}`
      ]),
      "",
      `Warnings summary: ${warnings.length}`,
      ...warnings.map(item => `- ${item.jobId || "case"}: ${item.warningsCount || 0} warning(s), readiness ${item.readinessLevel || "—"}`)
    ];
    return lines;
  }

  async function fetchCaseReport(caseId = state.currentCaseId) {
    if (!api()?.getPatientCaseReport || !caseId) {
      setError("Select a case before exporting case report.");
      return null;
    }
    if (isDemoMode() && caseId === DEMO_CASE_ID) {
      const positionedStatuses = new Set(["placed", "proposed", "approved", "corrected"]);
      const landmarkTemplateReport = {
        templatesUsed: [],
        placedLandmarksCount: state.caseLandmarks.filter(item => positionedStatuses.has(item.status)).length,
        missingLandmarksCount: state.caseLandmarks.filter(item => item.status === "unplaced").length
      };
      const aiItems = aiLandmarkItems();
      const aiAverageConfidence = aiItems.length
        ? Math.round(aiItems.reduce((sum, item) => sum + (Number(item.confidence) || 0), 0) / aiItems.length)
        : 0;
      const generatedMeasurements = state.caseMeasurements.filter(item => item.source === "template" || item.templateId);
      const measurementTemplateReport = {
        templatesUsed: Array.from(new Map(generatedMeasurements.map(item => [item.templateId || "measurement-template", {
          templateId: item.templateId || "measurement-template",
          templateName: item.templateName || item.templateId || "measurement-template",
          generatedMeasurementsCount: generatedMeasurements.filter(measurement => (measurement.templateId || "measurement-template") === (item.templateId || "measurement-template")).length,
          missingLandmarks: item.missingLandmarks || []
        }])).values()),
        generatedMeasurementsCount: generatedMeasurements.length,
        missingLandmarks: Array.from(new Set(generatedMeasurements.flatMap(item => item.missingLandmarks || []))),
        measurementValues: generatedMeasurements
      };
      const autoMeasurementReport = {
        calculatedMeasurements: generatedMeasurements,
        calculatedMeasurementsCount: generatedMeasurements.length,
        formulasUsed: Array.from(new Set(generatedMeasurements.map(item => item.formula).filter(Boolean))),
        missingLandmarks: Array.from(new Set(generatedMeasurements.flatMap(item => item.missingLandmarks || []))),
        warnings: Array.from(new Set(generatedMeasurements.flatMap(item => item.warnings || [])))
      };
      const presetIds = Array.from(new Set([
        ...state.caseLandmarks.map(item => item.analysisPresetId).filter(Boolean),
        ...state.caseMeasurements.map(item => item.analysisPresetId).filter(Boolean)
      ]));
      const clinicalAnalysisPresetReport = {
        selectedAnalysisPresets: presetIds.map(presetId => {
          const preset = (state.clinicalAnalysisPresets.length ? state.clinicalAnalysisPresets : DEFAULT_CLINICAL_ANALYSIS_PRESETS)
            .find(item => item.presetId === presetId);
          return {
            presetId,
            name: preset?.name || presetId,
            generatedLandmarksCount: state.caseLandmarks.filter(item => item.analysisPresetId === presetId).length,
            generatedMeasurementsCount: state.caseMeasurements.filter(item => item.analysisPresetId === presetId).length,
            warnings: []
          };
        }),
        generatedLandmarksCount: state.caseLandmarks.filter(item => item.analysisPresetId).length,
        generatedMeasurementsCount: state.caseMeasurements.filter(item => item.analysisPresetId).length,
        warnings: Array.from(new Set([
          ...(state.analysisPresetReportDraft?.warnings || []),
          ...state.caseMeasurements.flatMap(item => item.warnings || [])
        ]))
      };
      const aiLandmarkReport = {
        aiProposedLandmarks: aiItems,
        proposedCount: aiItems.filter(item => item.status === "proposed").length,
        approvedCount: aiItems.filter(item => item.status === "approved").length,
        correctedCount: aiItems.filter(item => item.status === "corrected").length,
        rejectedCount: aiItems.filter(item => item.status === "rejected").length,
        averageConfidence: aiAverageConfidence
      };
      const timeline = demoCaseTimeline();
      const teamMembers = DEMO_CASES[0].teamMembers.map(member => ({ ...member, permissions: [...(member.permissions || [])] }));
      const caseOwner = teamMembers.find(member => member.memberId === DEMO_CASES[0].ownerId) || teamMembers[0] || null;
      const auditEvents = state.auditEvents.length ? state.auditEvents : [{
        eventId: "audit-demo-case-created",
        caseId: DEMO_CASE_ID,
        userId: "demo-member-owner",
        userName: "Demo Owner",
        action: "case_created",
        entityType: "case",
        entityId: DEMO_CASE_ID,
        timestamp: DEMO_CASES[0].createdAt,
        details: { mode: "demo" }
      }];
      return {
        ...DEMO_CASES[0],
        generatedAt: new Date().toISOString(),
        ownerId: DEMO_CASES[0].ownerId,
        caseOwner,
        teamMembers,
        teamMembersCount: teamMembers.length,
        casePermissions: DEMO_CASES[0].permissions,
        contributors: teamMembers.filter(member => member.role !== "viewer"),
        auditEvents,
        auditSummary: {
          eventsCount: auditEvents.length,
          actions: auditEvents.reduce((acc, event) => {
            acc[event.action] = (acc[event.action] || 0) + 1;
            return acc;
          }, {}),
          users: auditEvents.reduce((acc, event) => {
            acc[event.userName || event.userId || "Local User"] = (acc[event.userName || event.userId || "Local User"] || 0) + 1;
            return acc;
          }, {}),
          latestEvents: auditEvents.slice(0, 10)
        },
        reconstructionJobs: DEMO_HISTORY.map(item => ({ ...item })),
        jobs: DEMO_HISTORY.map(item => ({ ...item })),
        resultModels: [{
          jobId: DEMO_JOB_ID,
          modelId: DEMO_MODEL_URL,
          resultGlbUrl: DEMO_MODEL_URL,
          createdAt: DEMO_HISTORY[0].createdAt,
          readinessScore: DEMO_HISTORY[0].readinessScore,
          readinessLevel: DEMO_HISTORY[0].readinessLevel,
          warningsCount: DEMO_HISTORY[0].warningsCount
        }],
        readinessScores: [{ jobId: DEMO_JOB_ID, readinessScore: 72, readinessLevel: "medium" }],
        warnings: [{ jobId: DEMO_JOB_ID, warningsCount: 1, readinessLevel: "medium" }],
        measurements: state.caseMeasurements,
        measurementTemplateReport,
        measurementTemplatesUsed: measurementTemplateReport.templatesUsed,
        generatedMeasurementsCount: measurementTemplateReport.generatedMeasurementsCount,
        autoMeasurementReport,
        calculatedMeasurements: autoMeasurementReport.calculatedMeasurements,
        clinicalAnalysisPresetReport,
        selectedAnalysisPresets: clinicalAnalysisPresetReport.selectedAnalysisPresets,
        landmarks: state.caseLandmarks,
        landmarkTemplateReport,
        placedLandmarksCount: landmarkTemplateReport.placedLandmarksCount,
        missingLandmarksCount: landmarkTemplateReport.missingLandmarksCount,
        aiLandmarkReport,
        aiProposedLandmarks: aiLandmarkReport.aiProposedLandmarks,
        aiApprovedLandmarksCount: aiLandmarkReport.approvedCount,
        aiCorrectedLandmarksCount: aiLandmarkReport.correctedCount,
        aiRejectedLandmarksCount: aiLandmarkReport.rejectedCount,
        aiAverageConfidence: aiLandmarkReport.averageConfidence,
        comparisons: [],
        surgicalSimulations: state.surgicalSimulations,
        surgicalSimulationsCount: state.surgicalSimulations.length,
        simulationWarnings: Array.from(new Set(state.surgicalSimulations.flatMap(item => item.warnings || []))),
        timeline,
        timelineSummary: {
          timelineId: timeline.timelineId,
          entriesCount: timeline.entries.length,
          reconstructionEntriesCount: timeline.entries.filter(item => item.entryType === "reconstruction").length,
          simulationEntriesCount: timeline.entries.filter(item => item.entryType === "simulation").length,
          reportEntriesCount: timeline.entries.filter(item => item.entryType === "report").length,
          measurementSnapshotEntriesCount: timeline.entries.filter(item => item.entryType === "measurement_snapshot").length,
          noteEntriesCount: timeline.entries.filter(item => item.entryType === "note").length
        },
        surgicalPlanningNotes: []
      };
    }
    const report = await api().getPatientCaseReport(caseId);
    state.currentCaseReport = report;
    state.clinicalReportDraft = buildClinicalReportSnapshot(report);
    renderClinicalReportBuilder();
    await loadCases();
    await loadAuditLog();
    return report;
  }

  async function viewCaseReport(caseId = state.currentCaseId) {
    const modal = byId("reconstructionReportModal");
    const pre = byId("reconstructionReportJson");
    const title = byId("reconstructionReportModalTitle");
    try {
      const report = await fetchCaseReport(caseId);
      if (!report) return;
      if (title) title.textContent = "Patient Case Report";
      if (pre) pre.textContent = JSON.stringify(report, null, 2);
      if (modal) modal.style.display = "flex";
      setStatusText("Case report loaded.");
    } catch (err) {
      setError(apiErrorMessage(err, "Case report unavailable."));
    }
  }

  function triggerCaseJsonDownload(report) {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${caseReportFileStem(report)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function downloadCaseJsonReport(caseId = state.currentCaseId) {
    try {
      if (isDemoMode()) {
        setModeBlocked("Demo mode cannot export patient case reports.");
        return;
      }
      const report = await fetchCaseReport(caseId);
      if (!report) return;
      triggerCaseJsonDownload(report);
      setStatusText("Patient Case JSON report downloaded.");
    } catch (err) {
      setError(apiErrorMessage(err, "Case report download failed."));
    }
  }

  async function exportCasePdfReport(caseId = state.currentCaseId) {
    try {
      if (isDemoMode()) {
        setModeBlocked("Demo mode cannot export patient case reports.");
        return;
      }
      if (!window.jspdf?.jsPDF) {
        setError("PDF export unavailable: jsPDF library is not loaded.");
        return;
      }
      const report = await fetchCaseReport(caseId);
      if (!report) return;
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF("p", "mm", "a4");
      const lines = caseReportTextLines(report);
      let y = 14;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      lines.forEach(line => {
        const wrapped = pdf.splitTextToSize(line, 184);
        wrapped.forEach(part => {
          if (y > 282) {
            pdf.addPage();
            y = 14;
          }
          pdf.text(part, 12, y);
          y += 5;
        });
      });
      pdf.save(`${caseReportFileStem(report)}.pdf`);
      setStatusText("Patient Case PDF report exported.");
    } catch (err) {
      setError(apiErrorMessage(err, "Case PDF export failed."));
    }
  }

  async function exportCaseDocxReport(caseId = state.currentCaseId) {
    try {
      if (isDemoMode()) {
        setModeBlocked("Demo mode cannot export patient case reports.");
        return;
      }
      if (!window.docx) {
        setError("DOCX export unavailable: docx.js library is not loaded.");
        return;
      }
      const report = await fetchCaseReport(caseId);
      if (!report) return;
      const D = window.docx;
      const paragraphs = caseReportTextLines(report).map(line => new D.Paragraph({
        children: [new D.TextRun(line || " ")],
        spacing: { after: line ? 80 : 40 }
      }));
      const doc = new D.Document({
        sections: [{ children: paragraphs }]
      });
      const blob = await D.Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${caseReportFileStem(report)}.docx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setStatusText("Patient Case DOCX report exported.");
    } catch (err) {
      setError(apiErrorMessage(err, "Case DOCX export failed."));
    }
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
    if (action === "download-case-report") {
      const item = state.historyItems.find(historyItem => historyItem.jobId === jobId);
      await downloadCaseJsonReport(item?.caseId || state.currentCaseId);
    }
    if (action === "delete") await deleteHistoryJob(jobId);
  }

  async function handleHistoryFilter(event) {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    state.historyFilter = button.dataset.filter || "all";
    await loadHistory();
  }

  async function handleHistoryCaseFilter(event) {
    state.historyCaseFilter = event.target?.value || "all";
    await loadHistory();
  }

  function bind() {
    const input = byId("reconstructionFileInput");
    const dropzone = byId("reconstructionDropzone");
    const openFilePicker = event => {
      if (!input || event?.target === input) return;
      event?.preventDefault();
      input.click();
    };
    byId("btnStartReconstruction")?.addEventListener("click", startCurrentJob);
    byId("btnRetryReconstruction")?.addEventListener("click", retryCurrentJob);
    byId("btnCancelReconstruction")?.addEventListener("click", cancelCurrentJob);
    byId("btnClearReconstruction")?.addEventListener("click", clearReconstruction);
    byId("btnRestoreReconstructionSession")?.addEventListener("click", () => restoreSavedSession());
    byId("btnStartCleanReconstructionSession")?.addEventListener("click", startCleanSession);
    byId("reconstructionAccessMode")?.addEventListener("change", event => setAccessMode(event.target.value || "demo"));
    byId("btnCreateReconstructionCase")?.addEventListener("click", createCaseFromForm);
    byId("btnViewCaseReport")?.addEventListener("click", () => viewCaseReport());
    byId("btnDownloadCaseJsonReport")?.addEventListener("click", () => downloadCaseJsonReport());
    byId("btnExportCasePdfReport")?.addEventListener("click", () => exportCasePdfReport());
    byId("btnExportCaseDocxReport")?.addEventListener("click", () => exportCaseDocxReport());
    byId("btnExportFullBackup")?.addEventListener("click", exportFullBackup);
    byId("backupImportFile")?.addEventListener("change", handleBackupFileImport);
    byId("btnPreviewBackup")?.addEventListener("click", previewImportedBackup);
    byId("btnRestoreBackup")?.addEventListener("click", restoreImportedBackup);
    byId("btnRunQaValidation")?.addEventListener("click", runQaValidationFromUi);
    byId("btnRunProductionReadiness")?.addEventListener("click", runProductionReadinessFromUi);
    byId("btnCreateRelease")?.addEventListener("click", createReleaseFromUi);
    byId("releaseManagerList")?.addEventListener("click", handleReleaseClick);
    byId("btnRegisterPlugin")?.addEventListener("click", registerPluginFromUi);
    byId("pluginManagerList")?.addEventListener("click", handlePluginClick);
    byId("qaChecksList")?.addEventListener("click", handleQaCheckClick);
    byId("btnDashboardCreateCase")?.addEventListener("click", resetCaseFormForCreate);
    byId("caseDashboardList")?.addEventListener("click", handleCaseDashboardClick);
    byId("btnAddCaseTeamMember")?.addEventListener("click", addCaseTeamMember);
    byId("caseTeamList")?.addEventListener("click", handleCaseTeamClick);
    byId("auditActionFilter")?.addEventListener("change", handleAuditFilterChange);
    byId("auditUserFilter")?.addEventListener("change", handleAuditFilterChange);
    byId("auditDateFilter")?.addEventListener("change", handleAuditFilterChange);
    byId("caseDashboardSearch")?.addEventListener("input", handleCaseDashboardFilter);
    byId("caseDashboardStatusFilter")?.addEventListener("change", handleCaseDashboardFilter);
    byId("caseDashboardSort")?.addEventListener("change", handleCaseDashboardFilter);
    byId("reconstructionCaseSelect")?.addEventListener("change", async event => {
      state.currentCaseId = event.target.value || "";
      state.currentSurgicalPlanId = "";
      renderCaseSummary();
      renderJob(currentJob());
      loadComparisons();
      loadComparisonModels();
      loadCaseMeasurements();
      renderClinicalAnalysisPresets();
      renderClinicalReportBuilder();
      renderLandmarkTemplates();
      loadCaseTeam();
      loadClinicalInsights();
      loadSurgicalPlanningNotes();
      loadSurgicalSimulations();
      applySurgicalPlanningForm(null);
      applySurgicalSimulationDraft({});
      await prepareSelectedFilesForUpload();
    });
    byId("comparisonBeforeModel")?.addEventListener("change", renderComparisonDetails);
    byId("comparisonAfterModel")?.addEventListener("change", renderComparisonDetails);
    byId("comparisonMode")?.addEventListener("change", renderComparisonDetails);
    byId("btnCreateComparison")?.addEventListener("click", createComparisonFromForm);
    byId("btnOpenComparisonBefore")?.addEventListener("click", () => openComparisonModel("before"));
    byId("btnOpenComparisonAfter")?.addEventListener("click", () => openComparisonModel("after"));
    byId("btnDownloadComparisonReport")?.addEventListener("click", downloadComparisonReport);
    byId("clinicalAnalysisPresetsList")?.addEventListener("click", handleClinicalAnalysisPresetAction);
    byId("clinicalReportTemplateSelect")?.addEventListener("change", () => {
      state.clinicalReportDraft = null;
      renderClinicalReportBuilder();
    });
    byId("clinicalReportSectionsChecklist")?.addEventListener("change", () => {
      state.clinicalReportDraft = buildClinicalReportSnapshot(state.currentCaseReport || {});
      renderClinicalReportPreview(state.clinicalReportDraft);
    });
    byId("clinicalReportDoctorNotes")?.addEventListener("input", () => {
      state.clinicalReportDraft = buildClinicalReportSnapshot(state.currentCaseReport || {});
      renderClinicalReportPreview(state.clinicalReportDraft);
    });
    byId("btnSaveClinicalReportDraft")?.addEventListener("click", () => saveClinicalReportDraft());
    byId("btnPreviewClinicalReport")?.addEventListener("click", previewClinicalReport);
    byId("btnDownloadClinicalReportJson")?.addEventListener("click", downloadClinicalReportJson);
    byId("btnExportClinicalReportHtml")?.addEventListener("click", exportClinicalReportHtml);
    byId("btnExportClinicalReportPdf")?.addEventListener("click", exportClinicalReportPdf);
    byId("btnExportClinicalReportDocx")?.addEventListener("click", exportClinicalReportDocx);
    byId("btnCreateLandmarkTemplate")?.addEventListener("click", createLandmarkTemplate);
    byId("landmarkTemplatesList")?.addEventListener("click", handleLandmarkTemplateAction);
    byId("landmarkDetectionMode")?.addEventListener("change", event => {
      state.landmarkDetectionMode = event.target.value || "ai_assisted";
      renderAiLandmarkDetection();
    });
    byId("aiLandmarkTemplateSelect")?.addEventListener("change", event => {
      state.currentLandmarkTemplateId = event.target.value || "";
      renderAiLandmarkDetection();
    });
    byId("btnRunAiLandmarkDetection")?.addEventListener("click", runAiLandmarkDetection);
    byId("aiLandmarkDetectionList")?.addEventListener("click", handleAiLandmarkAction);
    byId("btnCreateLandmark")?.addEventListener("click", createLandmarkFromForm);
    byId("landmarksList")?.addEventListener("click", handleLandmarkAction);
    byId("btnSaveSurgicalPlanningNotes")?.addEventListener("click", saveSurgicalPlanningNotes);
    byId("surgicalPlanModel")?.addEventListener("change", renderSurgicalPlanningNotes);
    byId("surgicalPlanningNotesList")?.addEventListener("click", handleSurgicalPlanningClick);
    byId("btnRunSurgicalSimulation")?.addEventListener("click", runSurgicalSimulation);
    byId("surgicalSimulationBeforeModel")?.addEventListener("change", renderSurgicalSimulation);
    byId("surgicalSimulationType")?.addEventListener("change", renderSurgicalSimulation);
    byId("surgicalSimulationList")?.addEventListener("click", handleSurgicalSimulationClick);
    byId("btnGenerateClinicalInsights")?.addEventListener("click", generateClinicalInsightsFromUi);
    byId("clinicalInsightsList")?.addEventListener("click", handleClinicalInsightClick);
    byId("caseTimelineList")?.addEventListener("click", handleCaseTimelineClick);
    byId("measurementTemplatesList")?.addEventListener("click", handleMeasurementTemplateAction);
    byId("caseMeasurementsList")?.addEventListener("click", handleMeasurementAction);
    byId("btnApproveReconstructionReview")?.addEventListener("click", approveReview);
    byId("btnRerunReconstructionAnalysis")?.addEventListener("click", rerunAnalysisFromReview);
    byId("btnCancelReconstructionReview")?.addEventListener("click", cancelCurrentJob);
    byId("reconstructionInputReview")?.addEventListener("change", handleReviewToggle);
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
    byId("btnPreviewManualAdjustment")?.addEventListener("click", previewManualAdjustment);
    byId("btnResetManualAdjustment")?.addEventListener("click", resetManualAdjustmentInputs);
    byId("btnApplyManualAdjustment")?.addEventListener("click", applyManualAdjustment);
    byId("btnSkipManualAdjustment")?.addEventListener("click", skipManualAdjustment);
    byId("btnCloseReconstructionReport")?.addEventListener("click", closeReportModal);
    byId("reconstructionHistoryList")?.addEventListener("click", handleHistoryClick);
    byId("reconstructionHistoryFilters")?.addEventListener("click", handleHistoryFilter);
    byId("reconstructionHistoryCaseFilter")?.addEventListener("change", handleHistoryCaseFilter);
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
    byId("tabReconstruction")?.addEventListener("input", scheduleSessionAutoSave);
    byId("tabReconstruction")?.addEventListener("change", scheduleSessionAutoSave);

    input?.addEventListener("change", event => {
      addFiles(event.target.files);
      event.target.value = "";
    });
    dropzone?.addEventListener("click", openFilePicker);
    dropzone?.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      openFilePicker(event);
    });

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

    state.accessMode = readAccessMode();
    state.settings = readSettings();
    state.measurementTemplates = DEFAULT_MEASUREMENT_TEMPLATES.map(template => ({ ...template }));
    state.clinicalAnalysisPresets = DEFAULT_CLINICAL_ANALYSIS_PRESETS.map(preset => ({ ...preset }));
    state.clinicalReportTemplates = DEFAULT_REPORT_TEMPLATES.map(template => ({ ...template, sections: [...template.sections] }));
    renderAccessModeUi();
    renderBackupRecovery();
    renderQaDashboard();
    renderProductionReadiness();
    renderReleaseManager();
    renderPluginManager();
    renderClinicalAnalysisPresets();
    renderClinicalReportBuilder();
    renderMeasurementTemplates();
    window.PMASReconstructionMeasurementBridge = {
      onMeasurementChanged: handleMeasurementBridge
    };
    resetJobUi();
    state.restoreCandidate = readSavedSession();
    loadCases().then(async () => {
      await Promise.all([loadComparisonModels(), loadComparisons(), loadHistory(), loadCaseTeam(), loadAuditLog(), loadClinicalInsights(), loadQaDashboard(), loadProductionReadiness(), loadReleases(), loadPlugins(), loadSurgicalPlanningNotes(), loadSurgicalSimulations(), loadCaseTimeline(), loadCaseLandmarks(), loadLandmarkTemplates()]);
      renderSessionRecoveryPrompt(state.restoreCandidate);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
