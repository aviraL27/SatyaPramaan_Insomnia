const { connectDb } = require("../config/db");
const { connectRedis, redis } = require("../config/redis");
const { dequeueVerifyJob } = require("../cache/verifyJobCache");
const { processQueuedVerificationJob } = require("../modules/verification/verification.service");

const QUEUE_BLOCK_TIMEOUT_SECONDS = Number(process.env.VERIFY_QUEUE_BLOCK_TIMEOUT_SEC) > 0
  ? Number(process.env.VERIFY_QUEUE_BLOCK_TIMEOUT_SEC)
  : 5;

let shouldStop = false;

async function run() {
  await connectDb();
  await connectRedis();

  const queueClient = redis.duplicate();
  await queueClient.connect();

  const stopWorker = () => {
    shouldStop = true;
  };

  process.on("SIGINT", stopWorker);
  process.on("SIGTERM", stopWorker);

  console.log("Heavy verification worker started");

  while (!shouldStop) {
    const jobId = await dequeueVerifyJob({
      timeoutSeconds: QUEUE_BLOCK_TIMEOUT_SECONDS,
      client: queueClient
    });

    if (!jobId) {
      continue;
    }

    await processQueuedVerificationJob(jobId);
  }

  await queueClient.quit();
  await redis.quit();
  console.log("Heavy verification worker stopped");
}

run().catch((error) => {
  console.error("Heavy verification worker failed", error);
  process.exit(1);
});
