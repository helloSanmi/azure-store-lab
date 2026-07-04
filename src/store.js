// Data access for accounts and file metadata: now backed by Azure SQL.
// Everything is parameterized (never string-concatenated) to avoid SQL injection.
// The actual file bytes live in Blob Storage; this module only stores metadata
// and the id that names the blob.

const { randomUUID } = require("crypto");
const { query, sql } = require("./db");

// ---------- Users (accounts) ----------

// SQL Server returns UNIQUEIDENTIFIER values upper-cased; lower-case them so the
// id is a valid Azure container/blob name and matches the blob we stored.
function toUser(row) {
  return { id: String(row.id).toLowerCase(), name: row.name, email: row.email, createdAt: row.created_at };
}

async function listUsers() {
  const r = await query("SELECT id, name, email, created_at FROM dbo.users ORDER BY created_at DESC");
  return r.recordset.map(toUser);
}

async function findUserByEmail(email) {
  const r = await query("SELECT TOP 1 id, name, email, created_at FROM dbo.users WHERE email = @email", {
    email: [sql.NVarChar(320), String(email).trim().toLowerCase()],
  });
  return r.recordset[0] ? toUser(r.recordset[0]) : null;
}

async function createUser({ name, email }) {
  const id = randomUUID();
  const cleanName = String(name).trim();
  const cleanEmail = String(email).trim().toLowerCase();
  await query("INSERT INTO dbo.users (id, name, email) VALUES (@id, @name, @email)", {
    id: [sql.UniqueIdentifier, id],
    name: [sql.NVarChar(200), cleanName],
    email: [sql.NVarChar(320), cleanEmail],
  });
  return { id, name: cleanName, email: cleanEmail };
}

// ---------- Files (My Files metadata; bytes live in Blob Storage) ----------

const IMAGE_TYPES = /^image\//;
function fileExt(name) {
  const i = String(name).lastIndexOf(".");
  return i >= 0 ? String(name).slice(i + 1) : "";
}

// Shape a DB row into what the views expect. URLs are keyed by the file id
// (the blob's name), not the display name: so rename never touches the bytes.
function toFile(row) {
  const id = String(row.id).toLowerCase(); // see note in toUser: match the blob name
  return {
    id,
    name: row.display_name,
    contentType: row.content_type || "",
    isImage: IMAGE_TYPES.test(row.content_type || ""),
    ext: fileExt(row.display_name),
    size: row.size_bytes,
    lastModified: row.uploaded_at,
    url: `/files/blob/${id}`,
    shareUrl: `/files/share/${id}`,
    renameUrl: `/files/rename/${id}`,
  };
}

async function listUserFiles(ownerId) {
  const r = await query(
    "SELECT id, display_name, content_type, size_bytes, uploaded_at FROM dbo.files WHERE owner_id = @owner ORDER BY uploaded_at DESC",
    { owner: [sql.UniqueIdentifier, ownerId] }
  );
  return r.recordset.map(toFile);
}

async function getFile(ownerId, fileId) {
  const r = await query(
    "SELECT id, display_name, content_type, size_bytes, uploaded_at FROM dbo.files WHERE owner_id = @owner AND id = @id",
    { owner: [sql.UniqueIdentifier, ownerId], id: [sql.UniqueIdentifier, fileId] }
  );
  return r.recordset[0] ? toFile(r.recordset[0]) : null;
}

async function fileNameExists(ownerId, name) {
  const r = await query("SELECT TOP 1 1 AS x FROM dbo.files WHERE owner_id = @owner AND display_name = @name", {
    owner: [sql.UniqueIdentifier, ownerId],
    name: [sql.NVarChar(255), name],
  });
  return r.recordset.length > 0;
}

// Files used + bytes used, as a single SQL aggregate (drives the quota + meters).
async function userUsage(ownerId) {
  const r = await query(
    "SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes FROM dbo.files WHERE owner_id = @owner",
    { owner: [sql.UniqueIdentifier, ownerId] }
  );
  const row = r.recordset[0] || {};
  return { count: Number(row.count) || 0, bytes: Number(row.bytes) || 0 };
}

// Insert the metadata row; the returned id becomes the blob's name.
async function createFileRecord({ ownerId, displayName, contentType, sizeBytes }) {
  const id = randomUUID();
  await query(
    "INSERT INTO dbo.files (id, owner_id, display_name, content_type, size_bytes) VALUES (@id, @owner, @name, @type, @size)",
    {
      id: [sql.UniqueIdentifier, id],
      owner: [sql.UniqueIdentifier, ownerId],
      name: [sql.NVarChar(255), displayName],
      type: [sql.NVarChar(150), contentType || null],
      size: [sql.BigInt, Number(sizeBytes) || 0],
    }
  );
  return id;
}

async function deleteFileRecord(ownerId, fileId) {
  await query("DELETE FROM dbo.files WHERE owner_id = @owner AND id = @id", {
    owner: [sql.UniqueIdentifier, ownerId],
    id: [sql.UniqueIdentifier, fileId],
  });
}

// Rename = one UPDATE. The bytes stay put (blob is named by the immutable id).
async function renameFile(ownerId, fileId, newName) {
  await query("UPDATE dbo.files SET display_name = @name WHERE owner_id = @owner AND id = @id", {
    owner: [sql.UniqueIdentifier, ownerId],
    id: [sql.UniqueIdentifier, fileId],
    name: [sql.NVarChar(255), newName],
  });
}

const sqlStore = {
  listUsers,
  findUserByEmail,
  createUser,
  listUserFiles,
  getFile,
  fileNameExists,
  userUsage,
  createFileRecord,
  deleteFileRecord,
  renameFile,
};

// In demo mode, swap the whole store for the in-memory one (same interface).
const { isDemo } = require("./demo");
module.exports = isDemo ? require("./demoBackend").store : sqlStore;
