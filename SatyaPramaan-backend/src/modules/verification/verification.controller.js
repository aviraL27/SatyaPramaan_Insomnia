const { z } = require("zod");
const { asyncHandler } = require("../../utils/asyncHandler");
const verificationService = require("./verification.service");

function parseJsonField(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    return value;
  }
}

const qrSchema = z.object({
  body: z.object({
    documentId: z.string().min(1),
    tenantId: z.string().min(1),
    signatureId: z.string().min(1),
    contentHash: z.string().min(1),
    verificationToken: z.string().min(1),
    issuedAt: z.union([z.string(), z.date()]),
    qrSignature: z.string().min(1)
  }),
  params: z.object({}),
  query: z.object({})
});

const qrPayloadSchema = z.object({
  documentId: z.string().min(1),
  tenantId: z.string().min(1),
  signatureId: z.string().min(1),
  contentHash: z.string().min(1),
  verificationToken: z.string().min(1),
  issuedAt: z.union([z.string(), z.date()]),
  qrSignature: z.string().min(1)
});

const uploadSchema = z
  .object({
    body: z.object({
      documentId: z.string().min(1).optional(),
      qrPayload: z.preprocess(parseJsonField, qrPayloadSchema.optional()),
      async: z.union([z.boolean(), z.string()]).optional()
    }),
    params: z.object({}),
    query: z.object({
      async: z.union([z.boolean(), z.string()]).optional()
    })
  })
  .refine((payload) => payload.body.documentId || payload.body.qrPayload, {
    message: "documentId or qrPayload is required",
    path: ["body", "documentId"]
  });

const verifyQr = asyncHandler(async (req, res) => {
  const data = await verificationService.verifyQrPayload({
    qrPayload: req.validated.body,
    ip: req.ip,
    userAgent: req.headers["user-agent"] || null,
    verifierUserId: req.auth?.userId || null
  });
  res.json({ data });
});

const verifyUpload = asyncHandler(async (req, res) => {
  const data = await verificationService.verifyUploadedFile(req);
  if (data?.status === "pending") {
    return res.status(202).json({ data });
  }

  return res.json({ data });
});

const getJob = asyncHandler(async (req, res) => {
  const data = await verificationService.getVerificationJob(req.params.jobId, {
    auth: req.auth || null,
    resultToken: req.query.resultToken || null
  });
  res.json({ data });
});

const getAttempt = asyncHandler(async (req, res) => {
  const data = await verificationService.getVerificationAttempt(req.params.attemptId, {
    auth: req.auth || null,
    resultToken: req.query.resultToken || null
  });
  res.json({ data });
});

module.exports = {
  qrSchema,
  uploadSchema,
  verifyQr,
  verifyUpload,
  getJob,
  getAttempt
};
