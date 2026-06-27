// Azure Storage demo: a small authenticated app over three Azure Storage services:
//   Table Storage -> user accounts + members list
//   Blob Storage  -> each user's private files
//   Azure Files   -> one shared file area
//
// Passwordless sign in / sign up; sessions via express-session. See README.md.

const path = require("path");

// Load .env from the project root regardless of where `node` is launched from.
require("dotenv").config({ path: path.join(__dirname, ".env") });

// Fail fast with a friendly message (not a stack trace) if config is missing or
// doesn't look like a real connection string (e.g. just the access key pasted in).
const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING;
const looksLikeConnString =
  !!CONN &&
  (/(^|;)\s*(AccountKey|SharedAccessSignature)=/.test(CONN) || /UseDevelopmentStorage=true/i.test(CONN));
if (!looksLikeConnString) {
  console.error(
    "\n[config] AZURE_STORAGE_CONNECTION_STRING is " +
      (CONN ? "set but doesn't look like a connection string (it may be just the access key)." : "not set.") +
      "\n  1. Copy .env.example to .env in the project root.\n" +
      "  2. In the Azure Portal: Storage account -> Access keys -> copy the\n" +
      "     *Connection string* field (NOT the shorter Key field).\n" +
      "  3. It should start with 'DefaultEndpointsProtocol=' and include\n" +
      "     'AccountKey=' and 'EndpointSuffix='.\n"
  );
  process.exit(1);
}

const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
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

app.listen(PORT, () => {
  console.log(`Azure Storage demo running at http://localhost:${PORT}`);
});
