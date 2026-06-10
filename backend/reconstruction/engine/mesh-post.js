/**
 * Mesh post-processing for the PMAS native engine: Taubin smoothing, vertex
 * normals, orientation fixing, centering/scaling and quality metrics.
 *
 * All functions return new typed arrays; inputs are never mutated.
 */

const TAUBIN_LAMBDA = 0.5;
const TAUBIN_MU = -0.53;

function assertMesh(positions, indices) {
  if (!(positions instanceof Float32Array) || positions.length % 3 !== 0) {
    throw new Error("Mesh positions must be a Float32Array of xyz triples.");
  }
  if (!(indices instanceof Uint32Array) || indices.length % 3 !== 0) {
    throw new Error("Mesh indices must be a Uint32Array of triangles.");
  }
}

/**
 * Build vertex adjacency in CSR form from triangle edges.
 * @returns {{offsets: Uint32Array, neighbors: Uint32Array}}
 */
function buildAdjacency(vertexCount, indices) {
  if (vertexCount >= 0x400000) {
    throw new Error(`Mesh has ${vertexCount} vertices — exceeds the 2^22 limit of the edge-key packing.`);
  }
  const edgeKeys = new Set();
  const addEdge = (a, b) => {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    edgeKeys.add(lo * 0x400000 + hi); // vertexCount < 2^22 by construction
  };
  for (let t = 0; t < indices.length; t += 3) {
    addEdge(indices[t], indices[t + 1]);
    addEdge(indices[t + 1], indices[t + 2]);
    addEdge(indices[t + 2], indices[t]);
  }

  const degrees = new Uint32Array(vertexCount);
  for (const key of edgeKeys) {
    degrees[Math.floor(key / 0x400000)] += 1;
    degrees[key % 0x400000] += 1;
  }
  const offsets = new Uint32Array(vertexCount + 1);
  for (let v = 0; v < vertexCount; v += 1) offsets[v + 1] = offsets[v] + degrees[v];
  const cursor = Uint32Array.from(offsets.subarray(0, vertexCount));
  const neighbors = new Uint32Array(offsets[vertexCount]);
  for (const key of edgeKeys) {
    const a = Math.floor(key / 0x400000);
    const b = key % 0x400000;
    neighbors[cursor[a]] = b;
    cursor[a] += 1;
    neighbors[cursor[b]] = a;
    cursor[b] += 1;
  }
  return { offsets, neighbors };
}

function smoothingPass(src, dst, offsets, neighbors, factor) {
  const vertexCount = src.length / 3;
  for (let v = 0; v < vertexCount; v += 1) {
    const start = offsets[v];
    const end = offsets[v + 1];
    const base = v * 3;
    if (start === end) {
      dst[base] = src[base];
      dst[base + 1] = src[base + 1];
      dst[base + 2] = src[base + 2];
      continue;
    }
    let ax = 0;
    let ay = 0;
    let az = 0;
    for (let n = start; n < end; n += 1) {
      const nb = neighbors[n] * 3;
      ax += src[nb];
      ay += src[nb + 1];
      az += src[nb + 2];
    }
    const inv = 1 / (end - start);
    dst[base] = src[base] + factor * (ax * inv - src[base]);
    dst[base + 1] = src[base + 1] + factor * (ay * inv - src[base + 1]);
    dst[base + 2] = src[base + 2] + factor * (az * inv - src[base + 2]);
  }
}

/**
 * Taubin lambda/mu smoothing — smooths voxel staircase without shrinking.
 */
function taubinSmooth(positions, indices, iterations = 10) {
  assertMesh(positions, indices);
  const vertexCount = positions.length / 3;
  const { offsets, neighbors } = buildAdjacency(vertexCount, indices);
  let current = Float32Array.from(positions);
  let buffer = new Float32Array(positions.length);
  for (let i = 0; i < iterations; i += 1) {
    smoothingPass(current, buffer, offsets, neighbors, TAUBIN_LAMBDA);
    smoothingPass(buffer, current, offsets, neighbors, TAUBIN_MU);
  }
  return current;
}

/** Area-weighted vertex normals. */
function computeVertexNormals(positions, indices) {
  assertMesh(positions, indices);
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    const abx = positions[b] - positions[a];
    const aby = positions[b + 1] - positions[a + 1];
    const abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a];
    const acy = positions[c + 1] - positions[a + 1];
    const acz = positions[c + 2] - positions[a + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const base of [a, b, c]) {
      normals[base] += nx;
      normals[base + 1] += ny;
      normals[base + 2] += nz;
    }
  }
  for (let v = 0; v < normals.length; v += 3) {
    const len = Math.hypot(normals[v], normals[v + 1], normals[v + 2]);
    if (len > 1e-12) {
      normals[v] /= len;
      normals[v + 1] /= len;
      normals[v + 2] /= len;
    } else {
      normals[v + 1] = 1;
    }
  }
  return normals;
}

/** Signed volume via the divergence theorem; positive = outward orientation. */
function computeSignedVolume(positions, indices) {
  let volume = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    volume +=
      positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]) +
      positions[a + 1] * (positions[b + 2] * positions[c] - positions[b] * positions[c + 2]) +
      positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
  }
  return volume / 6;
}

/** Flip winding if the mesh is oriented inward. Returns new indices. */
function ensureOutwardOrientation(positions, indices) {
  const volume = computeSignedVolume(positions, indices);
  if (volume >= 0) return { indices: Uint32Array.from(indices), flipped: false, volume };
  const flipped = new Uint32Array(indices.length);
  for (let t = 0; t < indices.length; t += 3) {
    flipped[t] = indices[t];
    flipped[t + 1] = indices[t + 2];
    flipped[t + 2] = indices[t + 1];
  }
  return { indices: flipped, flipped: true, volume: -volume };
}

function computeBounds(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < positions.length; v += 3) {
    for (let d = 0; d < 3; d += 1) {
      const value = positions[v + d];
      if (value < min[d]) min[d] = value;
      if (value > max[d]) max[d] = value;
    }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

/**
 * Center the mesh at the origin and scale it so its Y extent equals
 * targetHeight (viewer-friendly units). Returns new positions.
 */
function centerAndScale(positions, targetHeight = 0.25) {
  const bounds = computeBounds(positions);
  const height = Math.max(1e-9, bounds.size[1]);
  const scale = targetHeight / height;
  const cx = (bounds.min[0] + bounds.max[0]) / 2;
  const cy = (bounds.min[1] + bounds.max[1]) / 2;
  const cz = (bounds.min[2] + bounds.max[2]) / 2;
  const out = new Float32Array(positions.length);
  for (let v = 0; v < positions.length; v += 3) {
    out[v] = (positions[v] - cx) * scale;
    out[v + 1] = (positions[v + 1] - cy) * scale;
    out[v + 2] = (positions[v + 2] - cz) * scale;
  }
  return { positions: out, scale, bounds: computeBounds(out) };
}

/** Every directed edge must be matched by its reverse for a closed mesh. */
function isWatertight(indices) {
  let maxIndex = 0;
  for (let i = 0; i < indices.length; i += 1) {
    if (indices[i] > maxIndex) maxIndex = indices[i];
  }
  if (maxIndex >= 0x400000) {
    throw new Error(`Mesh index ${maxIndex} exceeds the 2^22 limit of the edge-key packing.`);
  }
  const directed = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [indices[t], indices[t + 1], indices[t + 2]];
    for (let e = 0; e < 3; e += 1) {
      const key = tri[e] * 0x400000 + tri[(e + 1) % 3];
      directed.set(key, (directed.get(key) || 0) + 1);
    }
  }
  for (const [key, count] of directed) {
    const reverse = (key % 0x400000) * 0x400000 + Math.floor(key / 0x400000);
    if (count !== 1 || directed.get(reverse) !== 1) return false;
  }
  return true;
}

module.exports = {
  buildAdjacency,
  taubinSmooth,
  computeVertexNormals,
  computeSignedVolume,
  ensureOutwardOrientation,
  centerAndScale,
  computeBounds,
  isWatertight
};
