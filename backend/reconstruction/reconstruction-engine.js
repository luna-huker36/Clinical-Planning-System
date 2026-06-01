const fs = require("fs/promises");
const path = require("path");

const RECONSTRUCTION_MODE = "mock";
const ENGINE_NAME = "PMAS Mock Reconstruction Engine";
const MOCK_INPUT_MODEL = path.resolve(__dirname, "../../models/LeePerrySmith.glb");

function getJobDatasetDir(job) {
  return path.resolve(__dirname, "../tmp/jobs", job.jobId, "dataset");
}

function getJobReconstructionDir(job) {
  return path.resolve(__dirname, "../tmp/jobs", job.jobId, "reconstruction");
}

function getSafeFrameNames(frames) {
  return Array.from(frames || []).map(frame => frame.fileName).filter(Boolean);
}

function getInputMasksCount(job) {
  return Number(job.masksCount || 0);
}

function getReconstructionQuality(inputFramesCount, inputMasksCount) {
  const usable = Math.min(inputFramesCount, inputMasksCount || inputFramesCount);
  if (usable >= 20) return "good";
  if (usable >= 5) return "medium";
  return "poor";
}

function getReconstructionWarnings(inputFramesCount, inputMasksCount) {
  const warnings = [];
  if (inputFramesCount < 15) warnings.push("Недостаточно кадров для уверенной 3D-реконструкции");
  if (inputMasksCount < 15) warnings.push("Недостаточно segmentation masks для стабильной очистки фона");
  return warnings;
}

async function prepareReconstructionDataset(job) {
  const datasetPath = getJobDatasetDir(job);
  await fs.mkdir(datasetPath, { recursive: true });
  const inputFramesCount = Number(job.selectedFramesCount || 0);
  const inputMasksCount = getInputMasksCount(job);
  const dataset = {
    jobId: job.jobId,
    mode: RECONSTRUCTION_MODE,
    frames: getSafeFrameNames(job.selectedFrames),
    inputFramesCount,
    inputMasksCount,
    segmentationMode: job.segmentationMode || "mock",
    createdAt: new Date().toISOString()
  };

  await fs.writeFile(path.join(datasetPath, "dataset.json"), JSON.stringify(dataset, null, 2));
  return {
    datasetPath,
    inputFramesCount,
    inputMasksCount
  };
}

async function runReconstructionEngine(datasetPath, options = {}) {
  const job = options.job;
  if (!job) throw new Error("Reconstruction job is required for mock engine.");

  // TODO: Add COLMAP adapter.
  // TODO: Add Meshroom / AliceVision adapter.
  // TODO: Add OpenMVG + OpenMVS adapter.
  // TODO: Add Gaussian Splatting / NeRF pipeline.
  // TODO: Add Blender post-processing handoff.
  // TODO: Add GPU worker queue and Docker worker execution.
  if (options.mode === "external_engine_ready") {
    // External engine execution will be wired here; mock remains the safe fallback.
  }

  const engineJobId = `engine-${job.jobId}`;
  const outputDir = getJobReconstructionDir(job);
  const rawMeshPath = path.join(outputDir, "raw-model.glb");
  await fs.mkdir(outputDir, { recursive: true });

  try {
    await fs.access(MOCK_INPUT_MODEL);
  } catch (err) {
    throw new Error("Mock input GLB для reconstruction engine не найден.");
  }

  await fs.copyFile(MOCK_INPUT_MODEL, rawMeshPath);
  return {
    engineJobId,
    rawMeshPath,
    engineName: ENGINE_NAME,
    reconstructionMode: RECONSTRUCTION_MODE
  };
}

async function monitorReconstructionProgress(engineJobId) {
  return {
    engineJobId,
    status: "finished",
    progress: 100
  };
}

async function getReconstructionOutput(engineJobId, options = {}) {
  return {
    engineJobId,
    rawMeshPath: options.rawMeshPath || ""
  };
}

async function cancelReconstructionEngineJob(engineJobId) {
  return {
    engineJobId,
    canceled: true
  };
}

async function validateReconstructionOutput(outputPath) {
  try {
    const stats = await fs.stat(outputPath);
    return {
      ok: stats.isFile() && stats.size > 0,
      size: stats.size
    };
  } catch (err) {
    return {
      ok: false,
      size: 0,
      errorMessage: "Reconstruction output mesh не найден."
    };
  }
}

async function runMockReconstruction(job) {
  const dataset = await prepareReconstructionDataset(job);
  const engine = await runReconstructionEngine(dataset.datasetPath, { job, mode: RECONSTRUCTION_MODE });
  await monitorReconstructionProgress(engine.engineJobId);
  const output = await getReconstructionOutput(engine.engineJobId, { rawMeshPath: engine.rawMeshPath });
  const validation = await validateReconstructionOutput(output.rawMeshPath);
  if (!validation.ok) {
    throw new Error(validation.errorMessage || "Reconstruction output mesh некорректен.");
  }

  return {
    reconstructionMode: RECONSTRUCTION_MODE,
    engineName: ENGINE_NAME,
    engineJobId: engine.engineJobId,
    datasetPath: dataset.datasetPath,
    inputFramesCount: dataset.inputFramesCount,
    inputMasksCount: dataset.inputMasksCount,
    rawMeshPath: output.rawMeshPath,
    reconstructionWarnings: getReconstructionWarnings(dataset.inputFramesCount, dataset.inputMasksCount),
    reconstructionQuality: getReconstructionQuality(dataset.inputFramesCount, dataset.inputMasksCount)
  };
}

module.exports = {
  prepareReconstructionDataset,
  runReconstructionEngine,
  monitorReconstructionProgress,
  getReconstructionOutput,
  cancelReconstructionEngineJob,
  validateReconstructionOutput,
  runMockReconstruction
};
