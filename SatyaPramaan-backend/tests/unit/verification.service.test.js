const crypto = require("crypto");

describe("verification.service upload flow", () => {
  function buildLeanResult(value) {
    return {
      lean: jest.fn().mockResolvedValue(value)
    };
  }

  function loadService({
    document,
    cachedSnapshot = null,
    cachedPdfPositions = null,
    cachedVerifyJob = null,
    parsedPdf,
    buildHashes,
    verifyPayloadResult = true,
    ocrComparison = null,
    visualComparison = null,
    issuedPdfReadError = null
  }) {
    jest.resetModules();

    const documentById = document ? { [document.documentId]: document } : {};

    const documentModel = {
      findOne: jest.fn((query) => buildLeanResult(documentById[query.documentId] || null)),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 })
    };

    const userModel = {
      findById: jest.fn(() =>
        buildLeanResult({
          _id: "issuer-1",
          rsaPublicKeyPem: "issuer-public-key-pem"
        })
      )
    };

    let attemptCounter = 0;
    const verificationAttemptModel = {
      create: jest.fn().mockImplementation(async (payload) => {
        attemptCounter += 1;
        return {
          _id: `attempt-${attemptCounter}`,
          ...payload,
          toObject() {
            return { ...this };
          }
        };
      }),
      findOne: jest.fn(() => buildLeanResult(null))
    };

    const mocks = {
      documentModel,
      userModel,
      verificationAttemptModel,
      getDocumentSnapshot: jest.fn().mockResolvedValue(cachedSnapshot),
      setDocumentSnapshot: jest.fn().mockResolvedValue(undefined),
      getPdfPositions: jest.fn().mockResolvedValue(cachedPdfPositions),
      setPdfPositions: jest.fn().mockResolvedValue(undefined),
      parsePdfWithPositions: jest.fn().mockResolvedValue(parsedPdf),
      buildIssuanceHashes: jest.fn().mockReturnValue(buildHashes),
      buildSignaturePayload: jest.fn().mockReturnValue({ payload: "signature-basis" }),
      verifyPayload: jest.fn().mockReturnValue(verifyPayloadResult),
      readIssuedFile: jest.fn().mockImplementation(() => {
        if (issuedPdfReadError) {
          return Promise.reject(issuedPdfReadError);
        }

        return Promise.resolve(Buffer.from("issued-pdf"));
      }),
      diffTokenStreams: jest.fn((left, right) =>
        left === right
          ? [{ value: left }]
          : [{ value: left }, { removed: true, value: "x" }, { added: true, value: right }]
      ),
      mapChangedWordsToRectangles: jest.fn((words) => {
        if (!words.length) {
          return {};
        }

        return {
          "1": words
            .filter((word) => word.pageNumber === 1)
            .map((word) => ({ x: word.x, y: word.y, width: word.width, height: word.height, text: word.text }))
        };
      }),
      appendAuditEntry: jest.fn().mockResolvedValue(undefined),
      recomputeTrustScore: jest.fn().mockResolvedValue(undefined),
      getTrustScore: jest.fn().mockResolvedValue({ currentScore: 82, scoreBand: "high" }),
      getVerifyJob: jest.fn().mockResolvedValue(cachedVerifyJob),
      setVerifyJob: jest.fn().mockResolvedValue(undefined),
      setVerifyJobIfAbsent: jest.fn().mockResolvedValue(true),
      getVerifyJobPayload: jest.fn().mockResolvedValue(null),
      setVerifyJobPayload: jest.fn().mockResolvedValue(undefined),
      deleteVerifyJobPayload: jest.fn().mockResolvedValue(undefined),
      enqueueVerifyJob: jest.fn().mockResolvedValue(undefined),
      extractOcrLayer: jest.fn().mockImplementation(async () => ({
        enabled: true,
        fullText: parsedPdf?.fullText || "",
        pages: parsedPdf?.pageText || [],
        averageConfidence: 0.92,
        pageCount: parsedPdf?.pageCount || 1
      })),
      compareOcrLayers: jest.fn().mockReturnValue(
        ocrComparison || {
          changedWordCount: 0,
          changedPages: [],
          confidence: 0.92,
          available: true
        }
      ),
      comparePdfVisualLayers: jest.fn().mockResolvedValue(
        visualComparison || {
          visualDiffScoreByPage: [{ pageNumber: 1, score: 0 }],
          changedPages: [],
          visualLayerChanged: false
        }
      )
    };

    jest.doMock("../../src/config/env", () => ({
      env: {
        OCR_ENABLED: true,
        OCR_LANG: "eng",
        OCR_ENGINE: "auto",
        OCR_TIMEOUT_MS: 12000,
        OCR_RENDER_SCALE: 2,
        OCR_MAX_PAGES: 60,
        VISUAL_DIFF_ENABLED: true,
        VISUAL_DIFF_THRESHOLD: 0.08,
        VISUAL_DIFF_MIN_CHANGED_OPS: 30,
        VISUAL_DIFF_MIN_CHANGED_SENSITIVE_OPS: 8,
        VISUAL_RENDER_SCALE: 1.5,
        VISUAL_DIFF_TIMEOUT_MS: 12000
      }
    }));
    jest.doMock("fs/promises", () => ({
      readFile: mocks.readIssuedFile
    }));

    jest.doMock("../../src/models/Document.model", () => documentModel);
    jest.doMock("../../src/models/User.model", () => userModel);
    jest.doMock("../../src/models/VerificationAttempt.model", () => verificationAttemptModel);
    jest.doMock("../../src/cache/documentSnapshotCache", () => ({
      getDocumentSnapshot: mocks.getDocumentSnapshot,
      setDocumentSnapshot: mocks.setDocumentSnapshot
    }));
    jest.doMock("../../src/cache/pdfPositionCache", () => ({
      getPdfPositions: mocks.getPdfPositions,
      setPdfPositions: mocks.setPdfPositions
    }));
    jest.doMock("../../src/cache/trustCache", () => ({
      getTrustScore: mocks.getTrustScore
    }));
    jest.doMock("../../src/cache/verifyJobCache", () => ({
      getVerifyJob: mocks.getVerifyJob,
      setVerifyJob: mocks.setVerifyJob,
      setVerifyJobIfAbsent: mocks.setVerifyJobIfAbsent,
      getVerifyJobPayload: mocks.getVerifyJobPayload,
      setVerifyJobPayload: mocks.setVerifyJobPayload,
      deleteVerifyJobPayload: mocks.deleteVerifyJobPayload,
      enqueueVerifyJob: mocks.enqueueVerifyJob
    }));
    jest.doMock("../../src/pdf-pipeline/pdfParser", () => ({
      parsePdfWithPositions: mocks.parsePdfWithPositions
    }));
    jest.doMock("../../src/pdf-pipeline/pdfDiffer", () => ({
      diffTokenStreams: mocks.diffTokenStreams
    }));
    jest.doMock("../../src/pdf-pipeline/pdfVisualDiff", () => ({
      comparePdfVisualLayers: mocks.comparePdfVisualLayers
    }));
    jest.doMock("../../src/pdf-pipeline/tamperMapper", () => ({
      mapChangedWordsToRectangles: mocks.mapChangedWordsToRectangles
    }));
    jest.doMock("../../src/modules/verification/ocr.service", () => ({
      extractOcrLayer: mocks.extractOcrLayer,
      compareOcrLayers: mocks.compareOcrLayers
    }));
    jest.doMock("../../src/modules/audit-ledger/auditLedger.service", () => ({
      appendAuditEntry: mocks.appendAuditEntry
    }));
    jest.doMock("../../src/modules/trust-score/trustScore.service", () => ({
      recomputeTrustScore: mocks.recomputeTrustScore
    }));
    jest.doMock("../../src/modules/issuance/issuance.service", () => ({
      buildIssuanceHashes: mocks.buildIssuanceHashes,
      buildSignaturePayload: mocks.buildSignaturePayload
    }));
    jest.doMock("../../src/crypto/documentSigner", () => ({
      verifyPayload: mocks.verifyPayload
    }));

    const service = require("../../src/modules/verification/verification.service");

    return { service, mocks };
  }

  function buildRequest(body = {}) {
    return {
      validated: { body },
      body,
      auth: { userId: "verifier-1" },
      ip: "127.0.0.1",
      headers: { "user-agent": "jest" },
      file: {
        originalname: "candidate.pdf",
        mimetype: "application/pdf",
        size: 128,
        buffer: Buffer.from("candidate-pdf")
      }
    };
  }

  it("returns not_found when target document does not exist", async () => {
    const { service, mocks } = loadService({
      document: null,
      parsedPdf: {
        pageCount: 1,
        metadata: {},
        textPositions: [],
        pageText: [],
        fullText: ""
      },
      buildHashes: {
        metadataHash: "meta",
        canonicalContentHash: "canon"
      }
    });

    const result = await service.verifyUploadedFile(
      buildRequest({ documentId: "doc-missing" })
    );

    expect(result.result.status).toBe("not_found");
    expect(result.result.reasonCode).toBe("DOCUMENT_NOT_FOUND");
    expect(mocks.verificationAttemptModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "upload",
        resultStatus: "not_found"
      })
    );
  });

  it("returns tampered when text differences are detected", async () => {
    const documentId = "doc-1";
    const fingerprint = crypto.createHash("sha256").update("issuer-public-key-pem").digest("hex");
    const { service, mocks } = loadService({
      document: {
        documentId,
        tenantId: "tenant-1",
        status: "issued",
        issuerUserId: "issuer-1",
        issuerInstitutionName: "Issuer One",
        verificationToken: "token-1",
        canonicalContentHash: "canon-1",
        metadataHash: "meta-1",
        signingKeyFingerprint: fingerprint,
        signatureId: "sig-1",
        signatureValue: "signed-value",
        pageCount: 1,
        title: "Degree",
        documentType: "certificate",
        recipientName: "Ava",
        recipientReference: "R-1",
        expiresAt: null,
        customMetadata: {},
        issuedAt: new Date("2026-01-01T00:00:00.000Z"),
        fileBinaryHash: "source-hash",
        textPositions: [
          {
            pageNumber: 1,
            words: [
              { text: "hello", normalizedText: "hello", x: 10, y: 10, width: 20, height: 10, readingOrderIndex: 0 },
              { text: "world", normalizedText: "world", x: 40, y: 10, width: 20, height: 10, readingOrderIndex: 1 }
            ]
          }
        ],
        qrPayload: {
          documentId,
          tenantId: "tenant-1",
          signatureId: "sig-1",
          contentHash: "canon-1",
          verificationToken: "token-1",
          issuedAt: new Date("2026-01-01T00:00:00.000Z"),
          qrSignature: "qr-signature"
        }
      },
      parsedPdf: {
        pageCount: 1,
        metadata: { info: {} },
        textPositions: [
          {
            pageNumber: 1,
            words: [
              { text: "hello", normalizedText: "hello", x: 10, y: 10, width: 20, height: 10, readingOrderIndex: 0 },
              { text: "tampered", normalizedText: "tampered", x: 40, y: 10, width: 30, height: 10, readingOrderIndex: 1 }
            ]
          }
        ],
        pageText: [{ pageNumber: 1, text: "hello tampered" }],
        fullText: "hello tampered"
      },
      buildHashes: {
        metadataHash: "meta-1",
        canonicalContentHash: "canon-1"
      }
    });

    const result = await service.verifyUploadedFile(
      buildRequest({ documentId })
    );

    expect(result.result.status).toBe("tampered");
    expect(result.result.reasonCode).toBe("TEXT_DIFF_DETECTED");
    expect(result.result.tamperFindings).toEqual(
      expect.objectContaining({
        changedWordCount: expect.any(Number),
        changedPages: [1]
      })
    );
    expect(mocks.appendAuditEntry).toHaveBeenCalled();
    expect(mocks.recomputeTrustScore).toHaveBeenCalled();
    expect(mocks.documentModel.updateOne).toHaveBeenCalledWith(
      { documentId },
      expect.objectContaining({
        $set: expect.objectContaining({ latestVerificationStatus: "tampered" })
      })
    );
  });

  it("returns verified for matching upload and valid qr payload", async () => {
    const documentId = "doc-2";
    const fingerprint = crypto.createHash("sha256").update("issuer-public-key-pem").digest("hex");
    const { service } = loadService({
      document: {
        documentId,
        tenantId: "tenant-1",
        status: "issued",
        issuerUserId: "issuer-1",
        issuerInstitutionName: "Issuer One",
        verificationToken: "token-2",
        canonicalContentHash: "canon-2",
        metadataHash: "meta-2",
        signingKeyFingerprint: fingerprint,
        signatureId: "sig-2",
        signatureValue: "signed-value",
        pageCount: 1,
        title: "Certificate",
        documentType: "certificate",
        recipientName: "Ava",
        recipientReference: null,
        expiresAt: null,
        customMetadata: {},
        issuedAt: new Date("2026-01-01T00:00:00.000Z"),
        fileBinaryHash: "source-hash",
        textPositions: [
          {
            pageNumber: 1,
            words: [{ text: "hello", normalizedText: "hello", x: 12, y: 12, width: 20, height: 10, readingOrderIndex: 0 }]
          }
        ],
        qrPayload: {
          documentId,
          tenantId: "tenant-1",
          signatureId: "sig-2",
          contentHash: "canon-2",
          verificationToken: "token-2",
          issuedAt: new Date("2026-01-01T00:00:00.000Z"),
          qrSignature: "qr-signature"
        }
      },
      parsedPdf: {
        pageCount: 1,
        metadata: { info: {} },
        textPositions: [
          {
            pageNumber: 1,
            words: [{ text: "hello", normalizedText: "hello", x: 12, y: 12, width: 20, height: 10, readingOrderIndex: 0 }]
          }
        ],
        pageText: [{ pageNumber: 1, text: "hello" }],
        fullText: "hello"
      },
      buildHashes: {
        metadataHash: "meta-2",
        canonicalContentHash: "canon-2"
      }
    });

    const result = await service.verifyUploadedFile(
      buildRequest({
        documentId,
        qrPayload: {
          documentId,
          tenantId: "tenant-1",
          signatureId: "sig-2",
          contentHash: "canon-2",
          verificationToken: "token-2",
          issuedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
          qrSignature: "qr-signature"
        }
      })
    );

    expect(result.result.status).toBe("verified");
    expect(result.result.reasonCode).toBe("VERIFIED");
    expect(result.result.tamperFindings).toBeNull();
  });

  it("returns verified_non_textual_variation when only hash mismatch is detected", async () => {
    const documentId = "doc-non-text";
    const fingerprint = crypto.createHash("sha256").update("issuer-public-key-pem").digest("hex");
    const { service } = loadService({
      document: {
        documentId,
        tenantId: "tenant-1",
        status: "issued",
        issuerUserId: "issuer-1",
        issuerInstitutionName: "Issuer One",
        verificationToken: "token-non-text",
        canonicalContentHash: "canon-source",
        metadataHash: "meta-source",
        signingKeyFingerprint: fingerprint,
        signatureId: "sig-non-text",
        signatureValue: "signed-value",
        pageCount: 1,
        title: "Certificate",
        documentType: "certificate",
        recipientName: "Ava",
        recipientReference: null,
        expiresAt: null,
        customMetadata: {},
        issuedAt: new Date("2026-01-01T00:00:00.000Z"),
        fileBinaryHash: "source-hash",
        textPositions: [
          {
            pageNumber: 1,
            words: [{ text: "hello", normalizedText: "hello", x: 12, y: 12, width: 20, height: 10, readingOrderIndex: 0 }]
          }
        ],
        qrPayload: {
          documentId,
          tenantId: "tenant-1",
          signatureId: "sig-non-text",
          contentHash: "canon-source",
          verificationToken: "token-non-text",
          issuedAt: new Date("2026-01-01T00:00:00.000Z"),
          qrSignature: "qr-signature"
        }
      },
      parsedPdf: {
        pageCount: 1,
        metadata: { info: { producer: "different" } },
        textPositions: [
          {
            pageNumber: 1,
            words: [{ text: "hello", normalizedText: "hello", x: 12, y: 12, width: 20, height: 10, readingOrderIndex: 0 }]
          }
        ],
        pageText: [{ pageNumber: 1, text: "hello" }],
        fullText: "hello"
      },
      buildHashes: {
        metadataHash: "meta-variant",
        canonicalContentHash: "canon-variant"
      }
    });

    const result = await service.verifyUploadedFile(
      buildRequest({ documentId })
    );

    expect(result.result.status).toBe("verified");
    expect(result.result.reasonCode).toBe("VERIFIED_NON_TEXTUAL_VARIATION");
    expect(result.result.tamperFindings).toBeNull();
  });

  it("returns verified when uploaded file matches issued binary baseline", async () => {
    const documentId = "doc-issued-binary-match";
    const fingerprint = crypto.createHash("sha256").update("issuer-public-key-pem").digest("hex");
    const { service } = loadService({
      document: {
        documentId,
        tenantId: "tenant-1",
        status: "issued",
        issuerUserId: "issuer-1",
        issuerInstitutionName: "Issuer One",
        verificationToken: "token-issued-binary-match",
        canonicalContentHash: "canon-source",
        metadataHash: "meta-source",
        signingKeyFingerprint: fingerprint,
        signatureId: "sig-issued-binary-match",
        signatureValue: "signed-value",
        pageCount: 1,
        title: "Certificate",
        documentType: "certificate",
        recipientName: "Ava",
        recipientReference: null,
        expiresAt: null,
        customMetadata: {},
        issuedAt: new Date("2026-01-01T00:00:00.000Z"),
        fileBinaryHash: "source-hash",
        ocrBaseline: {
          enabled: true,
          fileHash: crypto.createHash("sha256").update("candidate-pdf").digest("hex"),
          fullText: "hello",
          pages: [{ pageNumber: 1, text: "hello", confidence: 0.92 }],
          averageConfidence: 0.92,
          pageCount: 1
        },
        textPositions: [
          {
            pageNumber: 1,
            words: [{ text: "hello", normalizedText: "hello", x: 12, y: 12, width: 20, height: 10, readingOrderIndex: 0 }]
          }
        ],
        qrPayload: {
          documentId,
          tenantId: "tenant-1",
          signatureId: "sig-issued-binary-match",
          contentHash: "canon-source",
          verificationToken: "token-issued-binary-match",
          issuedAt: new Date("2026-01-01T00:00:00.000Z"),
          qrSignature: "qr-signature"
        }
      },
      parsedPdf: {
        pageCount: 1,
        metadata: { info: {} },
        textPositions: [
          {
            pageNumber: 1,
            words: [{ text: "changed", normalizedText: "changed", x: 12, y: 12, width: 24, height: 10, readingOrderIndex: 0 }]
          }
        ],
        pageText: [{ pageNumber: 1, text: "changed" }],
        fullText: "changed"
      },
      buildHashes: {
        metadataHash: "meta-variant",
        canonicalContentHash: "canon-variant"
      },
      ocrComparison: {
        changedWordCount: 4,
        changedPages: [1],
        confidence: 0.91,
        available: true
      },
      visualComparison: {
        visualDiffScoreByPage: [{ pageNumber: 1, score: 0.37 }],
        changedPages: [1],
        visualLayerChanged: true
      }
    });

    const result = await service.verifyUploadedFile(buildRequest({ documentId }));

    expect(result.result.status).toBe("verified");
    expect(result.result.reasonCode).toBe("VERIFIED_ISSUED_BINARY_MATCH");
    expect(result.result.tamperFindings).toBeNull();
  });

  it("returns verified when uploaded file matches original source binary baseline", async () => {
    const documentId = "doc-source-binary-match";
    const fingerprint = crypto.createHash("sha256").update("issuer-public-key-pem").digest("hex");
    const { service } = loadService({
      document: {
        documentId,
        tenantId: "tenant-1",
        status: "issued",
        issuerUserId: "issuer-1",
        issuerInstitutionName: "Issuer One",
        verificationToken: "token-source-binary-match",
        canonicalContentHash: "canon-source",
        metadataHash: "meta-source",
        signingKeyFingerprint: fingerprint,
        signatureId: "sig-source-binary-match",
        signatureValue: "signed-value",
        pageCount: 1,
        title: "Certificate",
        documentType: "certificate",
        recipientName: "Ava",
        recipientReference: null,
        expiresAt: null,
        customMetadata: {},
        issuedAt: new Date("2026-01-01T00:00:00.000Z"),
        fileBinaryHash: crypto.createHash("sha256").update("candidate-pdf").digest("hex"),
        ocrBaseline: {
          enabled: true,
          fileHash: "issued-hash-different-from-source",
          fullText: "hello",
          pages: [{ pageNumber: 1, text: "hello", confidence: 0.92 }],
          averageConfidence: 0.92,
          pageCount: 1
        },
        textPositions: [
          {
            pageNumber: 1,
            words: [{ text: "hello", normalizedText: "hello", x: 12, y: 12, width: 20, height: 10, readingOrderIndex: 0 }]
          }
        ],
        qrPayload: {
          documentId,
          tenantId: "tenant-1",
          signatureId: "sig-source-binary-match",
          contentHash: "canon-source",
          verificationToken: "token-source-binary-match",
          issuedAt: new Date("2026-01-01T00:00:00.000Z"),
          qrSignature: "qr-signature"
        }
      },
      parsedPdf: {
        pageCount: 1,
        metadata: { info: {} },
        textPositions: [
          {
            pageNumber: 1,
            words: [{ text: "changed", normalizedText: "changed", x: 12, y: 12, width: 24, height: 10, readingOrderIndex: 0 }]
          }
        ],
        pageText: [{ pageNumber: 1, text: "changed" }],
        fullText: "changed"
      },
      buildHashes: {
        metadataHash: "meta-variant",
        canonicalContentHash: "canon-variant"
      },
      ocrComparison: {
        changedWordCount: 4,
        changedPages: [1],
        confidence: 0.91,
        available: true
      },
      visualComparison: {
        visualDiffScoreByPage: [{ pageNumber: 1, score: 0.37 }],
        changedPages: [1],
        visualLayerChanged: true
      }
    });

    const result = await service.verifyUploadedFile(buildRequest({ documentId }));

    expect(result.result.status).toBe("verified");
    expect(result.result.reasonCode).toBe("VERIFIED_SOURCE_BINARY_MATCH");
    expect(result.result.tamperFindings).toBeNull();
  });

  it("returns tampered when OCR layer differs even if text layer matches", async () => {
    const documentId = "doc-ocr-diff";
    const fingerprint = crypto.createHash("sha256").update("issuer-public-key-pem").digest("hex");
    const { service } = loadService({
      document: {
        documentId,
        tenantId: "tenant-1",
        status: "issued",
        issuerUserId: "issuer-1",
        issuerInstitutionName: "Issuer One",
        verificationToken: "token-ocr-diff",
        canonicalContentHash: "canon-ocr-diff",
        metadataHash: "meta-ocr-diff",
        signingKeyFingerprint: fingerprint,
        signatureId: "sig-ocr-diff",
        signatureValue: "signed-value",
        pageCount: 1,
        title: "Certificate",
        documentType: "certificate",
        recipientName: "Ava",
        recipientReference: null,
        expiresAt: null,
        customMetadata: {},
        issuedAt: new Date("2026-01-01T00:00:00.000Z"),
        fileBinaryHash: "source-hash",
        textPositions: [
          {
            pageNumber: 1,
            words: [{ text: "hello", normalizedText: "hello", x: 12, y: 12, width: 20, height: 10, readingOrderIndex: 0 }]
          }
        ],
        qrPayload: {
          documentId,
          tenantId: "tenant-1",
          signatureId: "sig-ocr-diff",
          contentHash: "canon-ocr-diff",
          verificationToken: "token-ocr-diff",
          issuedAt: new Date("2026-01-01T00:00:00.000Z"),
          qrSignature: "qr-signature"
        }
      },
      parsedPdf: {
        pageCount: 1,
        metadata: { info: {} },
        textPositions: [
          {
            pageNumber: 1,
            words: [{ text: "hello", normalizedText: "hello", x: 12, y: 12, width: 20, height: 10, readingOrderIndex: 0 }]
          }
        ],
        pageText: [{ pageNumber: 1, text: "hello" }],
        fullText: "hello"
      },
      buildHashes: {
        metadataHash: "meta-ocr-diff",
        canonicalContentHash: "canon-ocr-diff"
      },
      ocrComparison: {
        changedWordCount: 6,
        changedPages: [1],
        confidence: 0.89,
        available: true
      }
    });

    const result = await service.verifyUploadedFile(buildRequest({ documentId }));

    expect(result.result.status).toBe("tampered");
    expect(result.result.reasonCode).toBe("OCR_DIFF_DETECTED");
    expect(result.result.detectors).toEqual(
      expect.objectContaining({
        textLayerChanged: false,
        ocrLayerChanged: true,
        visualLayerChanged: false
      })
    );
  });

  it("returns tampered when visual diff exceeds threshold", async () => {
    const documentId = "doc-visual-diff";
    const fingerprint = crypto.createHash("sha256").update("issuer-public-key-pem").digest("hex");
    const { service } = loadService({
      document: {
        documentId,
        tenantId: "tenant-1",
        status: "issued",
        issuerUserId: "issuer-1",
        issuerInstitutionName: "Issuer One",
        verificationToken: "token-visual-diff",
        canonicalContentHash: "canon-visual-diff",
        metadataHash: "meta-visual-diff",
        signingKeyFingerprint: fingerprint,
        signatureId: "sig-visual-diff",
        signatureValue: "signed-value",
        pageCount: 1,
        title: "Certificate",
        documentType: "certificate",
        recipientName: "Ava",
        recipientReference: null,
        expiresAt: null,
        customMetadata: {},
        issuedAt: new Date("2026-01-01T00:00:00.000Z"),
        fileBinaryHash: "source-hash",
        issuedPdfStorage: {
          path: "storage/documents/tenant-1/doc-visual-diff/issued.pdf",
          storageType: "local_fs"
        },
        textPositions: [
          {
            pageNumber: 1,
            words: [{ text: "hello", normalizedText: "hello", x: 12, y: 12, width: 20, height: 10, readingOrderIndex: 0 }]
          }
        ],
        qrPayload: {
          documentId,
          tenantId: "tenant-1",
          signatureId: "sig-visual-diff",
          contentHash: "canon-visual-diff",
          verificationToken: "token-visual-diff",
          issuedAt: new Date("2026-01-01T00:00:00.000Z"),
          qrSignature: "qr-signature"
        }
      },
      parsedPdf: {
        pageCount: 1,
        metadata: { info: {} },
        textPositions: [
          {
            pageNumber: 1,
            words: [{ text: "hello", normalizedText: "hello", x: 12, y: 12, width: 20, height: 10, readingOrderIndex: 0 }]
          }
        ],
        pageText: [{ pageNumber: 1, text: "hello" }],
        fullText: "hello"
      },
      buildHashes: {
        metadataHash: "meta-visual-diff",
        canonicalContentHash: "canon-visual-diff"
      },
      visualComparison: {
        visualDiffScoreByPage: [{ pageNumber: 1, score: 0.41 }],
        changedPages: [1],
        visualLayerChanged: true
      }
    });

    const result = await service.verifyUploadedFile(buildRequest({ documentId }));

    expect(result.result.status).toBe("tampered");
    expect(result.result.reasonCode).toBe("VISUAL_DIFF_DETECTED");
    expect(result.result.visualDiffScoreByPage).toEqual([{ pageNumber: 1, score: 0.41 }]);
    expect(result.result.detectors.visualLayerChanged).toBe(true);
  });

  it("returns suspicious when binary hash mismatches and visual baseline is unavailable", async () => {
    const documentId = "doc-visual-baseline-missing";
    const fingerprint = crypto.createHash("sha256").update("issuer-public-key-pem").digest("hex");
    const { service } = loadService({
      document: {
        documentId,
        tenantId: "tenant-1",
        status: "issued",
        issuerUserId: "issuer-1",
        issuerInstitutionName: "Issuer One",
        verificationToken: "token-visual-baseline-missing",
        canonicalContentHash: "canon-visual-baseline-missing",
        metadataHash: "meta-visual-baseline-missing",
        signingKeyFingerprint: fingerprint,
        signatureId: "sig-visual-baseline-missing",
        signatureValue: "signed-value",
        pageCount: 1,
        title: "Certificate",
        documentType: "certificate",
        recipientName: "Ava",
        recipientReference: null,
        expiresAt: null,
        customMetadata: {},
        issuedAt: new Date("2026-01-01T00:00:00.000Z"),
        fileBinaryHash: "source-hash",
        ocrBaseline: {
          enabled: true,
          fileHash: "issued-baseline-hash",
          fullText: "hello",
          pages: [{ pageNumber: 1, text: "hello", confidence: 0.92 }],
          averageConfidence: 0.92,
          pageCount: 1
        },
        textPositions: [
          {
            pageNumber: 1,
            words: [{ text: "hello", normalizedText: "hello", x: 12, y: 12, width: 20, height: 10, readingOrderIndex: 0 }]
          }
        ],
        qrPayload: {
          documentId,
          tenantId: "tenant-1",
          signatureId: "sig-visual-baseline-missing",
          contentHash: "canon-visual-baseline-missing",
          verificationToken: "token-visual-baseline-missing",
          issuedAt: new Date("2026-01-01T00:00:00.000Z"),
          qrSignature: "qr-signature"
        }
      },
      parsedPdf: {
        pageCount: 1,
        metadata: { info: {} },
        textPositions: [
          {
            pageNumber: 1,
            words: [{ text: "hello", normalizedText: "hello", x: 12, y: 12, width: 20, height: 10, readingOrderIndex: 0 }]
          }
        ],
        pageText: [{ pageNumber: 1, text: "hello" }],
        fullText: "hello"
      },
      buildHashes: {
        metadataHash: "meta-visual-baseline-missing",
        canonicalContentHash: "canon-visual-baseline-missing"
      },
      issuedPdfReadError: new Error("ENOENT: no such file or directory")
    });

    const result = await service.verifyUploadedFile(buildRequest({ documentId }));

    expect(result.result.status).toBe("suspicious");
    expect(result.result.reasonCode).toBe("BINARY_HASH_MISMATCH_WITHOUT_VISUAL_BASELINE");
  });

  it("returns pending when async mode is requested", async () => {
    const documentId = "doc-async";
    const fingerprint = crypto.createHash("sha256").update("issuer-public-key-pem").digest("hex");
    const { service, mocks } = loadService({
      document: {
        documentId,
        tenantId: "tenant-1",
        status: "issued",
        issuerUserId: "issuer-1",
        issuerInstitutionName: "Issuer One",
        verificationToken: "token-async",
        canonicalContentHash: "canon-async",
        metadataHash: "meta-async",
        signingKeyFingerprint: fingerprint,
        signatureId: "sig-async",
        signatureValue: "signed-value",
        pageCount: 1,
        title: "Certificate",
        documentType: "certificate",
        recipientName: "Ava",
        recipientReference: null,
        expiresAt: null,
        customMetadata: {},
        issuedAt: new Date("2026-01-01T00:00:00.000Z"),
        fileBinaryHash: "source-hash",
        textPositions: [
          {
            pageNumber: 1,
            words: [{ text: "hello", normalizedText: "hello", x: 12, y: 12, width: 20, height: 10, readingOrderIndex: 0 }]
          }
        ],
        qrPayload: {
          documentId,
          tenantId: "tenant-1",
          signatureId: "sig-async",
          contentHash: "canon-async",
          verificationToken: "token-async",
          issuedAt: new Date("2026-01-01T00:00:00.000Z"),
          qrSignature: "qr-signature"
        }
      },
      parsedPdf: {
        pageCount: 1,
        metadata: { info: {} },
        textPositions: [
          {
            pageNumber: 1,
            words: [{ text: "hello", normalizedText: "hello", x: 12, y: 12, width: 20, height: 10, readingOrderIndex: 0 }]
          }
        ],
        pageText: [{ pageNumber: 1, text: "hello" }],
        fullText: "hello"
      },
      buildHashes: {
        metadataHash: "meta-async",
        canonicalContentHash: "canon-async"
      }
    });

    const result = await service.verifyUploadedFile(
      buildRequest({ documentId, async: true })
    );

    expect(result.status).toBe("pending");
    expect(result.reasonCode).toBe("VERIFICATION_JOB_PENDING");
    expect(result.jobId).toMatch(/^verify_/);
    expect(mocks.setVerifyJobIfAbsent).toHaveBeenCalled();
    expect(mocks.setVerifyJobPayload).toHaveBeenCalled();
    expect(mocks.enqueueVerifyJob).toHaveBeenCalled();
  });
});
