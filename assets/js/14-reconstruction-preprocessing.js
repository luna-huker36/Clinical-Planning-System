(function () {
  const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png"]);
  const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm"]);
  const RECOMMENDATIONS = {
    morePhotos: "Добавьте больше фото с разных углов.",
    orbitVideo: "Видео должно быть снято вокруг головы.",
    lighting: "Избегайте размытия и плохого света.",
    idealCapture: "Для лучшего результата используйте 20-40 фото или видео 20-40 секунд."
  };

  function getExtension(file) {
    return String(file?.extension || file?.name || "").split(".").pop().toLowerCase();
  }

  function isImage(file) {
    return IMAGE_EXTENSIONS.has(getExtension(file));
  }

  function isVideo(file) {
    return VIDEO_EXTENSIONS.has(getExtension(file));
  }

  function detectInputType(files) {
    const fileArray = Array.from(files || []);
    let hasPhotos = false;
    let hasVideo = false;

    for (const file of fileArray) {
      if (isImage(file)) hasPhotos = true;
      if (isVideo(file)) hasVideo = true;
    }

    if (hasPhotos && hasVideo) return "mixed";
    if (hasPhotos) return "photos";
    if (hasVideo) return "video";
    return "unknown";
  }

  function loadImageMetadata(file) {
    return new Promise(resolve => {
      if (!file || typeof URL === "undefined" || typeof Image === "undefined" || !(file instanceof Blob)) {
        resolve({ width: null, height: null, warning: "Не удалось прочитать разрешение изображения." });
        return;
      }

      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ width: img.naturalWidth || null, height: img.naturalHeight || null, warning: "" });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ width: null, height: null, warning: "Не удалось прочитать разрешение изображения." });
      };
      img.src = url;
    });
  }

  function loadVideoMetadata(file) {
    return new Promise(resolve => {
      if (!file || typeof URL === "undefined" || typeof document === "undefined" || !(file instanceof Blob)) {
        resolve({ duration: null, width: null, height: null, warning: "Не удалось прочитать длительность видео." });
        return;
      }

      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve({
          duration: Number.isFinite(video.duration) ? video.duration : null,
          width: video.videoWidth || null,
          height: video.videoHeight || null,
          warning: ""
        });
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ duration: null, width: null, height: null, warning: "Не удалось прочитать длительность видео." });
      };
      video.src = url;
    });
  }

  async function analyzeUploadedFiles(files) {
    const fileArray = Array.from(files || []);
    const inputType = detectInputType(fileArray);
    const warnings = [];
    const recommendations = new Set([RECOMMENDATIONS.lighting, RECOMMENDATIONS.idealCapture]);
    const formats = Array.from(new Set(fileArray.map(getExtension).filter(Boolean))).sort();
    const totalBytes = fileArray.reduce((sum, file) => sum + (file.size || 0), 0);
    const photos = fileArray.filter(isImage);
    const videos = fileArray.filter(isVideo);

    if (inputType === "photos" || inputType === "mixed") {
      if (photos.length < 10) {
        warnings.push("Фото меньше 10: данных может быть недостаточно для reconstruction.");
        recommendations.add(RECOMMENDATIONS.morePhotos);
      } else if (photos.length < 20) {
        recommendations.add("Добавьте ещё фото, чтобы приблизиться к диапазону 20-40 кадров.");
      } else if (photos.length >= 40) {
        recommendations.add("Покрытие фото выглядит достаточным для будущей reconstruction.");
      }
    }

    if (inputType === "video" || inputType === "mixed") {
      recommendations.add(RECOMMENDATIONS.orbitVideo);
    }

    // TODO: Add blur detection for photos and extracted video frames.
    // TODO: Add angle coverage estimation when camera pose analysis is available.
    const imageMetadata = [];
    for (const file of photos) {
      const meta = await loadImageMetadata(file);
      if (meta.warning) warnings.push(`${file.name}: ${meta.warning}`);
      imageMetadata.push({ name: file.name, width: meta.width, height: meta.height });
    }

    const videoMetadata = [];
    for (const file of videos) {
      const meta = await loadVideoMetadata(file);
      if (meta.warning) warnings.push(`${file.name}: ${meta.warning}`);
      videoMetadata.push({ name: file.name, duration: meta.duration, width: meta.width, height: meta.height });
      if (meta.duration != null && (meta.duration < 20 || meta.duration > 40)) {
        recommendations.add("Оптимальная длительность видео для будущей reconstruction: 20-40 секунд.");
      }
    }

    if (inputType === "mixed") {
      warnings.push("Смешанный набор фото и видео будет обработан как комбинированный input.");
    }

    return {
      inputType,
      fileCount: fileArray.length,
      photoCount: photos.length,
      videoCount: videos.length,
      formats,
      totalBytes,
      imageMetadata,
      videoMetadata,
      warnings,
      recommendations: Array.from(recommendations)
    };
  }

  function estimateInputQuality(filesOrReport) {
    const report = Array.isArray(filesOrReport)
      ? {
          inputType: detectInputType(filesOrReport),
          photoCount: filesOrReport.filter(isImage).length,
          videoCount: filesOrReport.filter(isVideo).length,
          videoMetadata: []
        }
      : filesOrReport;

    if (!report || report.inputType === "unknown") return "poor";

    if (report.inputType === "photos") {
      if (report.photoCount < 10) return "poor";
      if (report.photoCount < 20) return "medium";
      return "good";
    }

    if (report.inputType === "video") {
      const duration = report.videoMetadata?.[0]?.duration;
      if (duration == null) return "medium";
      if (duration >= 20 && duration <= 40) return "good";
      return "medium";
    }

    if (report.inputType === "mixed") {
      if (report.photoCount >= 10 || report.videoCount >= 1) return "medium";
      return "poor";
    }

    return "poor";
  }

  async function prepareReconstructionInput(files) {
    const analysis = await analyzeUploadedFiles(files);
    const estimatedQuality = estimateInputQuality(analysis);

    // TODO: Extract frames with ffmpeg for video input before sending frames to reconstruction.
    return {
      inputType: analysis.inputType,
      estimatedQuality,
      files: Array.from(files || []).map(file => ({
        name: file.name,
        size: file.size,
        type: file.type || "",
        extension: getExtension(file),
        sourceKind: isImage(file) ? "photo" : isVideo(file) ? "video" : "unknown"
      })),
      analysis,
      warnings: analysis.warnings,
      recommendations: analysis.recommendations
    };
  }

  window.PMASReconstructionPreprocessing = {
    detectInputType,
    analyzeUploadedFiles,
    estimateInputQuality,
    prepareReconstructionInput
  };
})();
