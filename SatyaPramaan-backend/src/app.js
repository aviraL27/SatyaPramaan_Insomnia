const cors = require("cors");
const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");
const { env } = require("./config/env");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");
const authRoutes = require("./modules/auth/auth.routes");
const usersRoutes = require("./modules/users/users.routes");
const institutionsRoutes = require("./modules/institutions/institutions.routes");
const documentsRoutes = require("./modules/documents/documents.routes");
const issuanceRoutes = require("./modules/issuance/issuance.routes");
const verificationRoutes = require("./modules/verification/verification.routes");
const trustScoreRoutes = require("./modules/trust-score/trustScore.routes");
const auditLedgerRoutes = require("./modules/audit-ledger/auditLedger.routes");
const adminRoutes = require("./modules/admin/admin.routes");

function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(",").map((item) => item.trim()), credentials: true }));
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

  app.get("/health", (req, res) => {
    res.json({
      ok: true,
      service: "digisecure-backend",
      env: env.NODE_ENV
    });
  });

  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/users", usersRoutes);
  app.use("/api/v1/institutions", institutionsRoutes);
  app.use("/api/v1/documents", issuanceRoutes);
  app.use("/api/v1/documents", documentsRoutes);
  app.use("/api/v1", verificationRoutes);
  app.use("/api/v1", trustScoreRoutes);
  app.use("/api/v1", auditLedgerRoutes);
  app.use("/api/v1/admin", adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
