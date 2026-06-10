'use strict';

/**
 * Silhouette extraction via background-difference segmentation.
 * The object is assumed to be photographed against a relatively uniform
 * background; the background color is estimated from the image border ring.
 */

const { validateImage } = require('./image-utils');

const RING_FRACTION = 0.02;
const MIN_RING_THICKNESS = 2;
const THRESHOLD_MIN = 25;
const THRESHOLD_MAX = 120;
const LOW_COVERAGE_LIMIT = 0.02;
const HIGH_COVERAGE_LIMIT = 0.85;
const LOW_CONTRAST_FACTOR = 1.6;
const FOREGROUND = 255;
const WARN_LOW_COVERAGE = 'Объект почти не выделен на кадре — проверьте контраст с фоном';
const WARN_HIGH_COVERAGE = 'Фон слился с объектом на кадре';
const WARN_LOW_CONTRAST = 'Низкий контраст объекта с фоном';

/**
 * Extracts the object silhouette from an RGBA image using background-color
 * difference, Otsu thresholding, morphological cleanup, largest-component
 * selection and hole filling. Never throws on a valid image input.
 * @param {{width: number, height: number, data: Uint8Array}} img - Source RGBA image.
 * @param {object} [options] - Reserved for future tuning; must be an object.
 * @returns {{mask: Uint8Array, width: number, height: number,
 *   bbox: {minX: number, minY: number, maxX: number, maxY: number},
 *   center: {x: number, y: number}, halfHeight: number, coverage: number,
 *   backgroundColor: {r: number, g: number, b: number}, warnings: string[]}}
 */
function extractSilhouette(img, options = {}) {
  validateImage(img, 'extractSilhouette(img)');
  if (options === null || typeof options !== 'object') {
    throw new Error('extractSilhouette: options must be an object');
  }
  const { width, height } = img;
  const backgroundColor = computeBackgroundColor(img);
  const dist = buildDistanceMap(img, backgroundColor);
  const threshold = clampThreshold(otsuThreshold(dist));
  const rawMask = thresholdMask(dist, threshold);
  const opened = dilate3x3(erode3x3(rawMask, width, height), width, height);
  const largest = keepLargestComponent(opened, width, height);
  if (!hasForeground(largest)) {
    return buildEmptyResult(width, height, backgroundColor);
  }
  const filled = fillHoles(largest, width, height);
  const mask = erode3x3(dilate3x3(filled, width, height), width, height);
  const stats = computeStats(mask, width, height, dist);
  if (stats.count === 0) {
    return buildEmptyResult(width, height, backgroundColor);
  }
  const coverage = stats.count / (width * height);
  const meanDistance = stats.distSum / stats.count;
  const bbox = { minX: stats.minX, minY: stats.minY, maxX: stats.maxX, maxY: stats.maxY };
  return {
    mask,
    width,
    height,
    bbox,
    center: { x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2 },
    halfHeight: Math.max(1, (bbox.maxY - bbox.minY) / 2),
    coverage,
    backgroundColor,
    warnings: collectWarnings(coverage, meanDistance, threshold),
  };
}

function buildEmptyResult(width, height, backgroundColor) {
  return {
    mask: new Uint8Array(width * height),
    width,
    height,
    bbox: { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 },
    center: { x: (width - 1) / 2, y: (height - 1) / 2 },
    halfHeight: height / 2,
    coverage: 0,
    backgroundColor,
    warnings: [WARN_LOW_COVERAGE],
  };
}

function collectWarnings(coverage, meanDistance, threshold) {
  const warnings = [];
  if (coverage < LOW_COVERAGE_LIMIT) {
    warnings.push(WARN_LOW_COVERAGE);
  }
  if (coverage > HIGH_COVERAGE_LIMIT) {
    warnings.push(WARN_HIGH_COVERAGE);
  }
  if (meanDistance < LOW_CONTRAST_FACTOR * threshold) {
    warnings.push(WARN_LOW_CONTRAST);
  }
  return warnings;
}

function computeBackgroundColor(img) {
  const { width: w, height: h, data } = img;
  const t = Math.max(MIN_RING_THICKNESS, Math.round(RING_FRACTION * Math.min(w, h)));
  const innerW = Math.max(0, w - 2 * t);
  const innerH = Math.max(0, h - 2 * t);
  const count = w * h - innerW * innerH;
  const rs = new Uint8Array(count);
  const gs = new Uint8Array(count);
  const bs = new Uint8Array(count);
  let k = 0;
  for (let y = 0; y < h; y++) {
    const inBandY = y < t || y >= h - t;
    for (let x = 0; x < w; x++) {
      if (!inBandY && x >= t && x < w - t) {
        continue;
      }
      const i = 4 * (y * w + x);
      rs[k] = data[i];
      gs[k] = data[i + 1];
      bs[k] = data[i + 2];
      k++;
    }
  }
  rs.sort();
  gs.sort();
  bs.sort();
  return { r: medianOfSorted(rs), g: medianOfSorted(gs), b: medianOfSorted(bs) };
}

function medianOfSorted(sorted) {
  const n = sorted.length;
  const mid = n >> 1;
  if (n % 2 === 1) {
    return sorted[mid];
  }
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function buildDistanceMap(img, bg) {
  const { width, height, data } = img;
  const n = width * height;
  const dist = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const dr = data[4 * i] - bg.r;
    const dg = data[4 * i + 1] - bg.g;
    const db = data[4 * i + 2] - bg.b;
    const e = Math.sqrt(dr * dr + dg * dg + db * db);
    dist[i] = e >= 255 ? 255 : Math.round(e);
  }
  return dist;
}

function otsuThreshold(dist) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < dist.length; i++) {
    hist[dist[i]]++;
  }
  const total = dist.length;
  let sumAll = 0;
  for (let v = 0; v < 256; v++) {
    sumAll += v * hist[v];
  }
  let weightBg = 0;
  let sumBg = 0;
  let best = 0;
  let bestVariance = -1;
  for (let t = 0; t < 256; t++) {
    weightBg += hist[t];
    if (weightBg === 0) {
      continue;
    }
    const weightFg = total - weightBg;
    if (weightFg === 0) {
      break;
    }
    sumBg += t * hist[t];
    const meanBg = sumBg / weightBg;
    const meanFg = (sumAll - sumBg) / weightFg;
    const between = weightBg * weightFg * (meanBg - meanFg) * (meanBg - meanFg);
    if (between > bestVariance) {
      bestVariance = between;
      best = t;
    }
  }
  return best;
}

function clampThreshold(threshold) {
  return Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, threshold));
}

function thresholdMask(dist, threshold) {
  const mask = new Uint8Array(dist.length);
  for (let i = 0; i < dist.length; i++) {
    mask[i] = dist[i] > threshold ? FOREGROUND : 0;
  }
  return mask;
}

function neighborhood3x3(mask, w, h, x, y, requireAll) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      const v = nx < 0 || ny < 0 || nx >= w || ny >= h ? 0 : mask[ny * w + nx];
      if (requireAll && v === 0) {
        return false;
      }
      if (!requireAll && v !== 0) {
        return true;
      }
    }
  }
  return requireAll;
}

function erode3x3(mask, w, h) {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    out[i] = neighborhood3x3(mask, w, h, i % w, (i / w) | 0, true) ? FOREGROUND : 0;
  }
  return out;
}

function dilate3x3(mask, w, h) {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    out[i] = neighborhood3x3(mask, w, h, i % w, (i / w) | 0, false) ? FOREGROUND : 0;
  }
  return out;
}

function floodFill(mask, labels, queue, w, h, start, label) {
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  labels[start] = label;
  let size = 0;
  while (head < tail) {
    const p = queue[head++];
    size++;
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0 && mask[p - 1] !== 0 && labels[p - 1] === 0) {
      labels[p - 1] = label;
      queue[tail++] = p - 1;
    }
    if (x < w - 1 && mask[p + 1] !== 0 && labels[p + 1] === 0) {
      labels[p + 1] = label;
      queue[tail++] = p + 1;
    }
    if (y > 0 && mask[p - w] !== 0 && labels[p - w] === 0) {
      labels[p - w] = label;
      queue[tail++] = p - w;
    }
    if (y < h - 1 && mask[p + w] !== 0 && labels[p + w] === 0) {
      labels[p + w] = label;
      queue[tail++] = p + w;
    }
  }
  return size;
}

function keepLargestComponent(mask, w, h) {
  const n = w * h;
  const labels = new Int32Array(n);
  const queue = new Int32Array(n);
  let bestLabel = 0;
  let bestSize = 0;
  let nextLabel = 0;
  for (let i = 0; i < n; i++) {
    if (mask[i] === 0 || labels[i] !== 0) {
      continue;
    }
    nextLabel++;
    const size = floodFill(mask, labels, queue, w, h, i, nextLabel);
    if (size > bestSize) {
      bestSize = size;
      bestLabel = nextLabel;
    }
  }
  const out = new Uint8Array(n);
  if (bestLabel === 0) {
    return out;
  }
  for (let i = 0; i < n; i++) {
    out[i] = labels[i] === bestLabel ? FOREGROUND : 0;
  }
  return out;
}

function fillHoles(mask, w, h) {
  const n = w * h;
  const reached = new Uint8Array(n);
  const queue = new Int32Array(n);
  let tail = 0;
  const seed = (p) => {
    if (mask[p] === 0 && reached[p] === 0) {
      reached[p] = 1;
      queue[tail++] = p;
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  let head = 0;
  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (y > 0) seed(p - w);
    if (y < h - 1) seed(p + w);
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = mask[i] !== 0 || reached[i] === 0 ? FOREGROUND : 0;
  }
  return out;
}

function hasForeground(mask) {
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 0) {
      return true;
    }
  }
  return false;
}

function computeStats(mask, w, h, dist) {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  let distSum = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i] === 0) {
        continue;
      }
      count++;
      distSum += dist[i];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY, count, distSum };
}

module.exports = { extractSilhouette };
