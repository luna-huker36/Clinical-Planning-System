/**
 * Turntable camera rig for the PMAS native visual-hull engine.
 *
 * Convention (must match synthetic-dataset.js and voxel-carving.js):
 * - World is Y-up, object centered at the origin, object half-height = 1 world unit.
 * - View k looks at the origin from azimuth theta_k; orthographic projection.
 * - right_k = (cos theta, 0, -sin theta), up = (0, 1, 0).
 * - Projection of world point p: u = p.x*cos(theta) - p.z*sin(theta), v = p.y;
 *   pixel = (centerX + u*scalePx, centerY - v*scalePx).
 * - scalePx (pixels per world unit) is derived from the silhouette half-height,
 *   clamped against the median across views to suppress bbox outliers.
 */

const SCALE_CLAMP_LOW = 0.8;
const SCALE_CLAMP_HIGH = 1.25;
// Must exceed the worst-case hull bulge between view axes: for N>=3 views the
// hull can reach 1/max_k|sin(theta_k)| = 1.1547 of the silhouette half-width
// along z (worst at N=3 and N=6), so 1.16 keeps the hull inside the grid.
const EXTENT_MARGIN = 1.16;

function median(values) {
  if (!values.length) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Build a turntable rig from per-frame silhouettes.
 *
 * @param {Array<{mask: Uint8Array, width: number, height: number, bbox: object,
 *   center: {x: number, y: number}, halfHeight: number}>} silhouettes
 * @param {{coverageRadians?: number, startAngle?: number}} [options]
 * @returns {{views: Array<object>, extent: number, viewCount: number}}
 */
function buildTurntableRig(silhouettes, options = {}) {
  const frames = Array.from(silhouettes || []);
  if (!frames.length) throw new Error("Turntable rig requires at least one silhouette.");

  const coverage = Number.isFinite(options.coverageRadians) && options.coverageRadians > 0
    ? options.coverageRadians
    : Math.PI * 2;
  const startAngle = Number(options.startAngle) || 0;
  const direction = options.direction === "cw" ? -1 : 1;
  const fullCircle = Math.abs(coverage - Math.PI * 2) < 1e-6;
  // When some captured frames were rejected, azimuths must still follow the
  // ORIGINAL capture positions (frame.sourceIndex over totalFrames) — spacing
  // the survivors evenly would assign systematically wrong angles. With
  // rotation-period folding totalFrames may be SMALLER than the frame count
  // (several frames share an azimuth), so only sanity-check the value.
  const totalFrames = Number.isInteger(options.totalFrames) && options.totalFrames >= 2
    ? options.totalFrames
    : frames.length;

  const medianHalfHeight = Math.max(1, median(frames.map(frame => frame.halfHeight)));
  let maxHalfWidthWorld = 1;

  const views = frames.map((frame, index) => {
    // Even spacing: a full circle wraps (no duplicated end view), an arc includes both ends.
    const denom = fullCircle ? totalFrames : Math.max(1, totalFrames - 1);
    const sourceIndex = Number.isInteger(frame.sourceIndex) ? frame.sourceIndex : index;
    const azimuth = startAngle + direction * (coverage * sourceIndex) / denom;
    const rawScale = Math.max(1, frame.halfHeight);
    const scalePx = Math.min(
      medianHalfHeight * SCALE_CLAMP_HIGH,
      Math.max(medianHalfHeight * SCALE_CLAMP_LOW, rawScale)
    );
    const halfWidthPx = Math.max(1, (frame.bbox.maxX - frame.bbox.minX) / 2);
    maxHalfWidthWorld = Math.max(maxHalfWidthWorld, halfWidthPx / scalePx);

    // Вертикальный якорь — ВЕРХ силуэта (макушка), а не центр bbox: нижняя
    // граница силуэта нестабильна (одежда в цвет фона, тень у основания),
    // и выравнивание по центру кладёт объект в каждом ракурсе на свою
    // высоту — пересечение даёт «этажерку». Верх объекта сегментируется
    // стабильно. Для съёмок со стабильным низом формула эквивалентна центру.
    const centerYAnchored = frame.bbox.minY + scalePx;

    return {
      index,
      azimuth,
      cos: Math.cos(azimuth),
      sin: Math.sin(azimuth),
      centerX: frame.center.x,
      centerY: centerYAnchored,
      scalePx,
      width: frame.width,
      height: frame.height,
      mask: frame.mask,
      // Direction from the object toward this camera (used for vertex coloring).
      toCamera: { x: Math.sin(azimuth), y: 0, z: Math.cos(azimuth) }
    };
  });

  return {
    views,
    viewCount: views.length,
    extent: EXTENT_MARGIN * Math.max(1, maxHalfWidthWorld)
  };
}

/**
 * Project a world point into a view's pixel coordinates.
 * Exposed for tests and vertex coloring; carving inlines the same math.
 */
function projectToView(view, x, y, z) {
  const u = x * view.cos - z * view.sin;
  return {
    px: view.centerX + u * view.scalePx,
    py: view.centerY - y * view.scalePx
  };
}

module.exports = {
  buildTurntableRig,
  projectToView
};
