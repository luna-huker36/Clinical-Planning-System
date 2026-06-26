/**
 * Запекание фототекстуры для PMAS Native Engine.
 *
 * Вместо цветов вершин строится настоящая UV-текстура: меш разворачивается
 * цилиндрически (азимут вокруг Y → U, высота → V), каждый тексель
 * закрашивается из фотографии, лучше всего смотрящей на соответствующую
 * точку поверхности. Это даёт фотореалистичный результат с разрешением,
 * не зависящим от плотности сетки.
 *
 * Вход — меш в координатах rig'а (до centerAndScale), выход — новые массивы
 * вершин (со швом-дубликатами), UV и PNG-текстура.
 */

const { PNG } = require("pngjs");
const { sampleBilinear } = require("./image-utils");
const { projectToView } = require("./camera-rig");

const TEXTURE_WIDTH = 2048;
const TEXTURE_HEIGHT = 1024;
const MIN_FACING_DOT = 0.05;
const FALLBACK_COLOR = [200, 172, 150];
const DILATE_PASSES = 4;

function computeMeshYBounds(positions) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (let v = 1; v < positions.length; v += 3) {
    if (positions[v] < minY) minY = positions[v];
    if (positions[v] > maxY) maxY = positions[v];
  }
  return { minY, span: Math.max(1e-9, maxY - minY) };
}

/**
 * Цилиндрическая развёртка с разрезом по шву: треугольники, пересекающие
 * линию u=0/1, получают дубликаты вершин с u+1 (REPEAT в сэмплере).
 *
 * @returns {{positions, normals, uvs, indices, vertexCount}}
 */
function buildCylindricalUnwrap(positions, normals, indices) {
  const vertexCount = positions.length / 3;
  const { minY, span } = computeMeshYBounds(positions);
  const baseU = new Float32Array(vertexCount);
  const baseV = new Float32Array(vertexCount);
  for (let v = 0; v < vertexCount; v += 1) {
    // Та же азимутальная конвенция, что у rig'а: theta = atan2(x, z).
    baseU[v] = Math.atan2(positions[v * 3], positions[v * 3 + 2]) / (2 * Math.PI) + 0.5;
    baseV[v] = 1 - (positions[v * 3 + 1] - minY) / span;
  }

  const outPositions = Array.from(positions);
  const outNormals = Array.from(normals);
  const outU = Array.from(baseU);
  const outV = Array.from(baseV);
  const wrappedCopy = new Map(); // исходная вершина -> индекс дубликата с u+1
  const outIndices = new Uint32Array(indices.length);

  const duplicateWithWrap = (vertex) => {
    let copy = wrappedCopy.get(vertex);
    if (copy != null) return copy;
    copy = outU.length;
    outPositions.push(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]);
    outNormals.push(normals[vertex * 3], normals[vertex * 3 + 1], normals[vertex * 3 + 2]);
    outU.push(baseU[vertex] + 1);
    outV.push(baseV[vertex]);
    wrappedCopy.set(vertex, copy);
    return copy;
  };

  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    const uMin = Math.min(baseU[a], baseU[b], baseU[c]);
    const uMax = Math.max(baseU[a], baseU[b], baseU[c]);
    if (uMax - uMin > 0.5) {
      outIndices[t] = baseU[a] < 0.5 ? duplicateWithWrap(a) : a;
      outIndices[t + 1] = baseU[b] < 0.5 ? duplicateWithWrap(b) : b;
      outIndices[t + 2] = baseU[c] < 0.5 ? duplicateWithWrap(c) : c;
    } else {
      outIndices[t] = a;
      outIndices[t + 1] = b;
      outIndices[t + 2] = c;
    }
  }

  const finalCount = outU.length;
  const uvs = new Float32Array(finalCount * 2);
  for (let v = 0; v < finalCount; v += 1) {
    uvs[v * 2] = outU[v];
    uvs[v * 2 + 1] = outV[v];
  }
  return {
    positions: Float32Array.from(outPositions),
    normals: Float32Array.from(outNormals),
    uvs,
    indices: outIndices,
    vertexCount: finalCount
  };
}

const BLEND_TOP_VIEWS = 3;

function pickViewColor(rig, images, px, py, pz, nx, ny, nz) {
  // Смешиваются только 3 лучших по ракурсу вида с резким весом dot^6:
  // смесь по всем ракурсам устраняет мраморные полосы, но размывает черты
  // лица в кашу; топ-3 сохраняет резкость деталей и гладкие швы.
  const candidates = [];
  for (let k = 0; k < rig.views.length; k += 1) {
    const view = rig.views[k];
    const dot = nx * view.toCamera.x + ny * view.toCamera.y + nz * view.toCamera.z;
    if (dot <= MIN_FACING_DOT) continue;
    const projected = projectToView(view, px, py, pz);
    const ix = Math.round(projected.px);
    const iy = Math.round(projected.py);
    if (ix < 2 || iy < 0 || ix >= view.width - 2 || iy >= view.height) continue;
    // Сэмплируем только внутренность маски (запас 2px по горизонтали),
    // чтобы у контура не подмешивался фон.
    const row = iy * view.width;
    if (!view.mask[row + ix] || !view.mask[row + ix - 2] || !view.mask[row + ix + 2]) continue;
    candidates.push({ k, dot, px: projected.px, py: projected.py });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.dot - a.dot);

  let r = 0;
  let g = 0;
  let b = 0;
  let weightSum = 0;
  const top = Math.min(BLEND_TOP_VIEWS, candidates.length);
  for (let c = 0; c < top; c += 1) {
    const { k, dot, px: vx, py: vy } = candidates[c];
    const image = images[k];
    const view = rig.views[k];
    // Цвет берём из более детальной копии кадра, чем рабочее разрешение масок.
    const ratio = image.width / view.width;
    const rgb = sampleBilinear(image, vx * ratio, vy * ratio);
    const weight = dot ** 6;
    r += rgb[0] * weight;
    g += rgb[1] * weight;
    b += rgb[2] * weight;
    weightSum += weight;
  }
  if (weightSum <= 0) return null;
  return [r / weightSum, g / weightSum, b / weightSum];
}

function dilateTexture(rgba, filled, width, height) {
  for (let pass = 0; pass < DILATE_PASSES; pass += 1) {
    const grown = Uint8Array.from(filled);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        if (filled[i]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = (x + dx + width) % width; // U-шов заворачивается
            const ny = y + dy;
            if (ny < 0 || ny >= height) continue;
            const ni = ny * width + nx;
            if (!filled[ni]) continue;
            r += rgba[ni * 4];
            g += rgba[ni * 4 + 1];
            b += rgba[ni * 4 + 2];
            count += 1;
          }
        }
        if (count > 0) {
          rgba[i * 4] = Math.round(r / count);
          rgba[i * 4 + 1] = Math.round(g / count);
          rgba[i * 4 + 2] = Math.round(b / count);
          rgba[i * 4 + 3] = 255;
          grown[i] = 1;
        }
      }
    }
    filled.set(grown);
  }
}

/**
 * Запечь текстуру по фотографиям.
 *
 * @param {{positions, normals, uvs, indices}} unwrapped из buildCylindricalUnwrap
 * @param {{views: Array<object>}} rig
 * @param {Array<{width, height, data}>} images рабочие фото (по одному на view)
 * @returns {Buffer} PNG
 */
function bakeTexture(unwrapped, rig, images) {
  const { positions, normals, uvs, indices } = unwrapped;
  const W = TEXTURE_WIDTH;
  const H = TEXTURE_HEIGHT;
  const rgba = new Uint8Array(W * H * 4);
  const filled = new Uint8Array(W * H);

  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t];
    const ib = indices[t + 1];
    const ic = indices[t + 2];
    // UV в пиксельных координатах; U может выходить за W (шов) — пишем по модулю.
    const ax = uvs[ia * 2] * W;
    const ay = uvs[ia * 2 + 1] * H;
    const bx = uvs[ib * 2] * W;
    const by = uvs[ib * 2 + 1] * H;
    const cx = uvs[ic * 2] * W;
    const cy = uvs[ic * 2 + 1] * H;

    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxX = Math.ceil(Math.max(ax, bx, cx));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(denom) < 1e-12) continue;

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const pxc = x + 0.5;
        const pyc = y + 0.5;
        const w0 = ((by - cy) * (pxc - cx) + (cx - bx) * (pyc - cy)) / denom;
        const w1 = ((cy - ay) * (pxc - cx) + (ax - cx) * (pyc - cy)) / denom;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;

        const texX = ((x % W) + W) % W;
        const ti = y * W + texX;
        if (filled[ti]) continue;

        const px = w0 * positions[ia * 3] + w1 * positions[ib * 3] + w2 * positions[ic * 3];
        const py = w0 * positions[ia * 3 + 1] + w1 * positions[ib * 3 + 1] + w2 * positions[ic * 3 + 1];
        const pz = w0 * positions[ia * 3 + 2] + w1 * positions[ib * 3 + 2] + w2 * positions[ic * 3 + 2];
        let nx = w0 * normals[ia * 3] + w1 * normals[ib * 3] + w2 * normals[ic * 3];
        let ny = w0 * normals[ia * 3 + 1] + w1 * normals[ib * 3 + 1] + w2 * normals[ic * 3 + 1];
        let nz = w0 * normals[ia * 3 + 2] + w1 * normals[ib * 3 + 2] + w2 * normals[ic * 3 + 2];
        const nLen = Math.hypot(nx, ny, nz) || 1;
        nx /= nLen;
        ny /= nLen;
        nz /= nLen;

        const rgb = pickViewColor(rig, images, px, py, pz, nx, ny, nz) || FALLBACK_COLOR;
        rgba[ti * 4] = rgb[0];
        rgba[ti * 4 + 1] = rgb[1];
        rgba[ti * 4 + 2] = rgb[2];
        rgba[ti * 4 + 3] = 255;
        filled[ti] = 1;
      }
    }
  }

  dilateTexture(rgba, filled, W, H);
  // Незаполненные области — нейтральный тон вместо чёрного.
  for (let i = 0; i < W * H; i += 1) {
    if (!filled[i]) {
      rgba[i * 4] = FALLBACK_COLOR[0];
      rgba[i * 4 + 1] = FALLBACK_COLOR[1];
      rgba[i * 4 + 2] = FALLBACK_COLOR[2];
      rgba[i * 4 + 3] = 255;
    }
  }

  const png = new PNG({ width: W, height: H, colorType: 6 });
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length);
  return PNG.sync.write(png);
}

module.exports = {
  buildCylindricalUnwrap,
  bakeTexture,
  TEXTURE_WIDTH,
  TEXTURE_HEIGHT
};
