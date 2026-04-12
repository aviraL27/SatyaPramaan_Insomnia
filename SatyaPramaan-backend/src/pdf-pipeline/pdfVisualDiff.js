const { diffArrays } = require("diff");
const { AppError } = require("../utils/AppError");

let pdfJsLibPromise = null;
let canvasLib = null;

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

const TEXT_OP_NAMES = new Set([
  "beginText",
  "endText",
  "setCharSpacing",
  "setWordSpacing",
  "setHScale",
  "setLeading",
  "setFont",
  "setTextRenderingMode",
  "setTextRise",
  "moveText",
  "setLeadingMoveText",
  "setTextMatrix",
  "nextLine",
  "showText",
  "showSpacedText",
  "nextLineShowText",
  "nextLineSetSpacingShowText",
  "setCharWidth",
  "setCharWidthAndBounds"
]);

const SENSITIVE_VISUAL_OP_NAMES = new Set([
  "moveTo",
  "lineTo",
  "curveTo",
  "curveTo2",
  "curveTo3",
  "closePath",
  "rectangle",
  "stroke",
  "closeStroke",
  "fill",
  "eoFill",
  "fillStroke",
  "eoFillStroke",
  "closeFillStroke",
  "closeEOFillStroke",
  "endPath",
  "paintImageXObject",
  "paintInlineImageXObject",
  "paintImageMaskXObject",
  "paintSolidColorImageMask"
]);

function toFiniteNumber(value, precision = 2) {
  if (!Number.isFinite(value)) {
    return value;
  }

  return Number(value.toFixed(precision));
}

function normalizeArg(value, depth = 0) {
  if (depth > 2) {
    return "[depth]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => normalizeArg(item, depth + 1));
  }

  if (Number.isFinite(value)) {
    return toFiniteNumber(value);
  }

  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort().slice(0, 8);
    const normalized = {};

    for (const key of keys) {
      normalized[key] = normalizeArg(value[key], depth + 1);
    }

    return normalized;
  }

  if (typeof value === "string") {
    return value.slice(0, 64);
  }

  return value;
}

function buildOpNameByCode(OPS) {
  return Object.entries(OPS).reduce((accumulator, [name, code]) => {
    accumulator[code] = name;
    return accumulator;
  }, {});
}

function parseTokenOpName(token) {
  const value = String(token || "");
  const separatorIndex = value.indexOf(":");

  if (separatorIndex < 0) {
    return value;
  }

  return value.slice(0, separatorIndex);
}

function toLuminance(red, green, blue) {
  return 0.299 * red + 0.587 * green + 0.114 * blue;
}

async function renderPdfPagesForImageDiff(pdfBytes, { renderScale = 1.5, pageNumbers = [] } = {}) {
  const pdfjs = await getPdfJsLib();
  const { createCanvas } = getCanvasLib();
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
    const requestedPages = (Array.isArray(pageNumbers) ? pageNumbers : [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value >= 1 && value <= pdfDocument.numPages);
    const pagesToRender = requestedPages.length
      ? requestedPages
      : Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1);
    const renderedPagesByNumber = new Map();

    for (const pageNumber of pagesToRender) {
      const page = await pdfDocument.getPage(pageNumber);
      const viewport = page.getViewport({ scale: Number(renderScale) || 1.5 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");

      await page.render({ canvasContext: context, viewport }).promise;
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

      renderedPagesByNumber.set(pageNumber, {
        width: canvas.width,
        height: canvas.height,
        pixels: imageData.data
      });

      page.cleanup();
    }

    return renderedPagesByNumber;
  } finally {
    if (pdfDocument) {
      await pdfDocument.destroy();
    } else {
      await loadingTask.destroy();
    }
  }
}

function extractDarkInkRectangles(basePage, candidatePage, {
  renderScale = 1.5,
  blockSize = 12,
  darkenThreshold = 28,
  maxCandidateLuminance = 185,
  minDarkPixelsPerBlock = 8,
  minComponentBlocks = 2,
  maxRects = 8
} = {}) {
  if (!basePage || !candidatePage) {
    return [];
  }

  const width = Math.min(basePage.width, candidatePage.width);
  const height = Math.min(basePage.height, candidatePage.height);

  if (width <= 0 || height <= 0) {
    return [];
  }

  const blocksX = Math.ceil(width / blockSize);
  const blocksY = Math.ceil(height / blockSize);
  const active = Array.from({ length: blocksY }, () => Array(blocksX).fill(false));

  for (let blockY = 0; blockY < blocksY; blockY += 1) {
    for (let blockX = 0; blockX < blocksX; blockX += 1) {
      const startX = blockX * blockSize;
      const endX = Math.min(startX + blockSize, width);
      const startY = blockY * blockSize;
      const endY = Math.min(startY + blockSize, height);
      let darkPixelCount = 0;

      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          const offset = (y * width + x) * 4;
          const baseLuminance = toLuminance(
            basePage.pixels[offset],
            basePage.pixels[offset + 1],
            basePage.pixels[offset + 2]
          );
          const candidateLuminance = toLuminance(
            candidatePage.pixels[offset],
            candidatePage.pixels[offset + 1],
            candidatePage.pixels[offset + 2]
          );

          if (baseLuminance - candidateLuminance >= darkenThreshold && candidateLuminance <= maxCandidateLuminance) {
            darkPixelCount += 1;
          }
        }
      }

      if (darkPixelCount >= minDarkPixelsPerBlock) {
        active[blockY][blockX] = true;
      }
    }
  }

  const visited = Array.from({ length: blocksY }, () => Array(blocksX).fill(false));
  const components = [];

  function walkComponent(startX, startY) {
    const queue = [[startX, startY]];
    visited[startY][startX] = true;
    let minX = startX;
    let maxX = startX;
    let minY = startY;
    let maxY = startY;
    let blockCount = 0;

    while (queue.length) {
      const [currentX, currentY] = queue.shift();
      blockCount += 1;
      minX = Math.min(minX, currentX);
      maxX = Math.max(maxX, currentX);
      minY = Math.min(minY, currentY);
      maxY = Math.max(maxY, currentY);

      const neighbors = [
        [currentX - 1, currentY],
        [currentX + 1, currentY],
        [currentX, currentY - 1],
        [currentX, currentY + 1],
        [currentX - 1, currentY - 1],
        [currentX + 1, currentY - 1],
        [currentX - 1, currentY + 1],
        [currentX + 1, currentY + 1]
      ];

      for (const [nextX, nextY] of neighbors) {
        if (nextX < 0 || nextY < 0 || nextX >= blocksX || nextY >= blocksY) {
          continue;
        }

        if (visited[nextY][nextX] || !active[nextY][nextX]) {
          continue;
        }

        visited[nextY][nextX] = true;
        queue.push([nextX, nextY]);
      }
    }

    return { minX, maxX, minY, maxY, blockCount };
  }

  for (let y = 0; y < blocksY; y += 1) {
    for (let x = 0; x < blocksX; x += 1) {
      if (!active[y][x] || visited[y][x]) {
        continue;
      }

      const component = walkComponent(x, y);
      if (component.blockCount >= minComponentBlocks) {
        components.push(component);
      }
    }
  }

  const sortedComponents = components
    .sort((left, right) => right.blockCount - left.blockCount)
    .slice(0, maxRects);

  return sortedComponents.map((component) => {
    const pixelX = component.minX * blockSize;
    const pixelY = component.minY * blockSize;
    const pixelWidth = (component.maxX - component.minX + 1) * blockSize;
    const pixelHeight = (component.maxY - component.minY + 1) * blockSize;

    return {
      x: Number((pixelX / renderScale).toFixed(2)),
      y: Number((pixelY / renderScale).toFixed(2)),
      width: Number((pixelWidth / renderScale).toFixed(2)),
      height: Number((pixelHeight / renderScale).toFixed(2)),
      source: "visual_diff"
    };
  });
}

function scoreTokenDiff(leftTokens, rightTokens) {
  if (!leftTokens.length && !rightTokens.length) {
    return {
      score: 0,
      changedCount: 0,
      changedSensitiveCount: 0
    };
  }

  const chunks = diffArrays(leftTokens, rightTokens);
  let changedCount = 0;
  let changedSensitiveCount = 0;

  for (const chunk of chunks) {
    if (chunk.added || chunk.removed) {
      const values = Array.isArray(chunk.value) ? chunk.value : [];
      changedCount += values.length;

      for (const token of values) {
        const opName = parseTokenOpName(token);

        if (SENSITIVE_VISUAL_OP_NAMES.has(opName)) {
          changedSensitiveCount += 1;
        }
      }
    }
  }

  const denominator = Math.max(leftTokens.length, rightTokens.length, 1);
  const relativeScore = Math.min(changedCount / denominator, 1);
  const sensitivityBoost = Math.min(changedSensitiveCount / 200, 0.12);
  const score = Number(Math.min(relativeScore + sensitivityBoost, 1).toFixed(4));

  return {
    score,
    changedCount,
    changedSensitiveCount
  };
}

async function extractVisualTokensByPage(pdfBytes, { maxTokensPerPage = 12000 } = {}) {
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
    const opNameByCode = buildOpNameByCode(pdfjs.OPS);
    const pages = [];

    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const operatorList = await page.getOperatorList();
      const tokens = [];

      for (let index = 0; index < operatorList.fnArray.length; index += 1) {
        const opCode = operatorList.fnArray[index];
        const opName = opNameByCode[opCode] || String(opCode);

        if (TEXT_OP_NAMES.has(opName)) {
          continue;
        }

        const args = normalizeArg(operatorList.argsArray[index] || []);
        tokens.push(`${opName}:${JSON.stringify(args)}`);

        if (tokens.length >= maxTokensPerPage) {
          break;
        }
      }

      pages.push({ pageNumber, tokens });
      page.cleanup();
    }

    return {
      pageCount: pdfDocument.numPages,
      pages
    };
  } catch (error) {
    throw error instanceof AppError
      ? error
      : new AppError("Unable to extract visual diff tokens", 400, { message: error.message });
  } finally {
    if (pdfDocument) {
      await pdfDocument.destroy();
    } else {
      await loadingTask.destroy();
    }
  }
}

async function comparePdfVisualLayers({
  baselinePdfBuffer,
  candidatePdfBuffer,
  threshold,
  minChangedOps = 0,
  minChangedSensitiveOps = 0,
  renderScale = 1.5
}) {
  const baseline = await extractVisualTokensByPage(baselinePdfBuffer);
  const candidate = await extractVisualTokensByPage(candidatePdfBuffer);
  const maxPage = Math.max(Number(baseline.pageCount) || 0, Number(candidate.pageCount) || 0);
  const baselineByPage = new Map((baseline.pages || []).map((page) => [page.pageNumber, page.tokens]));
  const candidateByPage = new Map((candidate.pages || []).map((page) => [page.pageNumber, page.tokens]));
  const visualDiffScoreByPage = [];
  const changedPages = [];
  const visualRectanglesByPage = {};

  for (let pageNumber = 1; pageNumber <= maxPage; pageNumber += 1) {
    const leftTokens = baselineByPage.get(pageNumber) || [];
    const rightTokens = candidateByPage.get(pageNumber) || [];
    const diff = scoreTokenDiff(leftTokens, rightTokens);

    visualDiffScoreByPage.push({
      pageNumber,
      score: diff.score,
      changedOpCount: diff.changedCount,
      changedSensitiveOpCount: diff.changedSensitiveCount
    });

    if (
      diff.score >= threshold ||
      diff.changedCount >= Number(minChangedOps || 0) ||
      diff.changedSensitiveCount >= Number(minChangedSensitiveOps || 0)
    ) {
      changedPages.push(pageNumber);
    }
  }

  if (changedPages.length) {
    const baselineImagesByPage = await renderPdfPagesForImageDiff(baselinePdfBuffer, {
      renderScale,
      pageNumbers: changedPages
    });
    const candidateImagesByPage = await renderPdfPagesForImageDiff(candidatePdfBuffer, {
      renderScale,
      pageNumbers: changedPages
    });

    for (const pageNumber of changedPages) {
      const basePage = baselineImagesByPage.get(pageNumber);
      const candidatePage = candidateImagesByPage.get(pageNumber);
      const rectangles = extractDarkInkRectangles(basePage, candidatePage, { renderScale });

      if (rectangles.length) {
        visualRectanglesByPage[String(pageNumber)] = rectangles;
      }
    }
  }

  return {
    visualDiffScoreByPage,
    changedPages,
    visualRectanglesByPage,
    visualLayerChanged: changedPages.length > 0
  };
}

module.exports = {
  comparePdfVisualLayers
};
