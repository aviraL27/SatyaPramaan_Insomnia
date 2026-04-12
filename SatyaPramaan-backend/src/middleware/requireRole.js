const { AppError } = require("../utils/AppError");

function requireRole(...roles) {
  return function roleMiddleware(req, res, next) {
    if (!req.auth) {
      return next(new AppError("Authentication required", 401));
    }

    if (!roles.includes(req.auth.role)) {
      return next(new AppError("Forbidden", 403));
    }

    return next();
  };
}

module.exports = { requireRole };
