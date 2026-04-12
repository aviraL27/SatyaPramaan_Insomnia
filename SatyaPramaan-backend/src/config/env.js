const dotenv = require("dotenv");
const { z } = require("zod");

dotenv.config();

const booleanEnv = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }

    if (["0", "false", "no", "off", ""].includes(normalized)) {
      return false;
    }
  }

  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1),
  REDIS_URL: z.string().min(1),
  APP_BASE_URL: z.string().url(),
  CORS_ORIGIN: z.string().min(1),
  FIREBASE_PROJECT_ID: z.string().optional().default(""),
  FIREBASE_CLIENT_EMAIL: z.string().optional().default(""),
  FIREBASE_PRIVATE_KEY: z.string().optional().default(""),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional().default(""),
  PRIVATE_KEY_MASTER_KEY_BASE64: z.string().optional().default(""),
  PRIVATE_KEY_MASTER_KEY_VERSION: z.coerce.number().int().positive().default(1),
  BLOCKCHAIN_RPC_URL: z.string().optional().default(""),
  BLOCKCHAIN_PRIVATE_KEY: z.string().optional().default(""),
  BLOCKCHAIN_ANCHOR_RECIPIENT: z.string().optional().default(""),
  BLOCKCHAIN_EXPLORER_TX_BASE_URL: z.string().optional().default(""),
  DEFAULT_RSA_MODULUS_LENGTH: z.coerce.number().int().positive().default(3072),
  PUBLIC_UPLOAD_MAX_MB: z.coerce.number().int().positive().default(20),
  PUBLIC_UPLOAD_MAX_PAGES: z.coerce.number().int().positive().default(100),
  SYNC_VERIFICATION_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  VERIFY_QUEUE_BLOCK_TIMEOUT_SEC: z.coerce.number().int().positive().default(5),
  OCR_ENABLED: booleanEnv.default(true),
  OCR_LANG: z.string().min(1).default("eng"),
  OCR_ENGINE: z.enum(["auto", "tesseract", "text_layer_fallback"]).default("auto"),
  OCR_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
  OCR_RENDER_SCALE: z.coerce.number().positive().default(2),
  OCR_MAX_PAGES: z.coerce.number().int().positive().default(60),
  VISUAL_DIFF_ENABLED: booleanEnv.default(true),
  VISUAL_DIFF_THRESHOLD: z.coerce.number().min(0).max(1).default(0.08),
  VISUAL_DIFF_MIN_CHANGED_OPS: z.coerce.number().int().nonnegative().default(30),
  VISUAL_DIFF_MIN_CHANGED_SENSITIVE_OPS: z.coerce.number().int().nonnegative().default(8),
  VISUAL_RENDER_SCALE: z.coerce.number().positive().default(1.5),
  VISUAL_DIFF_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
  LOG_LEVEL: z.string().default("debug")
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

module.exports = { env };
