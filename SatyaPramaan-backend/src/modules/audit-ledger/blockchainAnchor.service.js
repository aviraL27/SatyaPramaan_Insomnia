const { v4: uuidv4 } = require("uuid");
const { ethers } = require("ethers");
const AuditAnchor = require("../../models/AuditAnchor.model");
const { env } = require("../../config/env");
const { AppError } = require("../../utils/AppError");

function isBlockchainConfigured() {
  return Boolean(env.BLOCKCHAIN_RPC_URL && env.BLOCKCHAIN_PRIVATE_KEY);
}

function buildAnchorPayload({ tenantId, sequenceNumber, anchoredHash, at }) {
  const payload = {
    type: "digisecure_audit_anchor_v1",
    tenantId,
    sequenceNumber,
    anchoredHash,
    anchoredAt: at
  };

  const payloadHex = Buffer.from(JSON.stringify(payload), "utf8").toString("hex");
  return { payload, payloadHex: `0x${payloadHex}` };
}

async function anchorAuditHead({ tenantId, sequenceNumber, anchoredHash, actorId }) {
  if (!isBlockchainConfigured()) {
    throw new AppError("Blockchain anchoring is not configured", 409);
  }

  const provider = new ethers.JsonRpcProvider(env.BLOCKCHAIN_RPC_URL);
  const signer = new ethers.Wallet(env.BLOCKCHAIN_PRIVATE_KEY, provider);
  const recipientAddress = env.BLOCKCHAIN_ANCHOR_RECIPIENT || signer.address;
  const anchoredAt = new Date().toISOString();
  const { payloadHex } = buildAnchorPayload({
    tenantId,
    sequenceNumber,
    anchoredHash,
    at: anchoredAt
  });

  let tx;

  try {
    tx = await signer.sendTransaction({
      to: recipientAddress,
      value: 0,
      data: payloadHex
    });
  } catch (error) {
    throw new AppError(error?.message || "Failed to send blockchain anchor transaction", 502);
  }

  let receipt;

  try {
    receipt = await tx.wait();
  } catch (error) {
    throw new AppError(error?.message || "Failed to confirm blockchain anchor transaction", 502);
  }

  const network = await provider.getNetwork();
  const chainId = String(network.chainId || "unknown");
  const txHash = tx.hash;
  const explorerBase = String(env.BLOCKCHAIN_EXPLORER_TX_BASE_URL || "").trim();
  const explorerUrl = explorerBase ? `${explorerBase.replace(/\/$/, "")}/${txHash}` : null;

  const created = await AuditAnchor.create({
    anchorId: uuidv4(),
    tenantId,
    sequenceNumber,
    anchoredHash,
    network: network.name || "unknown",
    chainId,
    recipientAddress,
    transactionHash: txHash,
    blockNumber: Number(receipt?.blockNumber || 0),
    actorId,
    payloadHex,
    explorerUrl
  });

  return created.toObject();
}

async function listAnchors({ tenantId = null, limit = 20 }) {
  const query = tenantId ? { tenantId } : {};
  const resolvedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  return AuditAnchor.find(query).sort({ createdAt: -1 }).limit(resolvedLimit).lean();
}

module.exports = {
  isBlockchainConfigured,
  anchorAuditHead,
  listAnchors
};
