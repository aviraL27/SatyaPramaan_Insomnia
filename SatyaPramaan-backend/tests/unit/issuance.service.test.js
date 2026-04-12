describe("issuance.service", () => {
  const realEnv = process.env;

  function loadService() {
    jest.resetModules();

    process.env = {
      ...realEnv,
      NODE_ENV: "test",
      MONGODB_URI: "mongodb://localhost:27017/digisecure-test",
      REDIS_URL: "redis://localhost:6379",
      APP_BASE_URL: "http://localhost:4000",
      CORS_ORIGIN: "http://localhost:3000",
      PRIVATE_KEY_MASTER_KEY_BASE64: Buffer.alloc(32, 7).toString("base64")
    };

    const { generateKeyPairSync, createHash } = require("crypto");
    const { encryptPrivateKey } = require("../../src/crypto/privateKeyVault");

    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });

    const issuer = {
      _id: "507f1f77bcf86cd799439011",
      tenantId: "tenant_demo",
      institutionName: "Demo University",
      displayName: "Demo University Admin",
      rsaPublicKeyPem: publicKey,
      rsaPublicKeyFingerprint: createHash("sha256").update(publicKey).digest("hex"),
      encryptedPrivateKey: encryptPrivateKey(privateKey)
    };

    const parsedPdf = {
      pageCount: 1,
      metadata: {
        info: { Producer: "pdf-lib" },
        xmp: {}
      },
      textPositions: [
        {
          pageNumber: 1,
          words: [
            {
              text: "Hello",
              normalizedText: "Hello",
              x: 10,
              y: 20,
              width: 30,
              height: 12,
              fontName: "Helvetica",
              fontSize: 12,
              transform: [12, 0, 0, 12, 10, 20],
              readingOrderIndex: 0
            }
          ]
        }
      ],
      pageText: [{ pageNumber: 1, text: "Hello DigiSecure" }],
      fullText: "Hello DigiSecure"
    };

    const createdDocuments = [];
    const documentModel = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async (payload) => {
        const document = {
          ...payload,
          _id: "doc_mongo_1",
          status: payload.status || "issued",
          toObject() {
            return { ...this };
          }
        };

        createdDocuments.push(document);
        return document;
      })
    };

    const userModel = {
      findOne: jest.fn().mockResolvedValue(issuer)
    };

    const mocks = {
      documentModel,
      userModel,
      setDocumentSnapshot: jest.fn().mockResolvedValue(undefined),
      setPdfPositions: jest.fn().mockResolvedValue(undefined),
      appendAuditEntry: jest.fn().mockResolvedValue(undefined),
      recomputeTrustScore: jest.fn().mockResolvedValue(undefined),
      parsePdfWithPositions: jest.fn().mockResolvedValue(parsedPdf),
      injectQrIntoPdf: jest.fn().mockResolvedValue(Buffer.from("issued-pdf-buffer")),
      mkdir: jest.fn().mockResolvedValue(undefined),
      writeFile: jest.fn().mockResolvedValue(undefined),
      qrToDataUrl: jest.fn().mockResolvedValue("data:image/png;base64,AAAA"),
      createdDocuments,
      issuer,
      parsedPdf
    };

    jest.doMock("../../src/models/Document.model", () => documentModel);
    jest.doMock("../../src/models/User.model", () => userModel);
    jest.doMock("../../src/cache/documentSnapshotCache", () => ({
      setDocumentSnapshot: mocks.setDocumentSnapshot
    }));
    jest.doMock("../../src/cache/pdfPositionCache", () => ({
      setPdfPositions: mocks.setPdfPositions
    }));
    jest.doMock("../../src/modules/audit-ledger/auditLedger.service", () => ({
      appendAuditEntry: mocks.appendAuditEntry
    }));
    jest.doMock("../../src/modules/trust-score/trustScore.service", () => ({
      recomputeTrustScore: mocks.recomputeTrustScore
    }));
    jest.doMock("../../src/pdf-pipeline/pdfParser", () => ({
      parsePdfWithPositions: mocks.parsePdfWithPositions
    }));
    jest.doMock("../../src/pdf-pipeline/pdfQRInjector", () => ({
      injectQrIntoPdf: mocks.injectQrIntoPdf
    }));
    jest.doMock("fs/promises", () => ({
      mkdir: mocks.mkdir,
      writeFile: mocks.writeFile
    }));
    jest.doMock("qrcode", () => ({
      toDataURL: mocks.qrToDataUrl
    }));
    jest.doMock("uuid", () => ({
      v4: jest.fn().mockReturnValueOnce("issuance-uuid").mockReturnValueOnce("signature-uuid")
    }));

    const service = require("../../src/modules/issuance/issuance.service");

    return {
      service,
      mocks,
      issuer
    };
  }

  afterAll(() => {
    process.env = realEnv;
  });

  it("creates hashes and a verifiable signature for issued documents", async () => {
    const { service, mocks, issuer } = loadService();
    const { verifyPayload } = require("../../src/crypto/documentSigner");
    const { canonicalize } = require("../../src/pdf-pipeline/pdfCanonicalizer");
    const { sha256 } = require("../../src/pdf-pipeline/pdfHasher");
    const body = {
      title: "Degree Certificate",
      documentType: "certificate",
      recipientName: "Ava Sharma",
      recipientReference: "REC-001",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      metadata: { grade: "A+" },
      qrPlacement: { pageIndex: 0, width: 120, height: 120 }
    };
    const req = {
      auth: {
        tenantId: "tenant_demo",
        userId: String(issuer._id)
      },
      validated: { body },
      body,
      headers: {
        "idempotency-key": "issue-001"
      },
      file: {
        originalname: "degree.pdf",
        mimetype: "application/pdf",
        size: 18,
        buffer: Buffer.from("source-pdf-buffer")
      }
    };

    const result = await service.issueDocument(req);
    const created = mocks.createdDocuments[0];
    const expectedHashes = service.buildIssuanceHashes({
      body,
      parsedPdf: mocks.parsedPdf
    });
    const signaturePayload = service.buildSignaturePayload({
      documentId: created.documentId,
      tenantId: created.tenantId,
      issuerUserId: String(created.issuerUserId),
      issuedAt: created.issuedAt.toISOString(),
      signatureId: created.signatureId,
      verificationToken: created.verificationToken,
      metadataHash: created.metadataHash,
      canonicalContentHash: created.canonicalContentHash,
      fileBinaryHash: created.fileBinaryHash,
      signingKeyFingerprint: created.signingKeyFingerprint
    });

    expect(created.metadataHash).toBe(expectedHashes.metadataHash);
    expect(created.canonicalContentHash).toBe(expectedHashes.canonicalContentHash);
    expect(created.fileBinaryHash).toBe(sha256(req.file.buffer));
    expect(created.documentId).toBe("doc_issuance-uuid");
    expect(created.signatureId).toBe("sig_signature-uuid");
    expect(created.qrPayload.contentHash).toBe(created.canonicalContentHash);
    expect(
      verifyPayload(canonicalize(signaturePayload), created.signatureValue, issuer.rsaPublicKeyPem)
    ).toBe(true);
    expect(mocks.setDocumentSnapshot).toHaveBeenCalledWith(
      created.documentId,
      expect.objectContaining({
        canonicalContentHash: created.canonicalContentHash,
        issuerPublicKeyPem: issuer.rsaPublicKeyPem
      })
    );
    expect(result.file.hashes).toEqual({
      metadataHash: created.metadataHash,
      canonicalContentHash: created.canonicalContentHash,
      fileBinaryHash: created.fileBinaryHash
    });
    expect(result.idempotency).toEqual({
      key: "issue-001",
      replayed: false
    });
  });

  it("replays the same document when the idempotency key matches the same request", async () => {
    const { service, mocks, issuer } = loadService();
    const { sha256 } = require("../../src/pdf-pipeline/pdfHasher");
    const body = {
      title: "Degree Certificate",
      documentType: "certificate",
      recipientName: "Ava Sharma",
      recipientReference: "REC-001",
      metadata: { grade: "A+" }
    };
    const fileBuffer = Buffer.from("source-pdf-buffer");
    const issuanceRequestHash = service.buildIssuanceRequestHash({
      body,
      fileBinaryHash: sha256(fileBuffer)
    });
    const existing = {
      documentId: "doc_existing",
      tenantId: "tenant_demo",
      issuerUserId: issuer._id,
      issuerInstitutionName: issuer.institutionName,
      title: body.title,
      documentType: body.documentType,
      recipientName: body.recipientName,
      recipientReference: body.recipientReference,
      status: "issued",
      issuedAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: null,
      verificationToken: "token-123",
      qrPayload: { documentId: "doc_existing" },
      signatureId: "sig_existing",
      signatureAlgorithm: "RSA-SHA256",
      signingKeyFingerprint: issuer.rsaPublicKeyFingerprint,
      sourcePdfStorage: { path: "storage/documents/tenant_demo/doc_existing/source.pdf", storageType: "local_fs" },
      issuedPdfStorage: { path: "storage/documents/tenant_demo/doc_existing/issued.pdf", storageType: "local_fs" },
      fileName: "degree.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: 18,
      issuedFileSizeBytes: 32,
      pageCount: 1,
      metadataHash: "metadata-hash",
      canonicalContentHash: "content-hash",
      fileBinaryHash: sha256(fileBuffer),
      issuanceIdempotencyKey: "issue-001",
      issuanceRequestHash
    };

    mocks.documentModel.findOne.mockResolvedValue(existing);

    const req = {
      auth: {
        tenantId: "tenant_demo",
        userId: String(issuer._id)
      },
      validated: { body },
      body,
      headers: {
        "idempotency-key": "issue-001"
      },
      file: {
        originalname: "degree.pdf",
        mimetype: "application/pdf",
        size: 18,
        buffer: fileBuffer
      }
    };

    const result = await service.issueDocument(req);

    expect(mocks.documentModel.create).not.toHaveBeenCalled();
    expect(mocks.parsePdfWithPositions).not.toHaveBeenCalled();
    expect(result.document.documentId).toBe("doc_existing");
    expect(result.idempotency).toEqual({
      key: "issue-001",
      replayed: true
    });
  });

  it("rejects reuse of an idempotency key for a different issuance payload", async () => {
    const { service, mocks, issuer } = loadService();
    const body = {
      title: "Degree Certificate",
      documentType: "certificate",
      recipientName: "Ava Sharma",
      recipientReference: "REC-001",
      metadata: { grade: "A+" }
    };

    mocks.documentModel.findOne.mockResolvedValue({
      issuanceRequestHash: "different-hash"
    });

    const req = {
      auth: {
        tenantId: "tenant_demo",
        userId: String(issuer._id)
      },
      validated: { body },
      body,
      headers: {
        "idempotency-key": "issue-001"
      },
      file: {
        originalname: "degree.pdf",
        mimetype: "application/pdf",
        size: 18,
        buffer: Buffer.from("source-pdf-buffer")
      }
    };

    await expect(service.issueDocument(req)).rejects.toMatchObject({
      statusCode: 409
    });
  });
});
