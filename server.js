// Azure Store Lab: a small authenticated app spanning a database and storage:
//   Azure SQL    -> user accounts + file metadata (the queryable "truth")
//   Blob Storage -> each user's private file bytes (keyed by the file's id)
//   Azure Files  -> one shared file area (folders + bytes)
//
// Passwordless sign in / sign up; sessions via express-session. See README.md.

const path = require("path");

// Load .env from the project root regardless of where `node` is launched from.
require("dotenv").config({ path: path.join(__dirname, ".env") });

const { isDemo } = require("./src/demo");

if (isDemo) {
  console.log(
    "\n[demo] DEMO MODE: using in-memory data, no Azure needed. Sign in with any\n" +
      "  email (or click 'Explore as demo user'). Everything resets on restart.\n"
  );
} else {
  // Warn (but DON'T crash) if config is missing or doesn't look like a real
  // connection string. The app still starts and serves pages; the affected
  // features show a "setup needed" page until config is set and the app restarts.
  const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const looksLikeConnString =
    !!CONN &&
    (/(^|;)\s*(AccountKey|SharedAccessSignature)=/.test(CONN) || /UseDevelopmentStorage=true/i.test(CONN));
  if (!looksLikeConnString) {
    console.warn(
      "\n[config] AZURE_STORAGE_CONNECTION_STRING is " +
        (CONN ? "set but doesn't look like a connection string (it may be just the access key)." : "not set.") +
        "\n  Storage features are disabled until you set a valid connection string\n" +
        "  (Storage account -> Access keys -> Connection string) and restart.\n" +
        "  Tip: run `npm run demo` to explore with in-memory data instead.\n"
    );
  }
  if (!process.env.AZURE_SQL_CONNECTION_STRING) {
    console.warn(
      "[config] AZURE_SQL_CONNECTION_STRING is not set. Accounts and My Files are " +
        "disabled until you set it and restart. (Or run `npm run demo`.)"
    );
  }
}

const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const db = require("./src/db");
const { renderError } = require("./src/views");

const app = express();
const PORT = process.env.PORT || 3000;

// Sign session cookies with SESSION_SECRET if set, otherwise a random secret
// generated per restart. Never a hardcoded constant (that would let anyone forge
// a session). A random secret means sessions reset when the app restarts.
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.SESSION_SECRET) {
  console.warn(
    "[config] SESSION_SECRET not set; using a random secret (sessions reset on restart). " +
      "Set SESSION_SECRET in .env for stable sessions."
  );
}

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 8 },
  })
);

// Auth routes first (login/signup/logout + "/"), then the authenticated app.
app.use("/", require("./routes/auth"));
app.use("/", require("./routes/main"));

// 404 for anything unmatched.
app.use((req, res) => {
  res.status(404).send(renderError("Page not found."));
});

// Error handler: log the real error, show a friendly page.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send(renderError(err.message));
});

// Create the DB tables if needed, then start listening. Schema failure is
// non-fatal: the app still boots so it can serve the "setup needed" page.
(async () => {
  if (isDemo) {
    require("./src/demoBackend").seed();
  } else if (db.configured) {
    try {
      await db.ensureSchema();
      console.log("[db] schema ready");
    } catch (err) {
      console.error("[db] could not initialise schema:", err.message);
    }
  }
  app.listen(PORT, () => {
    console.log(`Azure Store Lab running at http://localhost:${PORT}`);
  });
})();
