// Azure Storage demo: a small authenticated app over three Azure Storage services:
//   Table Storage -> user accounts + members list
//   Blob Storage  -> each user's private files
//   Azure Files   -> one shared file area
//
// Passwordless sign in / sign up; sessions via express-session. See README.md.

const path = require("path");

// Load .env from the project root regardless of where `node` is launched from.
require("dotenv").config({ path: path.join(__dirname, ".env") });

// Warn (but DON'T crash) if the connection string is missing or doesn't look
// like a real one. The app still starts and serves pages; storage features stay
// disabled until a valid connection string is set and the app is restarted.
// This keeps a fresh deploy (and its health checks) alive before config is set.
const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING;
const looksLikeConnString =
  !!CONN &&
  (/(^|;)\s*(AccountKey|SharedAccessSignature)=/.test(CONN) || /UseDevelopmentStorage=true/i.test(CONN));
if (!looksLikeConnString) {
  console.warn(
    "\n[config] AZURE_STORAGE_CONNECTION_STRING is " +
      (CONN ? "set but doesn't look like a connection string (it may be just the access key)." : "not set.") +
      "\n  The app will start, but storage features are disabled until you set a valid\n" +
      "  connection string (Storage account -> Access keys -> Connection string) and\n" +
      "  restart. It should start with 'DefaultEndpointsProtocol=' and include\n" +
      "  'AccountKey=' and 'EndpointSuffix='.\n"
  );
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
