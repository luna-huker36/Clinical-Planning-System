'use strict';

/**
 * Minimal, spec-correct binary glTF 2.0 (GLB) writer, parser and validator.
 * Pure Node.js built-ins (Buffer), no external dependencies. GLB layout:
 * 12-byte header (magic "glTF", version 2, total length), a JSON chunk
 * (0x4E4F534A, space-padded) and a BIN chunk (0x004E4942, zero-padded).
 */

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const CHUNK_TYPE_JSON = 0x4e4f534a;
const CHUNK_TYPE_BIN = 0x004e4942;
const TARGET_ARRAY_BUFFER = 34962;
const TARGET_ELEMENT_ARRAY_BUFFER = 34963;
const COMP_UNSIGNED_BYTE = 5121;
const COMP_UNSIGNED_SHORT = 5123;
const COMP_UNSIGNED_INT = 5125;
const COMP_FLOAT = 5126;
const COMPONENT_BYTE_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENT_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const MIN_MAX_TOLERANCE = 1e-5;
const DEFAULT_NAME = 'pmas-scan';
const DEFAULT_GENERATOR = 'PMAS Native Reconstruction Engine';

function align4(value) {
  return (value + 3) & ~3;
}

function assertFiniteFloats(arr, label) {
  for (let i = 0; i < arr.length; i += 1) {
    if (!Number.isFinite(arr[i])) throw new Error(`buildGlb: ${label}[${i}] is not a finite number`);
  }
}

function validateBuildInputs(positions, normals, colors, indices) {
  if (!(positions instanceof Float32Array)) throw new Error('buildGlb: positions must be a Float32Array');
  if (positions.length === 0 || positions.length % 3 !== 0) {
    throw new Error(`buildGlb: positions length must be a positive multiple of 3, got ${positions.length}`);
  }
  const vertexCount = positions.length / 3;
  if (!(normals instanceof Float32Array)) throw new Error('buildGlb: normals must be a Float32Array');
  if (normals.length !== positions.length) {
    throw new Error(`buildGlb: normals length ${normals.length} must equal positions length ${positions.length}`);
  }
  if (colors !== null) {
    if (!(colors instanceof Uint8Array)) throw new Error('buildGlb: colors must be a Uint8Array or null');
    if (colors.length !== 4 * vertexCount) {
      throw new Error(`buildGlb: colors length must be ${4 * vertexCount} (RGBA per vertex), got ${colors.length}`);
    }
  }
  if (!(indices instanceof Uint32Array)) throw new Error('buildGlb: indices must be a Uint32Array');
  if (indices.length === 0 || indices.length % 3 !== 0) {
    throw new Error(`buildGlb: indices length must be a positive multiple of 3, got ${indices.length}`);
  }
  for (let i = 0; i < indices.length; i += 1) {
    if (indices[i] >= vertexCount) {
      throw new Error(`buildGlb: index ${indices[i]} at position ${i} is out of range (vertexCount=${vertexCount})`);
    }
  }
  assertFiniteFloats(positions, 'positions');
  assertFiniteFloats(normals, 'normals');
  return vertexCount;
}

function computePositionBounds(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[i + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  return { min, max };
}

function writeFloatsLE(target, byteOffset, values) {
  for (let i = 0; i < values.length; i += 1) target.writeFloatLE(values[i], byteOffset + 4 * i);
}

function writeUint32sLE(target, byteOffset, values) {
  for (let i = 0; i < values.length; i += 1) target.writeUInt32LE(values[i], byteOffset + 4 * i);
}

function buildGltfJson({ vertexCount, indexCount, bounds, bufferViews, binByteLength, hasColors, name, generator }) {
  const accessors = [
    { bufferView: 0, byteOffset: 0, componentType: COMP_UNSIGNED_INT, count: indexCount, type: 'SCALAR' },
    { bufferView: 1, byteOffset: 0, componentType: COMP_FLOAT, count: vertexCount, type: 'VEC3', min: bounds.min, max: bounds.max },
    { bufferView: 2, byteOffset: 0, componentType: COMP_FLOAT, count: vertexCount, type: 'VEC3' },
  ];
  const attributes = { POSITION: 1, NORMAL: 2 };
  if (hasColors) {
    accessors.push({ bufferView: 3, byteOffset: 0, componentType: COMP_UNSIGNED_BYTE, count: vertexCount, type: 'VEC4', normalized: true });
    attributes.COLOR_0 = 3;
  }
  return {
    asset: { version: '2.0', generator },
    buffers: [{ byteLength: binByteLength }],
    bufferViews,
    accessors,
    materials: [{
      name: 'pmas-scan-material',
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.9 },
      doubleSided: true,
    }],
    meshes: [{ name, primitives: [{ attributes, indices: 0, material: 0, mode: 4 }] }],
    nodes: [{ mesh: 0, name }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
}

function assembleGlb(json, bin) {
  const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPadded = align4(jsonBuffer.length);
  const binPadded = align4(bin.length);
  const totalLength = HEADER_BYTES + CHUNK_HEADER_BYTES + jsonPadded + CHUNK_HEADER_BYTES + binPadded;
  const glb = Buffer.alloc(totalLength);
  glb.writeUInt32LE(GLB_MAGIC, 0);
  glb.writeUInt32LE(GLB_VERSION, 4);
  glb.writeUInt32LE(totalLength, 8);
  glb.writeUInt32LE(jsonPadded, 12);
  glb.writeUInt32LE(CHUNK_TYPE_JSON, 16);
  jsonBuffer.copy(glb, HEADER_BYTES + CHUNK_HEADER_BYTES);
  glb.fill(0x20, HEADER_BYTES + CHUNK_HEADER_BYTES + jsonBuffer.length, HEADER_BYTES + CHUNK_HEADER_BYTES + jsonPadded);
  const binChunkStart = HEADER_BYTES + CHUNK_HEADER_BYTES + jsonPadded;
  glb.writeUInt32LE(binPadded, binChunkStart);
  glb.writeUInt32LE(CHUNK_TYPE_BIN, binChunkStart + 4);
  bin.copy(glb, binChunkStart + CHUNK_HEADER_BYTES);
  return glb;
}

/**
 * Build a binary glTF 2.0 (GLB) Buffer from an indexed triangle mesh.
 *
 * @param {object} options
 * @param {Float32Array} options.positions XYZ per vertex (length 3*vertexCount).
 * @param {Float32Array} options.normals XYZ per vertex (length 3*vertexCount).
 * @param {Uint8Array|null} [options.colors] RGBA per vertex (length 4*vertexCount), or null.
 * @param {Uint32Array} options.indices Triangle indices (length divisible by 3).
 * @param {string} [options.name] Mesh/node name.
 * @param {string} [options.generator] asset.generator string.
 * @returns {Buffer} Complete GLB file contents.
 */
function buildGlb(options) {
  if (options === null || typeof options !== 'object') throw new Error('buildGlb: an options object is required');
  const { positions, normals, colors = null, indices, name = DEFAULT_NAME, generator = DEFAULT_GENERATOR } = options;
  if (typeof name !== 'string' || name.length === 0) throw new Error('buildGlb: name must be a non-empty string');
  if (typeof generator !== 'string' || generator.length === 0) throw new Error('buildGlb: generator must be a non-empty string');
  const vertexCount = validateBuildInputs(positions, normals, colors, indices);
  const hasColors = colors !== null;
  const sections = [
    { byteLength: indices.length * 4, target: TARGET_ELEMENT_ARRAY_BUFFER },
    { byteLength: positions.length * 4, target: TARGET_ARRAY_BUFFER },
    { byteLength: normals.length * 4, target: TARGET_ARRAY_BUFFER },
  ];
  if (hasColors) sections.push({ byteLength: colors.length, target: TARGET_ARRAY_BUFFER });
  let cursor = 0;
  const bufferViews = sections.map((section) => {
    const byteOffset = align4(cursor);
    cursor = byteOffset + section.byteLength;
    return { buffer: 0, byteOffset, byteLength: section.byteLength, target: section.target };
  });
  const binByteLength = cursor;
  const bin = Buffer.alloc(align4(binByteLength));
  writeUint32sLE(bin, bufferViews[0].byteOffset, indices);
  writeFloatsLE(bin, bufferViews[1].byteOffset, positions);
  writeFloatsLE(bin, bufferViews[2].byteOffset, normals);
  if (hasColors) bin.set(colors, bufferViews[3].byteOffset);
  const json = buildGltfJson({
    vertexCount,
    indexCount: indices.length,
    bounds: computePositionBounds(positions),
    bufferViews,
    binByteLength,
    hasColors,
    name,
    generator,
  });
  return assembleGlb(json, bin);
}

/**
 * Parse a GLB buffer into its JSON document and binary chunk.
 *
 * @param {Buffer} buffer Complete GLB file contents.
 * @returns {{ json: object, bin: Buffer }} Parsed glTF JSON and a copy of the BIN chunk.
 * @throws {Error} On bad magic, unsupported version, truncation or malformed chunks.
 */
function parseGlb(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error('parseGlb: expected a Buffer');
  if (buffer.length < HEADER_BYTES) {
    throw new Error(`parseGlb: buffer too small for GLB header (${buffer.length} bytes, need ${HEADER_BYTES})`);
  }
  const magic = buffer.readUInt32LE(0);
  if (magic !== GLB_MAGIC) throw new Error(`parseGlb: bad magic 0x${magic.toString(16)} (expected 0x46546c67 "glTF")`);
  const version = buffer.readUInt32LE(4);
  if (version !== GLB_VERSION) throw new Error(`parseGlb: unsupported GLB version ${version} (expected 2)`);
  const totalLength = buffer.readUInt32LE(8);
  if (totalLength !== buffer.length) {
    throw new Error(`parseGlb: declared total length ${totalLength} does not match buffer length ${buffer.length}`);
  }
  let offset = HEADER_BYTES;
  let json = null;
  let bin = null;
  let chunkIndex = 0;
  while (offset < totalLength) {
    if (offset + CHUNK_HEADER_BYTES > totalLength) throw new Error(`parseGlb: truncated chunk header at byte ${offset}`);
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + CHUNK_HEADER_BYTES;
    if (chunkLength % 4 !== 0) throw new Error(`parseGlb: chunk ${chunkIndex} length ${chunkLength} is not 4-byte aligned`);
    if (dataStart + chunkLength > totalLength) {
      throw new Error(`parseGlb: chunk ${chunkIndex} overruns buffer (ends at ${dataStart + chunkLength}, total ${totalLength})`);
    }
    if (chunkType === CHUNK_TYPE_JSON) {
      if (chunkIndex !== 0) throw new Error('parseGlb: JSON chunk must be the first chunk');
      const text = buffer.toString('utf8', dataStart, dataStart + chunkLength);
      try {
        json = JSON.parse(text);
      } catch (err) {
        throw new Error(`parseGlb: JSON chunk is not valid JSON: ${err.message}`);
      }
    } else if (chunkType === CHUNK_TYPE_BIN) {
      if (bin !== null) throw new Error('parseGlb: multiple BIN chunks found');
      bin = Buffer.from(buffer.subarray(dataStart, dataStart + chunkLength));
    }
    offset = dataStart + chunkLength;
    chunkIndex += 1;
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('parseGlb: missing or non-object JSON chunk');
  }
  return { json, bin: bin === null ? Buffer.alloc(0) : bin };
}

function accessorElementSize(accessor) {
  const componentSize = COMPONENT_BYTE_SIZE[accessor.componentType];
  const componentCount = TYPE_COMPONENT_COUNT[accessor.type];
  return componentSize && componentCount ? componentSize * componentCount : 0;
}

function checkBufferAndViews(json, bin, errors) {
  if (!Array.isArray(json.buffers) || json.buffers.length !== 1 || !json.buffers[0] || typeof json.buffers[0].byteLength !== 'number') {
    errors.push('expected exactly one buffer with a numeric byteLength');
    return;
  }
  const declared = json.buffers[0].byteLength;
  if (declared > bin.length) errors.push(`buffer byteLength ${declared} exceeds BIN chunk length ${bin.length}`);
  if (!Array.isArray(json.bufferViews) || json.bufferViews.length === 0) {
    errors.push('bufferViews missing or empty');
    return;
  }
  const bound = Math.min(declared, bin.length);
  json.bufferViews.forEach((view, i) => {
    const byteOffset = (view && view.byteOffset) || 0;
    if (!view || typeof view.byteLength !== 'number' || view.byteLength < 0) {
      errors.push(`bufferView ${i} has an invalid byteLength`);
      return;
    }
    if (byteOffset % 4 !== 0) errors.push(`bufferView ${i} byteOffset ${byteOffset} is not 4-byte aligned`);
    if (byteOffset + view.byteLength > bound) {
      errors.push(`bufferView ${i} range [${byteOffset}, ${byteOffset + view.byteLength}) exceeds BIN bounds (${bound})`);
    }
  });
}

function checkAccessors(json, errors) {
  if (!Array.isArray(json.accessors) || json.accessors.length === 0) {
    errors.push('accessors missing or empty');
    return;
  }
  const views = Array.isArray(json.bufferViews) ? json.bufferViews : [];
  json.accessors.forEach((accessor, i) => {
    const view = accessor ? views[accessor.bufferView] : undefined;
    if (!view) {
      errors.push(`accessor ${i} references missing bufferView ${accessor && accessor.bufferView}`);
      return;
    }
    const elementSize = accessorElementSize(accessor);
    if (elementSize === 0) {
      errors.push(`accessor ${i} has unknown componentType/type (${accessor.componentType}/${accessor.type})`);
      return;
    }
    if (typeof accessor.count !== 'number' || accessor.count <= 0 || !Number.isInteger(accessor.count)) {
      errors.push(`accessor ${i} has invalid count ${accessor.count}`);
      return;
    }
    const needed = (accessor.byteOffset || 0) + accessor.count * elementSize;
    if (needed > view.byteLength) {
      errors.push(`accessor ${i} needs ${needed} bytes but bufferView ${accessor.bufferView} has only ${view.byteLength}`);
    }
  });
}

function accessorDataStart(json, accessor) {
  const view = json.bufferViews[accessor.bufferView];
  return ((view && view.byteOffset) || 0) + (accessor.byteOffset || 0);
}

function checkPositionBounds(json, bin, accessor, errors) {
  const start = accessorDataStart(json, accessor);
  if (start + accessor.count * 12 > bin.length) return; // out-of-bounds already reported
  const actual = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let v = 0; v < accessor.count; v += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = bin.readFloatLE(start + 12 * v + 4 * axis);
      if (value < actual.min[axis]) actual.min[axis] = value;
      if (value > actual.max[axis]) actual.max[axis] = value;
    }
  }
  for (const key of ['min', 'max']) {
    const declared = accessor[key];
    if (!Array.isArray(declared) || declared.length !== 3) {
      errors.push(`POSITION accessor ${key} must be a 3-element array`);
      continue;
    }
    for (let axis = 0; axis < 3; axis += 1) {
      if (!(Math.abs(declared[axis] - actual[key][axis]) <= MIN_MAX_TOLERANCE)) {
        errors.push(`POSITION ${key}[${axis}] declared ${declared[axis]} but recomputed ${actual[key][axis]}`);
      }
    }
  }
}

function checkIndices(json, bin, accessor, vertexCount, errors) {
  if (accessor.count % 3 !== 0) errors.push(`index count ${accessor.count} is not divisible by 3`);
  const readers = {
    [COMP_UNSIGNED_BYTE]: (o) => bin.readUInt8(o),
    [COMP_UNSIGNED_SHORT]: (o) => bin.readUInt16LE(o),
    [COMP_UNSIGNED_INT]: (o) => bin.readUInt32LE(o),
  };
  const read = readers[accessor.componentType];
  if (!read) {
    errors.push(`unsupported index componentType ${accessor.componentType}`);
    return;
  }
  const size = COMPONENT_BYTE_SIZE[accessor.componentType];
  const start = accessorDataStart(json, accessor);
  if (start + accessor.count * size > bin.length) return; // out-of-bounds already reported
  for (let i = 0; i < accessor.count; i += 1) {
    const value = read(start + i * size);
    if (value >= vertexCount) {
      errors.push(`index ${value} at position ${i} is out of range (vertexCount=${vertexCount})`);
      return;
    }
  }
}

/**
 * Validate a GLB buffer structurally and against its own declared mesh data.
 *
 * @param {Buffer} buffer Complete GLB file contents.
 * @returns {{ ok: boolean, errors: string[], stats: { vertexCount: number, triangleCount: number, byteLength: number, hasColors: boolean, hasNormals: boolean } }}
 */
function validateGlbBuffer(buffer) {
  const errors = [];
  const stats = { vertexCount: 0, triangleCount: 0, byteLength: 0, hasColors: false, hasNormals: false };
  let parsed;
  try {
    parsed = parseGlb(buffer);
  } catch (err) {
    return { ok: false, errors: [err.message], stats };
  }
  const { json, bin } = parsed;
  stats.byteLength = buffer.length;
  checkBufferAndViews(json, bin, errors);
  checkAccessors(json, errors);
  const mesh = Array.isArray(json.meshes) ? json.meshes[0] : undefined;
  const primitive = mesh && Array.isArray(mesh.primitives) ? mesh.primitives[0] : undefined;
  if (!primitive || !primitive.attributes) {
    errors.push('no mesh primitive with attributes found');
    return { ok: false, errors, stats };
  }
  const accessors = Array.isArray(json.accessors) ? json.accessors : [];
  const positionAccessor = accessors[primitive.attributes.POSITION];
  const indexAccessor = accessors[primitive.indices];
  stats.hasNormals = accessors[primitive.attributes.NORMAL] !== undefined;
  stats.hasColors = accessors[primitive.attributes.COLOR_0] !== undefined;
  if (!positionAccessor || positionAccessor.type !== 'VEC3' || positionAccessor.componentType !== COMP_FLOAT) {
    errors.push('POSITION accessor missing or not a float VEC3');
  } else {
    stats.vertexCount = positionAccessor.count;
    checkPositionBounds(json, bin, positionAccessor, errors);
  }
  if (!indexAccessor || indexAccessor.type !== 'SCALAR') {
    errors.push('index accessor missing or not SCALAR');
  } else {
    stats.triangleCount = Math.floor(indexAccessor.count / 3);
    checkIndices(json, bin, indexAccessor, stats.vertexCount, errors);
  }
  return { ok: errors.length === 0, errors, stats };
}

module.exports = { buildGlb, parseGlb, validateGlbBuffer };
