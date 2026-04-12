const { z } = require("zod");
const { getFirebaseAdmin } = require("../../config/firebase");
const { asyncHandler } = require("../../utils/asyncHandler");
const authService = require("./auth.service");

const bootstrapSchema = z.object({
  body: z.object({
    displayName: z.string().min(1).optional(),
    role: z.enum(["institution_admin", "institution_operator", "verifier", "platform_admin"]),
    institutionName: z.string().optional(),
    institutionCode: z.string().optional(),
    institutionType: z.string().optional(),
    publicIssuerProfile: z.record(z.any()).optional(),
    contactPhone: z.string().optional(),
    address: z.record(z.any()).optional()
  }),
  params: z.object({}),
  query: z.object({})
});

const updateMeSchema = z.object({
  body: z.object({
    displayName: z.string().min(1).optional(),
    contactPhone: z.string().optional(),
    address: z.record(z.any()).optional()
  }),
  params: z.object({}),
  query: z.object({})
});

const bootstrap = asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization || "";
  const [, token] = authHeader.split(" ");
  const admin = getFirebaseAdmin();
  const firebaseUser = await admin.auth().verifyIdToken(token);
  const user = await authService.bootstrapUser({
    firebaseUser,
    profile: req.validated.body
  });

  res.status(201).json({ data: user });
});

const me = asyncHandler(async (req, res) => {
  const user = await authService.getCurrentUser(req.auth.userId);
  res.json({ data: user });
});

const updateMe = asyncHandler(async (req, res) => {
  const user = await authService.updateCurrentUser(req.auth.userId, req.validated.body);
  res.json({ data: user });
});

module.exports = {
  bootstrapSchema,
  updateMeSchema,
  bootstrap,
  me,
  updateMe
};
