const { AppError } = require("./AppError");

function notImplemented(feature) {
  throw new AppError(`${feature} is not implemented yet`, 501);
}

module.exports = { notImplemented };
