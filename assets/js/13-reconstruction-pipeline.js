(function () {
  const MAX_FILE_BYTES = 250 * 1024 * 1024;
  const MOCK_GLB_URL = "models/LeePerrySmith.glb";
  const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png"]);
  const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm"]);
  const VALID_STATUSES = new Set([
    "idle",
    "uploaded",
    "validating",
    "analyzing",
    "preparing",
    "extracting_frames",
    "analyzing_frames",
    "segmenting_head",
    "review_required",
    "queued",
    "reconstructing_3d",
    "cleaning_mesh",
    "aligning_model",
    "exporting",
    "ready",
    "canceled",
    "error"
  ]);
  const jobs = new Map();

  function nowIso() {
    return new Date().toISOString();
  }

  function makeJobId() {
    if (window.crypto?.randomUUID) return `recon-${window.crypto.randomUUID()}`;
    return `recon-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  }

  function getFileExtension(file) {
    return String(file?.name || "").split(".").pop().toLowerCase();
  }

  function cloneFileMeta(file) {
    let previewUrl = "";
    try {
      if (file instanceof Blob && IMAGE_EXTENSIONS.has(getFileExtension(file))) {
        previewUrl = URL.createObjectURL(file);
      }
    } catch (err) {
      previewUrl = "";
    }
    return {
      name: file.name,
      size: file.size,
      type: file.type || "",
      extension: getFileExtension(file),
      lastModified: file.lastModified || null,
      previewUrl
    };
  }

  function cloneJob(job) {
    if (!job) return null;
    return {
      ...job,
      uploadedFiles: job.uploadedFiles.map(file => ({ ...file }))
    };
  }

  function detectFileType(files) {
    let hasImage = false;
    let hasVideo = false;
    for (const file of files) {
      const ext = getFileExtension(file);
      if (IMAGE_EXTENSIONS.has(ext)) hasImage = true;
      if (VIDEO_EXTENSIONS.has(ext)) hasVideo = true;
    }
    if (hasImage && hasVideo) return "mixed";
    if (hasVideo) return "video";
    return "images";
  }

  function validateReconstructionFiles(files) {
    const fileArray = Array.from(files || []);
    const errors = [];

    if (!fileArray.length) {
      errors.push({
        code: "NO_FILES",
        message: "Добавьте хотя бы один файл для reconstruction."
      });
    }

    for (const file of fileArray) {
      const ext = getFileExtension(file);
      if (!IMAGE_EXTENSIONS.has(ext) && !VIDEO_EXTENSIONS.has(ext)) {
        errors.push({
          code: "UNSUPPORTED_FORMAT",
          fileName: file.name,
          message: `Формат ${file.name} не поддерживается. Разрешены JPG, JPEG, PNG, MP4, MOV, WEBM.`
        });
      }
      if (file.size > MAX_FILE_BYTES) {
        errors.push({
          code: "FILE_TOO_LARGE",
          fileName: file.name,
          message: `${file.name} превышает лимит 250 MB.`
        });
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      fileType: errors.length ? null : detectFileType(fileArray)
    };
  }

  function createReconstructionJob(files, settings = {}, caseId = "") {
    const fileArray = Array.from(files || []);
    const validation = validateReconstructionFiles(fileArray);
    if (!validation.ok) {
      return { ok: false, errors: validation.errors, job: null };
    }

    const timestamp = nowIso();
    const job = {
      jobId: makeJobId(),
      caseId: String(caseId || ""),
      uploadedFiles: fileArray.map(cloneFileMeta),
      fileType: validation.fileType,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "uploaded",
      progress: 0,
      errorMessage: "",
      resultGlbUrl: "",
      preprocessingReport: null,
      preparedInput: null,
      selectedFrames: [],
      rejectedFrames: [],
      selectedFramesCount: 0,
      rejectedFramesCount: 0,
      segmentationMasks: [],
      masksCount: 0,
      successfulMasksCount: 0,
      failedMasksCount: 0,
      averageMaskCoverage: 0,
      segmentationWarnings: [],
      segmentationQuality: "medium",
      reviewRequired: true,
      reviewedByUser: false,
      reviewCompletedAt: "",
      finalSelectedFrames: [],
      finalSelectedMasks: [],
      finalSelectedFramesCount: 0,
      manuallyExcludedFramesCount: 0,
      manuallyRestoredFramesCount: 0,
      settings: { ...settings }
    };
    jobs.set(job.jobId, job);
    return { ok: true, errors: [], job: cloneJob(job) };
  }

  function getMutableJob(jobId) {
    const job = jobs.get(jobId);
    if (!job) throw new Error("Reconstruction job не найден.");
    return job;
  }

  function updateJobProgress(jobId, status, progress) {
    if (!VALID_STATUSES.has(status)) throw new Error(`Некорректный reconstruction status: ${status}`);
    const job = getMutableJob(jobId);
    job.status = status;
    job.progress = Math.max(0, Math.min(100, Number(progress) || 0));
    job.updatedAt = nowIso();
    if (status !== "error") job.errorMessage = "";
    return cloneJob(job);
  }

  function isJobCanceled(jobId) {
    const job = getMutableJob(jobId);
    return job.status === "canceled";
  }

  function cancelReconstructionJob(jobId, reason = "Canceled by user") {
    const job = getMutableJob(jobId);
    job.status = "canceled";
    job.errorMessage = reason || "Canceled by user";
    job.resultGlbUrl = "";
    job.updatedAt = nowIso();
    return cloneJob(job);
  }

  function failJob(jobId, errorMessage) {
    const job = getMutableJob(jobId);
    job.status = "error";
    job.progress = Math.max(0, Math.min(100, job.progress || 0));
    job.errorMessage = errorMessage || "Reconstruction pipeline завершился с ошибкой.";
    job.resultGlbUrl = "";
    job.updatedAt = nowIso();
    return cloneJob(job);
  }

  async function completeJobWithMockGlb(jobId) {
    const response = await fetch(MOCK_GLB_URL, { method: "HEAD" });
    if (!response.ok) {
      return failJob(jobId, "Тестовая GLB-модель не найдена.");
    }

    const job = getMutableJob(jobId);
    job.status = "ready";
    job.progress = 100;
    job.errorMessage = "";
    job.resultGlbUrl = MOCK_GLB_URL;
    job.updatedAt = nowIso();
    return cloneJob(job);
  }

  function mockMaskDataUrl(index) {
    const hue = 185 + (index % 5) * 12;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240"><rect width="320" height="240" fill="#0f172a"/><ellipse cx="160" cy="94" rx="68" ry="76" fill="hsl(${hue},75%,65%)" opacity=".78"/><rect x="128" y="145" width="64" height="58" rx="18" fill="hsl(${hue},75%,65%)" opacity=".78"/><text x="160" y="224" text-anchor="middle" font-family="Arial" font-size="18" fill="#e2e8f0">mock mask</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function buildMockReviewData(job) {
    const images = (job.uploadedFiles || []).filter(file => IMAGE_EXTENSIONS.has(file.extension));
    const framesSource = images.length ? images : (job.uploadedFiles || []);
    const selectedFrames = framesSource.map((file, index) => ({
      fileName: file.name || `frame-${index + 1}`,
      frameUrl: file.previewUrl || "",
      qualityScore: Math.max(45, 88 - index * 3),
      blurScore: 30 + index,
      brightness: 128,
      contrast: 42,
      width: null,
      height: null,
      rejectionReason: ""
    }));
    const segmentationMasks = selectedFrames.map((frame, index) => ({
      frameName: frame.fileName,
      maskName: `mock-mask-${index + 1}.png`,
      maskUrl: mockMaskDataUrl(index),
      mode: "mock",
      width: 320,
      height: 240,
      coverage: 0.34,
      success: true,
      warning: "Нужна проверка маски перед reconstruction"
    }));
    return { selectedFrames, rejectedFrames: [], segmentationMasks };
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function rampJob(jobId, status, from, to, steps, delayMs) {
    if (isJobCanceled(jobId)) return getReconstructionJob(jobId);
    updateJobProgress(jobId, status, from);
    for (let i = 1; i <= steps; i += 1) {
      if (isJobCanceled(jobId)) return getReconstructionJob(jobId);
      await sleep(delayMs);
      if (isJobCanceled(jobId)) return getReconstructionJob(jobId);
      const value = from + ((to - from) * i) / steps;
      updateJobProgress(jobId, status, Math.round(value));
    }
    return getReconstructionJob(jobId);
  }

  async function startReconstructionJob(jobId) {
    const job = getMutableJob(jobId);
    job.resultGlbUrl = "";
    job.errorMessage = "";
    job.preprocessingReport = null;
    job.preparedInput = null;

    try {
      updateJobProgress(jobId, "validating", 5);
      const validation = validateReconstructionFiles(job.uploadedFiles);
      if (!validation.ok) {
        return failJob(jobId, validation.errors.map(error => error.message).join(" "));
      }
      await sleep(250);
      if (isJobCanceled(jobId)) return getReconstructionJob(jobId);
      updateJobProgress(jobId, "validating", 15);

      updateJobProgress(jobId, "analyzing", 18);
      await sleep(150);
      if (isJobCanceled(jobId)) return getReconstructionJob(jobId);
      const preprocessor = window.PMASReconstructionPreprocessing;
      if (!preprocessor) {
        return failJob(jobId, "Preprocessing module не загружен.");
      }
      const preprocessingReport = await preprocessor.analyzeUploadedFiles(job.uploadedFiles);
      job.preprocessingReport = {
        ...preprocessingReport,
        estimatedQuality: preprocessor.estimateInputQuality(preprocessingReport)
      };
      updateJobProgress(jobId, "analyzing", 28);

      updateJobProgress(jobId, "preparing", 30);
      if (isJobCanceled(jobId)) return getReconstructionJob(jobId);
      const preparedInput = await preprocessor.prepareReconstructionInput(job.uploadedFiles);
      if (isJobCanceled(jobId)) return getReconstructionJob(jobId);
      job.preparedInput = preparedInput;
      job.preprocessingReport = {
        ...preparedInput.analysis,
        estimatedQuality: preparedInput.estimatedQuality,
        warnings: preparedInput.warnings,
        recommendations: preparedInput.recommendations
      };
      await sleep(250);
      if (isJobCanceled(jobId)) return getReconstructionJob(jobId);
      updateJobProgress(jobId, "preparing", 35);

      updateJobProgress(jobId, "queued", 37);
      await sleep(350);
      if (isJobCanceled(jobId)) return getReconstructionJob(jobId);
      updateJobProgress(jobId, "queued", 40);

      await rampJob(jobId, "extracting_frames", 35, 45, 4, 130);
      if (isJobCanceled(jobId)) return getReconstructionJob(jobId);
      await rampJob(jobId, "analyzing_frames", 45, 55, 4, 130);
      if (isJobCanceled(jobId)) return getReconstructionJob(jobId);
      await rampJob(jobId, "segmenting_head", 55, 65, 4, 130);
      if (isJobCanceled(jobId)) return getReconstructionJob(jobId);

      const reviewData = buildMockReviewData(job);
      job.selectedFrames = reviewData.selectedFrames;
      job.rejectedFrames = reviewData.rejectedFrames;
      job.selectedFramesCount = reviewData.selectedFrames.length;
      job.rejectedFramesCount = reviewData.rejectedFrames.length;
      job.segmentationMasks = reviewData.segmentationMasks;
      job.masksCount = reviewData.segmentationMasks.length;
      job.successfulMasksCount = reviewData.segmentationMasks.length;
      job.failedMasksCount = 0;
      job.averageMaskCoverage = 0.34;
      job.segmentationWarnings = ["Нужна проверка масок перед reconstruction"];
      job.segmentationQuality = reviewData.segmentationMasks.length >= 10 ? "medium" : "poor";
      job.status = "review_required";
      job.progress = 65;
      job.reviewRequired = true;
      job.reviewedByUser = false;
      job.updatedAt = nowIso();
      return cloneJob(job);
    } catch (err) {
      return failJob(jobId, err?.message || "Reconstruction pipeline завершился с ошибкой.");
    }
  }

  async function approveReviewAndContinue(jobId, selectedFrameNames = []) {
    const job = getMutableJob(jobId);
    if (job.status !== "review_required") return failJob(jobId, "Review stage сейчас не активен.");
    const selected = new Set(Array.from(selectedFrameNames || []).map(String).filter(Boolean));
    const originalSelected = job.selectedFrames || [];
    const originalRejected = job.rejectedFrames || [];
    const allFrames = [...originalSelected, ...originalRejected];
    const finalFrames = allFrames.filter(frame => selected.has(frame.fileName));
    if (!finalFrames.length) return failJob(jobId, "Нужно выбрать хотя бы один кадр перед reconstruction.");
    const originalSelectedNames = new Set(originalSelected.map(frame => frame.fileName));
    const originalRejectedNames = new Set(originalRejected.map(frame => frame.fileName));
    const finalNames = new Set(finalFrames.map(frame => frame.fileName));
    job.selectedFrames = finalFrames;
    job.rejectedFrames = allFrames.filter(frame => !finalNames.has(frame.fileName));
    job.selectedFramesCount = finalFrames.length;
    job.rejectedFramesCount = job.rejectedFrames.length;
    job.finalSelectedFrames = finalFrames;
    job.finalSelectedMasks = (job.segmentationMasks || []).filter(mask => finalNames.has(mask.frameName));
    job.finalSelectedFramesCount = finalFrames.length;
    job.manuallyExcludedFramesCount = Array.from(originalSelectedNames).filter(name => !finalNames.has(name)).length;
    job.manuallyRestoredFramesCount = Array.from(originalRejectedNames).filter(name => finalNames.has(name)).length;
    job.reviewedByUser = true;
    job.reviewCompletedAt = nowIso();

    await rampJob(jobId, "queued", 65, 70, 3, 120);
    if (isJobCanceled(jobId)) return getReconstructionJob(jobId);
    await rampJob(jobId, "reconstructing_3d", 70, 82, 5, 130);
    if (isJobCanceled(jobId)) return getReconstructionJob(jobId);
    await rampJob(jobId, "cleaning_mesh", 82, 90, 4, 130);
    if (isJobCanceled(jobId)) return getReconstructionJob(jobId);
    await rampJob(jobId, "aligning_model", 90, 94, 3, 120);
      if (isJobCanceled(jobId)) return getReconstructionJob(jobId);

    await rampJob(jobId, "exporting", 94, 95, 3, 120);
      if (isJobCanceled(jobId)) return getReconstructionJob(jobId);

      return await completeJobWithMockGlb(jobId);
  }

  function getReconstructionJob(jobId) {
    return cloneJob(jobs.get(jobId));
  }

  window.PMASReconstructionPipeline = {
    createReconstructionJob,
    validateReconstructionFiles,
    startReconstructionJob,
    approveReviewAndContinue,
    updateJobProgress,
    cancelReconstructionJob,
    completeJobWithMockGlb,
    failJob,
    getReconstructionJob,
    constants: {
      maxFileBytes: MAX_FILE_BYTES,
      mockGlbUrl: MOCK_GLB_URL,
      statuses: Array.from(VALID_STATUSES)
    }
  };
})();
