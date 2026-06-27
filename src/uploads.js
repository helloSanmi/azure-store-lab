// Single source of truth for upload limits and allowed file types.
// Used by the server (to enforce) and the views (to display + validate client-side).

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_FILE_LABEL = "10 MB";

// Per-area storage caps, so the demo's storage can't grow without bound.
const MAX_FILES_PER_USER = 20;
const MAX_BYTES_PER_USER = 50 * 1024 * 1024; // 50 MB
const MAX_FILES_SHARED = 50;
const MAX_BYTES_SHARED = 200 * 1024 * 1024; // 200 MB

// Allowed file extensions, grouped only for the human-readable label.
const ALLOWED = {
  images: ["jpg", "jpeg", "png", "gif", "webp"],
  documents: ["pdf", "txt", "csv", "doc", "docx", "xls", "xlsx", "ppt", "pptx"],
  video: ["mp4", "mov", "webm"],
};

const ALLOWED_EXTENSIONS = [...ALLOWED.images, ...ALLOWED.documents, ...ALLOWED.video];
const ALLOWED_LABEL = "images, documents, video";
// For the <input accept="..."> attribute.
const ACCEPT_ATTR = ALLOWED_EXTENSIONS.map((e) => "." + e).join(",");

function extensionOf(name) {
  const i = String(name).lastIndexOf(".");
  return i >= 0 ? String(name).slice(i + 1).toLowerCase() : "";
}

// Returns an error message if the extension isn't allowed, otherwise null.
function checkExtension(name) {
  const ext = extensionOf(name);
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return `Files of type "${ext ? "." + ext : "(no extension)"}" aren't allowed. Allowed: ${ALLOWED_LABEL}.`;
  }
  return null;
}

// Human-readable byte size, e.g. 12.3 MB.
function humanSize(bytes) {
  const n = Number(bytes);
  if (!isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n;
  let i = -1;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

// Current usage of an area, given its file list and caps (for usage meters).
function usage(files, maxFiles, maxBytes) {
  const count = files.length;
  const bytes = files.reduce((sum, f) => sum + (Number(f.size) || 0), 0);
  const pct = (n, max) => (max ? Math.min(100, Math.round((n / max) * 100)) : 0);
  return { count, maxFiles, bytes, maxBytes, pctFiles: pct(count, maxFiles), pctBytes: pct(bytes, maxBytes) };
}

// Returns an error message if adding `newSize` bytes under `newName` would
// exceed the caps (accounting for overwriting a same-named file), else null.
function checkQuota(files, newName, newSize, maxFiles, maxBytes) {
  const existing = files.find((f) => f.name === newName);
  const count = files.length + (existing ? 0 : 1);
  const usedBytes = files.reduce((sum, f) => sum + (Number(f.size) || 0), 0);
  const projected = usedBytes - (existing ? Number(existing.size) || 0 : 0) + Number(newSize || 0);
  if (count > maxFiles) {
    return `Storage limit reached. At most ${maxFiles} files here; delete a file to upload another.`;
  }
  if (projected > maxBytes) {
    return `Not enough space. This would exceed the ${humanSize(maxBytes)} limit (currently using ${humanSize(usedBytes)}). Delete a file to free space.`;
  }
  return null;
}

// Broad category for an extension, used for colored file badges + icons.
function categoryOf(ext) {
  const e = String(ext || "").toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(e)) return "image";
  if (["mp4", "mov", "webm"].includes(e)) return "video";
  return "doc";
}

// Total bytes per category, for the dashboard storage chart.
function breakdown(files) {
  const out = { image: 0, doc: 0, video: 0 };
  for (const f of files) {
    const cat = f.isImage ? "image" : categoryOf(f.ext);
    out[cat] += Number(f.size) || 0;
  }
  return out;
}

module.exports = {
  MAX_FILE_BYTES,
  MAX_FILE_LABEL,
  MAX_FILES_PER_USER,
  MAX_BYTES_PER_USER,
  MAX_FILES_SHARED,
  MAX_BYTES_SHARED,
  ALLOWED_EXTENSIONS,
  ALLOWED_LABEL,
  ACCEPT_ATTR,
  extensionOf,
  checkExtension,
  humanSize,
  usage,
  checkQuota,
  categoryOf,
  breakdown,
};
