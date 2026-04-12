const request = require("supertest");

process.env.NODE_ENV = "test";
process.env.MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/digisecure-test";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
process.env.APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:4000";
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

jest.mock("../../src/config/firebase", () => ({
  getFirebaseAdmin: () => ({
    auth: () => ({
      verifyIdToken: jest.fn().mockResolvedValue({ uid: "firebase-user-1", email: "ava@example.com" })
    })
  }),
  isFirebaseConfigured: () => true
}));

jest.mock("../../src/middleware/rateLimiter", () => ({
  rateLimiter: () => (req, res, next) => next()
}));

jest.mock("../../src/middleware/uploadHandler", () => ({
  uploadHandler: {
    single: () => (req, res, next) => {
      req.file = {
        originalname: "test.pdf",
        mimetype: "application/pdf",
        size: 128,
        buffer: Buffer.from("test-pdf")
      };
      next();
    }
  }
}));

jest.mock("../../src/middleware/firebaseAuth", () => ({
  firebaseAuth: (req, res, next) => {
    const authHeader = req.headers.authorization || "";
    const [, token] = authHeader.split(" ");

    if (!token) {
      const error = new Error("Missing bearer token");
      error.statusCode = 401;
      return next(error);
    }

    req.auth = {
      firebaseUid: "firebase-user-1",
      userId: "user-1",
      tenantId: req.headers["x-test-tenant"] || "tenant-1",
      role: req.headers["x-test-role"] || "institution_admin",
      email: "ava@example.com"
    };

    return next();
  }
}));

jest.mock("../../src/middleware/optionalFirebaseAuth", () => ({
  optionalFirebaseAuth: (req, res, next) => {
    const authHeader = req.headers.authorization || "";
    const [, token] = authHeader.split(" ");

    if (token) {
      req.auth = {
        firebaseUid: "firebase-user-1",
        userId: "user-1",
        tenantId: "tenant-1",
        role: "institution_admin",
        email: "ava@example.com"
      };
    }

    return next();
  }
}));

jest.mock("../../src/modules/auth/auth.service", () => ({
  bootstrapUser: jest.fn(),
  getCurrentUser: jest.fn(),
  updateCurrentUser: jest.fn()
}));

jest.mock("../../src/modules/issuance/issuance.service", () => ({
  issueDocument: jest.fn(),
  buildIssuanceHashes: jest.fn(),
  buildSignaturePayload: jest.fn()
}));

jest.mock("../../src/modules/verification/verification.service", () => ({
  verifyQrPayload: jest.fn(),
  verifyUploadedFile: jest.fn(),
  getVerificationJob: jest.fn(),
  getVerificationAttempt: jest.fn()
}));

jest.mock("../../src/modules/audit-ledger/auditLedger.service", () => ({
  appendAuditEntry: jest.fn(),
  listAuditEntries: jest.fn(),
  verifyChain: jest.fn()
}));

jest.mock("../../src/modules/trust-score/trustScore.service", () => ({
  getTrustScoreByIssuer: jest.fn(),
  recomputeTrustScore: jest.fn()
}));

const { createApp } = require("../../src/app");
const authService = require("../../src/modules/auth/auth.service");
const issuanceService = require("../../src/modules/issuance/issuance.service");
const verificationService = require("../../src/modules/verification/verification.service");
const auditLedgerService = require("../../src/modules/audit-ledger/auditLedger.service");
const trustScoreService = require("../../src/modules/trust-score/trustScore.service");

describe("integration api flows", () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();

    authService.bootstrapUser.mockResolvedValue({ id: "user-1", role: "verifier" });
    authService.getCurrentUser.mockResolvedValue({ id: "user-1", role: "institution_admin" });
    issuanceService.issueDocument.mockResolvedValue({ documentId: "doc-1", status: "issued" });
    verificationService.verifyUploadedFile.mockResolvedValue({
      status: "pending",
      reasonCode: "VERIFICATION_JOB_PENDING",
      reason: "Verification job is still processing",
      jobId: "verify_abc123",
      documentId: "doc-1"
    });
    auditLedgerService.verifyChain.mockResolvedValue({ ok: true, brokenLinks: [] });
    trustScoreService.getTrustScoreByIssuer.mockResolvedValue({
      issuerUserId: "issuer-1",
      score: 88,
      history: [{ recordedAt: "2026-04-11T00:00:00.000Z", score: 88 }]
    });
  });

  it("bootstraps auth profile", async () => {
    const response = await request(app)
      .post("/api/v1/auth/bootstrap")
      .set("authorization", "Bearer fake-token")
      .send({
        displayName: "Ava",
        role: "verifier"
      });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(expect.objectContaining({ id: "user-1", role: "verifier" }));
    expect(authService.bootstrapUser).toHaveBeenCalled();
  });

  it("issues a document through the issuance endpoint", async () => {
    const response = await request(app)
      .post("/api/v1/documents/issue")
      .set("authorization", "Bearer fake-token")
      .set("x-test-role", "institution_admin")
      .send({
        title: "Degree Certificate",
        documentType: "certificate",
        recipientName: "Ava"
      });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(expect.objectContaining({ documentId: "doc-1", status: "issued" }));
    expect(issuanceService.issueDocument).toHaveBeenCalled();
  });

  it("returns 202 for async verification upload jobs", async () => {
    const response = await request(app)
      .post("/api/v1/public/verify/upload")
      .send({
        documentId: "doc-1",
        async: true
      });

    expect(response.status).toBe(202);
    expect(response.body.data).toEqual(
      expect.objectContaining({
        status: "pending",
        reasonCode: "VERIFICATION_JOB_PENDING",
        jobId: "verify_abc123"
      })
    );
    expect(verificationService.verifyUploadedFile).toHaveBeenCalled();
  });

  it("verifies audit chain for authorized users", async () => {
    const response = await request(app)
      .post("/api/v1/audit/verify-chain")
      .set("authorization", "Bearer fake-token")
      .set("x-test-role", "institution_admin");

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(expect.objectContaining({ ok: true }));
    expect(auditLedgerService.verifyChain).toHaveBeenCalledWith({ tenantId: "tenant-1" });
  });

  it("returns trust history for authenticated institution users", async () => {
    const response = await request(app)
      .get("/api/v1/trust/issuer-1/history")
      .set("authorization", "Bearer fake-token")
      .set("x-test-role", "institution_operator");

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      expect.objectContaining({ recordedAt: "2026-04-11T00:00:00.000Z", score: 88 })
    ]);
    expect(trustScoreService.getTrustScoreByIssuer).toHaveBeenCalledWith("issuer-1");
  });
});
