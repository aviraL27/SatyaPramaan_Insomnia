const { createApp } = require("./app");
const { connectDb } = require("./config/db");
const { connectRedis } = require("./config/redis");
const { env } = require("./config/env");

async function startServer() {
  await connectDb();
  await connectRedis();

  const app = createApp();
  app.listen(env.PORT, () => {
    console.log(`DigiSecure backend listening on port ${env.PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start DigiSecure backend", error);
  process.exit(1);
});
