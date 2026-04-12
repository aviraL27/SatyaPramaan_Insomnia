const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const AuditLog = require("../../models/AuditLog.model");
const { redis } = require("../../config/redis");
const { cacheKeys, CACHE_TTLS } = require("../../cache/keys");
const { canonicalize } = require("../../pdf-pipeline/pdfCanonicalizer");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function buildCurrentEntryHash(entry) {
  return sha256(
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
}

async function getCurrentHead() {
  const cached = await redis.get(cacheKeys.auditHead());

  if (cached) {
    return JSON.parse(cached);
  }

  const lastEntry = await AuditLog.findOne().sort({ sequenceNumber: -1 }).lean();
  const head = lastEntry
    ? { sequenceNumber: lastEntry.sequenceNumber, currentEntryHash: lastEntry.currentEntryHash }
    : { sequenceNumber: 0, currentEntryHash: "GENESIS" };

  await redis.set(cacheKeys.auditHead(), JSON.stringify(head), "EX", CACHE_TTLS.auditHead);

  return head;
}

async function appendAuditEntry({ tenantId, action, documentId = null, actorId, actorType, payload }) {
  while (true) {
    const head = await getCurrentHead();
    const entry = {
      entryId: uuidv4(),
      sequenceNumber: head.sequenceNumber + 1,
      tenantId,
      action,
      documentId,
      actorId,
      actorType,
      timestamp: new Date(),
      payload,
      payloadHash: sha256(canonicalize(payload)),
      previousEntryHash: head.currentEntryHash,
      chainHeadAtWrite: head.currentEntryHash,
      integrityStatus: "valid"
    };

    entry.currentEntryHash = buildCurrentEntryHash(entry);

    try {
      const created = await AuditLog.create(entry);
      await redis.set(
        cacheKeys.auditHead(),
        JSON.stringify({ sequenceNumber: created.sequenceNumber, currentEntryHash: created.currentEntryHash }),
        "EX",
        CACHE_TTLS.auditHead
      );
      return created;
    } catch (error) {
      if (error?.code === 11000) {
        await redis.del(cacheKeys.auditHead());
        continue;
      }

      throw error;
    }
  }
}

async function verifyChain({ tenantId = null } = {}) {
  const query = tenantId ? { tenantId } : {};
  const entries = await AuditLog.find(query).sort({ sequenceNumber: 1 }).lean();

  if (tenantId) {
    const previousSequenceNumbers = entries
      .map((entry) => Number(entry.sequenceNumber) - 1)
      .filter((value) => Number.isFinite(value) && value >= 1);
    const previousEntries = previousSequenceNumbers.length
      ? await AuditLog.find({ sequenceNumber: { $in: previousSequenceNumbers } })
          .select({ _id: 0, sequenceNumber: 1, currentEntryHash: 1 })
          .lean()
      : [];
    const previousHashBySequence = new Map(
      previousEntries.map((entry) => [Number(entry.sequenceNumber), entry.currentEntryHash])
    );

    for (const entry of entries) {
      const expectedPayloadHash = sha256(canonicalize(entry.payload));
      const recomputedCurrentHash = buildCurrentEntryHash({
        ...entry,
        payloadHash: expectedPayloadHash
      });
      const expectedPreviousHash =
        Number(entry.sequenceNumber) <= 1
          ? "GENESIS"
          : previousHashBySequence.get(Number(entry.sequenceNumber) - 1) || null;

      if (
        expectedPayloadHash !== entry.payloadHash ||
        expectedPreviousHash !== entry.previousEntryHash ||
        recomputedCurrentHash !== entry.currentEntryHash
      ) {
        return {
          isValid: false,
          checkedEntries: entries.length,
          firstBrokenSequence: entry.sequenceNumber,
          expectedPreviousHash,
          actualPreviousHash: entry.previousEntryHash,
          recomputedCurrentHash
        };
      }
    }

    const tailHash = entries.length ? entries[entries.length - 1].currentEntryHash : "GENESIS";

    return {
      isValid: true,
      checkedEntries: entries.length,
      firstBrokenSequence: null,
      expectedPreviousHash: tailHash,
      actualPreviousHash: tailHash,
      recomputedCurrentHash: tailHash
    };
  }

  let previousHash = "GENESIS";

  for (const entry of entries) {
    const expectedPayloadHash = sha256(canonicalize(entry.payload));
    const recomputedCurrentHash = buildCurrentEntryHash({
      ...entry,
      payloadHash: expectedPayloadHash
    });

    if (
      expectedPayloadHash !== entry.payloadHash ||
      entry.previousEntryHash !== previousHash ||
      recomputedCurrentHash !== entry.currentEntryHash
    ) {
      return {
        isValid: false,
        checkedEntries: entries.length,
        firstBrokenSequence: entry.sequenceNumber,
        expectedPreviousHash: previousHash,
        actualPreviousHash: entry.previousEntryHash,
        recomputedCurrentHash
      };
    }

    previousHash = entry.currentEntryHash;
  }

  return {
    isValid: true,
    checkedEntries: entries.length,
    firstBrokenSequence: null,
    expectedPreviousHash: previousHash,
    actualPreviousHash: previousHash,
    recomputedCurrentHash: previousHash
  };
}

async function listAuditEntries(filter = {}, options = {}) {
  const limit = Math.min(Number(options.limit) || 20, 100);
  return AuditLog.find(filter).sort({ sequenceNumber: -1 }).limit(limit).lean();
}

async function getLatestAuditHead({ tenantId = null } = {}) {
  const query = tenantId ? { tenantId } : {};
  const latest = await AuditLog.findOne(query).sort({ sequenceNumber: -1 }).lean();

  if (!latest) {
    return null;
  }

  return {
    tenantId: latest.tenantId,
    sequenceNumber: latest.sequenceNumber,
    currentEntryHash: latest.currentEntryHash
  };
}

module.exports = {
  appendAuditEntry,
  verifyChain,
  listAuditEntries,
  getLatestAuditHead
};
