/**
 * Naive Surface Nets over a binary voxel grid.
 *
 * Each 2x2x2 cell of voxels with mixed inside/outside corners produces one
 * vertex placed at the average of its sign-changing edge midpoints. Every
 * voxel edge with a sign change connects the four cells around it into a quad
 * (two triangles). Orientation: quads are emitted counter-clockwise as seen
 * from the outside, matching the glTF front-face convention.
 */

// Corner c occupies offset (c&1, (c>>1)&1, (c>>2)&1) within the cell.
const EDGE_PAIRS = [
  [0, 1], [2, 3], [4, 5], [6, 7], // x-aligned
  [0, 2], [1, 3], [4, 6], [5, 7], // y-aligned
  [0, 4], [1, 5], [2, 6], [3, 7]  // z-aligned
];
// Corner adjacent to corner 0 along each axis.
const AXIS_CORNER = [1, 2, 4];

/**
 * Extract a triangle mesh from carved voxels.
 *
 * @param {{occupancy: Uint8Array, dims: number, gridMin: number, voxelSize: number}} grid
 * @returns {{positions: Float32Array, indices: Uint32Array,
 *   vertexCount: number, triangleCount: number}}
 */
function extractSurface(grid) {
  const { occupancy, dims, gridMin, voxelSize } = grid;
  if (!occupancy || occupancy.length !== dims * dims * dims) {
    throw new Error("Surface extraction received an inconsistent voxel grid.");
  }

  const cellDims = dims - 1;
  const cellVertex = new Int32Array(cellDims * cellDims * cellDims).fill(-1);
  const positions = [];
  const indices = [];
  const corner = new Uint8Array(8);

  const voxelAt = (x, y, z) => occupancy[(z * dims + y) * dims + x];
  const cellAt = (x, y, z) => (z * cellDims + y) * cellDims + x;

  for (let cz = 0; cz < cellDims; cz += 1) {
    for (let cy = 0; cy < cellDims; cy += 1) {
      for (let cx = 0; cx < cellDims; cx += 1) {
        let cornerMask = 0;
        for (let c = 0; c < 8; c += 1) {
          corner[c] = voxelAt(cx + (c & 1), cy + ((c >> 1) & 1), cz + ((c >> 2) & 1));
          if (corner[c]) cornerMask |= 1 << c;
        }
        if (cornerMask === 0 || cornerMask === 0xff) continue;

        // Vertex: average of midpoints of all sign-changing cell edges.
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let crossings = 0;
        for (let e = 0; e < 12; e += 1) {
          const a = EDGE_PAIRS[e][0];
          const b = EDGE_PAIRS[e][1];
          if (corner[a] === corner[b]) continue;
          sx += ((a & 1) + (b & 1)) / 2;
          sy += (((a >> 1) & 1) + ((b >> 1) & 1)) / 2;
          sz += (((a >> 2) & 1) + ((b >> 2) & 1)) / 2;
          crossings += 1;
        }
        const vertexIndex = positions.length / 3;
        cellVertex[cellAt(cx, cy, cz)] = vertexIndex;
        positions.push(
          gridMin + (cx + sx / crossings) * voxelSize,
          gridMin + (cy + sy / crossings) * voxelSize,
          gridMin + (cz + sz / crossings) * voxelSize
        );

        // Quads: one per sign-changing voxel edge leaving corner 0 along each
        // axis. The four cells sharing that edge were all visited earlier in
        // this scan order (offsets are non-positive), so their vertices exist.
        for (let d = 0; d < 3; d += 1) {
          if (corner[0] === corner[AXIS_CORNER[d]]) continue;
          const u = (d + 1) % 3;
          const w = (d + 2) % 3;
          const cell = [cx, cy, cz];
          if (cell[u] === 0 || cell[w] === 0) continue;

          const stepU = [0, 0, 0];
          const stepW = [0, 0, 0];
          stepU[u] = 1;
          stepW[w] = 1;
          const q0 = cellVertex[cellAt(cx, cy, cz)];
          const q1 = cellVertex[cellAt(cx - stepU[0], cy - stepU[1], cz - stepU[2])];
          const q2 = cellVertex[cellAt(cx - stepU[0] - stepW[0], cy - stepU[1] - stepW[1], cz - stepU[2] - stepW[2])];
          const q3 = cellVertex[cellAt(cx - stepW[0], cy - stepW[1], cz - stepW[2])];
          if (q0 < 0 || q1 < 0 || q2 < 0 || q3 < 0) continue;

          if (corner[0]) {
            // Inside voxel below the edge: outward normal along +d (CCW from +d).
            indices.push(q0, q1, q2, q0, q2, q3);
          } else {
            indices.push(q0, q2, q1, q0, q3, q2);
          }
        }
      }
    }
  }

  return {
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3
  };
}

module.exports = {
  extractSurface
};
