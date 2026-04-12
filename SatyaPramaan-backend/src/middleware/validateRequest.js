const { AppError } = require("../utils/AppError");

function validateRequest(schema) {
  return function validationMiddleware(req, res, next) {
    const result = schema.safeParse({
      body: req.body,
      params: req.params,
      query: req.query
    });

    if (!result.success) {
      return next(new AppError("Request validation failed", 400, result.error.flatten()));
    }

    req.validated = result.data;
    return next();
  };
}

module.exports = { validateRequest };
