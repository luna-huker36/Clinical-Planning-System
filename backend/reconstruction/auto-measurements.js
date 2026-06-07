function pointFromLandmark(landmark) {
  return landmark?.position3D || landmark || {};
}

function calculateDistanceBetweenLandmarks(landmarkA, landmarkB) {
  const a = pointFromLandmark(landmarkA);
  const b = pointFromLandmark(landmarkB);
  return Math.sqrt(
    Math.pow(Number(a.x || 0) - Number(b.x || 0), 2)
    + Math.pow(Number(a.y || 0) - Number(b.y || 0), 2)
    + Math.pow(Number(a.z || 0) - Number(b.z || 0), 2)
  );
}

function calculateAngleBetweenLandmarks(landmarkA, landmarkB, landmarkC) {
  const a = pointFromLandmark(landmarkA);
  const b = pointFromLandmark(landmarkB);
  const c = pointFromLandmark(landmarkC);
  const ba = [Number(a.x || 0) - Number(b.x || 0), Number(a.y || 0) - Number(b.y || 0), Number(a.z || 0) - Number(b.z || 0)];
  const bc = [Number(c.x || 0) - Number(b.x || 0), Number(c.y || 0) - Number(b.y || 0), Number(c.z || 0) - Number(b.z || 0)];
  const dot = ba.reduce((sum, value, index) => sum + value * bc[index], 0);
  const ma = Math.sqrt(ba.reduce((sum, value) => sum + value * value, 0));
  const mc = Math.sqrt(bc.reduce((sum, value) => sum + value * value, 0));
  if (!ma || !mc) return null;
  return Math.acos(Math.max(-1, Math.min(1, dot / (ma * mc)))) * 180 / Math.PI;
}

function calculateVectorBetweenLandmarks(landmarkA, landmarkB) {
  const a = pointFromLandmark(landmarkA);
  const b = pointFromLandmark(landmarkB);
  return {
    x: Number(b.x || 0) - Number(a.x || 0),
    y: Number(b.y || 0) - Number(a.y || 0),
    z: Number(b.z || 0) - Number(a.z || 0),
    magnitude: calculateDistanceBetweenLandmarks(a, b)
  };
}

function calculateRatio(valueA, valueB) {
  const a = Number(valueA);
  const b = Number(valueB);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return a / b;
}

module.exports = {
  calculateDistanceBetweenLandmarks,
  calculateAngleBetweenLandmarks,
  calculateVectorBetweenLandmarks,
  calculateRatio
};
