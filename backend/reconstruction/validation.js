const path = require("path");
const {
  MAX_FILE_BYTES,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  ERROR_CODES
} = require("./constants");
const { ApiError } = require("./errors");

function getExtension(fileName) {
  return path.extname(String(fileName || "")).replace(".", "").toLowerCase();
}

function detectFileType(files) {
  let hasImage = false;
  let hasVideo = false;

  for (const file of files) {
    const extension = file.extension || getExtension(file.originalname || file.name);
    if (IMAGE_EXTENSIONS.has(extension)) hasImage = true;
    if (VIDEO_EXTENSIONS.has(extension)) hasVideo = true;
  }

  if (hasImage && hasVideo) return "mixed";
  if (hasVideo) return "video";
  return "images";
}

function validateUploadedFiles(files) {
  const errors = [];
  const fileArray = Array.from(files || []);

  if (!fileArray.length) {
    errors.push("Добавьте хотя бы один файл для reconstruction.");
  }

  for (const file of fileArray) {
    const fileName = file.originalname || file.name || "file";
    const extension = getExtension(fileName);

    if (!IMAGE_EXTENSIONS.has(extension) && !VIDEO_EXTENSIONS.has(extension)) {
      errors.push(`Формат ${fileName} не поддерживается. Разрешены JPG, JPEG, PNG, MP4, MOV, WEBM.`);
    }

    if (Number(file.size || 0) > MAX_FILE_BYTES) {
      errors.push(`${fileName} превышает лимит 250 MB.`);
    }
  }

  if (errors.length) {
    throw new ApiError(400, ERROR_CODES.validationFailed, errors.join(" "));
  }

  return {
    fileType: detectFileType(fileArray)
  };
}

function toSafeFileMeta(file) {
  return {
    id: file.filename || file.id,
    name: file.originalname || file.name,
    size: file.size,
    mimetype: file.mimetype || "",
    extension: getExtension(file.originalname || file.name),
    storageId: file.filename || file.storageId || null,
    path: file.path || null
  };
}

module.exports = {
  getExtension,
  detectFileType,
  validateUploadedFiles,
  toSafeFileMeta
};
