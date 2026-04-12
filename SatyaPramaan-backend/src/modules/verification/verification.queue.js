const { setVerifyJob } = require("../../cache/verifyJobCache");

async function enqueueHeavyVerification(job) {
  await setVerifyJob(job.jobId, {
    ...job,
    status: "pending",
    queuedAt: new Date().toISOString()
  });
}

module.exports = { enqueueHeavyVerification };
