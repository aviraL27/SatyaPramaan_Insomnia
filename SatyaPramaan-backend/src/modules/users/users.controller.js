const { asyncHandler } = require("../../utils/asyncHandler");
const usersService = require("./users.service");

const getUser = asyncHandler(async (req, res) => {
  const user = await usersService.getUserById(req.params.userId);
  res.json({ data: user });
});

module.exports = { getUser };
