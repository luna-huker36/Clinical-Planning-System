const MAX_FILE_BYTES = 250 * 1024 * 1024;
const MOCK_GLB_URL = "models/LeePerrySmith.glb";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm"]);

const STATUSES = Object.freeze({
  uploaded: "uploaded",
  validating: "validating",
  analyzing: "analyzing",
  preparing: "preparing",
  extractingFrames: "extracting_frames",
  analyzingFrames: "analyzing_frames",
  segmentingHead: "segmenting_head",
  queued: "queued",
  reconstructing3d: "reconstructing_3d",
  cleaningMesh: "cleaning_mesh",
  exporting: "exporting",
  ready: "ready",
  canceled: "canceled",
  error: "error"
});

const ERROR_CODES = Object.freeze({
  validationFailed: "VALIDATION_FAILED",
  uploadFailed: "UPLOAD_FAILED",
  uploadNotFound: "UPLOAD_NOT_FOUND",
  jobNotFound: "JOB_NOT_FOUND",
  jobInvalidState: "JOB_INVALID_STATE",
  resultNotReady: "RESULT_NOT_READY",
  backendFailed: "BACKEND_FAILED"
});

module.exports = {
  MAX_FILE_BYTES,
  MOCK_GLB_URL,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  STATUSES,
  ERROR_CODES
};
