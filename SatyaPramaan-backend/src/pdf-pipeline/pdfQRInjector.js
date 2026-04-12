const { PDFDocument, rgb } = require("pdf-lib");

async function injectQrIntoPdf(pdfBuffer, qrDataUrl, options = {}) {
  const {
    pageIndex = 0,
    width = 160,
    height = 160,
    marginRight = 36,
    marginBottom = 36,
    quietZonePadding = 8
  } = options;

  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages = pdfDoc.getPages();
  const safePageIndex = Math.max(0, Math.min(Number(pageIndex) || 0, pages.length - 1));
  const page = pages[safePageIndex];
  const pngBytes = Buffer.from(qrDataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
  const pngImage = await pdfDoc.embedPng(pngBytes);
  const pageHeight = page.getHeight();
  const pageWidth = page.getWidth();
  const plateWidth = width + quietZonePadding * 2;
  const plateHeight = height + quietZonePadding * 2;
  const preferredX = pageWidth - plateWidth - marginRight;
  const preferredY = marginBottom;
  const plateX = Math.max(0, Math.min(preferredX, pageWidth - plateWidth));
  const plateY = Math.max(0, Math.min(preferredY, pageHeight - plateHeight));

  page.drawRectangle({
    x: plateX,
    y: plateY,
    width: plateWidth,
    height: plateHeight,
    color: rgb(1, 1, 1)
  });

  page.drawImage(pngImage, {
    x: plateX + quietZonePadding,
    y: plateY + quietZonePadding,
    width,
    height
  });

  return Buffer.from(await pdfDoc.save());
}

module.exports = { injectQrIntoPdf };
