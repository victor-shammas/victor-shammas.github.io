// Build the Pagefind search index for victorshammas.com.
//
// Two sources are indexed:
//   1. The rendered HTML in ./public (blog posts, Research, Media, Norwegian,
//      Tools, etc.) — only elements inside data-pagefind-body, so the sidebar,
//      feed footers, and monitor embeds are excluded.
//   2. Full text extracted from every PDF in ./static/pdfs, added as custom
//      records that link straight to the PDF. Text PDFs use pdftotext; scanned
//      (image-only) PDFs fall back to OCR via pdftoppm + tesseract (eng+nor).
//
// Output: ./public/pagefind/  (served at /pagefind/)
//
// Requires (installed in CI): poppler-utils (pdftotext, pdftoppm),
// tesseract-ocr + tesseract-ocr-nor. Run after `hugo --minify`.

import * as pagefind from "pagefind";
import { execFileSync } from "node:child_process";
import { readdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PDF_DIR = "static/pdfs";
const PUBLIC_DIR = "public";
const OUT_DIR = "public/pagefind";
// Below this many extracted characters we assume the PDF is image-only and OCR it.
const OCR_THRESHOLD = 200;
// Cap OCR work per document so a single huge scan can't stall the build.
const OCR_MAX_PAGES = 40;

function titleFromFilename(name) {
  return name
    .replace(/\.pdf$/i, "")
    .replace(/^Shammas[-_]?/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b(\d{4})\b/g, "($1)")
    .replace(/\s+/g, " ")
    .trim();
}

function pdftotext(path) {
  try {
    return execFileSync("pdftotext", ["-q", "-enc", "UTF-8", path, "-"], {
      maxBuffer: 64 * 1024 * 1024,
    }).toString("utf8");
  } catch {
    return "";
  }
}

function ocr(path) {
  const dir = mkdtempSync(join(tmpdir(), "ocr-"));
  let text = "";
  try {
    // Render up to OCR_MAX_PAGES pages to PNG, then OCR each.
    execFileSync("pdftoppm", [
      "-png", "-r", "200", "-l", String(OCR_MAX_PAGES), path, join(dir, "p"),
    ], { maxBuffer: 256 * 1024 * 1024 });
    const pages = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
    for (const pg of pages) {
      try {
        text += execFileSync(
          "tesseract",
          [join(dir, pg), "stdout", "-l", "eng+nor"],
          { maxBuffer: 64 * 1024 * 1024 }
        ).toString("utf8") + "\n";
      } catch { /* skip unreadable page */ }
    }
  } catch { /* pdftoppm failed — leave text empty */ } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return text;
}

const { index } = await pagefind.createIndex({
  forceLanguage: "en",
});

// 1. Index the rendered site.
const dir = await index.addDirectory({ path: PUBLIC_DIR });
console.log(`Indexed ${dir.page_count} HTML pages.`);

// 2. Index PDF full text — cached.
//    The expensive pdftotext/OCR pass only runs for a PDF when its bytes
//    change OR the workflow cache has rolled over (keyed weekly), so routine
//    content deploys reuse the cached text and stay fast. The HTML index above
//    is always rebuilt, so new posts are searchable immediately regardless.
//    FORCE_PDF_REFRESH=1 ignores the cache and re-extracts everything.
const CACHE_FILE = ".cache/pdf-text.json";
const FORCE = process.env.FORCE_PDF_REFRESH === "1";
let cache = {};
if (!FORCE && existsSync(CACHE_FILE)) {
  try { cache = JSON.parse(readFileSync(CACHE_FILE, "utf8")); } catch { cache = {}; }
}
const nextCache = {};
let pdfCount = 0, ocrCount = 0, emptyCount = 0, freshCount = 0, reuseCount = 0;
// Skip directories: a redirect stub can occupy an old PDF path as
// <name>.pdf/index.html, and readFileSync on it would throw EISDIR.
const pdfs = readdirSync(PDF_DIR, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".pdf"))
  .map((e) => e.name);
for (const file of pdfs) {
  const path = join(PDF_DIR, file);
  const sha = createHash("sha1").update(readFileSync(path)).digest("hex");
  let entry = cache[file];
  if (!entry || entry.sha !== sha) {
    let text = pdftotext(path);
    let viaOcr = false;
    if (text.replace(/\s+/g, "").length < OCR_THRESHOLD) {
      const ocrText = ocr(path);
      if (ocrText.replace(/\s+/g, "").length > text.replace(/\s+/g, "").length) {
        text = ocrText;
        viaOcr = true;
      }
    }
    entry = { sha, text: text.replace(/\s+/g, " ").trim(), ocr: viaOcr };
    freshCount++;
    if (viaOcr) { ocrCount++; console.log(`  ocr  ${file}`); }
  } else {
    reuseCount++;
    if (entry.ocr) ocrCount++;
  }
  nextCache[file] = entry;
  if (!entry.text || entry.text.length < 20) {
    emptyCount++;
    console.warn(`  ⚠ no text extracted: ${file}`);
    continue;
  }
  await index.addCustomRecord({
    url: `/pdfs/${encodeURIComponent(file)}`,
    content: entry.text,
    language: "en",
    meta: { title: titleFromFilename(file), resource: "PDF" },
  });
  pdfCount++;
}
mkdirSync(".cache", { recursive: true });
writeFileSync(CACHE_FILE, JSON.stringify(nextCache));
console.log(`Indexed ${pdfCount} PDFs (${freshCount} extracted, ${reuseCount} cached, ${ocrCount} OCR, ${emptyCount} empty).`);

await index.writeFiles({ outputPath: OUT_DIR });
await pagefind.close();
console.log(`Wrote index to ${OUT_DIR}.`);
