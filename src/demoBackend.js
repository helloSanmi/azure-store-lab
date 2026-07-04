// In-memory backend for demo mode: stands in for Azure SQL (accounts + file
// metadata) and Azure Storage (blob bytes + a shared file tree). Same interfaces
// as the real store/clients, so routes/views need no changes. Everything lives
// in process memory and resets on restart.

const zlib = require("zlib");
const { Readable } = require("stream");
const { randomUUID } = require("crypto");
const { DEMO_NAME, DEMO_EMAIL } = require("./demo");

// ---- in-memory state ----
const users = []; // { id, name, email, createdAt }
const files = []; // { id, owner_id, display_name, content_type, size_bytes, uploaded_at }
const blobs = new Map(); // containerId -> Map(blobName -> { buffer, contentType })
const shared = new Map(); // dirPath ("" = root) -> { folders:Set, files:Map(name -> {buffer,contentType,size,lastModified}) }
shared.set("", { folders: new Set(), files: new Map() });

// ---- store (mirrors src/store.js) ----
function fileExt(n) { const i = String(n).lastIndexOf("."); return i >= 0 ? String(n).slice(i + 1) : ""; }
function toUser(u) { return { id: u.id, name: u.name, email: u.email, createdAt: u.createdAt }; }
function toFile(f) {
  const id = f.id;
  return {
    id, name: f.display_name, contentType: f.content_type || "",
    isImage: /^image\//.test(f.content_type || ""), ext: fileExt(f.display_name),
    size: f.size_bytes, lastModified: f.uploaded_at,
    url: `/files/blob/${id}`, shareUrl: `/files/share/${id}`, renameUrl: `/files/rename/${id}`,
  };
}

const store = {
  async listUsers() { return users.slice().sort((a, b) => b.createdAt - a.createdAt).map(toUser); },
  async findUserByEmail(email) { const e = String(email).trim().toLowerCase(); const u = users.find((x) => x.email === e); return u ? toUser(u) : null; },
  async createUser({ name, email }) {
    const u = { id: randomUUID(), name: String(name).trim(), email: String(email).trim().toLowerCase(), createdAt: new Date() };
    users.push(u); return toUser(u);
  },
  async listUserFiles(ownerId) { return files.filter((f) => f.owner_id === ownerId).sort((a, b) => b.uploaded_at - a.uploaded_at).map(toFile); },
  async getFile(ownerId, fileId) { const f = files.find((x) => x.owner_id === ownerId && x.id === fileId); return f ? toFile(f) : null; },
  async fileNameExists(ownerId, name) { return files.some((f) => f.owner_id === ownerId && f.display_name === name); },
  async userUsage(ownerId) { const mine = files.filter((f) => f.owner_id === ownerId); return { count: mine.length, bytes: mine.reduce((s, f) => s + (Number(f.size_bytes) || 0), 0) }; },
  async createFileRecord({ ownerId, displayName, contentType, sizeBytes }) {
    const id = randomUUID();
    files.push({ id, owner_id: ownerId, display_name: displayName, content_type: contentType || null, size_bytes: Number(sizeBytes) || 0, uploaded_at: new Date() });
    return id;
  },
  async deleteFileRecord(ownerId, fileId) { const i = files.findIndex((f) => f.owner_id === ownerId && f.id === fileId); if (i >= 0) files.splice(i, 1); },
  async renameFile(ownerId, fileId, newName) { const f = files.find((x) => x.owner_id === ownerId && x.id === fileId); if (f) f.display_name = newName; },
};

// ---- fake blob client (My Files bytes) ----
function demoSas(kind, a, b, expiresOn) {
  const exp = (expiresOn instanceof Date ? expiresOn : new Date(expiresOn)).toISOString();
  const host = kind === "blob" ? "blob" : "file";
  return `https://demo-account.${host}.core.windows.net/${encodeURIComponent(a)}/${encodeURIComponent(b)}?sv=2024-11-04&se=${encodeURIComponent(exp)}&sp=r&sig=DEMO-not-a-real-signature`;
}

function blobContainerClient(containerId) {
  if (!blobs.has(containerId)) blobs.set(containerId, new Map());
  const c = blobs.get(containerId);
  return {
    async createIfNotExists() { if (!blobs.has(containerId)) blobs.set(containerId, new Map()); return {}; },
    getBlockBlobClient(name) {
      return {
        async uploadData(buffer, opts) {
          const ct = (opts && opts.blobHTTPHeaders && opts.blobHTTPHeaders.blobContentType) || "application/octet-stream";
          c.set(name, { buffer: Buffer.from(buffer), contentType: ct });
        },
        async deleteIfExists() { c.delete(name); },
        async setHTTPHeaders() { /* no-op in demo */ },
      };
    },
    getBlobClient(name) {
      return {
        async exists() { return c.has(name); },
        async download() { const b = c.get(name); return { contentType: b ? b.contentType : undefined, readableStreamBody: b ? Readable.from(b.buffer) : null }; },
        async generateSasUrl({ expiresOn }) { return demoSas("blob", containerId, name, expiresOn); },
      };
    },
  };
}
const blobServiceClient = { getContainerClient: (id) => blobContainerClient(id) };

// ---- fake share client (Azure Files: shared folders + bytes) ----
function dirEntry(path) { if (!shared.has(path)) shared.set(path, { folders: new Set(), files: new Map() }); return shared.get(path); }

function shareFileClient(dirPath, name) {
  return {
    async exists() { const d = shared.get(dirPath); return !!(d && d.files.has(name)); },
    async download() { const d = shared.get(dirPath); const f = d && d.files.get(name); return { contentType: f ? f.contentType : undefined, readableStreamBody: f ? Readable.from(f.buffer) : null }; },
    async downloadToBuffer() { const d = shared.get(dirPath); const f = d && d.files.get(name); return f ? Buffer.from(f.buffer) : Buffer.alloc(0); },
    async getProperties() { const d = shared.get(dirPath); const f = d && d.files.get(name); return { contentType: f ? f.contentType : undefined }; },
    async uploadData(buffer, opts) {
      const ct = (opts && opts.fileHttpHeaders && opts.fileHttpHeaders.fileContentType) || "application/octet-stream";
      dirEntry(dirPath).files.set(name, { buffer: Buffer.from(buffer), contentType: ct, size: buffer.length, lastModified: new Date() });
    },
    async deleteIfExists() { const d = shared.get(dirPath); if (d) d.files.delete(name); },
    async generateSasUrl({ expiresOn }) { return demoSas("file", dirPath || "root", name, expiresOn); },
  };
}

function shareDirectoryClient(path) {
  return {
    async createIfNotExists() {
      if (path) { const parts = path.split("/"); const name = parts.pop(); dirEntry(parts.join("/")).folders.add(name); }
      dirEntry(path); return {};
    },
    async deleteIfExists() {
      const d = shared.get(path);
      if (!d) return;
      if (d.folders.size > 0 || d.files.size > 0) throw new Error("Directory is not empty");
      shared.delete(path);
      if (path) { const parts = path.split("/"); const name = parts.pop(); const parent = shared.get(parts.join("/")); if (parent) parent.folders.delete(name); }
    },
    getFileClient(name) { return shareFileClient(path, name); },
    async *listFilesAndDirectories() {
      const d = dirEntry(path);
      for (const folder of d.folders) yield { kind: "directory", name: folder };
      for (const [n, meta] of d.files) yield { kind: "file", name: n, properties: { contentLength: meta.size, lastModified: meta.lastModified } };
    },
  };
}

const shareServiceClient = {
  getShareClient() {
    return {
      async createIfNotExists() { dirEntry(""); return {}; },
      rootDirectoryClient: shareDirectoryClient(""),
      getDirectoryClient: (p) => shareDirectoryClient(p),
    };
  },
};

// ---- tiny PNG encoder (demo images only, no external deps) ----
// Generates real RGBA pictures so the gallery thumbnails and the lightbox show
// something meaningful instead of a 1x1 placeholder.
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (~c) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
// Build an 8-bit truecolor+alpha PNG; colorAt(x, y) returns [r, g, b] (or [r,g,b,a]).
function makePng(width, height, colorAt) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // per-scanline filter: none
    for (let x = 0; x < width; x++) {
      const c = colorAt(x, y);
      raw[p++] = c[0];
      raw[p++] = c[1];
      raw[p++] = c[2];
      raw[p++] = c.length > 3 ? c[3] : 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", zlib.deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}
function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
function gradient(w, h, c1, c2) {
  return makePng(w, h, (x, y) => {
    const t = (x / w + y / h) / 2;
    return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
  });
}
const IMG_WELCOME = gradient(800, 500, [79, 70, 229], [168, 85, 247]); // indigo -> violet
const IMG_LOGO = gradient(480, 480, [16, 185, 129], [45, 212, 191]); // emerald -> teal
// A simple homepage "mockup": indigo header band, light page, a hero card + two side cards.
const IMG_MOCKUP = makePng(900, 560, (x, y) => {
  if (y < 96) return [79, 70, 229];
  if (y > 140 && y < 430 && x > 60 && x < 540) return [255, 255, 255];
  if (y > 140 && y < 300 && x > 580 && x < 840) return [226, 232, 240];
  if (y > 330 && y < 430 && x > 580 && x < 840) return [226, 232, 240];
  return [241, 245, 249];
});

let seeded = false;
function seed() {
  if (seeded) return;
  seeded = true;

  const ada = { id: "3f2a1b4c-1111-2222-3333-abcdef012345", name: DEMO_NAME, email: DEMO_EMAIL, createdAt: new Date(Date.now() - 6 * 864e5) };
  users.push(ada);
  users.push({ id: randomUUID(), name: "Alan Turing", email: "alan@example.com", createdAt: new Date(Date.now() - 3 * 864e5) });
  users.push({ id: randomUUID(), name: "Grace Hopper", email: "grace@example.com", createdAt: new Date(Date.now() - 1 * 864e5) });

  // Ada's private files (metadata + blob bytes under her container).
  function addFile(name, type, buffer) {
    const id = randomUUID();
    files.push({ id, owner_id: ada.id, display_name: name, content_type: type, size_bytes: buffer.length, uploaded_at: new Date(Date.now() - Math.floor(Math.random() * 5) * 36e5) });
    if (!blobs.has(ada.id)) blobs.set(ada.id, new Map());
    blobs.get(ada.id).set(id, { buffer, contentType: type });
  }
  addFile("welcome.png", "image/png", IMG_WELCOME);
  addFile("project-brief.pdf", "application/pdf", Buffer.from("%PDF-1.4 demo project brief"));
  addFile("q3-budget.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Buffer.from("demo spreadsheet bytes"));
  addFile("intro-clip.mp4", "video/mp4", Buffer.from("demo video bytes ".repeat(64)));

  // Shared area: a couple of root files + a folder with a file.
  const root = dirEntry("");
  root.files.set("team-handbook.pdf", { buffer: Buffer.from("%PDF-1.4 handbook"), contentType: "application/pdf", size: 17, lastModified: new Date() });
  root.files.set("brand-logo.png", { buffer: IMG_LOGO, contentType: "image/png", size: IMG_LOGO.length, lastModified: new Date() });
  root.folders.add("designs");
  const designs = dirEntry("designs");
  designs.files.set("homepage-mockup.png", { buffer: IMG_MOCKUP, contentType: "image/png", size: IMG_MOCKUP.length, lastModified: new Date() });
}

module.exports = { store, blobServiceClient, shareServiceClient, seed };
