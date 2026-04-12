const { connectDb } = require("../config/db");
const { connectRedis } = require("../config/redis");
const auditLedgerService = require("../modules/audit-ledger/auditLedger.service");

async function run() {
  await connectDb();
  await connectRedis();

  const result = await auditLedgerService.verifyChain();
  console.log("Ledger verification result", result);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
