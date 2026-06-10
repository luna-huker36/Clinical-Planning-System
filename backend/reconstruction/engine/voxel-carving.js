/**
 * Voxel carving (visual hull) for the PMAS native engine.
 *
 * A cubic voxel grid spanning [-extent, +extent]^3 is tested against every
 * view's silhouette: a voxel survives only if its projection lands inside the
 * silhouette in (almost) all views. The tolerance for missed views absorbs
 * segmentation noise on individual frames.
 */

const DEFAULT_MIN_INSIDE_FRACTION = 0.92;

/**
 * Carve a voxel grid against the rig's silhouettes.
 *
 * @param {{views: Array<object>, extent: number}} rig from buildTurntableRig
 * @param {{dims?: number, minInsideFraction?: number, onProgress?: function}} [options]
 * @returns {Promise<{occupancy: Uint8Array, dims: number, gridMin: number,
 *   voxelSize: number, insideCount: number}>}
 */
async function carveVoxels(rig, options = {}) {
  const views = rig.views;
  if (!views || !views.length) throw new Error("Voxel carving requires at least one view.");

  const dims = Math.max(16, Math.min(256, Math.round(options.dims || 128)));
  const minInsideFraction = Number.isFinite(options.minInsideFraction)
    ? Math.min(1, Math.max(0.5, options.minInsideFraction))
    : DEFAULT_MIN_INSIDE_FRACTION;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;

  const extent = rig.extent;
  const gridMin = -extent;
  const voxelSize = (2 * extent) / (dims - 1);
  const occupancy = new Uint8Array(dims * dims * dims);
  const viewCount = views.length;
  const allowedMisses = Math.max(0, Math.floor(viewCount * (1 - minInsideFraction)));

  // Per-view constants hoisted out of the voxel loops.
  const cosScale = new Float64Array(viewCount);
  const sinScale = new Float64Array(viewCount);
  const widths = new Int32Array(viewCount);
  const heights = new Int32Array(viewCount);
  const masks = new Array(viewCount);
  for (let k = 0; k < viewCount; k += 1) {
    cosScale[k] = views[k].cos * views[k].scalePx;
    sinScale[k] = views[k].sin * views[k].scalePx;
    widths[k] = views[k].width;
    heights[k] = views[k].height;
    masks[k] = views[k].mask;
  }

  const pxBase = new Float64Array(viewCount); // centerX - z*sin*scale, fixed per z-slab
  const rowMaskOffset = new Int32Array(viewCount); // py*width per y-row, -1 when py out of bounds
  let insideCount = 0;

  // The outermost voxel shell is kept empty so surface extraction can always
  // close the mesh: cells beyond the grid cannot emit faces, and a hull
  // clipped by the grid boundary would otherwise be silently non-watertight.
  const lastIndex = dims - 1;

  for (let iz = 1; iz < lastIndex; iz += 1) {
    const z = gridMin + iz * voxelSize;
    for (let k = 0; k < viewCount; k += 1) {
      pxBase[k] = views[k].centerX - z * sinScale[k];
    }
    const slabOffset = iz * dims * dims;

    for (let iy = 1; iy < lastIndex; iy += 1) {
      const y = gridMin + iy * voxelSize;
      for (let k = 0; k < viewCount; k += 1) {
        const py = Math.round(views[k].centerY - y * views[k].scalePx);
        rowMaskOffset[k] = (py >= 0 && py < heights[k]) ? py * widths[k] : -1;
      }
      const rowOffset = slabOffset + iy * dims;

      for (let ix = 1; ix < lastIndex; ix += 1) {
        const x = gridMin + ix * voxelSize;
        let misses = 0;
        for (let k = 0; k < viewCount; k += 1) {
          const px = Math.round(pxBase[k] + x * cosScale[k]);
          if (px < 0 || px >= widths[k] || rowMaskOffset[k] < 0 ||
              masks[k][rowMaskOffset[k] + px] === 0) {
            misses += 1;
            if (misses > allowedMisses) break;
          }
        }
        if (misses <= allowedMisses) {
          occupancy[rowOffset + ix] = 1;
          insideCount += 1;
        }
      }
    }

    if ((iz & 7) === 7) {
      if (onProgress) onProgress((iz + 1) / dims);
      // Keep the HTTP server responsive while crunching.
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  if (onProgress) onProgress(1);
  return { occupancy, dims, gridMin, voxelSize, insideCount };
}

module.exports = {
  carveVoxels
};
