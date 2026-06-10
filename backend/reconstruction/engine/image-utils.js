'use strict';

/**
 * Image utilities for the pure-JS 3D reconstruction engine.
 *
 * Image convention: { width: number, height: number, data: Uint8Array }
 * where data is RGBA and data.length === 4 * width * height.
 */

const fs = require('fs/promises');
const path = require('path');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png'];
const RGBA_CHANNELS = 4;

/**
 * Validates that a value conforms to the shared Image convention.
 * @param {object} img - Candidate image object.
 * @param {string} name - Label used in error messages.
 * @throws {Error} If the value is not a valid RGBA image object.
 */
function validateImage(img, name) {
  if (!img || typeof img !== 'object') {
    throw new Error(`${name}: expected an image object { width, height, data }`);
  }
  const { width, height, data } = img;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error(`${name}: width and height must be positive integers, got ${width}x${height}`);
  }
  if (!(data instanceof Uint8Array)) {
    throw new Error(`${name}: data must be a Uint8Array of RGBA pixels`);
  }
  const expected = RGBA_CHANNELS * width * height;
  if (data.length !== expected) {
    throw new Error(`${name}: data length ${data.length} does not match expected ${expected} (4*${width}*${height})`);
  }
}

/**
 * Decodes a JPEG or PNG file from disk into an RGBA image object.
 * @param {string} filePath - Path to a .jpg/.jpeg/.png file.
 * @returns {Promise<{width: number, height: number, data: Uint8Array}>} Decoded RGBA image.
 * @throws {Error} On unsupported extension, read failure, or decode failure.
 */
async function decodeImageFile(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('decodeImageFile: filePath must be a non-empty string');
  }
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new Error(`decodeImageFile: unsupported extension "${ext}" for "${filePath}" (expected .jpg, .jpeg or .png)`);
  }
  let buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch (err) {
    throw new Error(`decodeImageFile: failed to read "${filePath}": ${err.message}`);
  }
  let image;
  try {
    image = ext === '.png' ? decodePngBuffer(buffer) : decodeJpegBuffer(buffer);
  } catch (err) {
    throw new Error(`decodeImageFile: failed to decode "${filePath}": ${err.message}`);
  }
  validateImage(image, 'decodeImageFile(result)');
  return image;
}

function decodePngBuffer(buffer) {
  const png = PNG.sync.read(buffer);
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
}

function decodeJpegBuffer(buffer) {
  // Raised limits: modern phones produce 48-50MP JPEGs that exceed the
  // jpeg-js defaults (512MB / 100MP would throw on a plain photo).
  const raw = jpeg.decode(buffer, {
    useTArray: true,
    formatAsRGBA: true,
    maxMemoryUsageInMB: 2048,
    maxResolutionInMP: 120
  });
  const data = raw.data instanceof Uint8Array && !Buffer.isBuffer(raw.data)
    ? raw.data
    : new Uint8Array(raw.data);
  const image = { width: raw.width, height: raw.height, data };
  return applyExifOrientation(image, readJpegOrientation(buffer));
}

/**
 * Reads the EXIF orientation tag (1..8) from a JPEG buffer.
 * Returns 1 (upright) when there is no EXIF data or parsing fails — phone
 * cameras store rotated pixels and rely on this tag, so it must be honored.
 * @param {Buffer|Uint8Array} buffer - Raw JPEG file bytes.
 * @returns {number} EXIF orientation value 1..8.
 */
function readJpegOrientation(buffer) {
  try {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return 1;
    let offset = 2;
    while (offset + 4 <= buffer.length) {
      if (buffer[offset] !== 0xff) return 1;
      // JPEG allows 0xFF fill bytes before a marker — skip them.
      while (buffer[offset + 1] === 0xff && offset + 5 <= buffer.length) offset += 1;
      const marker = buffer[offset + 1];
      if (marker === 0xda || marker === 0xd9) return 1; // start of scan / end
      const size = (buffer[offset + 2] << 8) | buffer[offset + 3];
      if (size < 2) return 1;
      if (marker === 0xe1 && offset + 4 + 6 <= buffer.length &&
          buffer.toString("ascii", offset + 4, offset + 10) === "Exif\0\0") {
        const tiff = offset + 10;
        const littleEndian = buffer[tiff] === 0x49 && buffer[tiff + 1] === 0x49;
        const read16 = at => (littleEndian
          ? buffer[at] | (buffer[at + 1] << 8)
          : (buffer[at] << 8) | buffer[at + 1]);
        const read32 = at => (littleEndian
          ? buffer[at] | (buffer[at + 1] << 8) | (buffer[at + 2] << 16) | (buffer[at + 3] << 24)
          : (buffer[at] << 24) | (buffer[at + 1] << 16) | (buffer[at + 2] << 8) | buffer[at + 3]);
        const ifdOffset = read32(tiff + 4);
        const ifd = tiff + ifdOffset;
        if (ifd + 2 > buffer.length) return 1;
        const entryCount = read16(ifd);
        for (let i = 0; i < entryCount; i += 1) {
          const entry = ifd + 2 + i * 12;
          if (entry + 12 > buffer.length) return 1;
          if (read16(entry) === 0x0112) {
            const value = read16(entry + 8);
            return value >= 1 && value <= 8 ? value : 1;
          }
        }
        return 1;
      }
      offset += 2 + size;
    }
  } catch (err) {
    // Malformed EXIF — treat as upright.
  }
  return 1;
}

/**
 * Remaps pixels so the image is upright according to its EXIF orientation.
 * Orientations 5..8 swap width and height. Returns the input unchanged for
 * orientation 1.
 * @param {{width: number, height: number, data: Uint8Array}} img - Source RGBA image.
 * @param {number} orientation - EXIF orientation 1..8.
 * @returns {{width: number, height: number, data: Uint8Array}} Upright image.
 */
function applyExifOrientation(img, orientation) {
  if (!orientation || orientation === 1) return img;
  const { width: w, height: h, data } = img;
  const swapped = orientation >= 5;
  const outW = swapped ? h : w;
  const outH = swapped ? w : h;
  const out = new Uint8Array(RGBA_CHANNELS * outW * outH);
  for (let oy = 0; oy < outH; oy += 1) {
    for (let ox = 0; ox < outW; ox += 1) {
      let sx;
      let sy;
      switch (orientation) {
        case 2: sx = w - 1 - ox; sy = oy; break;            // mirror horizontal
        case 3: sx = w - 1 - ox; sy = h - 1 - oy; break;    // rotate 180
        case 4: sx = ox; sy = h - 1 - oy; break;            // mirror vertical
        case 5: sx = oy; sy = ox; break;                    // transpose
        case 6: sx = oy; sy = h - 1 - ox; break;            // rotate 90 CW
        case 7: sx = w - 1 - oy; sy = h - 1 - ox; break;    // transverse
        case 8: sx = w - 1 - oy; sy = ox; break;            // rotate 90 CCW
        default: sx = ox; sy = oy; break;
      }
      const si = RGBA_CHANNELS * (sy * w + sx);
      const oi = RGBA_CHANNELS * (oy * outW + ox);
      out[oi] = data[si];
      out[oi + 1] = data[si + 1];
      out[oi + 2] = data[si + 2];
      out[oi + 3] = data[si + 3];
    }
  }
  return { width: outW, height: outH, data: out };
}

/**
 * Downscales an image so that max(width, height) <= maxDim, preserving aspect
 * ratio, using a box filter with correct fractional weighting at region edges.
 * Returns the input image unchanged if it is already small enough.
 * @param {{width: number, height: number, data: Uint8Array}} img - Source RGBA image.
 * @param {number} maxDim - Maximum allowed dimension (positive integer).
 * @returns {{width: number, height: number, data: Uint8Array}} Downscaled RGBA image.
 */
function downscaleImage(img, maxDim) {
  validateImage(img, 'downscaleImage(img)');
  if (!Number.isInteger(maxDim) || maxDim < 1) {
    throw new Error(`downscaleImage: maxDim must be a positive integer, got ${maxDim}`);
  }
  const { width, height } = img;
  if (Math.max(width, height) <= maxDim) {
    return img;
  }
  const scale = maxDim / Math.max(width, height);
  const dstW = Math.max(1, Math.round(width * scale));
  const dstH = Math.max(1, Math.round(height * scale));
  const scaleX = width / dstW;
  const scaleY = height / dstH;
  const out = new Uint8Array(RGBA_CHANNELS * dstW * dstH);
  for (let dy = 0; dy < dstH; dy++) {
    for (let dx = 0; dx < dstW; dx++) {
      const oi = RGBA_CHANNELS * (dy * dstW + dx);
      boxAverage(img, dx * scaleX, (dx + 1) * scaleX, dy * scaleY, (dy + 1) * scaleY, out, oi);
    }
  }
  return { width: dstW, height: dstH, data: out };
}

function boxAverage(img, sx0, sx1, sy0, sy1, out, oi) {
  const { width, height, data } = img;
  const yStart = Math.floor(sy0);
  const yEnd = Math.min(Math.ceil(sy1), height);
  const xStart = Math.floor(sx0);
  const xEnd = Math.min(Math.ceil(sx1), width);
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let weightSum = 0;
  for (let sy = yStart; sy < yEnd; sy++) {
    const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
    for (let sx = xStart; sx < xEnd; sx++) {
      const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
      const w = wx * wy;
      const i = RGBA_CHANNELS * (sy * width + sx);
      r += data[i] * w;
      g += data[i + 1] * w;
      b += data[i + 2] * w;
      a += data[i + 3] * w;
      weightSum += w;
    }
  }
  const norm = weightSum > 0 ? weightSum : 1;
  out[oi] = Math.round(r / norm);
  out[oi + 1] = Math.round(g / norm);
  out[oi + 2] = Math.round(b / norm);
  out[oi + 3] = Math.round(a / norm);
}

/**
 * Samples RGB at (x, y) with bilinear interpolation; coordinates are clamped
 * to the valid pixel range [0, width-1] x [0, height-1].
 * @param {{width: number, height: number, data: Uint8Array}} img - Source RGBA image.
 * @param {number} x - X coordinate in pixels.
 * @param {number} y - Y coordinate in pixels.
 * @returns {[number, number, number]} Interpolated [r, g, b].
 */
function sampleBilinear(img, x, y) {
  validateImage(img, 'sampleBilinear(img)');
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`sampleBilinear: x and y must be finite numbers, got (${x}, ${y})`);
  }
  const { width, height, data } = img;
  const cx = Math.min(width - 1, Math.max(0, x));
  const cy = Math.min(height - 1, Math.max(0, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const i00 = RGBA_CHANNELS * (y0 * width + x0);
  const i10 = RGBA_CHANNELS * (y0 * width + x1);
  const i01 = RGBA_CHANNELS * (y1 * width + x0);
  const i11 = RGBA_CHANNELS * (y1 * width + x1);
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  return [
    data[i00] * w00 + data[i10] * w10 + data[i01] * w01 + data[i11] * w11,
    data[i00 + 1] * w00 + data[i10 + 1] * w10 + data[i01 + 1] * w01 + data[i11 + 1] * w11,
    data[i00 + 2] * w00 + data[i10 + 2] * w10 + data[i01 + 2] * w01 + data[i11 + 2] * w11,
  ];
}

/**
 * Samples a binary mask with nearest-neighbor lookup. Coordinates within a
 * 1-pixel margin outside the bounds are clamped; anything farther returns 0.
 * @param {Uint8Array} mask - Binary mask (values 0 or 255), length width*height.
 * @param {number} width - Mask width in pixels.
 * @param {number} height - Mask height in pixels.
 * @param {number} x - X coordinate in pixels.
 * @param {number} y - Y coordinate in pixels.
 * @returns {0|255} Mask value at the nearest valid pixel, or 0 when out of range.
 */
function sampleMaskNearest(mask, width, height, x, y) {
  if (!(mask instanceof Uint8Array)) {
    throw new Error('sampleMaskNearest: mask must be a Uint8Array');
  }
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error(`sampleMaskNearest: width and height must be positive integers, got ${width}x${height}`);
  }
  if (mask.length !== width * height) {
    throw new Error(`sampleMaskNearest: mask length ${mask.length} does not match ${width}*${height}`);
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`sampleMaskNearest: x and y must be finite numbers, got (${x}, ${y})`);
  }
  if (x < -1 || x > width || y < -1 || y > height) {
    return 0;
  }
  const xi = Math.min(width - 1, Math.max(0, Math.round(x)));
  const yi = Math.min(height - 1, Math.max(0, Math.round(y)));
  return mask[yi * width + xi] === 255 ? 255 : 0;
}

module.exports = {
  decodeImageFile,
  downscaleImage,
  sampleBilinear,
  sampleMaskNearest,
  validateImage,
  readJpegOrientation,
  applyExifOrientation,
};
