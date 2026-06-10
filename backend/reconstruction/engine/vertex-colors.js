/**
 * Vertex coloring: project each vertex into the frame that faces it best and
 * sample the photo color there. Positions must be in rig world units (the
 * same space used for carving), i.e. before centerAndScale.
 */

const { sampleBilinear } = require("./image-utils");
const { projectToView } = require("./camera-rig");

const MIN_FACING_DOT = 0.05;
const FALLBACK_COLOR = [200, 172, 150];

/**
 * @param {Float32Array} positions vertices in rig world units
 * @param {Float32Array} normals unit vertex normals
 * @param {{views: Array<object>}} rig from buildTurntableRig
 * @param {Array<{width: number, height: number, data: Uint8Array}>} images
 *   working-resolution photos, one per rig view (same order)
 * @returns {Uint8Array} RGBA per vertex
 */
function assignVertexColors(positions, normals, rig, images) {
  const vertexCount = positions.length / 3;
  if (normals.length !== positions.length) {
    throw new Error("Vertex colors require one normal per vertex.");
  }
  if (!images || images.length !== rig.views.length) {
    throw new Error("Vertex colors require one image per rig view.");
  }

  const colors = new Uint8Array(vertexCount * 4);
  for (let v = 0; v < vertexCount; v += 1) {
    const px = positions[v * 3];
    const py = positions[v * 3 + 1];
    const pz = positions[v * 3 + 2];
    const nx = normals[v * 3];
    const ny = normals[v * 3 + 1];
    const nz = normals[v * 3 + 2];

    let bestMasked = -1;
    let bestMaskedDot = MIN_FACING_DOT;
    let bestAny = -1;
    let bestAnyDot = -Infinity;

    for (let k = 0; k < rig.views.length; k += 1) {
      const view = rig.views[k];
      const dot = nx * view.toCamera.x + ny * view.toCamera.y + nz * view.toCamera.z;
      if (dot > bestAnyDot) {
        bestAnyDot = dot;
        bestAny = k;
      }
      if (dot <= bestMaskedDot) continue;
      const projected = projectToView(view, px, py, pz);
      const ix = Math.round(projected.px);
      const iy = Math.round(projected.py);
      if (ix < 0 || iy < 0 || ix >= view.width || iy >= view.height) continue;
      if (view.mask[iy * view.width + ix] === 0) continue;
      bestMaskedDot = dot;
      bestMasked = k;
    }

    let rgb = FALLBACK_COLOR;
    const chosen = bestMasked >= 0 ? bestMasked : bestAny;
    if (chosen >= 0) {
      const view = rig.views[chosen];
      const projected = projectToView(view, px, py, pz);
      const ix = Math.round(projected.px);
      const iy = Math.round(projected.py);
      // Sample only inside the silhouette — otherwise grazing views (e.g. the
      // top of a head) would blend in background pixels.
      if (ix >= 0 && iy >= 0 && ix < view.width && iy < view.height &&
          view.mask[iy * view.width + ix] !== 0) {
        rgb = sampleBilinear(images[chosen], projected.px, projected.py);
      }
    }
    colors[v * 4] = rgb[0];
    colors[v * 4 + 1] = rgb[1];
    colors[v * 4 + 2] = rgb[2];
    colors[v * 4 + 3] = 255;
  }
  return colors;
}

module.exports = {
  assignVertexColors
};
