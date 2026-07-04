// Azure SQL Database access. One connection pool for the whole app, built from
// AZURE_SQL_CONNECTION_STRING (the ADO.NET connection string from the portal).
//
// Like the storage clients, this degrades gracefully: if the connection string
// isn't set, `configured` is false and the app still boots (storage/DB features
// show a "setup needed" page) instead of crash-looping.

const fs = require("fs");
const path = require("path");
const sql = require("mssql");
const { isDemo } = require("./demo");

const connectionString = process.env.AZURE_SQL_CONNECTION_STRING;
// In demo mode the store is in-memory, but requireDb checks this flag, so the
// database "counts as configured" and DB-backed pages work.
const configured = isDemo || !!connectionString;

let poolPromise = null;

// Lazily connect and cache the pool. On failure the promise is cleared so the
// next request retries (e.g. after the DB comes online).
function getPool() {
  if (!configured) throw new Error("Database is not configured (AZURE_SQL_CONNECTION_STRING is not set).");
  if (!poolPromise) {
    poolPromise = sql.connect(connectionString).catch((err) => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

// Run parameterized SQL. `params` is { name: value } or { name: [type, value] }.
// Always use this (never string-concatenate values) to avoid SQL injection.
async function query(text, params) {
  const pool = await getPool();
  const request = pool.request();
  if (params) {
    for (const [name, spec] of Object.entries(params)) {
      if (Array.isArray(spec)) request.input(name, spec[0], spec[1]);
      else request.input(name, spec);
    }
  }
  return request.query(text);
}

// Create the tables if they don't exist (runs schema.sql). Idempotent.
// No-op in demo mode (the in-memory store has no schema).
async function ensureSchema() {
  if (isDemo || !connectionString) return;
  const ddl = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");
  const pool = await getPool();
  await pool.request().batch(ddl);
}

module.exports = { sql, getPool, query, ensureSchema, configured };
