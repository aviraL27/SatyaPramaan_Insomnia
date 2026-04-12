const { z } = require("zod");
const { asyncHandler } = require("../../utils/asyncHandler");
const institutionsService = require("./institutions.service");

const updateProfileSchema = z.object({
  body: z.object({
    institutionName: z.string().optional(),
    institutionType: z.string().optional(),
    publicIssuerProfile: z.record(z.any()).optional(),
    contactPhone: z.string().optional(),
    address: z.record(z.any()).optional()
  }),
  params: z.object({}),
  query: z.object({})
});

const getProfile = asyncHandler(async (req, res) => {
  const data = await institutionsService.getInstitutionProfile(req.auth.userId);
  res.json({ data });
});

const updateProfile = asyncHandler(async (req, res) => {
  const data = await institutionsService.updateInstitutionProfile(req.auth.userId, req.validated.body);
  res.json({ data });
});

const rotateKeys = asyncHandler(async (req, res) => {
  const data = await institutionsService.rotateKeys(req.auth.userId);
  res.json({ data });
});

const getPublicProfile = asyncHandler(async (req, res) => {
  const data = await institutionsService.getPublicInstitutionProfile(req.params.issuerUserId);
  res.json({ data });
});

module.exports = {
  updateProfileSchema,
  getProfile,
  updateProfile,
  rotateKeys,
  getPublicProfile
};
