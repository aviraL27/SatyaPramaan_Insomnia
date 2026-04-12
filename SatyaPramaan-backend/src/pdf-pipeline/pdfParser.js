const { AppError } = require("../utils/AppError");
const { normalizeText } = require("./pdfCanonicalizer");

let pdfJsLibPromise = null;

async function getPdfJsLib() {
  if (!pdfJsLibPromise) {
    pdfJsLibPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }

  return pdfJsLibPromise;
}

function isTextItem(item) {
  return item && typeof item.str === "string" && Array.isArray(item.transform);
}

function toFiniteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function normalizeMetadataValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeMetadataValue(item));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value && typeof value === "object") {
    return Object.entries(value).reduce((accumulator, [key, item]) => {
      accumulator[key] = normalizeMetadataValue(item);
      return accumulator;
    }, {});
  }

  if (typeof value === "string") {
    return normalizeText(value);
  }

  return value;
}

function computeFontSize(item) {
  const [a = 0, b = 0, c = 0, d = 0] = item.transform || [];
  const horizontalScale = Math.hypot(a, b);
  const verticalScale = Math.hypot(c, d);

  return toFiniteNumber(Math.max(horizontalScale, verticalScale, item.height || 0), 0);
}

function splitTextItemIntoWords(item, pageHeight, readingOrderIndexStart) {
  const rawText = String(item.str || "");
  const matches = [...rawText.matchAll(/\S+/g)];

  if (!matches.length) {
    return [];
  }

  const totalLength = Math.max(rawText.length, 1);
  const chunkWidth = Math.abs(toFiniteNumber(item.width, 0));
  const chunkHeight = Math.abs(toFiniteNumber(item.height, 0)) || computeFontSize(item);
  const transform = item.transform.map((value) => toFiniteNumber(value, 0));
  const baseX = toFiniteNumber(transform[4], 0);
  const baseY = toFiniteNumber(pageHeight - transform[5] - chunkHeight, 0);
  const fontSize = computeFontSize(item);

  return matches
    .map((match, offset) => {
      const ratioStart = match.index / totalLength;
      const ratioWidth = match[0].length / totalLength;
      const normalizedWord = normalizeText(match[0]);

      if (!normalizedWord) {
        return null;
      }

      return {
        text: match[0],
        normalizedText: normalizedWord,
        x: toFiniteNumber(baseX + chunkWidth * ratioStart, baseX),
        y: baseY,
        width: toFiniteNumber(chunkWidth * ratioWidth, 0),
        height: chunkHeight,
        fontName: item.fontName || null,
        fontSize,
        transform,
        readingOrderIndex: readingOrderIndexStart + offset
      };
    })
    .filter(Boolean);
}

function normalizePdfMetadata(metadataResult = {}) {
  const xmpMetadata =
    metadataResult.metadata && typeof metadataResult.metadata.getAll === "function"
      ? metadataResult.metadata.getAll()
      : {};

  return normalizeMetadataValue({
    info: metadataResult.info || {},
    xmp: xmpMetadata || {},
    contentDispositionFilename: metadataResult.contentDispositionFilename || null
  });
}

async function parsePdfWithPositions(pdfBytes) {
  if (!pdfBytes || !Buffer.byteLength(Buffer.from(pdfBytes))) {
    throw new AppError("PDF file is required", 400);
  }

  const pdfjs = await getPdfJsLib();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(Buffer.from(pdfBytes)),
    useWorkerFetch: false,
    useSystemFonts: true,
    disableFontFace: false,
    isEvalSupported: false
  });

  let pdfDocument = null;

  try {
    pdfDocument = await loadingTask.promise;
    const metadataResult = await pdfDocument
      .getMetadata()
      .catch(() => ({ info: {}, metadata: null, contentDispositionFilename: null }));
    const metadata = normalizePdfMetadata(metadataResult);
    const textPositions = [];
    const pageText = [];

    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent({ disableNormalization: true });
      let readingOrderIndex = 0;
      const words = [];

      for (const item of textContent.items) {
        if (!isTextItem(item)) {
          continue;
        }

        const itemWords = splitTextItemIntoWords(item, viewport.height, readingOrderIndex);
        readingOrderIndex += itemWords.length;
        words.push(...itemWords);
      }

      textPositions.push({ pageNumber, words });
      pageText.push({
        pageNumber,
        text: normalizeText(words.map((word) => word.text).join(" "))
      });
      page.cleanup();
    }

    return {
      pageCount: pdfDocument.numPages,
      metadata,
      textPositions,
      pageText,
      fullText: normalizeText(pageText.map((page) => page.text).join("\n"))
    };
  } catch (error) {
    throw error instanceof AppError
      ? error
      : new AppError("Unable to parse PDF", 400, { message: error.message });
  } finally {
    if (pdfDocument) {
      await pdfDocument.destroy();
    } else {
      await loadingTask.destroy();
    }
  }
}

module.exports = { parsePdfWithPositions };
