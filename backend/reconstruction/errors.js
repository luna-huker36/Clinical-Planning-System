const { ERROR_CODES } = require("./constants");

class ApiError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function sendError(res, err) {
  const statusCode = err.statusCode || 500;
  const code = err.code || ERROR_CODES.backendFailed;
  const message = err.message || "Unexpected backend error.";
  res.status(statusCode).json({ error: { code, message } });
}

module.exports = {
  ApiError,
  sendError
};
