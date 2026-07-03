// Tiny session helpers. "Passwordless" auth: the session simply remembers which
// account is signed in. The session itself is signed cookie-backed (express-session).

const { configured: storageConfigured } = require("./azureClients");
const { configured: dbConfigured } = require("./db");
const { renderNotConfigured } = require("./views");

// The signed-in account, or null.
function currentUser(req) {
  return req.session && req.session.user ? req.session.user : null;
}

// Gate for routes that touch Azure Storage (Blob / Files). When the storage
// connection string isn't set, show a friendly "setup needed" page instead of
// crashing on a null client. (Routes that render without storage skip this.)
function requireStorage(req, res, next) {
  if (storageConfigured) return next();
  return res.status(503).send(renderNotConfigured());
}

// Gate for routes that touch the SQL database (accounts, file metadata).
function requireDb(req, res, next) {
  if (dbConfigured) return next();
  return res.status(503).send(renderNotConfigured());
}

// Gate for pages that require a signed-in user.
function requireAuth(req, res, next) {
  if (currentUser(req)) return next();
  setFlash(req, "error", "Please sign in to continue.");
  return res.redirect("/login");
}

// One-shot flash message: set it, then takeFlash() reads and clears it.
function setFlash(req, type, text) {
  if (req.session) req.session.flash = { type, text };
}

function takeFlash(req) {
  if (!req.session || !req.session.flash) return null;
  const flash = req.session.flash;
  delete req.session.flash;
  return flash;
}

module.exports = { currentUser, requireAuth, requireStorage, requireDb, setFlash, takeFlash };
