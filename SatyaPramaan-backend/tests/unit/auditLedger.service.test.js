const crypto = require("crypto");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function buildEntry({ sequenceNumber, tenantId, previousEntryHash, payload = {}, action = "TEST_EVENT" }) {
  const entry = {
    entryId: `entry-${sequenceNumber}-${tenantId}`,
    sequenceNumber,
    tenantId,
    action,
    documentId: null,
    actorId: `actor-${tenantId}`,
    actorType: "institution_user",
    timestamp: new Date(`2026-04-11T10:${String(sequenceNumber).padStart(2, "0")}:00.000Z`).toISOString(),
    payload,
    payloadHash: sha256(canonicalize(payload)),
    previousEntryHash,
    chainHeadAtWrite: previousEntryHash,
    integrityStatus: "valid"
  };

  entry.currentEntryHash = sha256(
    [
      entry.entryId,
      entry.sequenceNumber,
      entry.tenantId,
      entry.action,
      entry.documentId || "",
      entry.actorId,
      entry.actorType,
      new Date(entry.timestamp).toISOString(),
      entry.payloadHash,
      entry.previousEntryHash
    ].join("|")
  );

  return entry;
}

describe("auditLedger.service verifyChain tenant scope", () => {
  it("accepts valid tenant chain when global sequence is interleaved", async () => {
    jest.resetModules();

    const entry1 = buildEntry({ sequenceNumber: 1, tenantId: "tenant-a", previousEntryHash: "GENESIS", payload: { x: 1 } });
    const entry2 = buildEntry({ sequenceNumber: 2, tenantId: "tenant-b", previousEntryHash: entry1.currentEntryHash, payload: { x: 2 } });
    const entry3 = buildEntry({ sequenceNumber: 3, tenantId: "tenant-a", previousEntryHash: entry2.currentEntryHash, payload: { x: 3 } });

    const auditModel = {
      find: jest.fn((query) => {
        if (query?.tenantId === "tenant-a") {
          return {
            sort: () => ({
              lean: async () => [entry1, entry3]
            })
          };
        }

        if (query?.sequenceNumber?.$in) {
          return {
            select: () => ({
              lean: async () => [
                {
                  sequenceNumber: 2,
                  currentEntryHash: entry2.currentEntryHash
                }
              ]
            })
          };
        }

        return {
          sort: () => ({
            lean: async () => []
          })
        };
      })
    };

    jest.doMock("../../src/models/AuditLog.model", () => auditModel);
    jest.doMock("../../src/config/redis", () => ({
      redis: {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue("OK"),
        del: jest.fn().mockResolvedValue(1)
      }
    }));

    const service = require("../../src/modules/audit-ledger/auditLedger.service");
    const result = await service.verifyChain({ tenantId: "tenant-a" });

    expect(result.isValid).toBe(true);
    expect(result.checkedEntries).toBe(2);
  });
});
