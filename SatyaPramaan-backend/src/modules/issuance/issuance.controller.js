const { z } = require("zod");
const { asyncHandler } = require("../../utils/asyncHandler");
const issuanceService = require("./issuance.service");

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

function preprocessOptionalDate(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return value instanceof Date ? value : new Date(value);
}

function preprocessOptionalNumber(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return typeof value === "number" ? value : Number(value);
}

const issueDocumentSchema = z.object({
  body: z.object({
    title: z.string().trim().min(1),
    documentType: z.string().trim().min(1),
    recipientName: z.string().trim().min(1),
    recipientReference: z.string().trim().min(1).optional(),
    expiresAt: z.preprocess(preprocessOptionalDate, z.date().optional()),
    metadata: z.preprocess(parseJsonField, z.record(z.any()).optional()),
    qrPlacement: z
      .preprocess(
        parseJsonField,
        z
          .object({
            pageIndex: z.preprocess(preprocessOptionalNumber, z.number().int().min(0).optional()),
            width: z.preprocess(preprocessOptionalNumber, z.number().positive().max(512).optional()),
            height: z.preprocess(preprocessOptionalNumber, z.number().positive().max(512).optional()),
            marginRight: z.preprocess(preprocessOptionalNumber, z.number().min(0).max(512).optional()),
            marginBottom: z.preprocess(preprocessOptionalNumber, z.number().min(0).max(512).optional())
          })
          .optional()
      )
      .optional()
  }),
  params: z.object({}),
  query: z.object({})
});

const issueDocument = asyncHandler(async (req, res) => {
  const data = await issuanceService.issueDocument(req);
  res.status(201).json({ data });
});

module.exports = { issueDocumentSchema, issueDocument };
