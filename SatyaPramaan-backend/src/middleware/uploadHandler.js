const multer = require("multer");
const { env } = require("../config/env");

const uploadHandler = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.PUBLIC_UPLOAD_MAX_MB * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDF uploads are allowed"));
    }

    return cb(null, true);
  }
});

module.exports = { uploadHandler };
