const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

const CLEANUP_MODES = {
  mock: "mock",
  blenderCli: "blender_cli",
  trimeshReady: "trimesh_ready",
  open3dReady: "open3d_ready"
};
const CLEANUP_MODE = process.env.MESH_CLEANUP_MODE || CLEANUP_MODES.mock;
const BLENDER_CLI_PATH = process.env.MESH_CLEANUP_BLENDER_CLI_PATH || process.env.BLENDER_CLI_PATH || "";
const MOCK_INPUT_MODEL = path.resolve(__dirname, "../../models/LeePerrySmith.glb");

function getJobMeshDir(job) {
  return path.resolve(__dirname, "../tmp/jobs", job.jobId, "mesh");
}

function getPublicCleanedMeshUrl(jobId) {
  return `/api/reconstruction/artifacts/${encodeURIComponent(jobId)}/mesh/cleaned-model.glb`;
}

function getStrengthOptions(job, options = {}) {
  const strength = options.cleanupStrength || job.settings?.cleanupStrength || "medium";
  const targetQuality = options.targetModelQuality || job.settings?.targetModelQuality || "preview";
  const presets = {
    low: { removedComponentsCount: 1, holesRepairedCount: 1, decimationRatio: targetQuality === "planning" ? 0.98 : 0.95, smoothingIterations: 1 },
    medium: { removedComponentsCount: 3, holesRepairedCount: 2, decimationRatio: targetQuality === "planning" ? 0.92 : 0.85, smoothingIterations: 2 },
    high: { removedComponentsCount: 5, holesRepairedCount: 4, decimationRatio: targetQuality === "planning" ? 0.84 : 0.72, smoothingIterations: 3 }
  };
  return { strength, targetQuality, ...(presets[strength] || presets.medium), ...options };
}

async function prepareMeshForCleanup(inputMeshPath, job) {
  const meshDir = getJobMeshDir(job);
  const cleanedMeshPath = path.join(meshDir, "cleaned-model.glb");
  await fs.mkdir(meshDir, { recursive: true });

  try {
    await fs.access(inputMeshPath);
  } catch (err) {
    throw new Error("Input mesh для cleanup не найден.");
  }

  return {
    cleanupMode: CLEANUP_MODE,
    inputMeshPath,
    cleanedMeshPath,
    publicCleanedMeshUrl: getPublicCleanedMeshUrl(job.jobId)
  };
}

async function validateCleanedMesh(meshPath) {
  try {
    const file = await fs.open(meshPath, "r");
    const header = Buffer.alloc(12);
    await file.read(header, 0, 12, 0);
    await file.close();
    const stats = await fs.stat(meshPath);
    const isGlb = header.toString("utf8", 0, 4) === "glTF";
    return {
      ok: stats.isFile() && stats.size > 20 && isGlb,
      size: stats.size,
      format: isGlb ? "glb" : path.extname(meshPath).replace(".", "").toLowerCase()
    };
  } catch (err) {
    return {
      ok: false,
      size: 0,
      format: "unknown",
      errorMessage: "Cleaned mesh не найден или повреждён."
    };
  }
}

async function removeSmallDisconnectedComponents(meshPath, options = {}) {
  // TODO: Remove small disconnected mesh components with Blender, trimesh, or Open3D.
  return {
    meshPath,
    removedComponentsCount: options.removedComponentsCount ?? options.mockRemovedArtifactsCount ?? 3
  };
}

async function cropMeshToHeadRegion(meshPath, options = {}) {
  // TODO: Crop head/face region using landmarks, bounding box, or segmentation-derived volume.
  return {
    meshPath,
    cropApplied: true,
    targetModelQuality: options.targetModelQuality || "preview"
  };
}

async function removeBackgroundArtifacts(meshPath, masks = [], options = {}) {
  // TODO: Use segmentation masks to remove background geometry from reconstructed mesh.
  return {
    meshPath,
    masksUsed: Array.isArray(masks) ? masks.length : 0,
    backgroundArtifactsRemoved: Boolean(masks?.length)
  };
}

async function smoothMeshSurface(meshPath, options = {}) {
  // TODO: Apply mesh smoothing while preserving clinically relevant surface detail.
  return {
    meshPath,
    smoothingIterations: options.smoothingIterations || options.iterations || 1
  };
}

async function decimateMesh(meshPath, targetRatio = 0.85) {
  // TODO: Add mesh decimation for viewer-friendly GLB output.
  return {
    meshPath,
    decimationRatio: targetRatio
  };
}

async function repairMeshHoles(meshPath, options = {}) {
  // TODO: Add hole filling and topology repair.
  return {
    meshPath,
    holesRepairedCount: options.holesRepairedCount ?? options.mockHolesRepairedCount ?? 2
  };
}

function runBlenderCleanup(inputMeshPath, outputPath, options = {}) {
  if (!BLENDER_CLI_PATH) {
    return Promise.resolve({ exitCode: -1, stdout: "", stderr: "MESH_CLEANUP_BLENDER_CLI_PATH is not configured." });
  }
  // TODO: Replace placeholder script with a dedicated Blender cleanup/export script.
  const expression = [
    "import bpy",
    "bpy.ops.wm.read_factory_settings(use_empty=True)",
    `bpy.ops.import_scene.gltf(filepath=r"${inputMeshPath}")`,
    `bpy.ops.export_scene.gltf(filepath=r"${outputPath}", export_format='GLB')`
  ].join("; ");

  const child = spawn(BLENDER_CLI_PATH, ["--background", "--python-expr", expression], { shell: false });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk.toString(); });
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });

  return new Promise(resolve => {
    child.on("error", err => resolve({ exitCode: -1, stdout, stderr: stderr || err.message }));
    child.on("close", code => resolve({ exitCode: Number.isInteger(code) ? code : -1, stdout, stderr }));
  });
}

async function exportCleanedMeshToGlb(inputMeshPath, outputPath, options = {}) {
  const requestedMode = options.cleanupMode || CLEANUP_MODE;
  const warnings = [];

  if (requestedMode === CLEANUP_MODES.blenderCli) {
    const blender = await runBlenderCleanup(inputMeshPath, outputPath, options);
    if (blender.exitCode === 0) {
      const validation = await validateCleanedMesh(outputPath);
      if (validation.ok) {
        return {
          outputPath,
          size: validation.size,
          cleanupMode: CLEANUP_MODES.blenderCli,
          cleanupSuccess: true,
          cleanupQuality: options.cleanupQuality || "good",
          cleanupWarnings: warnings
        };
      }
      warnings.push("Blender cleanup завершился, но cleaned GLB не прошёл проверку.");
    } else {
      warnings.push(`Blender cleanup unavailable or failed with exit ${blender.exitCode}.`);
      if (blender.stderr) warnings.push(`Blender cleanup stderr: ${blender.stderr.slice(0, 300)}`);
    }
  } else if (requestedMode === CLEANUP_MODES.trimeshReady || requestedMode === CLEANUP_MODES.open3dReady) {
    warnings.push(`${requestedMode} зарезервирован для будущей real cleanup интеграции; используется mock fallback.`);
  }

  await fs.copyFile(inputMeshPath, outputPath);
  const validation = await validateCleanedMesh(outputPath);
  if (!validation.ok) {
    await fs.copyFile(MOCK_INPUT_MODEL, outputPath);
    warnings.push("Input mesh не прошёл GLB validation; cleaned GLB создан через mock fallback.");
  }
  const stats = await fs.stat(outputPath);
  return {
    outputPath,
    size: stats.size,
    cleanupMode: CLEANUP_MODES.mock,
    cleanupSuccess: true,
    cleanupQuality: options.cleanupQuality || "medium",
    cleanupWarnings: warnings
  };
}

async function runMockMeshCleanup(job, options = {}) {
  const cleanupOptions = getStrengthOptions(job, options);
  const requestedMode = Object.values(CLEANUP_MODES).includes(CLEANUP_MODE) ? CLEANUP_MODE : CLEANUP_MODES.mock;
  const prepared = await prepareMeshForCleanup(options.inputMeshPath || job.outputGlbPath || job.rawMeshPath || MOCK_INPUT_MODEL, job);
  const components = await removeSmallDisconnectedComponents(prepared.inputMeshPath, cleanupOptions);
  const cropped = await cropMeshToHeadRegion(components.meshPath, cleanupOptions);
  const background = await removeBackgroundArtifacts(cropped.meshPath, job.segmentationMasks || [], cleanupOptions);
  const smoothed = await smoothMeshSurface(background.meshPath, cleanupOptions);
  const decimation = await decimateMesh(smoothed.meshPath, cleanupOptions.decimationRatio);
  const repair = await repairMeshHoles(decimation.meshPath, cleanupOptions);
  const exported = await exportCleanedMeshToGlb(repair.meshPath, prepared.cleanedMeshPath, {
    ...cleanupOptions,
    cleanupMode: requestedMode,
    cleanupQuality: cleanupOptions.targetQuality === "planning" && cleanupOptions.strength === "high" ? "good" : "medium"
  });
  const validation = await validateCleanedMesh(exported.outputPath);
  const cleanupWarnings = [
    ...exported.cleanupWarnings,
    exported.cleanupMode === CLEANUP_MODES.mock ? "Mesh cleanup выполнен в mock mode" : "",
    "Нужна проверка cleaned mesh перед клиническим использованием"
  ].filter(Boolean);

  return {
    cleanupMode: exported.cleanupMode,
    inputMeshPath: prepared.inputMeshPath,
    cleanedMeshPath: prepared.cleanedMeshPath,
    publicCleanedMeshUrl: prepared.publicCleanedMeshUrl,
    removedComponentsCount: components.removedComponentsCount,
    removedArtifactsCount: components.removedComponentsCount,
    holesRepairedCount: repair.holesRepairedCount,
    decimationRatio: decimation.decimationRatio,
    cleanupSuccess: validation.ok,
    cleanupWarnings,
    cleanupQuality: validation.ok ? exported.cleanupQuality : "poor",
    resultModelSource: "cleaned"
  };
}

module.exports = {
  CLEANUP_MODES,
  prepareMeshForCleanup,
  removeSmallDisconnectedComponents,
  cropMeshToHeadRegion,
  removeBackgroundArtifacts,
  smoothMeshSurface,
  decimateMesh,
  repairMeshHoles,
  validateCleanedMesh,
  exportCleanedMeshToGlb,
  runMockMeshCleanup,
  getPublicCleanedMeshUrl,
  removeFloatingArtifacts: removeSmallDisconnectedComponents,
  cropToHeadRegion: cropMeshToHeadRegion,
  smoothMesh: smoothMeshSurface
};
