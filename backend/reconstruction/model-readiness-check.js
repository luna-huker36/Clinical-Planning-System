const fs = require("fs");

const READINESS_WARNING_MEASUREMENTS = "Модель может быть непригодна для точных измерений";
const READINESS_WARNING_LOW_FRAMES = "Слишком мало качественных кадров";
const READINESS_WARNING_ARTIFACTS = "Модель содержит артефакты";
const READINESS_WARNING_SMALL = "Размер модели подозрительно маленький";
const READINESS_WARNING_CLINICAL = "Требуется ручная проверка перед клиническим использованием";

function uniqueWarnings(warnings) {
  return Array.from(new Set((warnings || []).filter(Boolean)));
}

function readGlbJson(glbPath) {
  const buffer = fs.readFileSync(glbPath);
  if (buffer.length < 20) throw new Error("GLB file is too small.");
  if (buffer.toString("utf8", 0, 4) !== "glTF") throw new Error("Invalid GLB magic.");

  const version = buffer.readUInt32LE(4);
  const declaredLength = buffer.readUInt32LE(8);
  if (version !== 2) throw new Error("Only GLB 2.0 is supported.");
  if (declaredLength > buffer.length) throw new Error("GLB length is invalid.");

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    offset += 8;
    if (offset + chunkLength > buffer.length) throw new Error("GLB chunk length is invalid.");
    if (chunkType === 0x4e4f534a) {
      const jsonText = buffer.toString("utf8", offset, offset + chunkLength).replace(/\0+$/g, "").trim();
      return {
        json: JSON.parse(jsonText),
        fileSize: buffer.length,
        version,
        declaredLength
      };
    }
    offset += chunkLength;
  }

  throw new Error("GLB JSON chunk not found.");
}

function getAccessor(gltf, accessorIndex) {
  if (!Number.isInteger(accessorIndex)) return null;
  return gltf.accessors?.[accessorIndex] || null;
}

function combineBounds(bounds, min, max) {
  if (!Array.isArray(min) || !Array.isArray(max) || min.length < 3 || max.length < 3) return bounds;
  if (!bounds) {
    return {
      min: min.slice(0, 3).map(Number),
      max: max.slice(0, 3).map(Number)
    };
  }
  for (let i = 0; i < 3; i += 1) {
    bounds.min[i] = Math.min(bounds.min[i], Number(min[i]));
    bounds.max[i] = Math.max(bounds.max[i], Number(max[i]));
  }
  return bounds;
}

function analyzeMeshStats(gltf) {
  let vertexCount = 0;
  let faceCount = 0;
  let meshPrimitiveCount = 0;
  let boundingBox = null;

  for (const mesh of gltf.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      meshPrimitiveCount += 1;
      const positionAccessor = getAccessor(gltf, primitive.attributes?.POSITION);
      if (positionAccessor) {
        vertexCount += Number(positionAccessor.count || 0);
        boundingBox = combineBounds(boundingBox, positionAccessor.min, positionAccessor.max);
      }

      const indexAccessor = getAccessor(gltf, primitive.indices);
      if (indexAccessor) {
        faceCount += Math.floor(Number(indexAccessor.count || 0) / 3);
      } else if (positionAccessor) {
        faceCount += Math.floor(Number(positionAccessor.count || 0) / 3);
      }
    }
  }

  const size = boundingBox
    ? {
      x: boundingBox.max[0] - boundingBox.min[0],
      y: boundingBox.max[1] - boundingBox.min[1],
      z: boundingBox.max[2] - boundingBox.min[2]
    }
    : null;

  return {
    meshExists: meshPrimitiveCount > 0,
    meshPrimitiveCount,
    vertexCount,
    faceCount,
    boundingBox: boundingBox ? { ...boundingBox, size } : null
  };
}

function hasArtifactWarnings(job) {
  return [
    ...(job.warnings || []),
    ...(job.cleanupWarnings || []),
    ...(job.reconstructionWarnings || []),
    ...(job.segmentationWarnings || [])
  ].some(warning => /artifact|артефакт|mock mode|ручная проверка|clinical/i.test(String(warning)));
}

function assessBoundingBox(boundingBox) {
  if (!boundingBox?.size) return { suspicious: true, warning: "Model bounding box metadata is unavailable." };
  const dimensions = [boundingBox.size.x, boundingBox.size.y, boundingBox.size.z].map(Number).filter(Number.isFinite);
  if (dimensions.length !== 3) return { suspicious: true, warning: "Model bounding box metadata is invalid." };
  const maxDimension = Math.max(...dimensions);
  const minDimension = Math.min(...dimensions);
  if (maxDimension < 0.01 || minDimension <= 0) return { suspicious: true, warning: "Model bounding box is suspiciously small." };
  if (maxDimension > 1000) return { suspicious: true, warning: "Model bounding box is suspiciously large." };
  return { suspicious: false, warning: "" };
}

function buildReadinessResult(overrides) {
  const readinessScore = Math.max(0, Math.min(100, Math.round(overrides.readinessScore || 0)));
  const readinessLevel = overrides.readinessLevel
    || (readinessScore >= 80 ? "good" : readinessScore >= 50 ? "medium" : "poor");
  return {
    readinessScore,
    readinessLevel,
    canOpenInViewer: Boolean(overrides.canOpenInViewer),
    canUseForVisualization: Boolean(overrides.canUseForVisualization),
    canUseForMeasurements: overrides.canUseForMeasurements,
    readinessWarnings: uniqueWarnings(overrides.readinessWarnings),
    readinessMetadata: overrides.readinessMetadata || {}
  };
}

function checkModelReadiness(job, options = {}) {
  const targetModelQuality = options.settings?.targetModelQuality || job.settings?.targetModelQuality || "preview";
  const artifactPath = options.artifactPath || job.cleanedMeshPath || "";
  const previousWarnings = uniqueWarnings([
    ...(job.warnings || []),
    ...(job.frameQualityReport?.warnings || []),
    ...(job.segmentationWarnings || []),
    ...(job.reconstructionWarnings || []),
    ...(job.cleanupWarnings || [])
  ]);

  if (!artifactPath || !fs.existsSync(artifactPath)) {
    return buildReadinessResult({
      readinessScore: 0,
      readinessLevel: "poor",
      canOpenInViewer: false,
      canUseForVisualization: false,
      canUseForMeasurements: false,
      readinessWarnings: [
        "GLB-модель не найдена",
        READINESS_WARNING_MEASUREMENTS,
        READINESS_WARNING_CLINICAL
      ],
      readinessMetadata: { glbExists: false, glbLoadsCorrectly: false, meshExists: false }
    });
  }

  let parsed;
  try {
    parsed = readGlbJson(artifactPath);
  } catch (err) {
    return buildReadinessResult({
      readinessScore: 10,
      readinessLevel: "poor",
      canOpenInViewer: false,
      canUseForVisualization: false,
      canUseForMeasurements: false,
      readinessWarnings: [
        "GLB-модель не загружается корректно",
        READINESS_WARNING_MEASUREMENTS,
        READINESS_WARNING_CLINICAL
      ],
      readinessMetadata: { glbExists: true, glbLoadsCorrectly: false, parseError: err.message }
    });
  }

  const stats = analyzeMeshStats(parsed.json);
  const bboxAssessment = assessBoundingBox(stats.boundingBox);
  const warnings = [];
  let score = 100;

  if (!stats.meshExists) {
    score -= 60;
    warnings.push("Mesh отсутствует в GLB-модели");
  }
  if (stats.vertexCount < 1000) {
    score -= 25;
    warnings.push("Слишком низкое количество вершин");
  }
  if (stats.faceCount < 500) {
    score -= 20;
    warnings.push("Слишком низкое количество полигонов");
  }
  if (parsed.fileSize < 50 * 1024) {
    score -= 25;
    warnings.push(READINESS_WARNING_SMALL);
  }
  if (bboxAssessment.suspicious) {
    score -= 15;
    warnings.push(bboxAssessment.warning);
  }
  if ((job.selectedFramesCount || 0) > 0 && job.selectedFramesCount < 15) {
    score -= 15;
    warnings.push(READINESS_WARNING_LOW_FRAMES);
  }
  if (hasArtifactWarnings(job)) {
    score -= 15;
    warnings.push(READINESS_WARNING_ARTIFACTS);
  }
  if (previousWarnings.length) {
    score -= Math.min(15, previousWarnings.length * 2);
  }
  if (targetModelQuality === "planning") {
    if ((job.selectedFramesCount || 0) < 20) {
      score -= 10;
      warnings.push("Planning quality requires more selected frames");
    }
    if (stats.vertexCount < 10000 || stats.faceCount < 5000) {
      score -= 10;
      warnings.push("Planning quality requires denser model geometry");
    }
  }

  warnings.push(READINESS_WARNING_CLINICAL);

  const readinessLevel = score >= 80 ? "good" : score >= 50 ? "medium" : "poor";
  const canOpenInViewer = stats.meshExists;
  const canUseForVisualization = canOpenInViewer && readinessLevel !== "poor";
  const canUseForMeasurements = readinessLevel === "good" ? true : readinessLevel === "medium" ? "caution" : false;
  if (canUseForMeasurements !== true) warnings.push(READINESS_WARNING_MEASUREMENTS);

  return buildReadinessResult({
    readinessScore: score,
    readinessLevel,
    canOpenInViewer,
    canUseForVisualization,
    canUseForMeasurements,
    readinessWarnings: warnings,
    readinessMetadata: {
      glbExists: true,
      glbLoadsCorrectly: true,
      meshExists: stats.meshExists,
      vertexCount: stats.vertexCount,
      faceCount: stats.faceCount,
      fileSize: parsed.fileSize,
      boundingBox: stats.boundingBox,
      previousWarningsCount: previousWarnings.length,
      targetModelQuality
    }
  });
}

module.exports = {
  checkModelReadiness,
  readGlbJson,
  analyzeMeshStats
};
