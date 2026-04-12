const { z } = require("zod");
const { asyncHandler } = require("../../utils/asyncHandler");
const verificationService = require("./verification.service");

function extractJsonObjectSegments(input) {
  if (typeof input !== "string") {
    return [];
  }

  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  const segments = [];

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char === "}" && depth > 0) {
      depth -= 1;

      if (depth === 0 && start >= 0) {
        segments.push(input.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return segments;
}

function parsePossiblyRepeatedJson(raw) {
  const input = String(raw || "").trim();

  if (!input) {
    return undefined;
  }

  const candidates = [input];

  if (input.length % 2 === 0) {
    const midpoint = input.length / 2;
    const firstHalf = input.slice(0, midpoint);
    const secondHalf = input.slice(midpoint);

    if (firstHalf === secondHalf) {
      candidates.push(firstHalf);
    }
  }

  const objectSegments = extractJsonObjectSegments(input);
  for (const segment of objectSegments) {
    if (segment && segment !== input) {
      candidates.push(segment);
    }
  }

  let lastParsed = null;

  for (const candidate of candidates) {
    try {
      let parsed = JSON.parse(candidate);

      for (let unwrap = 0; unwrap < 2; unwrap += 1) {
        if (typeof parsed === "string") {
          parsed = JSON.parse(parsed);
        }
      }

      lastParsed = parsed;
    } catch (_error) {
      // Keep trying other candidates.
    }
  }

  if (lastParsed !== null) {
    return lastParsed;
  }

  return raw;
}

function parseJsonField(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  return parsePossiblyRepeatedJson(trimmed);
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
