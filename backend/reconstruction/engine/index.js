/**
 * PMAS Native Reconstruction Engine (Visual Hull).
 *
 * Pure-JS photogrammetry-lite: photos (or extracted video frames) shot around
 * an object are segmented into silhouettes, carved into a voxel visual hull
 * on a turntable camera rig, meshed with Surface Nets, smoothed, colored from
 * the source photos and exported as a binary glTF (GLB).
 */

const fs = require("fs/promises");
const path = require("path");
const { decodeImageFile, downscaleImage } = require("./image-utils");
const { extractSilhouette } = require("./silhouette");
const { buildTurntableRig } = require("./camera-rig");
const { carveVoxels } = require("./voxel-carving");
const { extractSurface } = require("./surface-nets");
const {
  taubinSmooth,
  computeVertexNormals,
  ensureOutwardOrientation,
  centerAndScale,
  isWatertight
} = require("./mesh-post");
const { assignVertexColors } = require("./vertex-colors");
const { buildCylindricalUnwrap, bakeTexture } = require("./texture-baking");
const { buildGlb } = require("./glb-writer");

const ENGINE_NAME = "PMAS Native Reconstruction Engine (Visual Hull)";
const TARGET_MODEL_HEIGHT = 0.25;
const MIN_FRAME_COVERAGE = 0.015;
const MAX_FRAME_COVERAGE = 0.85;
const PROFILE_BY_MODE = Object.freeze({
  fast: { dims: 104, workSize: 224, smoothIterations: 8 },
  balanced: { dims: 136, workSize: 288, smoothIterations: 10 },
  quality: { dims: 176, workSize: 352, smoothIterations: 12 }
});

function resolveProfile(settings = {}) {
  const profile = { ...(PROFILE_BY_MODE[settings.processingMode] || PROFILE_BY_MODE.balanced) };
  if (settings.targetModelQuality === "planning") profile.dims += 16;
  return profile;
}

function selectFramePaths(job) {
  return Array.from(job.selectedFrames || [])
    .map(frame => ({ fileName: String(frame.fileName || ""), framePath: frame.framePath }))
    .filter(frame => frame.framePath)
    .sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true }));
}

/**
 * Позиции кадров в исходной съёмочной последовательности по номерам в именах
 * файлов (frame-0012.jpg, IMG_2034.JPG, ...-FRAME-0011.JPG). Если этап
 * отбора качества или ревью выбросил часть кадров, углы по позициям остаются
 * верными — равномерное распределение «по списку» дало бы каждому выжившему
 * кадру систематически неверный азимут.
 */
function orderFramesBySequence(frames) {
  const parsed = frames.map(frame => {
    const stem = frame.fileName.replace(/\.[^.]*$/, "");
    const match = stem.match(/(\d+)(?!.*\d)/);
    return { ...frame, seqNumber: match ? parseInt(match[1], 10) : null };
  });
  const numbers = parsed.map(f => f.seqNumber).filter(n => Number.isFinite(n));
  const distinct = new Set(numbers);
  const usable = numbers.length >= frames.length * 0.7 && distinct.size === numbers.length && frames.length >= 2;
  if (!usable) {
    return { frames, positions: frames.map((_, i) => i), span: frames.length };
  }
  const withNumbers = parsed.filter(f => Number.isFinite(f.seqNumber))
    .sort((a, b) => a.seqNumber - b.seqNumber);
  const minNumber = withNumbers[0].seqNumber;
  const maxNumber = withNumbers[withNumbers.length - 1].seqNumber;
  return {
    frames: withNumbers,
    positions: withNumbers.map(f => f.seqNumber - minNumber),
    span: maxNumber - minNumber + 1
  };
}

const PERIOD_GRID = 12;
const PERIOD_MIN = 6;
const PERIOD_MIN_PAIRS = 5;
const PERIOD_ACCEPT_RATIO = 0.55;

// Дескриптор ракурса: сетка ЯРКОСТИ внутри силуэта, а не только занятость.
// Чистая форма маски обманывается симметрией объекта (куб повторяет силуэт
// каждые 90°), а освещение/текстура различают грани — «тот же ракурс через
// полный оборот» совпадает и по форме, и по свету.
function silhouetteDescriptor(silhouette, image) {
  const { mask, bbox } = silhouette;
  const d = new Float32Array(PERIOD_GRID * PERIOD_GRID);
  const w = Math.max(1, bbox.maxX - bbox.minX);
  const h = Math.max(1, bbox.maxY - bbox.minY);
  const data = image.data;
  for (let y = bbox.minY; y <= bbox.maxY; y += 1) {
    for (let x = bbox.minX; x <= bbox.maxX; x += 1) {
      const idx = y * silhouette.width + x;
      if (!mask[idx]) continue;
      const gx = Math.min(PERIOD_GRID - 1, Math.floor(((x - bbox.minX) / w) * PERIOD_GRID));
      const gy = Math.min(PERIOD_GRID - 1, Math.floor(((y - bbox.minY) / h) * PERIOD_GRID));
      const luminance = 0.299 * data[idx * 4] + 0.587 * data[idx * 4 + 1] + 0.114 * data[idx * 4 + 2];
      d[gy * PERIOD_GRID + gx] += 16 + luminance;
    }
  }
  let norm = 0;
  for (const v of d) norm += v * v;
  const inv = norm > 0 ? 1 / Math.sqrt(norm) : 0;
  for (let i = 0; i < d.length; i += 1) d[i] *= inv;
  return d;
}

function descriptorDistance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

/**
 * Автоопределение периода вращения: если в съёмке больше одного оборота
 * (человек продолжает крутиться, длинное видео), кадры с разностью позиций,
 * кратной периоду, дают почти одинаковые силуэты. Без этого движок растянул
 * бы несколько оборотов на один круг и получил кашу вместо формы.
 *
 * @returns {number|null} период в позициях последовательности или null
 */
function detectRotationPeriod(silhouettes, images) {
  if (silhouettes.length < PERIOD_MIN + PERIOD_MIN_PAIRS) return null;
  const byPosition = new Map();
  for (let i = 0; i < silhouettes.length; i += 1) {
    byPosition.set(silhouettes[i].sourceIndex, silhouetteDescriptor(silhouettes[i], images[i]));
  }
  const positions = Array.from(byPosition.keys()).sort((a, b) => a - b);
  const maxPos = positions[positions.length - 1];

  const scores = [];
  for (let p = PERIOD_MIN; p <= maxPos; p += 1) {
    let sum = 0;
    let pairs = 0;
    for (const pos of positions) {
      const other = byPosition.get(pos + p);
      if (!other) continue;
      sum += descriptorDistance(byPosition.get(pos), other);
      pairs += 1;
    }
    if (pairs >= PERIOD_MIN_PAIRS) scores.push({ p, score: sum / pairs });
  }
  if (scores.length < 4) return null;

  const sorted = scores.map(s => s.score).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  // Однородные объекты (сфера): все расстояния около нуля — периода нет.
  if (median < 1e-3) return null;
  const best = scores.reduce((m, s) => (s.score < m.score ? s : m));
  if (best.score / median > PERIOD_ACCEPT_RATIO) return null;
  return best.p;
}

/**
 * Эвристика «тень/подставка у основания»: у выпуклого объекта ширина силуэта
 * к нижнему краю монотонно убывает. Прилипший блин тени или подставки ломает
 * монотонность — после сужения ширина снова растёт. Ищем такой повторный
 * рост в нижних 30% силуэта.
 */
function detectBaseArtifact(silhouette) {
  const { mask, width, bbox } = silhouette;
  const height = bbox.maxY - bbox.minY;
  const bboxWidth = bbox.maxX - bbox.minX;
  if (height < 24 || bboxWidth < 8) return false;
  const rowWidth = (y) => {
    let count = 0;
    const base = y * width;
    for (let x = bbox.minX; x <= bbox.maxX; x += 1) {
      if (mask[base + x]) count += 1;
    }
    return count;
  };
  const bandStart = bbox.maxY - Math.max(6, Math.round(height * 0.3));
  let runningMin = Infinity;
  let maxRise = 0;
  for (let y = Math.max(bbox.minY, bandStart); y <= bbox.maxY; y += 1) {
    const w = rowWidth(y);
    if (w < runningMin) runningMin = w;
    else if (Number.isFinite(runningMin)) maxRise = Math.max(maxRise, w - runningMin);
  }
  return maxRise > bboxWidth * 0.12 && runningMin > 0 && maxRise > runningMin * 0.3;
}

function gradeQuality({ usableFrames, watertight, averageCoverage }) {
  if (usableFrames >= 12 && watertight && averageCoverage >= 0.04 && averageCoverage <= 0.7) return "good";
  if (usableFrames >= 5) return "medium";
  return "poor";
}

/**
 * Run the full reconstruction for a job.
 *
 * @param {object} job reconstruction job (needs selectedFrames with framePath)
 * @param {{outputPath: string, settings?: object, onProgress?: function}} options
 * @returns {Promise<{rawMeshPath, engineName, warnings, quality, stats}>}
 */
async function runNativeReconstruction(job, options = {}) {
  const outputPath = options.outputPath;
  if (!outputPath) throw new Error("Native engine requires an explicit GLB output path.");
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
  const profile = resolveProfile(options.settings || job.settings || {});

  const selected = selectFramePaths(job);
  if (!selected.length) throw new Error("Нет кадров для реконструкции.");
  const sequence = orderFramesBySequence(selected);
  const framePaths = sequence.frames;

  // 1. Load photos and extract silhouettes (progress 0 -> 0.15).
  const warnings = new Set();
  const silhouettes = [];
  const images = [];
  // Более детальные копии кадров для запекания текстуры: рабочего
  // разрешения масок хватает геометрии, но не цвету.
  const colorImages = [];
  let decodeFailures = 0;
  let rejectedFrames = 0;
  let firstDecodeError = "";
  for (let i = 0; i < framePaths.length; i += 1) {
    try {
      const colorImage = downscaleImage(await decodeImageFile(framePaths[i].framePath), 1024);
      const image = downscaleImage(colorImage, profile.workSize);
      const silhouette = extractSilhouette(image);
      // Border contact on 3+ sides means the "object" is most likely the
      // background (inverted segmentation) or a heavily cropped frame.
      const borderTouches =
        (silhouette.bbox.minX <= 1 ? 1 : 0) + (silhouette.bbox.minY <= 1 ? 1 : 0) +
        (silhouette.bbox.maxX >= image.width - 2 ? 1 : 0) +
        (silhouette.bbox.maxY >= image.height - 2 ? 1 : 0);
      const usable = silhouette.coverage >= MIN_FRAME_COVERAGE &&
        silhouette.coverage <= MAX_FRAME_COVERAGE && borderTouches < 3;
      if (usable) {
        silhouette.sourceIndex = sequence.positions[i];
        silhouettes.push(silhouette);
        images.push(image);
        colorImages.push(colorImage);
      } else {
        rejectedFrames += 1;
      }
      silhouette.warnings.forEach(warning => warnings.add(warning));
    } catch (err) {
      decodeFailures += 1;
      if (!firstDecodeError) firstDecodeError = err.message;
    }
    onProgress(0.15 * ((i + 1) / framePaths.length));
  }
  if (decodeFailures) warnings.add(`Не удалось прочитать кадров: ${decodeFailures}`);
  if (rejectedFrames) warnings.add(`Кадров отклонено по качеству силуэта: ${rejectedFrames}`);
  // Если на большинстве кадров силуэт упирается в нижний край фото — в скан,
  // скорее всего, попала подставка или стол.
  const bottomContact = silhouettes.filter(s => s.bbox.maxY >= s.height - 2).length;
  if (silhouettes.length >= 3 && bottomContact > silhouettes.length / 2) {
    warnings.add("Объект касается низа кадра — в модель могла попасть подставка/поверхность; нижнюю часть можно отсечь инструментом «Отсечение по шее».");
  }
  // Тень или подставка, слившаяся с основанием, расширяет низ силуэта.
  const baseArtifacts = silhouettes.filter(detectBaseArtifact).length;
  if (silhouettes.length >= 3 && baseArtifacts > silhouettes.length * 0.4) {
    warnings.add("У основания объекта обнаружено расширение (тень или подставка) — низ модели может быть искажён; приподнимите объект над поверхностью или отсеките низ инструментом «Отсечение по шее».");
  }
  if (!silhouettes.length) {
    if (decodeFailures === framePaths.length) {
      throw new Error(`Не удалось прочитать ни один кадр (${decodeFailures}). ` +
        `Поддерживаются JPG/PNG (HEIC не поддерживается). Первая ошибка: ${firstDecodeError}`);
    }
    throw new Error("Ни на одном кадре не удалось выделить объект — проверьте контраст с фоном.");
  }
  if (silhouettes.length <= 6) {
    warnings.add(`Мало ракурсов (${silhouettes.length}) — форма будет грубой; снимите 15–30 кадров вокруг объекта.`);
  }

  // 2. Visual hull carving (0.15 -> 0.7).
  // Видео часто содержит больше одного оборота — определяем период по
  // повторяемости силуэтов и сворачиваем позиции в один круг.
  let totalForAzimuth = sequence.span;
  const period = detectRotationPeriod(silhouettes, images);
  if (period && period < sequence.span) {
    for (const s of silhouettes) s.sourceIndex = s.sourceIndex % period;
    totalForAzimuth = period;
    warnings.add(`Обнаружено вращение с периодом ~${period} кадров (в съёмке ${(sequence.span / period).toFixed(1)} оборота) — углы рассчитаны по одному обороту.`);
  }
  const captureDirection = (options.settings && options.settings.rotationDirection) ||
    process.env.PMAS_CAPTURE_DIRECTION || "ccw";
  const rig = buildTurntableRig(silhouettes, {
    totalFrames: totalForAzimuth,
    direction: captureDirection === "cw" ? "cw" : "ccw"
  });
  const grid = await carveVoxels(rig, {
    dims: profile.dims,
    onProgress: fraction => onProgress(0.15 + 0.55 * fraction)
  });
  if (!grid.insideCount) {
    throw new Error("Силуэты кадров несовместимы — пустой объём. Снимайте объект по кругу с одного уровня.");
  }

  // 3. Meshing and post-processing (0.7 -> 0.9). Yield between the heavy
  // synchronous stages so status polling and cancel stay responsive.
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const rawMesh = extractSurface(grid);
  if (!rawMesh.triangleCount) throw new Error("Не удалось построить поверхность по вокселям.");
  onProgress(0.75);
  await tick();
  const smoothedPositions = taubinSmooth(rawMesh.positions, rawMesh.indices, profile.smoothIterations);
  await tick();
  const oriented = ensureOutwardOrientation(smoothedPositions, rawMesh.indices);
  const normals = computeVertexNormals(smoothedPositions, oriented.indices);
  onProgress(0.9);
  await tick();

  // 4. Texture (or vertex-color fallback), placement, GLB export (0.9 -> 1).
  let exportPositions = smoothedPositions;
  let exportNormals = normals;
  let exportIndices = oriented.indices;
  let colors = null;
  let uvs = null;
  let texturePng = null;
  try {
    const unwrapped = buildCylindricalUnwrap(smoothedPositions, normals, oriented.indices);
    texturePng = bakeTexture(unwrapped, rig, colorImages);
    exportPositions = unwrapped.positions;
    exportNormals = unwrapped.normals;
    exportIndices = unwrapped.indices;
    uvs = unwrapped.uvs;
  } catch (err) {
    warnings.add(`Не удалось запечь текстуру (${err.message}) — использованы цвета вершин.`);
    texturePng = null;
    uvs = null;
  }
  if (!texturePng) {
    colors = assignVertexColors(smoothedPositions, normals, rig, images);
  }
  await tick();

  // Если известна реальная высота объекта, экспортируем GLB сразу в метрах
  // (1 ед. = 1000 мм) — измерения во вьюере становятся точными без эвристик.
  const realHeightMm = Number(options.settings && options.settings.realHeightMm) || null;
  const targetHeight = realHeightMm && realHeightMm > 0 ? realHeightMm / 1000 : TARGET_MODEL_HEIGHT;
  const placed = centerAndScale(exportPositions, targetHeight);
  const glb = buildGlb({
    positions: placed.positions,
    normals: exportNormals,
    colors,
    uvs,
    texturePng,
    indices: exportIndices,
    name: `pmas-scan-${job.jobId || "model"}`,
    generator: ENGINE_NAME
  });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, glb);
  onProgress(1);

  const averageCoverage = silhouettes.reduce((sum, s) => sum + s.coverage, 0) / silhouettes.length;
  const watertight = isWatertight(oriented.indices);
  const stats = {
    inputFrames: framePaths.length,
    usableFrames: silhouettes.length,
    voxelGrid: profile.dims,
    insideVoxels: grid.insideCount,
    vertexCount: rawMesh.vertexCount,
    triangleCount: rawMesh.triangleCount,
    watertight,
    textured: Boolean(texturePng),
    realHeightMm: realHeightMm || null,
    averageSilhouetteCoverage: Number(averageCoverage.toFixed(4)),
    glbBytes: glb.length
  };
  return {
    rawMeshPath: outputPath,
    engineName: ENGINE_NAME,
    warnings: Array.from(warnings),
    quality: gradeQuality({ usableFrames: silhouettes.length, watertight, averageCoverage }),
    realHeightMm: realHeightMm || null,
    stats
  };
}

module.exports = {
  ENGINE_NAME,
  runNativeReconstruction,
  resolveProfile
};
