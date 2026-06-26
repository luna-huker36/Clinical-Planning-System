const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

const ENGINE_MODES = {
  mock: "mock",
  native: "pmas_native",
  colmapReady: "colmap_ready",
  meshroomReady: "meshroom_ready",
  externalCli: "external_cli"
};
const RECONSTRUCTION_MODE = process.env.RECONSTRUCTION_ENGINE_MODE || ENGINE_MODES.native;
const RECONSTRUCTION_ENGINE_COMMAND = process.env.RECONSTRUCTION_ENGINE_COMMAND || "";
const RECONSTRUCTION_ENGINE_ARGS = process.env.RECONSTRUCTION_ENGINE_ARGS || "";
const ENGINE_NAME = "PMAS Mock Reconstruction Engine";
const { runNativeReconstruction, ENGINE_NAME: NATIVE_ENGINE_NAME } = require("./engine");
const MOCK_INPUT_MODEL = path.resolve(__dirname, "../../models/LeePerrySmith.glb");
const RAW_MESH_EXTENSIONS = new Set([".obj", ".ply", ".stl", ".glb", ".gltf"]);

function getJobDatasetDir(job) {
  return path.resolve(__dirname, "../tmp/jobs", job.jobId, "dataset");
}

function getJobReconstructionDir(job) {
  return path.resolve(__dirname, "../tmp/jobs", job.jobId, "reconstruction");
}

function getJobEngineRoot(job) {
  return path.resolve(__dirname, "../tmp/jobs", job.jobId);
}

function getJobEngineOutputDir(job) {
  return path.resolve(getJobEngineRoot(job), "output");
}

function getJobRawMeshDir(job) {
  return path.resolve(getJobEngineRoot(job), "raw_mesh");
}

function getSafeFrameNames(frames) {
  return Array.from(frames || []).map(frame => frame.fileName).filter(Boolean);
}

function getSafeMaskNames(masks) {
  return Array.from(masks || []).map(mask => mask.maskName).filter(Boolean);
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
    masks: getSafeMaskNames(job.segmentationMasks),
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

async function copyIfReadable(sourcePath, targetPath) {
  if (!sourcePath) return false;
  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    if (path.resolve(sourcePath) === path.resolve(targetPath)) return true;
    await fs.copyFile(sourcePath, targetPath);
    return true;
  } catch (err) {
    return false;
  }
}

async function prepareDatasetForEngine(job) {
  const rootDir = getJobEngineRoot(job);
  const inputFramesDir = path.join(rootDir, "input_frames");
  const masksDir = path.join(rootDir, "masks");
  const datasetPath = getJobDatasetDir(job);
  const outputDir = getJobEngineOutputDir(job);
  const rawMeshDir = getJobRawMeshDir(job);
  await Promise.all([
    fs.mkdir(inputFramesDir, { recursive: true }),
    fs.mkdir(masksDir, { recursive: true }),
    fs.mkdir(datasetPath, { recursive: true }),
    fs.mkdir(outputDir, { recursive: true }),
    fs.mkdir(rawMeshDir, { recursive: true })
  ]);

  const copiedFrames = [];
  for (const frame of Array.from(job.selectedFrames || [])) {
    const targetPath = path.join(inputFramesDir, frame.fileName || `frame-${copiedFrames.length + 1}.jpg`);
    if (await copyIfReadable(frame.framePath, targetPath)) copiedFrames.push(path.basename(targetPath));
  }

  const copiedMasks = [];
  for (const mask of Array.from(job.segmentationMasks || [])) {
    const targetPath = path.join(masksDir, mask.maskName || `mask-${copiedMasks.length + 1}.png`);
    if (await copyIfReadable(mask.maskPath, targetPath)) copiedMasks.push(path.basename(targetPath));
  }

  const dataset = {
    jobId: job.jobId,
    mode: RECONSTRUCTION_MODE,
    inputFrames: copiedFrames,
    masks: copiedMasks,
    inputFramesCount: Number(job.selectedFramesCount || copiedFrames.length),
    inputMasksCount: Number(job.masksCount || copiedMasks.length),
    segmentationMode: job.segmentationMode || "mock",
    outputDir,
    rawMeshDir,
    createdAt: new Date().toISOString()
  };
  await fs.writeFile(path.join(datasetPath, "dataset.json"), JSON.stringify(dataset, null, 2));
  return {
    datasetPath,
    inputFramesDir,
    masksDir,
    outputDir,
    rawMeshDir,
    inputFramesCount: dataset.inputFramesCount,
    inputMasksCount: dataset.inputMasksCount
  };
}

function parseEngineArgs(args, context) {
  if (!args) return [];
  return String(args)
    .split(" ")
    .map(arg => arg.trim())
    .filter(Boolean)
    .map(arg => arg
      .replaceAll("{datasetPath}", context.datasetPath)
      .replaceAll("{outputDir}", context.outputDir)
      .replaceAll("{rawMeshDir}", context.rawMeshDir)
      .replaceAll("{inputFramesDir}", context.inputFramesDir)
      .replaceAll("{masksDir}", context.masksDir));
}

function runExternalReconstructionCommand(datasetPath, options = {}) {
  const command = options.command || RECONSTRUCTION_ENGINE_COMMAND;
  if (!command) {
    return Promise.reject(new Error("External reconstruction command is not configured."));
  }

  const args = parseEngineArgs(options.args || RECONSTRUCTION_ENGINE_ARGS, {
    ...options,
    datasetPath
  });
  const startedAt = Date.now();
  const child = spawn(command, args, {
    cwd: options.cwd || path.dirname(datasetPath),
    shell: false,
    env: { ...process.env, ...(options.env || {}) }
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk.toString(); });
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });

  return new Promise(resolve => {
    child.on("error", err => {
      resolve({
        processId: child.pid || null,
        engineExitCode: -1,
        engineStdout: stdout,
        engineStderr: stderr || err.message,
        durationMs: Date.now() - startedAt
      });
    });
    child.on("close", code => {
      resolve({
        processId: child.pid || null,
        engineExitCode: Number.isInteger(code) ? code : -1,
        engineStdout: stdout,
        engineStderr: stderr,
        durationMs: Date.now() - startedAt
      });
    });
  });
}

async function monitorExternalProcess(processId) {
  return {
    processId,
    status: processId ? "finished" : "not_started"
  };
}

async function collectEngineOutput(outputDir) {
  const matches = [];
  async function walk(dir) {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(entryPath);
      if (entry.isFile() && RAW_MESH_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        matches.push(entryPath);
      }
    }
  }
  await walk(outputDir);
  matches.sort();
  return {
    rawMeshPath: matches[0] || "",
    outputCandidates: matches.map(candidate => path.basename(candidate))
  };
}

async function runReconstructionEngine(datasetPath, options = {}) {
  const job = options.job;
  if (!job) throw new Error("Reconstruction job is required for mock engine.");

  if (options.mode === ENGINE_MODES.native) {
    const outputDir = getJobReconstructionDir(job);
    const native = await runNativeReconstruction(job, {
      outputPath: path.join(outputDir, "raw-model.glb"),
      settings: options.settings,
      onProgress: options.onProgress
    });
    return {
      engineJobId: `native-${job.jobId}`,
      rawMeshPath: native.rawMeshPath,
      engineName: native.engineName || NATIVE_ENGINE_NAME,
      reconstructionMode: ENGINE_MODES.native,
      engineMode: ENGINE_MODES.native,
      engineCommand: "",
      engineExitCode: 0,
      engineStdout: JSON.stringify(native.stats),
      engineStderr: "",
      nativeWarnings: native.warnings,
      nativeQuality: native.quality,
      nativeStats: native.stats,
      nativeRealHeightMm: native.realHeightMm || null
    };
  }

  // TODO: Add COLMAP adapter.
  // TODO: Add Meshroom / AliceVision adapter.
  // TODO: Add OpenMVG + OpenMVS adapter.
  // TODO: Add Gaussian Splatting / NeRF pipeline.
  // TODO: Add Blender post-processing handoff.
  // TODO: Add GPU worker queue and Docker worker execution.
  if (options.mode === ENGINE_MODES.externalCli) {
    const commandResult = await runExternalReconstructionCommand(datasetPath, options);
    await monitorExternalProcess(commandResult.processId);
    const output = await collectEngineOutput(options.outputDir || getJobEngineOutputDir(job));
    const rawMeshOutput = output.rawMeshPath
      ? output
      : await collectEngineOutput(options.rawMeshDir || getJobRawMeshDir(job));
    return {
      engineJobId: `external-${job.jobId}`,
      rawMeshPath: rawMeshOutput.rawMeshPath,
      engineName: options.command || RECONSTRUCTION_ENGINE_COMMAND || "External CLI",
      reconstructionMode: options.engineMode || ENGINE_MODES.externalCli,
      engineMode: options.engineMode || ENGINE_MODES.externalCli,
      engineCommand: options.command || RECONSTRUCTION_ENGINE_COMMAND || "",
      engineExitCode: commandResult.engineExitCode,
      engineStdout: commandResult.engineStdout,
      engineStderr: commandResult.engineStderr,
      outputCandidates: rawMeshOutput.outputCandidates
    };
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
    reconstructionMode: ENGINE_MODES.mock,
    engineMode: ENGINE_MODES.mock,
    engineCommand: "",
    engineExitCode: 0,
    engineStdout: "",
    engineStderr: ""
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

function shouldUseExternalCli() {
  return [ENGINE_MODES.externalCli, ENGINE_MODES.colmapReady, ENGINE_MODES.meshroomReady]
    .includes(getConfiguredEngineMode());
}

function getConfiguredEngineMode() {
  if (!Object.values(ENGINE_MODES).includes(RECONSTRUCTION_MODE)) return ENGINE_MODES.native;
  if ([ENGINE_MODES.externalCli, ENGINE_MODES.colmapReady, ENGINE_MODES.meshroomReady].includes(RECONSTRUCTION_MODE)) {
    return RECONSTRUCTION_ENGINE_COMMAND ? RECONSTRUCTION_MODE : ENGINE_MODES.native;
  }
  return RECONSTRUCTION_MODE;
}

async function runMockReconstruction(job, options = {}) {
  const configuredMode = getConfiguredEngineMode();
  const dataset = shouldUseExternalCli()
    ? await prepareDatasetForEngine(job)
    : await prepareReconstructionDataset(job);
  const reconstructionWarnings = getReconstructionWarnings(dataset.inputFramesCount, dataset.inputMasksCount);
  let engine = null;
  let nativeQuality = "";

  if (shouldUseExternalCli()) {
    engine = await runReconstructionEngine(dataset.datasetPath, {
      job,
      mode: ENGINE_MODES.externalCli,
      engineMode: configuredMode,
      command: RECONSTRUCTION_ENGINE_COMMAND,
      args: RECONSTRUCTION_ENGINE_ARGS,
      outputDir: dataset.outputDir,
      rawMeshDir: dataset.rawMeshDir,
      inputFramesDir: dataset.inputFramesDir,
      masksDir: dataset.masksDir
    });
    const externalValidation = await validateReconstructionOutput(engine.rawMeshPath);
    if (!externalValidation.ok || engine.engineExitCode !== 0) {
      reconstructionWarnings.push(`${configuredMode} reconstruction engine failed; fallback to mock mode.`);
      if (engine.engineStderr) reconstructionWarnings.push(`External engine stderr: ${engine.engineStderr.slice(0, 300)}`);
      const failedExternal = engine;
      engine = await runReconstructionEngine(dataset.datasetPath, { job, mode: ENGINE_MODES.mock });
      engine.engineMode = configuredMode;
      engine.engineCommand = failedExternal.engineCommand || "";
      engine.engineExitCode = failedExternal.engineExitCode;
      engine.engineStdout = failedExternal.engineStdout || "";
      engine.engineStderr = failedExternal.engineStderr || "";
    }
  } else if (configuredMode === ENGINE_MODES.native) {
    if (RECONSTRUCTION_MODE !== ENGINE_MODES.native && RECONSTRUCTION_MODE !== ENGINE_MODES.mock) {
      reconstructionWarnings.push("External reconstruction engine is not configured; using PMAS native engine.");
    }
    try {
      engine = await runReconstructionEngine(dataset.datasetPath, {
        job,
        mode: ENGINE_MODES.native,
        settings: options.settings,
        onProgress: options.onProgress
      });
      (engine.nativeWarnings || []).forEach(warning => reconstructionWarnings.push(warning));
      nativeQuality = engine.nativeQuality || "";
    } catch (err) {
      reconstructionWarnings.push(`Native reconstruction failed: ${err.message}; fallback to mock mode.`);
      reconstructionWarnings.push("ВНИМАНИЕ: показана тестовая модель, а не реконструкция загруженных кадров.");
      engine = await runReconstructionEngine(dataset.datasetPath, { job, mode: ENGINE_MODES.mock });
      engine.engineMode = ENGINE_MODES.native;
      engine.engineExitCode = -1;
      engine.engineStderr = err.message;
      nativeQuality = "poor";
    }
  } else {
    engine = await runReconstructionEngine(dataset.datasetPath, { job, mode: ENGINE_MODES.mock });
  }

  await monitorReconstructionProgress(engine.engineJobId);
  const output = await getReconstructionOutput(engine.engineJobId, { rawMeshPath: engine.rawMeshPath });
  const validation = await validateReconstructionOutput(output.rawMeshPath);
  if (!validation.ok) {
    throw new Error(validation.errorMessage || "Reconstruction output mesh некорректен.");
  }

  return {
    reconstructionMode: engine.reconstructionMode || ENGINE_MODES.mock,
    engineMode: engine.engineMode || engine.reconstructionMode || ENGINE_MODES.mock,
    engineCommand: engine.engineCommand || "",
    engineExitCode: Number.isInteger(engine.engineExitCode) ? engine.engineExitCode : 0,
    engineStdout: engine.engineStdout || "",
    engineStderr: engine.engineStderr || "",
    engineName: engine.engineName || ENGINE_NAME,
    engineJobId: engine.engineJobId,
    datasetPath: dataset.datasetPath,
    inputFramesCount: dataset.inputFramesCount,
    inputMasksCount: dataset.inputMasksCount,
    rawMeshPath: output.rawMeshPath,
    reconstructionWarnings,
    reconstructionQuality: nativeQuality || getReconstructionQuality(dataset.inputFramesCount, dataset.inputMasksCount),
    reconstructionStats: engine.nativeStats || null,
    resultRealHeightMm: engine.nativeRealHeightMm || null
  };
}

module.exports = {
  ENGINE_MODES,
  getConfiguredEngineMode,
  prepareReconstructionDataset,
  prepareDatasetForEngine,
  runReconstructionEngine,
  runExternalReconstructionCommand,
  monitorExternalProcess,
  collectEngineOutput,
  monitorReconstructionProgress,
  getReconstructionOutput,
  cancelReconstructionEngineJob,
  validateReconstructionOutput,
  validateRawMeshOutput: validateReconstructionOutput,
  runMockReconstruction
};
