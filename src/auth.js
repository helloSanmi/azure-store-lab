// Tiny session helpers. "Passwordless" auth: the session simply remembers which
// account is signed in. The session itself is signed cookie-backed (express-session).

// The signed-in account, or null.
function currentUser(req) {
  return req.session && req.session.user ? req.session.user : null;
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

module.exports = { currentUser, requireAuth, setFlash, takeFlash };
