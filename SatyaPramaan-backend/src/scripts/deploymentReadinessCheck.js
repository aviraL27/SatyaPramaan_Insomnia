const { env } = require("../config/env");
const { connectDb, mongoose } = require("../config/db");
const { connectRedis, redis } = require("../config/redis");

function checkBase64Secret(value, minBytes = 32) {
  try {
    const decoded = Buffer.from(value, "base64");
    return decoded.length >= minBytes;
  } catch (error) {
    return false;
  }
}

function runStaticChecks() {
  const checks = [];

  checks.push({
    name: "APP_BASE_URL should not target localhost in production",
    ok: env.NODE_ENV !== "production" || !String(env.APP_BASE_URL).includes("localhost")
  });

  checks.push({
    name: "CORS_ORIGIN should not target localhost in production",
    ok: env.NODE_ENV !== "production" || !String(env.CORS_ORIGIN).includes("localhost")
  });

  checks.push({
    name: "PRIVATE_KEY_MASTER_KEY_BASE64 must be a valid >=32-byte base64 key",
    ok: checkBase64Secret(env.PRIVATE_KEY_MASTER_KEY_BASE64)
  });

  checks.push({
    name: "VERIFY_QUEUE_BLOCK_TIMEOUT_SEC should be >= 1",
    ok: Number(env.VERIFY_QUEUE_BLOCK_TIMEOUT_SEC) >= 1
  });

  checks.push({
    name: "OCR_TIMEOUT_MS should be >= 1000",
    ok: Number(env.OCR_TIMEOUT_MS) >= 1000
  });

  checks.push({
    name: "OCR_RENDER_SCALE should be >= 1",
    ok: Number(env.OCR_RENDER_SCALE) >= 1
  });

  checks.push({
    name: "OCR_MAX_PAGES should be >= 1",
    ok: Number(env.OCR_MAX_PAGES) >= 1
  });

  checks.push({
    name: "VISUAL_DIFF_THRESHOLD should be between 0 and 1",
    ok: Number(env.VISUAL_DIFF_THRESHOLD) >= 0 && Number(env.VISUAL_DIFF_THRESHOLD) <= 1
  });

  checks.push({
    name: "VISUAL_DIFF_MIN_CHANGED_OPS should be >= 0",
    ok: Number(env.VISUAL_DIFF_MIN_CHANGED_OPS) >= 0
  });

  checks.push({
    name: "VISUAL_DIFF_MIN_CHANGED_SENSITIVE_OPS should be >= 0",
    ok: Number(env.VISUAL_DIFF_MIN_CHANGED_SENSITIVE_OPS) >= 0
  });

  return checks;
}

async function runConnectivityChecks() {
  const checks = [];

  try {
    await connectDb();
    checks.push({ name: "MongoDB connection", ok: true });
  } catch (error) {
    checks.push({ name: "MongoDB connection", ok: false, details: error.message });
  }

  try {
    await connectRedis();
    await redis.ping();
    checks.push({ name: "Redis connection", ok: true });
  } catch (error) {
    checks.push({ name: "Redis connection", ok: false, details: error.message });
  }

  return checks;
}

function printChecks(checks) {
  for (const check of checks) {
    const status = check.ok ? "PASS" : "FAIL";
    const details = check.details ? ` (${check.details})` : "";
    console.log(`[${status}] ${check.name}${details}`);
  }
}

async function cleanupConnections() {
  if (redis.status === "ready" || redis.status === "connecting") {
    await redis.quit();
  }

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

async function run() {
  const staticChecks = runStaticChecks();
  const connectivityChecks = await runConnectivityChecks();
  const allChecks = [...staticChecks, ...connectivityChecks];

  printChecks(allChecks);

  await cleanupConnections();

  const failed = allChecks.filter((item) => !item.ok);

  if (failed.length > 0) {
    process.exit(1);
  }

  console.log("Deployment readiness checks passed.");
}

run().catch(async (error) => {
  console.error("Deployment readiness checks failed", error);
  await cleanupConnections();
  process.exit(1);
});
