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
    "queued",
    "processing",
    "cleaning",
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
    return {
      name: file.name,
      size: file.size,
      type: file.type || "",
      extension: getFileExtension(file),
      lastModified: file.lastModified || null
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

  function createReconstructionJob(files) {
    const fileArray = Array.from(files || []);
    const validation = validateReconstructionFiles(fileArray);
    if (!validation.ok) {
      return { ok: false, errors: validation.errors, job: null };
    }

    const timestamp = nowIso();
    const job = {
      jobId: makeJobId(),
      uploadedFiles: fileArray.map(cloneFileMeta),
      fileType: validation.fileType,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "uploaded",
      progress: 0,
      errorMessage: "",
      resultGlbUrl: "",
      preprocessingReport: null,
      preparedInput: null
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

      // TODO: Extract video frames through ffmpeg when a backend worker is connected.
      await rampJob(jobId, "processing", 40, 58, 5, 140);
      if (isJobCanceled(jobId)) return getReconstructionJob(jobId);
      // TODO: Add head segmentation before reconstruction input is sent to the engine.
      await rampJob(jobId, "processing", 58, 70, 4, 140);
      if (isJobCanceled(jobId)) return getReconstructionJob(jobId);
      // TODO: Replace this mock stage with the real 3D reconstruction engine call.

      // TODO: Run mesh cleanup after reconstruction produces raw geometry.
      await rampJob(jobId, "cleaning", 70, 82, 4, 130);
      if (isJobCanceled(jobId)) return getReconstructionJob(jobId);

      // TODO: Export the produced mesh as GLB instead of returning the bundled mock model.
      await rampJob(jobId, "exporting", 82, 95, 5, 120);
      if (isJobCanceled(jobId)) return getReconstructionJob(jobId);

      return await completeJobWithMockGlb(jobId);
    } catch (err) {
      return failJob(jobId, err?.message || "Reconstruction pipeline завершился с ошибкой.");
    }
  }

  function getReconstructionJob(jobId) {
    return cloneJob(jobs.get(jobId));
  }

  window.PMASReconstructionPipeline = {
    createReconstructionJob,
    validateReconstructionFiles,
    startReconstructionJob,
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
