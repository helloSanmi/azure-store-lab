// Authenticated app routes: Dashboard, My Files (Blob), Shared Files (Azure
// Files), and Members (Table). Every route here requires a signed-in user.

const express = require("express");
const multer = require("multer");
const path = require("path");
const { pipeline } = require("stream");
const router = express.Router();

const { BlobSASPermissions } = require("@azure/storage-blob");
const { FileSASPermissions } = require("@azure/storage-file-share");
const { blobServiceClient, shareServiceClient, SHARED_FILE_SHARE } = require("../src/azureClients");
const { listUsers } = require("../src/store");
const { currentUser, requireAuth, setFlash, takeFlash } = require("../src/auth");
const { renderDashboard, renderFiles, renderShared, renderMembers, renderShareLink, renderRename } = require("../src/views");
const {
  MAX_FILE_BYTES,
  MAX_FILE_LABEL,
  MAX_FILES_PER_USER,
  MAX_BYTES_PER_USER,
  MAX_FILES_SHARED,
  MAX_BYTES_SHARED,
  checkExtension,
  checkQuota,
  usage,
  breakdown,
} = require("../src/uploads");

// How long a generated shareable (SAS) link stays valid.
const SAS_TTL_MS = 60 * 60 * 1000; // 1 hour

// Uploads buffered in memory, streamed straight to Azure. Size is capped here
// so multer aborts oversize uploads before buffering the whole thing.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES } });

// Run multer for a single "file" field, turning an over-size error into a
// friendly flash + redirect instead of the generic error page. `redirectTo` may
// be a string or a function of req (so it can read the parsed form, e.g. path).
function handleUpload(redirectTo) {
  return (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (!err) return next();
      if (err.code === "LIMIT_FILE_SIZE") {
        setFlash(req, "error", `That file is too large. The limit is ${MAX_FILE_LABEL}.`);
        return res.redirect(typeof redirectTo === "function" ? redirectTo(req) : redirectTo);
      }
      next(err);
    });
  };
}

// Everything below requires authentication.
router.use(requireAuth);

const IMAGE_TYPES = /^image\//;
function fileExt(name) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1) : "";
}

// Reduce an uploaded filename to a safe, flat leaf name: strip any directory
// part, replace characters that Azure Blob/Files reject, and cap the length.
// Returns null if nothing usable is left. This is the boundary that keeps each
// user's files inside their own container / the shared share (no path traversal).
function safeName(raw) {
  const base = path
    .basename(String(raw || ""))
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .trim();
  if (!base || base === "." || base === "..") return null;
  return base.slice(0, 200);
}

// A name arriving via a URL must already be a safe leaf (it was sanitized on
// upload). Reject anything with path separators or control characters.
function isValidLeaf(name) {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= 255 &&
    name !== "." &&
    name !== ".." &&
    !/[\\/\x00-\x1f]/.test(name)
  );
}

// Validate a shared-folder path: every "/"-separated segment must be a safe
// leaf. Returns the cleaned path ("" for root) or null if any segment is bad.
// This keeps navigation/uploads inside the share (no traversal via the path).
function sanitizePath(raw) {
  if (raw == null || raw === "") return "";
  const parts = String(raw).split("/").filter((s) => s.length > 0);
  for (const part of parts) {
    if (!isValidLeaf(part)) return null;
  }
  return parts.join("/");
}

// Where to send the user back to in the shared browser for a given folder path.
function sharedBack(p) {
  return p ? `/shared?path=${encodeURIComponent(p)}` : "/shared";
}

// Directory client for a folder path within the shared share ("" = root).
function sharedDir(p) {
  const share = shareServiceClient.getShareClient(SHARED_FILE_SHARE);
  return p ? share.getDirectoryClient(p) : share.rootDirectoryClient;
}

// A user's blob container is named after their row key (a lowercase UUID, which
// is a valid container name).
function userContainer(rowKey) {
  return blobServiceClient.getContainerClient(rowKey);
}

async function listUserFiles(rowKey) {
  const container = userContainer(rowKey);
  await container.createIfNotExists();
  const files = [];
  for await (const blob of container.listBlobsFlat()) {
    const contentType = (blob.properties && blob.properties.contentType) || "";
    files.push({
      name: blob.name,
      url: `/files/blob/${encodeURIComponent(blob.name)}`,
      shareUrl: `/files/share/${encodeURIComponent(blob.name)}`,
      renameUrl: `/files/rename/${encodeURIComponent(blob.name)}`,
      isImage: IMAGE_TYPES.test(contentType),
      ext: fileExt(blob.name),
      contentType,
      size: blob.properties && blob.properties.contentLength,
      lastModified: blob.properties && blob.properties.lastModified,
    });
  }
  return files;
}

// List one folder of the shared share: its subfolders (names) and files
// (with path-aware action URLs). `p` is "" for the root.
async function listSharedDir(p) {
  const share = shareServiceClient.getShareClient(SHARED_FILE_SHARE);
  await share.createIfNotExists();
  const dir = p ? share.getDirectoryClient(p) : share.rootDirectoryClient;
  const q = p ? `path=${encodeURIComponent(p)}&` : "";
  const folders = [];
  const files = [];
  for await (const item of dir.listFilesAndDirectories()) {
    if (item.kind === "directory") {
      folders.push(item.name);
    } else if (item.kind === "file") {
      files.push({
        name: item.name,
        url: `/shared/download?${q}name=${encodeURIComponent(item.name)}`,
        shareUrl: `/shared/share?${q}name=${encodeURIComponent(item.name)}`,
        renameUrl: `/shared/rename?${q}name=${encodeURIComponent(item.name)}`,
        size: item.properties && item.properties.contentLength,
        lastModified: item.properties && item.properties.lastModified,
      });
    }
  }
  folders.sort((a, b) => a.localeCompare(b));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { folders, files };
}

// ---------- Dashboard ----------
router.get("/dashboard", async (req, res, next) => {
  try {
    const user = currentUser(req);
    // Each stat is independent; if one service is unreachable, show "n/a" rather
    // than failing the whole page.
    let myFiles = "n/a", shared = "n/a", members = "n/a", storage = null, bd = null;
    try {
      const f = await listUserFiles(user.rowKey);
      myFiles = f.length;
      storage = usage(f, MAX_FILES_PER_USER, MAX_BYTES_PER_USER);
      bd = breakdown(f);
    } catch (e) { /* keep "n/a" */ }
    try { shared = (await listSharedDir("")).files.length; } catch (e) { /* keep "n/a" */ }
    try { members = (await listUsers()).length; } catch (e) { /* keep "n/a" */ }
    res.send(renderDashboard({ user, myFiles, shared, members, storage, breakdown: bd, flash: takeFlash(req) }));
  } catch (err) {
    next(err);
  }
});

// ---------- My Files (Blob) ----------
router.get("/files", async (req, res, next) => {
  try {
    const user = currentUser(req);
    const files = await listUserFiles(user.rowKey);
    res.send(renderFiles({ user, files, flash: takeFlash(req) }));
  } catch (err) {
    next(err);
  }
});

router.post("/files/upload", handleUpload("/files"), async (req, res, next) => {
  try {
    const user = currentUser(req);
    if (!req.file) return res.redirect("/files");
    const name = safeName(req.file.originalname);
    if (!name) {
      setFlash(req, "error", "That file name can't be stored. Please rename the file and try again.");
      return res.redirect("/files");
    }
    const extError = checkExtension(name);
    if (extError) {
      setFlash(req, "error", extError);
      return res.redirect("/files");
    }
    const existing = await listUserFiles(user.rowKey);
    const quotaError = checkQuota(existing, name, req.file.size, MAX_FILES_PER_USER, MAX_BYTES_PER_USER);
    if (quotaError) {
      setFlash(req, "error", quotaError);
      return res.redirect("/files");
    }
    const container = userContainer(user.rowKey);
    await container.createIfNotExists();
    await container.getBlockBlobClient(name).uploadData(req.file.buffer, {
      blobHTTPHeaders: { blobContentType: req.file.mimetype },
    });
    res.redirect("/files");
  } catch (err) {
    next(err);
  }
});

// Stream a blob from the signed-in user's own container (private containers, so
// we proxy the bytes). Used for inline image previews and downloads.
router.get("/files/blob/:name", async (req, res, next) => {
  try {
    const user = currentUser(req);
    if (!isValidLeaf(req.params.name)) return res.status(400).send("Invalid file name");
    const blob = userContainer(user.rowKey).getBlobClient(req.params.name);
    if (!(await blob.exists())) return res.status(404).send("Not found");
    const download = await blob.download();
    if (download.contentType) res.set("Content-Type", download.contentType);
    res.set("X-Content-Type-Options", "nosniff");
    const body = download.readableStreamBody;
    if (!body) return res.status(204).end();
    // Handle a mid-transfer Azure stream error without crashing the process.
    pipeline(body, res, (e) => {
      if (e && !res.headersSent) next(e);
      else if (e) res.destroy(e);
    });
  } catch (err) {
    next(err);
  }
});

// Delete one of the signed-in user's own blobs.
router.post("/files/delete", async (req, res, next) => {
  try {
    const user = currentUser(req);
    const name = req.body.name;
    if (!isValidLeaf(name)) {
      setFlash(req, "error", "Invalid file name.");
      return res.redirect("/files");
    }
    await userContainer(user.rowKey).getBlockBlobClient(name).deleteIfExists();
    setFlash(req, "success", `Deleted “${name}”.`);
    res.redirect("/files");
  } catch (err) {
    next(err);
  }
});

// Generate a time-limited, read-only shareable link (SAS URL) for one of the
// user's own blobs. The link works without signing in, until it expires.
router.get("/files/share/:name", async (req, res, next) => {
  try {
    const user = currentUser(req);
    if (!isValidLeaf(req.params.name)) return res.status(400).send("Invalid file name");
    const blob = userContainer(user.rowKey).getBlobClient(req.params.name);
    if (!(await blob.exists())) return res.status(404).send("Not found");
    const expiresOn = new Date(Date.now() + SAS_TTL_MS);
    const url = await blob.generateSasUrl({ permissions: BlobSASPermissions.parse("r"), expiresOn });
    res.send(renderShareLink({ user, name: req.params.name, url, expiresOn, backHref: "/files" }));
  } catch (err) {
    next(err);
  }
});

// Rename a blob. Blobs can't be renamed in place, so we copy to the new name
// and delete the old one.
router.get("/files/rename/:name", async (req, res, next) => {
  try {
    const user = currentUser(req);
    if (!isValidLeaf(req.params.name)) return res.status(400).send("Invalid file name");
    res.send(renderRename({ user, name: req.params.name, action: "/files/rename", hidden: { oldName: req.params.name }, backHref: "/files", active: "files" }));
  } catch (err) {
    next(err);
  }
});

router.post("/files/rename", async (req, res, next) => {
  try {
    const user = currentUser(req);
    const oldName = req.body.oldName;
    if (!isValidLeaf(oldName)) {
      setFlash(req, "error", "Invalid file name.");
      return res.redirect("/files");
    }
    const newName = safeName(req.body.newName);
    if (!newName) {
      setFlash(req, "error", "Please enter a valid new name.");
      return res.redirect("/files");
    }
    const extError = checkExtension(newName);
    if (extError) {
      setFlash(req, "error", extError);
      return res.redirect("/files");
    }
    if (newName === oldName) return res.redirect("/files");
    const container = userContainer(user.rowKey);
    const src = container.getBlobClient(oldName);
    if (!(await src.exists())) {
      setFlash(req, "error", "That file no longer exists.");
      return res.redirect("/files");
    }
    if (await container.getBlobClient(newName).exists()) {
      setFlash(req, "error", `A file named “${newName}” already exists.`);
      return res.redirect("/files");
    }
    const props = await src.getProperties();
    const buffer = await src.downloadToBuffer();
    await container.getBlockBlobClient(newName).uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: props.contentType || "application/octet-stream" },
    });
    await container.getBlockBlobClient(oldName).deleteIfExists();
    setFlash(req, "success", `Renamed to “${newName}”.`);
    res.redirect("/files");
  } catch (err) {
    next(err);
  }
});

// ---------- Shared Files (Azure Files): folder browser ----------
router.get("/shared", async (req, res, next) => {
  try {
    const user = currentUser(req);
    const p = sanitizePath(req.query.path);
    if (p === null) {
      setFlash(req, "error", "Invalid folder path.");
      return res.redirect("/shared");
    }
    let listing;
    try {
      listing = await listSharedDir(p);
    } catch (e) {
      // A missing subfolder: bounce to the root. A failure at the root itself
      // (e.g. the service is unreachable) must NOT redirect to /shared, which
      // would loop, so surface it as an error instead.
      if (!p) throw e;
      setFlash(req, "error", "That folder no longer exists.");
      return res.redirect("/shared");
    }
    res.send(renderShared({ user, path: p, folders: listing.folders, files: listing.files, flash: takeFlash(req) }));
  } catch (err) {
    next(err);
  }
});

router.post("/shared/upload", handleUpload((req) => sharedBack(sanitizePath(req.body.path) || "")), async (req, res, next) => {
  try {
    const p = sanitizePath(req.body.path);
    if (p === null) {
      setFlash(req, "error", "Invalid folder path.");
      return res.redirect("/shared");
    }
    const back = sharedBack(p);
    if (!req.file) return res.redirect(back);
    const name = safeName(req.file.originalname);
    if (!name) {
      setFlash(req, "error", "That file name can't be stored. Please rename the file and try again.");
      return res.redirect(back);
    }
    const extError = checkExtension(name);
    if (extError) {
      setFlash(req, "error", extError);
      return res.redirect(back);
    }
    const { files } = await listSharedDir(p);
    const quotaError = checkQuota(files, name, req.file.size, MAX_FILES_SHARED, MAX_BYTES_SHARED);
    if (quotaError) {
      setFlash(req, "error", quotaError);
      return res.redirect(back);
    }
    await sharedDir(p).getFileClient(name).uploadData(req.file.buffer, {
      fileHttpHeaders: { fileContentType: req.file.mimetype },
    });
    res.redirect(back);
  } catch (err) {
    next(err);
  }
});

// Create a subfolder in the current folder.
router.post("/shared/folder", async (req, res, next) => {
  try {
    const p = sanitizePath(req.body.path);
    if (p === null) {
      setFlash(req, "error", "Invalid folder path.");
      return res.redirect("/shared");
    }
    const back = sharedBack(p);
    const name = safeName(req.body.name);
    if (!name) {
      setFlash(req, "error", "Please enter a valid folder name.");
      return res.redirect(back);
    }
    const childPath = p ? p + "/" + name : name;
    const share = shareServiceClient.getShareClient(SHARED_FILE_SHARE);
    await share.createIfNotExists();
    await share.getDirectoryClient(childPath).createIfNotExists();
    setFlash(req, "success", `Folder “${name}” created.`);
    res.redirect(back);
  } catch (err) {
    next(err);
  }
});

// Delete an (empty) subfolder.
router.post("/shared/folder/delete", async (req, res, next) => {
  try {
    const p = sanitizePath(req.body.path);
    if (p === null) {
      setFlash(req, "error", "Invalid folder path.");
      return res.redirect("/shared");
    }
    const back = sharedBack(p);
    const name = req.body.name;
    if (!isValidLeaf(name)) {
      setFlash(req, "error", "Invalid folder name.");
      return res.redirect(back);
    }
    const childPath = p ? p + "/" + name : name;
    try {
      await shareServiceClient.getShareClient(SHARED_FILE_SHARE).getDirectoryClient(childPath).deleteIfExists();
      setFlash(req, "success", `Deleted folder “${name}”.`);
    } catch (e) {
      // Azure Files won't delete a non-empty directory.
      setFlash(req, "error", `Couldn't delete “${name}”. Empty the folder first.`);
    }
    res.redirect(back);
  } catch (err) {
    next(err);
  }
});

router.get("/shared/download", async (req, res, next) => {
  try {
    const p = sanitizePath(req.query.path);
    const name = req.query.name;
    if (p === null || !isValidLeaf(name)) return res.status(400).send("Invalid request");
    const fileClient = sharedDir(p).getFileClient(name);
    if (!(await fileClient.exists())) return res.status(404).send("Not found");
    const download = await fileClient.download();
    const headerName = String(name).replace(/["\r\n]/g, "");
    res.set("Content-Disposition", `attachment; filename="${headerName}"`);
    if (download.contentType) res.set("Content-Type", download.contentType);
    res.set("X-Content-Type-Options", "nosniff");
    const body = download.readableStreamBody;
    if (!body) return res.status(204).end();
    pipeline(body, res, (e) => {
      if (e && !res.headersSent) next(e);
      else if (e) res.destroy(e);
    });
  } catch (err) {
    next(err);
  }
});

// Delete a file from the shared area (any signed-in member may do this).
router.post("/shared/delete", async (req, res, next) => {
  try {
    const p = sanitizePath(req.body.path);
    if (p === null) {
      setFlash(req, "error", "Invalid folder path.");
      return res.redirect("/shared");
    }
    const back = sharedBack(p);
    const name = req.body.name;
    if (!isValidLeaf(name)) {
      setFlash(req, "error", "Invalid file name.");
      return res.redirect(back);
    }
    await sharedDir(p).getFileClient(name).deleteIfExists();
    setFlash(req, "success", `Deleted “${name}”.`);
    res.redirect(back);
  } catch (err) {
    next(err);
  }
});

// Time-limited, read-only shareable link (SAS URL) for a shared file.
router.get("/shared/share", async (req, res, next) => {
  try {
    const user = currentUser(req);
    const p = sanitizePath(req.query.path);
    const name = req.query.name;
    if (p === null || !isValidLeaf(name)) return res.status(400).send("Invalid request");
    const fileClient = sharedDir(p).getFileClient(name);
    if (!(await fileClient.exists())) return res.status(404).send("Not found");
    const expiresOn = new Date(Date.now() + SAS_TTL_MS);
    const url = await fileClient.generateSasUrl({ permissions: FileSASPermissions.parse("r"), expiresOn });
    res.send(renderShareLink({ user, name, url, expiresOn, backHref: sharedBack(p) }));
  } catch (err) {
    next(err);
  }
});

// Rename a shared file (copy + delete, within its folder).
router.get("/shared/rename", async (req, res, next) => {
  try {
    const user = currentUser(req);
    const p = sanitizePath(req.query.path);
    const name = req.query.name;
    if (p === null || !isValidLeaf(name)) return res.status(400).send("Invalid request");
    res.send(renderRename({ user, name, action: "/shared/rename", hidden: { oldName: name, path: p }, backHref: sharedBack(p), active: "shared" }));
  } catch (err) {
    next(err);
  }
});

router.post("/shared/rename", async (req, res, next) => {
  try {
    const p = sanitizePath(req.body.path);
    if (p === null) {
      setFlash(req, "error", "Invalid folder path.");
      return res.redirect("/shared");
    }
    const back = sharedBack(p);
    const oldName = req.body.oldName;
    if (!isValidLeaf(oldName)) {
      setFlash(req, "error", "Invalid file name.");
      return res.redirect(back);
    }
    const newName = safeName(req.body.newName);
    if (!newName) {
      setFlash(req, "error", "Please enter a valid new name.");
      return res.redirect(back);
    }
    const extError = checkExtension(newName);
    if (extError) {
      setFlash(req, "error", extError);
      return res.redirect(back);
    }
    if (newName === oldName) return res.redirect(back);
    const dir = sharedDir(p);
    const src = dir.getFileClient(oldName);
    if (!(await src.exists())) {
      setFlash(req, "error", "That file no longer exists.");
      return res.redirect(back);
    }
    if (await dir.getFileClient(newName).exists()) {
      setFlash(req, "error", `A file named “${newName}” already exists here.`);
      return res.redirect(back);
    }
    const props = await src.getProperties();
    const buffer = await src.downloadToBuffer();
    await dir.getFileClient(newName).uploadData(buffer, {
      fileHttpHeaders: { fileContentType: props.contentType || "application/octet-stream" },
    });
    await src.deleteIfExists();
    setFlash(req, "success", `Renamed to “${newName}”.`);
    res.redirect(back);
  } catch (err) {
    next(err);
  }
});

// ---------- Members (Table) ----------
router.get("/members", async (req, res, next) => {
  try {
    const user = currentUser(req);
    const members = await listUsers();
    res.send(renderMembers({ user, members, flash: takeFlash(req) }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
