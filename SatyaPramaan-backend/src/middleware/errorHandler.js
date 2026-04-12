const { AppError } = require("../utils/AppError");

function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      message: "Route not found"
    }
  });
}

function errorHandler(error, req, res, next) {
  const normalized = error instanceof AppError
    ? error
    : new AppError(error.message || "Internal server error", error.statusCode || 500);

  res.status(normalized.statusCode).json({
    error: {
      message: normalized.message,
      details: normalized.details
    }
  });
}

module.exports = { notFoundHandler, errorHandler };
