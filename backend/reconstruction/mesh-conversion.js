const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

const CONVERSION_MODES = {
  mock: "mock",
  blenderCli: "blender_cli",
  assimpCli: "assimp_cli",
  trimeshReady: "trimesh_ready"
};
const SUPPORTED_INPUT_FORMATS = new Set(["obj", "ply", "stl", "gltf", "glb"]);
const MESH_CONVERSION_MODE = process.env.MESH_CONVERSION_MODE || CONVERSION_MODES.mock;
const BLENDER_CLI_PATH = process.env.BLENDER_CLI_PATH || "";
const ASSIMP_CLI_PATH = process.env.ASSIMP_CLI_PATH || "";
const MOCK_INPUT_MODEL = path.resolve(__dirname, "../../models/LeePerrySmith.glb");

function getJobConversionDir(job) {
  return path.resolve(__dirname, "../tmp/jobs", job.jobId, "conversion");
}

function detectMeshFormat(inputMeshPath) {
  const extension = path.extname(String(inputMeshPath || "")).replace(".", "").toLowerCase();
  return SUPPORTED_INPUT_FORMATS.has(extension) ? extension : "unknown";
}

async function validateGlbFile(outputGlbPath) {
  try {
    const file = await fs.open(outputGlbPath, "r");
    const header = Buffer.alloc(12);
    await file.read(header, 0, 12, 0);
    await file.close();
    const stats = await fs.stat(outputGlbPath);
    return {
      ok: stats.isFile() && stats.size > 20 && header.toString("utf8", 0, 4) === "glTF",
      size: stats.size
    };
  } catch (err) {
    return {
      ok: false,
      size: 0,
      errorMessage: "Converted GLB не найден или повреждён."
    };
  }
}

async function fallbackToMockGlb(job, reason = "") {
  const outputGlbPath = path.join(getJobConversionDir(job), "result.glb");
  await fs.mkdir(path.dirname(outputGlbPath), { recursive: true });
  await fs.copyFile(MOCK_INPUT_MODEL, outputGlbPath);
  return {
    inputMeshFormat: detectMeshFormat(job.rawMeshPath),
    conversionMode: CONVERSION_MODES.mock,
    conversionSuccess: true,
    outputGlbPath,
    conversionWarnings: [
      reason || "Mesh conversion выполнен в mock mode",
      "Нужна проверка converted GLB перед клиническим использованием"
    ]
  };
}

function runCommand(command, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { shell: false, cwd: options.cwd || process.cwd() });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", err => {
      resolve({ exitCode: -1, stdout, stderr: stderr || err.message });
    });
    child.on("close", code => {
      resolve({ exitCode: Number.isInteger(code) ? code : -1, stdout, stderr });
    });
  });
}

async function convertWithBlender(inputMeshPath, outputGlbPath) {
  if (!BLENDER_CLI_PATH) throw new Error("BLENDER_CLI_PATH is not configured.");
  // TODO: Replace placeholder args with a dedicated Blender Python export script.
  return await runCommand(BLENDER_CLI_PATH, [
    "--background",
    "--python-expr",
    `import bpy; bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.obj(filepath=r"${inputMeshPath}"); bpy.ops.export_scene.gltf(filepath=r"${outputGlbPath}", export_format='GLB')`
  ]);
}

async function convertWithAssimp(inputMeshPath, outputGlbPath) {
  if (!ASSIMP_CLI_PATH) throw new Error("ASSIMP_CLI_PATH is not configured.");
  return await runCommand(ASSIMP_CLI_PATH, ["export", inputMeshPath, outputGlbPath]);
}

async function convertMeshToGlb(inputMeshPath, outputGlbPath, options = {}) {
  const job = options.job || {};
  const inputMeshFormat = detectMeshFormat(inputMeshPath);
  const warnings = [];
  await fs.mkdir(path.dirname(outputGlbPath), { recursive: true });

  if (!SUPPORTED_INPUT_FORMATS.has(inputMeshFormat)) {
    return await fallbackToMockGlb(job, "Raw mesh format не поддерживается; GLB создан через mock fallback.");
  }

  if (inputMeshFormat === "glb") {
    await fs.copyFile(inputMeshPath, outputGlbPath);
    const validation = await validateGlbFile(outputGlbPath);
    if (validation.ok) {
      return {
        inputMeshFormat,
        conversionMode: CONVERSION_MODES.mock,
        conversionSuccess: true,
        outputGlbPath,
        conversionWarnings: ["Raw mesh уже был GLB; conversion выполнен как safe copy."]
      };
    }
    return await fallbackToMockGlb(job, "Raw GLB некорректен; использован mock GLB fallback.");
  }

  if (inputMeshFormat === "gltf") {
    await fs.copyFile(inputMeshPath, outputGlbPath);
    warnings.push("Raw mesh был GLTF; до real exporter выполняется mock copy/fallback.");
  }

  const requestedMode = options.mode || MESH_CONVERSION_MODE;
  let cliResult = null;
  try {
    if (requestedMode === CONVERSION_MODES.blenderCli) {
      cliResult = await convertWithBlender(inputMeshPath, outputGlbPath);
    } else if (requestedMode === CONVERSION_MODES.assimpCli) {
      cliResult = await convertWithAssimp(inputMeshPath, outputGlbPath);
    } else if (requestedMode === CONVERSION_MODES.trimeshReady) {
      warnings.push("trimesh_ready зарезервирован для будущей Python/trimesh интеграции; используется mock fallback.");
    }
  } catch (err) {
    warnings.push(err.message);
  }

  if (cliResult?.exitCode === 0) {
    const validation = await validateGlbFile(outputGlbPath);
    if (validation.ok) {
      return {
        inputMeshFormat,
        conversionMode: requestedMode,
        conversionSuccess: true,
        outputGlbPath,
        conversionWarnings: warnings
      };
    }
    warnings.push("CLI conversion завершился, но GLB не прошёл проверку.");
  } else if (cliResult) {
    warnings.push(`Mesh conversion CLI failed with exit ${cliResult.exitCode}.`);
    if (cliResult.stderr) warnings.push(`Mesh conversion stderr: ${cliResult.stderr.slice(0, 300)}`);
  }

  return await fallbackToMockGlb(job, warnings.join(" ") || "Mesh conversion CLI не настроен; использован mock GLB fallback.");
}

async function convertJobRawMeshToGlb(job, options = {}) {
  const outputGlbPath = path.join(getJobConversionDir(job), "result.glb");
  return await convertMeshToGlb(job.rawMeshPath || "", outputGlbPath, {
    ...options,
    job,
    mode: options.mode || MESH_CONVERSION_MODE
  });
}

module.exports = {
  CONVERSION_MODES,
  detectMeshFormat,
  convertMeshToGlb,
  validateGlbFile,
  fallbackToMockGlb,
  convertJobRawMeshToGlb
};
