// Auth routes: passwordless sign in / sign up backed by Azure SQL.

const express = require("express");
const router = express.Router();

const { findUserByEmail, createUser } = require("../src/store");
const { currentUser, requireDb, setFlash, takeFlash } = require("../src/auth");
const { renderLogin, renderSignup } = require("../src/views");

// Sign a user in: rotate the session id first (prevents session fixation; the
// id changes on this privilege change), then store the user and persist.
function startSession(req, user, flashText, callback) {
  req.session.regenerate((err) => {
    if (err) return callback(err);
    req.session.user = { id: user.id, name: user.name, email: user.email };
    req.session.flash = { type: "success", text: flashText };
    req.session.save(callback);
  });
}

// Land on the dashboard if signed in, otherwise the sign-in page.
router.get("/", (req, res) => {
  res.redirect(currentUser(req) ? "/dashboard" : "/login");
});

router.get("/login", (req, res) => {
  if (currentUser(req)) return res.redirect("/dashboard");
  res.send(renderLogin(takeFlash(req)));
});

router.post("/login", requireDb, async (req, res, next) => {
  try {
    const email = (req.body.email || "").trim().toLowerCase();
    if (!email) {
      setFlash(req, "error", "Please enter your email.");
      return res.redirect("/login");
    }
    const user = await findUserByEmail(email);
    if (!user) {
      setFlash(req, "error", "No account with that email yet. Create one below.");
      return res.redirect("/signup");
    }
    startSession(req, user, `Welcome back, ${user.name}.`, (err) => {
      if (err) return next(err);
      res.redirect("/dashboard");
    });
  } catch (err) {
    next(err);
  }
});

router.get("/signup", (req, res) => {
  if (currentUser(req)) return res.redirect("/dashboard");
  res.send(renderSignup(takeFlash(req)));
});

router.post("/signup", requireDb, async (req, res, next) => {
  try {
    const name = (req.body.name || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();
    if (!name || !email) {
      setFlash(req, "error", "Please enter both your name and email.");
      return res.redirect("/signup");
    }
    // If the email is already registered, just sign them in.
    let user = await findUserByEmail(email);
    let flashText;
    if (user) {
      flashText = "That email already has an account. Signed you in.";
    } else {
      user = await createUser({ name, email });
      flashText = `Account created. Welcome, ${user.name}.`;
    }
    startSession(req, user, flashText, (err) => {
      if (err) return next(err);
      res.redirect("/dashboard");
    });
  } catch (err) {
    next(err);
  }
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

module.exports = router;
