const { z } = require("zod");
const { asyncHandler } = require("../../utils/asyncHandler");
const documentsService = require("./documents.service");

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

const revokeSchema = z.object({
  body: z.object({
    reason: z.string().min(1)
  }),
  params: z.object({
    documentId: z.string().min(1)
  }),
  query: z.object({})
});

const replaceSchema = z.object({
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
  params: z.object({
    documentId: z.string().min(1)
  }),
  query: z.object({})
});

const downloadSchema = z.object({
  body: z.object({}),
  params: z.object({
    documentId: z.string().min(1)
  }),
  query: z.object({
    token: z.string().min(1).optional()
  })
});

const listDocuments = asyncHandler(async (req, res) => {
  const data = await documentsService.listDocuments({
    tenantId: req.auth.tenantId,
    issuerUserId: req.auth.userId
  });
  res.json({ data });
});

const getDocument = asyncHandler(async (req, res) => {
  const data = await documentsService.getDocumentById({
    tenantId: req.auth.tenantId,
    documentId: req.params.documentId
  });
  res.json({ data });
});

const revokeDocument = asyncHandler(async (req, res) => {
  const data = await documentsService.revokeDocument({
    tenantId: req.auth.tenantId,
    actorId: req.auth.userId,
    documentId: req.params.documentId,
    reason: req.validated.body.reason
  });
  res.json({ data });
});

const listVersions = asyncHandler(async (req, res) => {
  const data = await documentsService.listDocumentVersions({
    tenantId: req.auth.tenantId,
    documentId: req.params.documentId
  });
  res.json({ data });
});

const downloadDocument = asyncHandler(async (req, res) => {
  const data = await documentsService.getDocumentDownloadInfo({
    auth: req.auth || null,
    documentId: req.params.documentId,
    token: req.validated?.query?.token || req.query?.token || null
  });

  res.setHeader("Content-Type", "application/pdf");
  res.download(data.filePath, data.fileName);
});

const replaceDocument = asyncHandler(async (req, res) => {
  const data = await documentsService.replaceDocument({
    tenantId: req.auth.tenantId,
    actorId: req.auth.userId,
    documentId: req.params.documentId,
    body: req.validated.body,
    file: req.file
  });

  res.status(201).json({ data });
});

module.exports = {
  revokeSchema,
  replaceSchema,
  downloadSchema,
  listDocuments,
  getDocument,
  revokeDocument,
  listVersions,
  downloadDocument,
  replaceDocument
};
