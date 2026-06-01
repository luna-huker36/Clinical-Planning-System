const fs = require("fs/promises");
const path = require("path");

const CLEANUP_MODE = "mock";
const MOCK_INPUT_MODEL = path.resolve(__dirname, "../../models/LeePerrySmith.glb");

function getJobMeshDir(job) {
  return path.resolve(__dirname, "../tmp/jobs", job.jobId, "mesh");
}

function getPublicCleanedMeshUrl(jobId) {
  return `/api/reconstruction/artifacts/${encodeURIComponent(jobId)}/mesh/cleaned-model.glb`;
}

async function prepareMeshForCleanup(inputMeshPath, job) {
  const meshDir = getJobMeshDir(job);
  const cleanedMeshPath = path.join(meshDir, "cleaned-model.glb");
  await fs.mkdir(meshDir, { recursive: true });

  try {
    await fs.access(inputMeshPath);
  } catch (err) {
    throw new Error("Mock input GLB для mesh cleanup не найден.");
  }

  return {
    cleanupMode: CLEANUP_MODE,
    inputMeshPath,
    cleanedMeshPath,
    publicCleanedMeshUrl: getPublicCleanedMeshUrl(job.jobId)
  };
}

async function removeFloatingArtifacts(inputMeshPath, options = {}) {
  // TODO: Remove small disconnected mesh components.
  // TODO: Remove background mesh using segmentation masks.
  return {
    meshPath: inputMeshPath,
    removedArtifactsCount: options.mockRemovedArtifactsCount ?? 3
  };
}

async function cropToHeadRegion(inputMeshPath, options = {}) {
  // TODO: Crop head/face area and remove shoulders/clothes if needed.
  return {
    meshPath: inputMeshPath,
    cropApplied: true
  };
}

async function smoothMesh(inputMeshPath, options = {}) {
  // TODO: Apply mesh smoothing while preserving clinical surface detail.
  return {
    meshPath: inputMeshPath,
    smoothingIterations: options.iterations || 1
  };
}

async function decimateMesh(inputMeshPath, options = {}) {
  // TODO: Add mesh decimation for viewer-friendly GLB output.
  return {
    meshPath: inputMeshPath,
    decimationRatio: options.decimationRatio || 0.85
  };
}

async function repairMeshHoles(inputMeshPath, options = {}) {
  // TODO: Add hole filling and topology repair.
  return {
    meshPath: inputMeshPath,
    holesRepairedCount: options.mockHolesRepairedCount ?? 2
  };
}

async function exportCleanedMeshToGlb(inputMeshPath, outputPath, options = {}) {
  // TODO: Add texture cleanup before final GLB export.
  // TODO: Replace mock copy with GLB export via Blender / trimesh / Open3D.
  await fs.copyFile(inputMeshPath, outputPath);
  const stats = await fs.stat(outputPath);
  return {
    outputPath,
    size: stats.size,
    cleanupQuality: options.cleanupQuality || "medium"
  };
}

async function runMockMeshCleanup(job, options = {}) {
  const prepared = await prepareMeshForCleanup(options.inputMeshPath || job.rawMeshPath || MOCK_INPUT_MODEL, job);
  const floating = await removeFloatingArtifacts(prepared.inputMeshPath, options);
  await cropToHeadRegion(floating.meshPath, options);
  await smoothMesh(floating.meshPath, options);
  const decimation = await decimateMesh(floating.meshPath, options);
  const repair = await repairMeshHoles(floating.meshPath, options);
  const exported = await exportCleanedMeshToGlb(floating.meshPath, prepared.cleanedMeshPath, options);

  return {
    cleanupMode: CLEANUP_MODE,
    inputMeshPath: prepared.inputMeshPath,
    cleanedMeshPath: prepared.cleanedMeshPath,
    publicCleanedMeshUrl: prepared.publicCleanedMeshUrl,
    removedArtifactsCount: floating.removedArtifactsCount,
    holesRepairedCount: repair.holesRepairedCount,
    decimationRatio: decimation.decimationRatio,
    cleanupWarnings: [
      "Mesh cleanup выполнен в mock mode",
      "Нужна проверка cleaned mesh перед клиническим использованием"
    ],
    cleanupQuality: exported.cleanupQuality,
    resultModelSource: "cleaned"
  };
}

module.exports = {
  prepareMeshForCleanup,
  removeFloatingArtifacts,
  cropToHeadRegion,
  smoothMesh,
  decimateMesh,
  repairMeshHoles,
  exportCleanedMeshToGlb,
  runMockMeshCleanup,
  getPublicCleanedMeshUrl
};
