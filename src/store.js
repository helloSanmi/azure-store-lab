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
    tier: row.access_tier || "Hot",
    lastModified: row.uploaded_at,
    url: `/files/blob/${id}`,
    shareUrl: `/files/share/${id}`,
    renameUrl: `/files/rename/${id}`,
    tierUrl: `/files/tier/${id}`,
  };
}

async function listUserFiles(ownerId) {
  const r = await query(
    "SELECT id, display_name, content_type, size_bytes, access_tier, uploaded_at FROM dbo.files WHERE owner_id = @owner ORDER BY uploaded_at DESC",
    { owner: [sql.UniqueIdentifier, ownerId] }
  );
  return r.recordset.map(toFile);
}

async function getFile(ownerId, fileId) {
  const r = await query(
    "SELECT id, display_name, content_type, size_bytes, access_tier, uploaded_at FROM dbo.files WHERE owner_id = @owner AND id = @id",
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

// Set a file's Azure Blob access tier (Hot / Cool / Archive). Just a metadata
// UPDATE here; the route also asks Blob Storage to move the bytes to that tier.
async function setFileTier(ownerId, fileId, tier) {
  await query("UPDATE dbo.files SET access_tier = @tier WHERE owner_id = @owner AND id = @id", {
    owner: [sql.UniqueIdentifier, ownerId],
    id: [sql.UniqueIdentifier, fileId],
    tier: [sql.NVarChar(20), tier],
  });
}

// ---------- Account ----------

async function updateUserName(userId, name) {
  await query("UPDATE dbo.users SET name = @name WHERE id = @id", {
    id: [sql.UniqueIdentifier, userId],
    name: [sql.NVarChar(200), String(name).trim()],
  });
}

// Delete the account row. The FKs (ON DELETE CASCADE) remove the user's file
// rows and activity automatically; the route removes the blob container too.
async function deleteUser(userId) {
  await query("DELETE FROM dbo.users WHERE id = @id", { id: [sql.UniqueIdentifier, userId] });
}

// ---------- Activity (append-only log) ----------

async function logActivity({ actorId, action, target, area }) {
  await query(
    "INSERT INTO dbo.activity (actor_id, action, target, area) VALUES (@actor, @action, @target, @area)",
    {
      actor: [sql.UniqueIdentifier, actorId],
      action: [sql.NVarChar(40), action],
      target: [sql.NVarChar(255), target || null],
      area: [sql.NVarChar(20), area],
    }
  );
}

// Recent activity a viewer may see: everything in the shared area, plus the
// viewer's own private/account actions (so nobody sees others' private files).
async function listActivity(viewerId, limit) {
  const r = await query(
    `SELECT TOP (@limit) a.action, a.target, a.area, a.created_at, u.name AS actor_name
       FROM dbo.activity a JOIN dbo.users u ON u.id = a.actor_id
       WHERE a.area = 'shared' OR a.actor_id = @viewer
       ORDER BY a.created_at DESC`,
    { viewer: [sql.UniqueIdentifier, viewerId], limit: [sql.Int, Number(limit) || 10] }
  );
  return r.recordset.map((row) => ({
    action: row.action,
    target: row.target,
    area: row.area,
    actorName: row.actor_name,
    createdAt: row.created_at,
  }));
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
  setFileTier,
  updateUserName,
  deleteUser,
  logActivity,
  listActivity,
};

// In demo mode, swap the whole store for the in-memory one (same interface).
const { isDemo } = require("./demo");
module.exports = isDemo ? require("./demoBackend").store : sqlStore;
