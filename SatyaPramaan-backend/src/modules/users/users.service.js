const User = require("../../models/User.model");
const { AppError } = require("../../utils/AppError");
const { sanitizeUser } = require("../../utils/serializers");

async function getUserById(userId) {
  const user = await User.findById(userId).lean();

  if (!user) {
    throw new AppError("User not found", 404);
  }

  return sanitizeUser(user);
}

module.exports = { getUserById };
