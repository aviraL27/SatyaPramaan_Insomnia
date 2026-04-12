const { diffArrays } = require("diff");
const { env } = require("../../config/env");
const { normalizeText } = require("../../pdf-pipeline/pdfCanonicalizer");
const { parsePdfWithPositions } = require("../../pdf-pipeline/pdfParser");
const { getOcrExtraction, setOcrExtraction } = require("../../cache/ocrCache");

const DEFAULT_CONFIDENCE = 0.7;
let pdfJsLibPromise = null;
let canvasLib = null;
let tesseractLib = null;

async function getPdfJsLib() {
  if (!pdfJsLibPromise) {
    pdfJsLibPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }

  return pdfJsLibPromise;
}

function getCanvasLib() {
  if (!canvasLib) {
    canvasLib = require("@napi-rs/canvas");
  }

  return canvasLib;
}

function getTesseractLib() {
  if (!tesseractLib) {
    tesseractLib = require("tesseract.js");
  }

  return tesseractLib;
}

function runWithTimeout(promise, timeoutMs, timeoutMessage) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        const error = new Error(timeoutMessage || "OCR extraction timed out");
        error.code = "OCR_TIMEOUT";
        reject(error);
      }, timeoutMs);
    })
  ]);
}

function normalizePageText(parsedPdf = {}) {
  if (Array.isArray(parsedPdf.pageText) && parsedPdf.pageText.length) {
    return parsedPdf.pageText.map((page) => ({
      pageNumber: Number(page.pageNumber) || 1,
      text: normalizeText(page.text || "")
    }));
  }

  if (!Array.isArray(parsedPdf.textPositions)) {
    return [];
  }

  return parsedPdf.textPositions.map((page) => ({
    pageNumber: Number(page.pageNumber) || 1,
    text: normalizeText(
      (Array.isArray(page.words) ? page.words : [])
        .map((word) => word?.text || "")
        .join(" ")
    )
  }));
}

function normalizeConfidence(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_CONFIDENCE;
  }

  if (value > 1) {
    return Number((value / 100).toFixed(3));
  }

  return Number(value.toFixed(3));
}

function summarizeAverageConfidence(pages = []) {
  if (!pages.length) {
    return null;
  }

  const total = pages.reduce((sum, page) => sum + normalizeConfidence(page.confidence), 0);
  return Number((total / pages.length).toFixed(3));
}

function buildOcrResult({
  parsedPdf,
  pages,
  pageCount,
  language = env.OCR_LANG,
  engine = "text_layer_fallback",
  timedOut = false,
  error = null,
  warnings = []
}) {
  const normalizedPages = (Array.isArray(pages) ? pages : normalizePageText(parsedPdf)).map((page) => ({
    pageNumber: Number(page.pageNumber) || 1,
    text: normalizeText(page.text || ""),
    confidence: normalizeConfidence(page.confidence)
  }));

  const averageConfidence = summarizeAverageConfidence(normalizedPages);

  return {
    enabled: true,
    engine,
    language,
    timedOut,
    error,
    warnings,
    extractedAt: new Date().toISOString(),
    pageCount: Number(pageCount) || Number(parsedPdf?.pageCount) || normalizedPages.length,
    fullText: normalizeText(normalizedPages.map((page) => page.text).join("\n")),
    pages: normalizedPages,
    averageConfidence
  };
}

function buildOcrUnavailableResult() {
  return {
    enabled: false,
    engine: "disabled",
    language: env.OCR_LANG,
    timedOut: false,
    error: null,
    extractedAt: new Date().toISOString(),
    pageCount: 0,
    fullText: "",
    pages: [],
    averageConfidence: null
  };
}

async function extractOcrLayer({
  documentId,
  fileHash,
  pdfBuffer = null,
  parsedPdf = null,
  timeoutMs = env.OCR_TIMEOUT_MS,
  useCache = true
}) {
  if (!env.OCR_ENABLED) {
    return buildOcrUnavailableResult();
  }

  if (useCache && documentId && fileHash) {
    const cached = await getOcrExtraction(documentId, fileHash);
    if (cached) {
      return cached;
    }
  }

  let workingParsedPdf = parsedPdf;
  let timedOut = false;
  let ocrError = null;
  const warnings = [];

  const shouldUseTesseract = Boolean(pdfBuffer) && ["auto", "tesseract"].includes(env.OCR_ENGINE);

  try {
    if (shouldUseTesseract) {
      const tesseractResult = await runWithTimeout(
        extractWithTesseract({
          pdfBuffer,
          language: env.OCR_LANG,
          renderScale: env.OCR_RENDER_SCALE,
          maxPages: env.OCR_MAX_PAGES
        }),
        timeoutMs,
        "OCR extraction timed out"
      );

      if (tesseractResult.truncated) {
        warnings.push(`OCR processed first ${tesseractResult.processedPages} pages out of ${tesseractResult.pageCount}`);
      }

      const result = buildOcrResult({
        pages: tesseractResult.pages,
        pageCount: tesseractResult.pageCount,
        language: env.OCR_LANG,
        engine: "tesseract.js",
        warnings
      });

      if (useCache && documentId && fileHash) {
        await setOcrExtraction(documentId, fileHash, result);
      }

      return result;
    }
  } catch (error) {
    timedOut = error?.code === "OCR_TIMEOUT";
    ocrError = error?.message || "OCR extraction failed";
    warnings.push(`OCR fallback activated: ${ocrError}`);
  }

  try {
    if (!workingParsedPdf && pdfBuffer) {
      workingParsedPdf = await runWithTimeout(
        parsePdfWithPositions(pdfBuffer),
        timeoutMs,
        "OCR extraction timed out"
      );
    }
  } catch (error) {
    timedOut = timedOut || error?.code === "OCR_TIMEOUT";
    ocrError = ocrError || error?.message || "OCR fallback parse failed";
  }

  if (workingParsedPdf) {
    const fallback = buildOcrResult({
      parsedPdf: workingParsedPdf,
      timedOut,
      error: ocrError,
      warnings,
      language: env.OCR_LANG,
      engine: "text_layer_fallback"
    });

    if (useCache && documentId && fileHash) {
      await setOcrExtraction(documentId, fileHash, fallback);
    }

    return fallback;
  }

  return {
    ...buildOcrUnavailableResult(),
    enabled: true,
    engine: "text_layer_fallback",
    timedOut,
    error: ocrError || "OCR extraction failed",
    warnings
  };
}

async function renderPdfPagesForOcr(pdfBuffer, { renderScale, maxPages }) {
  const pdfjs = await getPdfJsLib();
  const { createCanvas } = getCanvasLib();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(Buffer.from(pdfBuffer)),
    useWorkerFetch: false,
    useSystemFonts: true,
    disableFontFace: false,
    isEvalSupported: false
  });

  let pdfDocument = null;

  try {
    pdfDocument = await loadingTask.promise;
    const pageCount = Number(pdfDocument.numPages) || 0;
    const pagesToProcess = Math.min(pageCount, Number(maxPages) || pageCount);
    const renderedPages = [];

    for (let pageNumber = 1; pageNumber <= pagesToProcess; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const viewport = page.getViewport({ scale: Number(renderScale) || 2 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");

      await page.render({ canvasContext: context, viewport }).promise;

      renderedPages.push({
        pageNumber,
        imageBuffer: canvas.toBuffer("image/png")
      });

      page.cleanup();
    }

    return {
      pageCount,
      processedPages: renderedPages.length,
      truncated: pageCount > renderedPages.length,
      renderedPages
    };
  } finally {
    if (pdfDocument) {
      await pdfDocument.destroy();
    } else {
      await loadingTask.destroy();
    }
  }
}

async function extractWithTesseract({ pdfBuffer, language, renderScale, maxPages }) {
  const tesseract = getTesseractLib();
  const rendered = await renderPdfPagesForOcr(pdfBuffer, { renderScale, maxPages });
  const pages = [];

  for (const page of rendered.renderedPages) {
    const response = await tesseract.recognize(page.imageBuffer, language, {
      logger: () => {}
    });
    const text = normalizeText(response?.data?.text || "");
    const confidence = normalizeConfidence(response?.data?.confidence);

    pages.push({
      pageNumber: page.pageNumber,
      text,
      confidence
    });
  }

  return {
    pageCount: rendered.pageCount,
    processedPages: rendered.processedPages,
    truncated: rendered.truncated,
    pages
  };
}

function tokenize(text = "") {
  const normalized = normalizeText(text);
  return normalized ? normalized.split(" ").filter(Boolean) : [];
}

function buildPageTextMap(ocr = null) {
  const pages = Array.isArray(ocr?.pages) ? ocr.pages : [];

  return pages.reduce((accumulator, page) => {
    accumulator[Number(page.pageNumber) || 1] = normalizeText(page.text || "");
    return accumulator;
  }, {});
}

function compareOcrLayers({ baseline = null, candidate = null }) {
  if (!baseline?.enabled || !candidate?.enabled) {
    return {
      changedWordCount: 0,
      changedPages: [],
      confidence: null,
      available: false
    };
  }

  const baseTokens = tokenize(baseline.fullText || "");
  const candidateTokens = tokenize(candidate.fullText || "");
  const chunks = diffArrays(baseTokens, candidateTokens);
  let changedWordCount = 0;

  for (const chunk of chunks) {
    if (chunk.added || chunk.removed) {
      changedWordCount += Array.isArray(chunk.value) ? chunk.value.length : 0;
    }
  }

  const basePages = buildPageTextMap(baseline);
  const candidatePages = buildPageTextMap(candidate);
  const maxPage = Math.max(
    Number(baseline.pageCount) || 0,
    Number(candidate.pageCount) || 0,
    ...Object.keys(basePages).map((value) => Number(value) || 0),
    ...Object.keys(candidatePages).map((value) => Number(value) || 0)
  );
  const changedPages = [];

  for (let pageNumber = 1; pageNumber <= maxPage; pageNumber += 1) {
    const left = basePages[pageNumber] || "";
    const right = candidatePages[pageNumber] || "";

    if (left !== right) {
      changedPages.push(pageNumber);
    }
  }

  const baselineConfidence = Number.isFinite(baseline.averageConfidence)
    ? baseline.averageConfidence
    : DEFAULT_CONFIDENCE;
  const candidateConfidence = Number.isFinite(candidate.averageConfidence)
    ? candidate.averageConfidence
    : DEFAULT_CONFIDENCE;

  return {
    changedWordCount,
    changedPages,
    confidence: Number(((baselineConfidence + candidateConfidence) / 2).toFixed(3)),
    available: true
  };
}

module.exports = {
  extractOcrLayer,
  compareOcrLayers
};
