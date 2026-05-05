// Global Executive — PDF Service
// Reads, rasterises and edits PDFs server-side, in batches, so the agent
// can navigate documents larger than its context window without losing
// state.
//
// SCOPE:
//   getMetadata(buf)              \u2192 page count, sizes, AcroForm fields, text preview per page
//   rasterizePages(buf, pages)    \u2192 PNG buffer per page (1-indexed page numbers)
//   editPdf(buf, edits)           \u2192 modified PDF buffer (form fill + text overlays)
//
// BATCHING DISCIPLINE:
//   The agent NEVER receives all pages at once. The route layer passes
//   small batches (default 1\u20133 pages) per /step call. Multi-page
//   operations are driven by the agent itself iterating with a cursor.
//
// DEPENDENCIES:
//   - pdf-lib            (pure JS, AcroForm fill + overlay drawing + metadata)
//   - pdfjs-dist/legacy  (pure JS, page rendering to a canvas)
//   - @napi-rs/canvas    (zero-system-deps native canvas for pdfjs to draw on)
//
// All three are loaded lazily so the rest of the server keeps booting
// when they aren't installed yet. Callers see a clear `pdfDepsMissing`
// flag they can surface to the agent as a recovery hint.

let _pdfLib = null;
let _pdfjs = null;
let _canvas = null;
let _depsErr = null;

function loadDeps() {
  if (_pdfLib && _pdfjs && _canvas) return { ok: true };
  try {
    _pdfLib = _pdfLib || require('pdf-lib');
    _pdfjs  = _pdfjs  || require('pdfjs-dist/legacy/build/pdf.js');
    _canvas = _canvas || require('@napi-rs/canvas');
    return { ok: true };
  } catch (e) {
    _depsErr = e.message;
    return { ok: false, error: e.message };
  }
}

// ============================================
// getMetadata \u2014 cheap, no rendering. Returns enough info for the agent
// to decide what to do next without spending tokens on full pages.
// ============================================
async function getMetadata(buffer) {
  const { ok, error } = loadDeps();
  if (!ok) {
    // pdf-lib is what we need here \u2014 try it standalone in case only canvas/pdfjs are missing.
    try { _pdfLib = require('pdf-lib'); } catch { return { pdfDepsMissing: true, error }; }
  }
  const { PDFDocument } = _pdfLib;
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  const pages = doc.getPages();
  const pageSizes = pages.map((p, i) => ({
    page: i + 1,
    width: Math.round(p.getWidth()),
    height: Math.round(p.getHeight()),
    rotation: (p.getRotation && p.getRotation().angle) || 0
  }));

  // AcroForm fields (if any). Group by page so the agent knows what to fill where.
  const formFields = [];
  try {
    const form = doc.getForm();
    const fields = form.getFields();
    for (const f of fields) {
      let type = 'unknown';
      const ctor = f.constructor && f.constructor.name;
      if (/TextField/i.test(ctor)) type = 'text';
      else if (/CheckBox/i.test(ctor)) type = 'checkbox';
      else if (/RadioGroup/i.test(ctor)) type = 'radio';
      else if (/Dropdown|OptionList/i.test(ctor)) type = 'choice';
      else if (/Signature/i.test(ctor)) type = 'signature';
      let value = '';
      try {
        if (type === 'text') value = f.getText() || '';
        else if (type === 'checkbox') value = f.isChecked() ? 'on' : 'off';
        else if (type === 'radio') value = f.getSelected() || '';
        else if (type === 'choice') value = (f.getSelected && f.getSelected().join(',')) || '';
      } catch { /* fields without values */ }
      // Best-effort page lookup via widget annotation refs.
      let pageNum = 0;
      try {
        const widgets = f.acroField.getWidgets();
        const w = widgets && widgets[0];
        if (w) {
          const pageRef = w.P() || w.dict.get(_pdfLib.PDFName.of('P'));
          if (pageRef) {
            for (let i = 0; i < pages.length; i++) {
              if (pages[i].ref === pageRef) { pageNum = i + 1; break; }
            }
          }
        }
      } catch { /* page mapping is best-effort */ }
      formFields.push({ name: f.getName(), type, value: String(value).slice(0, 200), page: pageNum || null });
    }
  } catch { /* no form / corrupted form \u2014 ignore */ }

  return {
    pageCount: pages.length,
    pageSizes,
    formFields,
    hasAcroForm: formFields.length > 0,
    title: doc.getTitle() || '',
    author: doc.getAuthor() || '',
    bytes: buffer.length
  };
}

// ============================================
// rasterizePages \u2014 render specified pages to PNG buffers.
// Pages are 1-indexed. dpi controls quality / file size; default 120 is
// readable for vision models without bloating storage.
// ============================================
async function rasterizePages(buffer, pageNumbers, dpi = 120) {
  const { ok, error } = loadDeps();
  if (!ok) return { pdfDepsMissing: true, error, pages: [] };
  const { getDocument } = _pdfjs;
  const { createCanvas } = _canvas;

  const data = new Uint8Array(buffer);
  const loadingTask = getDocument({ data, useSystemFonts: true, isEvalSupported: false });
  const doc = await loadingTask.promise;
  const total = doc.numPages;

  const out = [];
  const scale = dpi / 72; // PDF default = 72 DPI
  for (const n of pageNumbers) {
    if (!Number.isInteger(n) || n < 1 || n > total) {
      out.push({ page: n, error: `Page ${n} out of range (1..${total})` });
      continue;
    }
    try {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      // pdfjs expects a CanvasRenderingContext2D-shaped object; @napi-rs/canvas is compatible.
      await page.render({ canvasContext: ctx, viewport }).promise;
      const pngBuffer = await canvas.encode('png');
      out.push({
        page: n,
        width: canvas.width,
        height: canvas.height,
        mime: 'image/png',
        pngBuffer
      });
    } catch (e) {
      out.push({ page: n, error: `Render failed: ${e.message}` });
    }
  }
  try { await doc.cleanup(); await doc.destroy(); } catch {}
  return { pages: out, pageCount: total };
}

// ============================================
// editPdf \u2014 apply form fills and / or text overlays. Returns a Buffer
// of the modified PDF. Passes through unsigned (callers can sign /
// flatten externally if desired).
//
// edits = {
//   formFields:   { fieldName: value, ... }              // AcroForm
//   overlays:     [ { page, x, y, text, fontSize?, color?, font? } ]
//   flattenForm:  bool   // when true, "bakes" form values into static text
// }
// ============================================
async function editPdf(buffer, edits = {}) {
  try { _pdfLib = require('pdf-lib'); } catch (e) {
    return { error: 'pdf-lib not installed: ' + e.message, pdfDepsMissing: true };
  }
  const { PDFDocument, StandardFonts, rgb } = _pdfLib;
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pages = doc.getPages();

  const filledFields = [];
  const skippedFields = [];

  // ---- AcroForm fill ----
  if (edits.formFields && typeof edits.formFields === 'object') {
    let form;
    try { form = doc.getForm(); } catch { form = null; }
    if (!form) {
      for (const k of Object.keys(edits.formFields)) skippedFields.push({ field: k, reason: 'no_form' });
    } else {
      for (const [name, raw] of Object.entries(edits.formFields)) {
        try {
          const f = form.getFieldMaybe ? form.getFieldMaybe(name) : (() => {
            try { return form.getField(name); } catch { return null; }
          })();
          if (!f) { skippedFields.push({ field: name, reason: 'not_found' }); continue; }
          const ctor = f.constructor && f.constructor.name;
          if (/TextField/i.test(ctor)) f.setText(String(raw == null ? '' : raw));
          else if (/CheckBox/i.test(ctor)) {
            if (raw === true || raw === 'on' || raw === 'true' || raw === 1) f.check();
            else f.uncheck();
          } else if (/RadioGroup/i.test(ctor)) f.select(String(raw));
          else if (/Dropdown|OptionList/i.test(ctor)) f.select(String(raw));
          else { skippedFields.push({ field: name, reason: `unsupported_type:${ctor}` }); continue; }
          filledFields.push({ field: name, type: ctor, value: String(raw).slice(0, 200) });
        } catch (e) {
          skippedFields.push({ field: name, reason: 'fill_failed', error: e.message });
        }
      }
      if (edits.flattenForm) {
        try { form.flatten(); } catch { /* flatten can fail on weird forms; non-fatal */ }
      }
    }
  }

  // ---- Text overlays ----
  const drawnOverlays = [];
  if (Array.isArray(edits.overlays) && edits.overlays.length) {
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    for (const o of edits.overlays) {
      const pn = parseInt(o.page, 10);
      if (!pn || pn < 1 || pn > pages.length) continue;
      const page = pages[pn - 1];
      const fontSize = Math.min(Math.max(Number(o.fontSize) || 12, 4), 72);
      const text = String(o.text || '').slice(0, 1000);
      if (!text) continue;
      // Coordinates are PDF-space: (0,0) is bottom-left. The agent should
      // pass coords in points; if it sends ratios (0..1), convert.
      const pw = page.getWidth(), ph = page.getHeight();
      const x = o.x > 0 && o.x <= 1 ? o.x * pw : Number(o.x) || 0;
      const y = o.y > 0 && o.y <= 1 ? (1 - o.y) * ph : Number(o.y) || 0; // ratio Y is top-left convention
      let color;
      try {
        const c = o.color || [0, 0, 0];
        if (Array.isArray(c) && c.length === 3) color = rgb(c[0], c[1], c[2]);
        else color = rgb(0, 0, 0);
      } catch { color = rgb(0, 0, 0); }
      page.drawText(text, { x, y, size: fontSize, font: helv, color });
      drawnOverlays.push({ page: pn, x, y, fontSize, chars: text.length });
    }
  }

  const out = await doc.save({ updateFieldAppearances: true });
  return {
    buffer: Buffer.from(out),
    filledFields,
    skippedFields,
    drawnOverlays,
    pageCount: pages.length
  };
}

// ============================================
// extractText \u2014 pull selectable text out of a PDF. Returns an array of
// { page, text } objects. Silently returns an empty string per page on
// scanned (image-only) PDFs \u2014 those need OCR / vision instead.
// Optional pageNumbers array selects specific pages; omit for all.
// ============================================
async function extractText(buffer, pageNumbers) {
  try { _pdfjs = _pdfjs || require('pdfjs-dist/legacy/build/pdf.js'); }
  catch (e) { return { pdfDepsMissing: true, error: e.message, pages: [] }; }
  const { getDocument } = _pdfjs;
  const data = new Uint8Array(buffer);
  const loadingTask = getDocument({ data, useSystemFonts: true, isEvalSupported: false });
  const doc = await loadingTask.promise;
  const total = doc.numPages;
  const targets = (Array.isArray(pageNumbers) && pageNumbers.length)
    ? pageNumbers.filter(n => Number.isInteger(n) && n >= 1 && n <= total)
    : Array.from({ length: total }, (_, i) => i + 1);

  const pages = [];
  for (const n of targets) {
    try {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      // Reconstruct readable text, inserting newlines between items whose
      // y-coordinate changes by more than ~2 points (new line in PDF-space).
      let text = '';
      let lastY = null;
      for (const it of content.items) {
        const y = it.transform ? it.transform[5] : null;
        if (lastY != null && y != null && Math.abs(y - lastY) > 2) text += '\n';
        text += it.str || '';
        if (it.hasEOL) text += '\n';
        lastY = y;
      }
      pages.push({ page: n, text: text.trim() });
    } catch (e) {
      pages.push({ page: n, text: '', error: e.message });
    }
  }
  try { await doc.cleanup(); await doc.destroy(); } catch {}
  return { pageCount: total, pages };
}

module.exports = {
  loadDeps,
  getMetadata,
  rasterizePages,
  extractText,
  editPdf
};
