const { connectDb, mongoose } = require("../config/db");
const Document = require("../models/Document.model");

const LEGACY_INDEX_NAME = "tenantId_1_issuerUserId_1_issuanceIdempotencyKey_1";

async function run() {
  await connectDb();

  try {
    await Document.collection.dropIndex(LEGACY_INDEX_NAME);
    console.log(`Dropped legacy index: ${LEGACY_INDEX_NAME}`);
  } catch (error) {
    if (error.codeName === "IndexNotFound") {
      console.log(`Legacy index not found: ${LEGACY_INDEX_NAME}`);
    } else {
      throw error;
    }
  }

  const result = await Document.collection.createIndex(
    { tenantId: 1, issuerUserId: 1, issuanceIdempotencyKey: 1 },
    {
      name: LEGACY_INDEX_NAME,
      unique: true,
      partialFilterExpression: {
        issuanceIdempotencyKey: {
          $exists: true,
          $type: "string"
        }
      }
    }
  );

  console.log(`Created index: ${result}`);
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error("Failed to migrate idempotency index", error);
  await mongoose.disconnect();
  process.exit(1);
});
