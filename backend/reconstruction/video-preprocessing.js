const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { VIDEO_EXTENSIONS } = require("./constants");

const DEFAULT_FPS = 1;
const DEFAULT_MAX_FRAMES = 60;
const COMMAND_TIMEOUT_MS = 30000;
const FFMPEG_FALLBACK_WARNING = "ffmpeg/ffprobe недоступны, frame extraction выполнен в mock mode";

function isVideoFile(file) {
  return VIDEO_EXTENSIONS.has(String(file.extension || "").toLowerCase());
}

function parseFps(value) {
  if (!value || value === "0/0") return null;
  if (!value.includes("/")) return Number(value) || null;
  const [left, right] = value.split("/").map(Number);
  if (!left || !right) return null;
  return left / right;
}

function runCommand(command, args, timeoutMs = COMMAND_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out.`));
    }, timeoutMs);

    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });
    child.on("error", err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      err.toolMissing = err.code === "ENOENT";
      reject(err);
    });
    child.on("close", code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr || `${command} exited with code ${code}.`));
    });
  });
}

function fallbackMetadata(videoPath, fileMeta = {}) {
  return {
    duration: null,
    width: null,
    height: null,
    fps: null,
    size: fileMeta.size || null,
    source: "mock",
    fileName: fileMeta.name || path.basename(videoPath || "")
  };
}

async function getVideoMetadata(videoPath, fileMeta = {}) {
  if (!videoPath) {
    return {
      ...fallbackMetadata(videoPath, fileMeta),
      warning: FFMPEG_FALLBACK_WARNING
    };
  }

  try {
    const { stdout } = await runCommand("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height,avg_frame_rate,r_frame_rate:format=duration,size",
      "-of", "json",
      videoPath
    ]);
    const parsed = JSON.parse(stdout || "{}");
    const stream = parsed.streams?.[0] || {};
    return {
      duration: Number(parsed.format?.duration) || null,
      width: Number(stream.width) || null,
      height: Number(stream.height) || null,
      fps: parseFps(stream.avg_frame_rate) || parseFps(stream.r_frame_rate),
      size: Number(parsed.format?.size) || fileMeta.size || null,
      source: "ffprobe",
      fileName: fileMeta.name || path.basename(videoPath || "")
    };
  } catch (err) {
    return {
      ...fallbackMetadata(videoPath, fileMeta),
      warning: FFMPEG_FALLBACK_WARNING
    };
  }
}

async function extractFramesFromVideo(videoPath, outputDir, options = {}) {
  const fps = options.fps || DEFAULT_FPS;
  const maxFrames = options.maxFrames || DEFAULT_MAX_FRAMES;
  await fs.mkdir(outputDir, { recursive: true });

  try {
    await runCommand("ffmpeg", [
      "-y",
      "-i", videoPath,
      "-vf", `fps=${fps}`,
      "-frames:v", String(maxFrames),
      "-q:v", "2",
      path.join(outputDir, "frame-%04d.jpg")
    ], 60000);
    const files = await fs.readdir(outputDir);
    return {
      extractedFramesCount: files.filter(name => /^frame-\d+\.jpg$/i.test(name)).length,
      warning: ""
    };
  } catch (err) {
    return {
      extractedFramesCount: 0,
      warning: FFMPEG_FALLBACK_WARNING
    };
  }
}

function buildWarnings(metadata, extractedFramesCount, toolWarnings) {
  const warnings = [...toolWarnings];
  if (extractedFramesCount < 15) warnings.push("Недостаточно кадров для хорошей реконструкции");
  if (metadata.duration !== null && metadata.duration < 10) warnings.push("Видео слишком короткое");
  if ((metadata.width && metadata.width < 720) || (metadata.height && metadata.height < 720)) {
    warnings.push("Низкое разрешение может ухудшить качество модели");
  }
  return Array.from(new Set(warnings.filter(Boolean)));
}

async function preprocessVideoInputs(job) {
  const videoFile = (job.files || []).find(isVideoFile);
  if (!videoFile) {
    return {
      skipped: true,
      extractedFramesCount: 0,
      videoMetadata: null,
      warnings: [],
      framesDir: ""
    };
  }

  const framesDir = path.resolve(__dirname, "../tmp/jobs", job.jobId, "frames");
  const metadata = await getVideoMetadata(videoFile.path, videoFile);
  const toolWarnings = metadata.warning ? [metadata.warning] : [];
  delete metadata.warning;

  const extraction = videoFile.path
    ? await extractFramesFromVideo(videoFile.path, framesDir, { fps: DEFAULT_FPS, maxFrames: DEFAULT_MAX_FRAMES })
    : { extractedFramesCount: 0, warning: FFMPEG_FALLBACK_WARNING };
  if (extraction.warning) toolWarnings.push(extraction.warning);

  return {
    skipped: false,
    extractedFramesCount: extraction.extractedFramesCount,
    videoMetadata: metadata,
    warnings: buildWarnings(metadata, extraction.extractedFramesCount, toolWarnings),
    framesDir
  };
}

module.exports = {
  getVideoMetadata,
  extractFramesFromVideo,
  preprocessVideoInputs
};
