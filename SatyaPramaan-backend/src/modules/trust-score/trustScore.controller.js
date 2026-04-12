const { asyncHandler } = require("../../utils/asyncHandler");
const trustScoreService = require("./trustScore.service");
const { AppError } = require("../../utils/AppError");

const getTrustScore = asyncHandler(async (req, res) => {
  const data = await trustScoreService.getTrustScoreByIssuer(req.params.issuerUserId);

  if (!data) {
    throw new AppError("Trust score not found", 404);
  }

  res.json({ data });
});

const getTrustHistory = asyncHandler(async (req, res) => {
  const data = await trustScoreService.getTrustScoreByIssuer(req.params.issuerUserId);

  if (!data) {
    throw new AppError("Trust score not found", 404);
  }

  res.json({ data: data.history || [] });
});

module.exports = {
  getTrustScore,
  getTrustHistory
};
