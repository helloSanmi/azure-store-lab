// All HTML rendering for the app. No templating engine, just functions that
// return strings. Route handlers gather data and call a render* function.

const {
  MAX_FILE_BYTES,
  MAX_FILE_LABEL,
  MAX_FILES_PER_USER,
  MAX_BYTES_PER_USER,
  MAX_FILES_SHARED,
  MAX_BYTES_SHARED,
  ACCEPT_ATTR,
  ALLOWED_EXTENSIONS,
  ALLOWED_LABEL,
  humanSize,
  usage,
  categoryOf,
  breakdown,
} = require("./uploads");
const { isDemo, DEMO_EMAIL } = require("./demo");

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Inline stroke icons (no external assets).
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  files: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  shared: '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 3v13"/><path d="m8 7 4-4 4 4"/>',
  members: '<circle cx="9" cy="8" r="3"/><path d="M2 20a7 7 0 0 1 14 0"/><path d="M16 5a3 3 0 0 1 0 6"/><path d="M22 20a7 7 0 0 0-5-6.7"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  cloud: '<path d="M17.5 19a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.5-1.5A4 4 0 0 0 6 19z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5-5 5 5"/><path d="M12 5v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  folderPlus: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5"/><path d="M9.5 13.5h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
};
function icon(name) {
  // Icons are decorative; adjacent text provides the accessible name.
  return `<svg class="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ""}</svg>`;
}

// The brand mark: a layered "storage stack" (filled top layer + two below).
function brandMark() {
  return `<svg class="icon" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path d="M12 3 3 7.5 12 12l9-4.5L12 3Z" fill="currentColor" fill-opacity="0.92" stroke="none"/>
    <path d="m3 12 9 4.5 9-4.5"/>
    <path d="m3 16.5 9 4.5 9-4.5"/>
  </svg>`;
}

const APP_NAME = "Azure Store Lab";

// Runs in <head> before paint: apply the saved theme (or the OS preference) so
// there's no light-to-dark flash on load. Kept apostrophe/backtick-free.
const THEME_INIT_SCRIPT = `
try { var t = localStorage.getItem("storelab-theme");
  if (!t) t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  if (t === "dark") document.documentElement.setAttribute("data-theme", "dark");
} catch (e) {}
`;

function htmlDoc(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} · ${APP_NAME}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <script>${THEME_INIT_SCRIPT}</script>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>${bodyHtml}</body>
</html>`;
}

function flashHtml(flash) {
  if (!flash) return "";
  return `<div class="flash ${flash.type === "error" ? "error" : "success"}">${esc(flash.text)}</div>`;
}

function initials(name) {
  return String(name || "?")
    .trim()
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// The signed-in app shell: top header + page tab row + content area.
function appShell({ title, active, user, flash, body }) {
  const links = [
    { href: "/dashboard", key: "dashboard", label: "Dashboard", icon: "dashboard" },
    { href: "/files", key: "files", label: "My Files", icon: "files" },
    { href: "/shared", key: "shared", label: "Shared Files", icon: "shared" },
    { href: "/members", key: "members", label: "Members", icon: "members" },
  ]
    .map(
      (l) =>
        `<a href="${l.href}" class="tab${l.key === active ? " active" : ""}"${l.key === active ? ' aria-current="page"' : ""}>${icon(l.icon)}<span>${esc(l.label)}</span></a>`
    )
    .join("");

  const shell = `
  <div class="app">
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="/dashboard">
          <span class="logo">${brandMark()}</span>
          <span class="brand-text">
            <span class="brand-name">${esc(APP_NAME)}</span>${
              isDemo ? '<span class="demo-badge" title="In-memory demo data; resets on restart">Demo</span>' : ""
            }
          </span>
        </a>
        <div class="topbar-actions">
          <button class="icon-btn" type="button" data-theme-toggle title="Toggle dark mode" aria-label="Toggle dark mode">
            <span class="theme-icon theme-icon-dark">${icon("moon")}</span>
            <span class="theme-icon theme-icon-light">${icon("sun")}</span>
          </button>
          <div class="user-chip">
            <span class="avatar">${esc(initials(user.name))}</span>
            <span class="user-meta">
              <span class="who-name">${esc(user.name)}</span>
              <span class="who-email">${esc(user.email)}</span>
            </span>
          </div>
          <form method="post" action="/logout">
            <button class="icon-btn" type="submit" title="Sign out" aria-label="Sign out">${icon("logout")}</button>
          </form>
        </div>
      </div>
      <nav class="tabbar" aria-label="Primary">
        <div class="tabbar-inner">${links}</div>
      </nav>
    </header>
    <main class="content">
      ${flashHtml(flash)}
      ${body}
    </main>
  </div>
  <div class="lightbox" id="lightbox" hidden tabindex="-1"><img alt=""></div>
  <div class="modal" id="confirm-modal" hidden>
    <div class="modal-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-text">
      <h2 id="confirm-title">Confirm deletion</h2>
      <p class="modal-text" id="confirm-text"></p>
      <div class="modal-actions">
        <button class="btn secondary" type="button" data-confirm-cancel>Cancel</button>
        <button class="btn danger" type="button" data-confirm-ok>Delete</button>
      </div>
    </div>
  </div>
  <script>${UPLOAD_WIDGET_SCRIPT}${LIGHTBOX_SCRIPT}${COPY_SCRIPT}${CONFIRM_DELETE_SCRIPT}${FORM_VALIDATION_SCRIPT}${SEARCH_SORT_SCRIPT}${THEME_TOGGLE_SCRIPT}</script>`;

  return htmlDoc(title, shell);
}

// Client-side helper for the upload widget: shows the picked file's name/size,
// validates type + size before submit, and enables the Upload button. Kept free
// of apostrophes so it survives template-literal embedding. The server enforces
// the same rules, so this is purely UX.
const UPLOAD_WIDGET_SCRIPT = `
(function(){
  function human(b){ if(b<1024) return b+" B"; var u=["KB","MB","GB","TB"]; var i=-1; do{ b/=1024; i++; }while(b>=1024 && i<u.length-1); return (b<10?b.toFixed(1):Math.round(b))+" "+u[i]; }
  var forms = document.querySelectorAll(".upload-widget");
  for (var k=0;k<forms.length;k++){ (function(form){
    var input=form.querySelector(".file-input");
    var label=form.querySelector(".file-drop");
    var main=form.querySelector(".file-cta-main");
    var sub=form.querySelector(".file-cta-sub");
    var err=form.querySelector(".file-error");
    var submit=form.querySelector(".upload-submit");
    var max=Number(form.getAttribute("data-max-bytes"))||0;
    var maxLabel=form.getAttribute("data-max-label")||"";
    var allowed=(form.getAttribute("data-allowed")||"").split(",");
    var defMain=main.textContent, defSub=sub.textContent;
    submit.disabled=true; // JS present: gate upload until a valid file is chosen
    function fail(msg){ label.classList.add("has-error"); label.classList.remove("has-file"); err.hidden=false; err.textContent=msg; main.textContent=defMain; sub.textContent=defSub; input.value=""; submit.disabled=true; }
    input.addEventListener("change", function(){
      err.hidden=true; err.textContent=""; label.classList.remove("has-error","has-file"); submit.disabled=true;
      var f=input.files && input.files[0];
      if(!f){ main.textContent=defMain; sub.textContent=defSub; return; }
      var dot=f.name.lastIndexOf("."); var ext=dot>=0?f.name.slice(dot+1).toLowerCase():"";
      if(allowed.length && allowed.indexOf(ext)===-1){ fail("File type " + (ext?"."+ext:"(none)") + " is not allowed."); return; }
      if(max && f.size>max){ fail("That file is "+human(f.size)+", over the "+maxLabel+" limit."); return; }
      label.classList.add("has-file"); main.textContent=f.name; sub.textContent=human(f.size)+" · ready to upload"; submit.disabled=false;
    });
  })(forms[k]); }
})();
`;

// Click an image thumbnail to view it full-size in an overlay; click or Esc to close.
const LIGHTBOX_SCRIPT = `
(function(){
  var box=document.getElementById("lightbox"); if(!box) return;
  var img=box.querySelector("img"); var last=null;
  function close(){ box.hidden=true; img.removeAttribute("src"); if(last && last.focus) last.focus(); }
  document.addEventListener("click", function(e){
    var t=e.target;
    if(t && t.getAttribute && t.getAttribute("data-full")){ e.preventDefault(); last=t; img.setAttribute("src", t.getAttribute("data-full")); img.alt=t.getAttribute("alt")||""; box.hidden=false; box.focus(); return; }
    if(!box.hidden && (t===box || t===img)){ close(); }
  });
  document.addEventListener("keydown", function(e){ if(e.key==="Escape" && !box.hidden) close(); });
})();
`;

// Copy-to-clipboard for any button with data-copy="<selector>".
const COPY_SCRIPT = `
(function(){
  document.addEventListener("click", function(e){
    var btn = e.target.closest && e.target.closest("[data-copy]");
    if(!btn) return;
    var target = document.querySelector(btn.getAttribute("data-copy"));
    if(!target) return;
    var text = target.value || target.textContent;
    function done(){ var old=btn.textContent; btn.textContent="Copied!"; setTimeout(function(){ btn.textContent=old; }, 1500); }
    if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(text).then(done, function(){ try{ target.select(); }catch(_){} done(); }); }
    else { try{ target.select(); document.execCommand("copy"); }catch(_){} done(); }
  });
})();
`;

// Every destructive (.action-form) submit is intercepted and routed through a
// styled confirmation modal instead of the browser's native confirm() dialog.
// The name is read from the form's hidden input and set via textContent only
// (never interpolated into markup or JS source), so no injection is possible.
const CONFIRM_DELETE_SCRIPT = `
(function(){
  var modal = document.getElementById("confirm-modal"); if(!modal) return;
  var text = modal.querySelector(".modal-text");
  var okBtn = modal.querySelector("[data-confirm-ok]");
  var cancelBtn = modal.querySelector("[data-confirm-cancel]");
  var pending = null, lastFocus = null;
  function open(form){
    pending = form;
    var nm = form.getAttribute("data-confirm-label") || "this item";
    text.textContent = "Delete \\"" + nm + "\\"? This can\\u2019t be undone.";
    modal.hidden = false; lastFocus = document.activeElement; if(cancelBtn) cancelBtn.focus();
  }
  function close(){ modal.hidden = true; pending = null; if(lastFocus && lastFocus.focus) lastFocus.focus(); }
  document.addEventListener("submit", function(e){
    var form = e.target;
    if(form && form.classList && form.classList.contains("action-form")){ e.preventDefault(); open(form); }
  });
  modal.addEventListener("click", function(e){
    var t = e.target;
    if(t.hasAttribute && t.hasAttribute("data-confirm-ok")){ var f = pending; close(); if(f) f.submit(); return; }
    if(t === modal || (t.hasAttribute && t.hasAttribute("data-confirm-cancel"))) close();
  });
  document.addEventListener("keydown", function(e){ if(e.key === "Escape" && !modal.hidden) close(); });
})();
`;

// Replace the browser's native validation bubbles with styled inline messages
// on any form.validated. Without JS, native validation still works as fallback.
const FORM_VALIDATION_SCRIPT = `
(function(){
  function labelText(el){
    var l = el.id ? document.querySelector('label[for="' + el.id + '"]') : null;
    return l ? l.textContent.trim().toLowerCase() : (el.getAttribute("aria-label") || "this field");
  }
  function message(el){
    var v = el.validity;
    if(v.valueMissing) return "Please enter your " + labelText(el) + ".";
    if(v.typeMismatch && el.type === "email") return "Please enter a valid email address.";
    return el.validationMessage || "Please check this field.";
  }
  function errorEl(input){
    var n = input.nextElementSibling;
    if(n && n.classList && n.classList.contains("field-error")) return n;
    var e = document.createElement("small");
    e.className = "field-error"; e.setAttribute("role", "alert"); e.hidden = true;
    input.insertAdjacentElement("afterend", e);
    return e;
  }
  function clear(input){ input.classList.remove("invalid"); input.removeAttribute("aria-invalid"); var e = errorEl(input); e.textContent = ""; e.hidden = true; }
  function fail(input){ var e = errorEl(input); e.textContent = message(input); e.hidden = false; input.classList.add("invalid"); input.setAttribute("aria-invalid", "true"); }
  var forms = document.querySelectorAll("form.validated");
  for(var i=0;i<forms.length;i++){ (function(form){
    form.setAttribute("novalidate", "");
    form.addEventListener("submit", function(e){
      var fields = form.querySelectorAll("input[required], input[type=email]");
      var firstBad = null;
      for(var j=0;j<fields.length;j++){
        if(!fields[j].checkValidity()){ fail(fields[j]); if(!firstBad) firstBad = fields[j]; }
        else clear(fields[j]);
      }
      if(firstBad){ e.preventDefault(); firstBad.focus(); }
    });
    form.addEventListener("input", function(e){
      if(e.target.classList && e.target.classList.contains("invalid")) clear(e.target);
    });
  })(forms[i]); }
})();
`;

// Client-side search + sort for any [data-browse] container (items carry
// data-name/data-size/data-date; folders carry data-folder and stay on top).
const SEARCH_SORT_SCRIPT = `
(function(){
  var roots = document.querySelectorAll("[data-browse]");
  for(var b=0;b<roots.length;b++){ (function(root){
    var search = root.querySelector("[data-search]");
    var sort = root.querySelector("[data-sort]");
    var list = root.querySelector("[data-items]");
    var empty = root.querySelector("[data-no-matches]");
    if(!list) return;
    function items(){ return Array.prototype.slice.call(list.children).filter(function(el){ return el.hasAttribute("data-name"); }); }
    function apply(){
      var q = ((search && search.value) || "").trim().toLowerCase();
      var visible = 0;
      items().forEach(function(el){
        var show = !q || (el.getAttribute("data-name")||"").toLowerCase().indexOf(q) !== -1;
        el.hidden = !show; if(show) visible++;
      });
      if(empty) empty.hidden = visible !== 0;
    }
    function sortBy(key){
      var els = items();
      els.sort(function(a,b){
        var af = a.hasAttribute("data-folder")?0:1, bf = b.hasAttribute("data-folder")?0:1;
        if(af !== bf) return af - bf;
        if(key==="size") return (Number(b.getAttribute("data-size"))||0) - (Number(a.getAttribute("data-size"))||0);
        if(key==="date") return (Number(b.getAttribute("data-date"))||0) - (Number(a.getAttribute("data-date"))||0);
        return (a.getAttribute("data-name")||"").localeCompare(b.getAttribute("data-name")||"");
      });
      els.forEach(function(el){ list.appendChild(el); });
    }
    if(search) search.addEventListener("input", apply);
    if(sort) sort.addEventListener("change", function(){ sortBy(sort.value); });
  })(roots[b]); }
})();
`;

// Toggle light/dark and remember the choice. The no-flash init in <head> applies
// it on the next load; this just flips it live.
const THEME_TOGGLE_SCRIPT = `
(function(){
  document.addEventListener("click", function(e){
    var btn = e.target.closest && e.target.closest("[data-theme-toggle]");
    if(!btn) return;
    var dark = document.documentElement.getAttribute("data-theme") === "dark";
    if(dark) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", "dark");
    try{ localStorage.setItem("storelab-theme", dark ? "light" : "dark"); }catch(_){}
  });
})();
`;

function pageHeader(title, subtitle, serviceTag) {
  return `<div class="page-header">
    <h1>${esc(title)}</h1>
    ${subtitle ? `<p>${esc(subtitle)}</p>` : ""}
    ${serviceTag ? `<span class="service-tag">${esc(serviceTag)}</span>` : ""}
  </div>`;
}

// Polished single-file upload widget. The limits/types are shown up front; a
// small script (in appShell) validates the picked file client-side and enables
// the Upload button. The server enforces the same rules regardless.
function uploadForm(action, heading, extraFields) {
  return `<div class="card upload-card">
    <h2 class="section-title">${esc(heading)}</h2>
    <form class="upload-widget" method="post" action="${action}" enctype="multipart/form-data"
          data-max-bytes="${MAX_FILE_BYTES}" data-max-label="${esc(MAX_FILE_LABEL)}"
          data-allowed="${esc(ALLOWED_EXTENSIONS.join(","))}">
      ${extraFields || ""}
      <label class="file-drop">
        <input type="file" name="file" class="file-input" accept="${esc(ACCEPT_ATTR)}" required aria-label="Choose a file to upload">
        <span class="file-cta">
          ${icon("upload")}
          <span class="file-cta-text">
            <span class="file-cta-main">Choose a file</span>
            <span class="file-cta-sub">Max ${esc(MAX_FILE_LABEL)} · ${esc(ALLOWED_LABEL)}</span>
          </span>
        </span>
      </label>
      <p class="file-error" role="alert" hidden></p>
      <!-- Enabled by default so uploads still work without JS; the script below
           disables it until a valid file is picked when JS is available. -->
      <button class="btn upload-submit" type="submit">Upload</button>
    </form>
  </div>`;
}

// A collapsible panel listing the Azure SDK calls a page uses; this is a
// teaching demo, so we make the operations visible. `calls` is [{op, call}].
function explainer(calls) {
  const items = calls
    .map((c) => `<li><span class="op">${esc(c.op)}</span><code>${esc(c.call)}</code></li>`)
    .join("");
  return `<details class="explainer">
    <summary>${icon("cloud")} Behind the scenes: the Azure SDK calls this page uses</summary>
    <ul>${items}</ul>
  </details>`;
}

// Teaching panel: why accounts live in a relational database, not NoSQL storage.
function nosqlVsSqlPanel() {
  return `<details class="explainer">
    <summary>${icon("cloud")} NoSQL vs SQL: why accounts live in a database</summary>
    <div class="compare">
      <div>
        <h4>Azure Table Storage (NoSQL)</h4>
        <ul>
          <li>Key-value: PartitionKey + RowKey</li>
          <li>Schema-less; no relationships or JOINs</li>
          <li>Very cheap, huge scale, simple lookups</li>
          <li>Great for logs, events, telemetry</li>
        </ul>
      </div>
      <div>
        <h4>Azure SQL (relational)</h4>
        <ul>
          <li>Tables with a fixed schema, types, constraints</li>
          <li>Primary &amp; foreign keys, JOINs, transactions</li>
          <li>Rich queries: WHERE, ORDER BY, COUNT, SUM</li>
          <li>Great when data is related and queried many ways</li>
        </ul>
      </div>
    </div>
    <p class="compare-note">This app uses SQL because a user <strong>has many</strong> files (a relationship) and we constantly search, sort, and count them. That's exactly what a relational database is for.</p>
  </details>`;
}

function meterState(pct) {
  return pct >= 90 ? "full" : pct >= 70 ? "warn" : "ok";
}

// A small two-bar usage meter (files used / max, storage used / max).
function usageMeter(u, compact) {
  if (!u) return "";
  const row = (label, used, max, pct) => `
    <div class="usage-row">
      <div class="usage-head"><span>${esc(label)}</span><span class="muted">${esc(used)} <span class="usage-sep">/</span> ${esc(max)}</span></div>
      <div class="meter"><div class="meter-fill ${meterState(pct)}" style="width:${pct}%"></div></div>
    </div>`;
  return `<div class="usage card${compact ? " compact" : ""}">
    ${row("Files", String(u.count), String(u.maxFiles), u.pctFiles)}
    ${row("Storage", humanSize(u.bytes), humanSize(u.maxBytes), u.pctBytes)}
  </div>`;
}

function emptyState(text) {
  return `<div class="empty">${icon("files")}<p>${esc(text)}</p></div>`;
}

function dateMs(value) {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return isNaN(t) ? 0 : t;
}

// Search box + sort selector for a [data-browse] list.
function toolbar() {
  return `<div class="toolbar">
    <div class="search-box">
      ${icon("search")}
      <input type="search" data-search placeholder="Search by name…" aria-label="Search files">
    </div>
    <label class="sort-box">Sort
      <select data-sort aria-label="Sort files">
        <option value="name">Name (A-Z)</option>
        <option value="date">Newest</option>
        <option value="size">Largest</option>
      </select>
    </label>
  </div>`;
}

// Folder breadcrumbs for the shared file browser.
function breadcrumbs(path) {
  const parts = path ? path.split("/") : [];
  let cum = "";
  const crumbs = [`<a href="/shared">Home</a>`];
  for (const part of parts) {
    cum = cum ? cum + "/" + part : part;
    crumbs.push(`<a href="/shared?path=${encodeURIComponent(cum)}">${esc(part)}</a>`);
  }
  return `<nav class="crumbs" aria-label="Breadcrumb">${crumbs.join('<span class="sep">›</span>')}</nav>`;
}

function newFolderForm(path) {
  return `<form class="new-folder validated" method="post" action="/shared/folder">
    <input type="hidden" name="path" value="${esc(path)}">
    <input type="text" name="name" placeholder="New folder name" aria-label="New folder name" required>
    <button class="btn secondary" type="submit">${icon("folderPlus")} New folder</button>
  </form>`;
}

// A donut of storage used (by category) vs the limit, with a legend.
function storageCard(storage, bd) {
  const max = storage.maxBytes || 1;
  const cats = [
    { key: "image", label: "Images", color: "#059669" },
    { key: "doc", label: "Documents", color: "#2563eb" },
    { key: "video", label: "Video", color: "#7c3aed" },
  ];
  const cx = 64, cy = 64, r = 54, sw = 16, C = 2 * Math.PI * r;
  let offset = 0;
  const arcs = cats
    .map((cat) => {
      const val = (bd && bd[cat.key]) || 0;
      if (val <= 0) return "";
      const len = Math.min(C, (val / max) * C);
      const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${cat.color}" stroke-width="${sw}" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"></circle>`;
      offset += len;
      return seg;
    })
    .join("");
  const legend =
    cats
      .map(
        (cat) =>
          `<li><span class="dot" style="background:${cat.color}"></span>${esc(cat.label)}<span class="muted">${esc(humanSize((bd && bd[cat.key]) || 0))}</span></li>`
      )
      .join("") +
    `<li><span class="dot" style="background:var(--track)"></span>Free<span class="muted">${esc(humanSize(Math.max(0, storage.maxBytes - storage.bytes)))}</span></li>`;
  return `<div class="card storage-card">
    <div class="donut">
      <svg viewBox="0 0 128 128" width="132" height="132" role="img" aria-label="Storage used ${storage.pctBytes}%">
        <circle class="donut-track" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="${sw}"></circle>
        ${arcs}
      </svg>
      <div class="donut-center"><strong>${storage.pctBytes}%</strong><span class="muted">used</span></div>
    </div>
    <div class="storage-detail">
      <div class="usage-head"><span>${esc(humanSize(storage.bytes))} of ${esc(humanSize(storage.maxBytes))}</span><span class="muted">${storage.count} / ${storage.maxFiles} files</span></div>
      <ul class="legend">${legend}</ul>
    </div>
  </div>`;
}

// ---------- Auth pages ----------

function authShell({ title, heading, sub, body, flash }) {
  const html = `
  <main class="auth-wrap">
    <div class="auth-card">
      <div class="brand"><span class="logo">${brandMark()}</span>${esc(APP_NAME)}</div>
      <h1>${esc(heading)}</h1>
      <p class="sub">${esc(sub)}</p>
      ${flashHtml(flash)}
      ${body}
    </div>
  </main>
  <script>${FORM_VALIDATION_SCRIPT}</script>`;
  return htmlDoc(title, html);
}

function renderLogin(flash) {
  const demoBlock = isDemo
    ? `
    <div class="auth-or"><span>demo mode</span></div>
    <form method="post" action="/login">
      <input type="hidden" name="email" value="${esc(DEMO_EMAIL)}">
      <button class="btn secondary full" type="submit">Explore as demo user</button>
    </form>
    <p class="auth-switch">In-memory data, no Azure needed. Everything resets on restart.</p>`
    : `<p class="auth-switch">New here? <a href="/signup">Create an account</a></p>`;
  const body = `
    <form class="stacked validated" method="post" action="/login">
      <label for="email">Email</label>
      <input type="email" id="email" name="email" placeholder="you@example.com" required autofocus>
      <button class="btn full" type="submit" style="margin-top:16px;">Sign in</button>
    </form>
    ${demoBlock}`;
  return authShell({
    title: "Sign in",
    heading: "Welcome back",
    sub: "Sign in with your email to continue.",
    flash,
    body,
  });
}

function renderSignup(flash) {
  const body = `
    <form class="stacked validated" method="post" action="/signup">
      <label for="name">Name</label>
      <input type="text" id="name" name="name" placeholder="Ada Lovelace" required autofocus>
      <label for="email">Email</label>
      <input type="email" id="email" name="email" placeholder="you@example.com" required>
      <button class="btn full" type="submit" style="margin-top:16px;">Create account</button>
    </form>
    <p class="auth-switch">Already have an account? <a href="/login">Sign in</a></p>`;
  return authShell({
    title: "Create account",
    heading: "Create your account",
    sub: "No password needed, just your name and email.",
    flash,
    body,
  });
}

// ---------- Dashboard ----------

function statCard(label, value, iconName) {
  return `<div class="card stat">
    <div class="stat-chip chip-${esc(iconName)}">${icon(iconName)}</div>
    <div class="stat-body">
      <div class="stat-label">${esc(label)}</div>
      <div class="stat-value">${esc(String(value))}</div>
    </div>
  </div>`;
}

function quickLink(href, iconName, title, desc) {
  return `<a class="card quick-link" href="${href}">
    ${icon(iconName)}
    <h3>${esc(title)}</h3>
    <p>${esc(desc)}</p>
    <p class="chip">Open →</p>
  </a>`;
}

function renderDashboard({ user, myFiles, shared, members, storage, breakdown: bd, flash }) {
  const storageBlock = storage
    ? `<h2 class="section-title">Your storage</h2>${storageCard(storage, bd || {})}`
    : "";
  const body = `
    ${pageHeader(`Welcome, ${user.name}`, "An overview of your storage across the three Azure services.")}
    <div class="grid stats">
      ${statCard("Your files", myFiles, "files")}
      ${statCard("Shared files", shared, "shared")}
      ${statCard("Members", members, "members")}
    </div>
    ${storageBlock}
    <h2 class="section-title">Quick actions</h2>
    <div class="grid quick-links">
      ${quickLink("/files", "files", "My Files", "Upload and browse your own private files (Azure Blob Storage).")}
      ${quickLink("/shared", "shared", "Shared Files", "The area every member can read and write (Azure Files).")}
      ${quickLink("/members", "members", "Members", "Everyone who has signed up (Azure SQL).")}
    </div>
    ${explainer([
      { op: "Your files + storage", call: "SELECT COUNT(*), SUM(size_bytes) FROM files WHERE owner_id = @you" },
      { op: "Shared file count", call: "share.rootDirectoryClient.listFilesAndDirectories()  (Azure Files)" },
      { op: "Member count", call: "SELECT COUNT(*) FROM users" },
    ])}`;
  return appShell({ title: "Dashboard", active: "dashboard", user, flash, body });
}

// ---------- My Files (Blob) ----------

// One line of small muted details: size · type · date.
function fileMeta(file) {
  const bits = [];
  if (file.size != null) bits.push(esc(humanSize(file.size)));
  if (file.ext) bits.push(esc(file.ext.toUpperCase()));
  if (file.lastModified) bits.push(esc(formatDate(file.lastModified)));
  return bits.join(" · ");
}

function iconBtn(href, iconName, label) {
  return `<a class="action" href="${href}" title="${esc(label)}" aria-label="${esc(label)}">${icon(iconName)}</a>`;
}

function deleteForm(action, label, fields) {
  // Intercepted by CONFIRM_DELETE_SCRIPT, which reads the human label from
  // data-confirm-label. `fields` supplies the hidden inputs (id, or name+path).
  return `<form method="post" action="${action}" class="action-form" data-confirm-label="${esc(label)}">
    ${fields || ""}
    <button class="action danger" type="submit" title="Delete" aria-label="Delete ${esc(label)}">${icon("trash")}</button>
  </form>`;
}

function fileTile(file) {
  const cat = file.isImage ? "image" : categoryOf(file.ext);
  const thumb = file.isImage
    ? `<div class="thumb"><img src="${file.url}" alt="${esc(file.name)}" data-full="${file.url}" loading="lazy"></div>`
    : `<div class="thumb cat-${cat}"><span class="filetype">${esc(file.ext || "file")}</span></div>`;
  const meta = fileMeta(file);
  return `<div class="tile" data-name="${esc(file.name)}" data-size="${Number(file.size) || 0}" data-date="${dateMs(file.lastModified)}">
    ${thumb}
    <div class="meta">
      <div class="meta-info">
        <span class="name">${esc(file.name)}</span>
        ${meta ? `<span class="size muted">${meta}</span>` : ""}
      </div>
      <div class="tile-actions">
        ${iconBtn(file.url, "download", "Download")}
        ${iconBtn(file.shareUrl, "link", "Get a shareable link")}
        ${iconBtn(file.renameUrl, "edit", "Rename")}
        ${deleteForm("/files/delete", file.name, `<input type="hidden" name="id" value="${esc(file.id)}">`)}
      </div>
    </div>
  </div>`;
}

const FILES_CALLS = [
  { op: "List your files", call: "SELECT * FROM files WHERE owner_id = @you ORDER BY uploaded_at DESC" },
  { op: "Search / sort", call: "... WHERE display_name LIKE @q   ORDER BY size_bytes DESC" },
  { op: "Upload", call: "INSERT INTO files (...)   +   blockBlobClient.uploadData(bytes)" },
  { op: "Preview / download", call: "SELECT ... WHERE id = @id   +   blobClient.download()" },
  { op: "Rename", call: "UPDATE files SET display_name = @new   (the bytes never move)" },
  { op: "Delete", call: "DELETE FROM files ...   +   blockBlobClient.deleteIfExists()" },
  { op: "Usage / quota", call: "SELECT COUNT(*), SUM(size_bytes) FROM files WHERE owner_id = @you" },
  { op: "Shareable link", call: 'blobClient.generateSasUrl({ permissions: "r", expiresOn })' },
];

function renderFiles({ user, files, flash }) {
  const gallery = files.length
    ? `<div data-browse>
        ${toolbar()}
        <div class="gallery" data-items>${files.map(fileTile).join("")}</div>
        <div class="empty-inline" data-no-matches hidden>No files match your search.</div>
      </div>`
    : emptyState("No files yet. Upload your first file above.");
  const u = usage(files, MAX_FILES_PER_USER, MAX_BYTES_PER_USER);

  const body = `
    ${pageHeader("My Files", "Your own private file area. Only you can see these. Images preview inline; everything else gets a download link.", "Azure Blob Storage · container per user")}
    <div class="split">
      ${uploadForm("/files/upload", "Upload a file")}
      ${usageMeter(u)}
    </div>
    ${gallery}
    ${explainer(FILES_CALLS)}`;
  return appShell({ title: "My Files", active: "files", user, flash, body });
}

// ---------- Shared Files (Azure Files) ----------

const SHARED_CALLS = [
  { op: "List a folder", call: "share.getDirectoryClient(path).listFilesAndDirectories()" },
  { op: "Create a folder", call: "share.getDirectoryClient(childPath).createIfNotExists()" },
  { op: "Upload into folder", call: "directoryClient.getFileClient(name).uploadData(buffer)" },
  { op: "Download", call: "fileClient.download()" },
  { op: "Rename (copy + delete)", call: "download() → uploadData() → deleteIfExists()" },
  { op: "Delete file / empty folder", call: "fileClient.deleteIfExists() / dirClient.deleteIfExists()" },
  { op: "Shareable link", call: 'fileClient.generateSasUrl({ permissions: "r", expiresOn })' },
];

function renderShared({ user, path, folders, files, flash }) {
  const p = path || "";
  const pathField = `<input type="hidden" name="path" value="${esc(p)}">`;

  const folderRows = folders
    .map((name) => {
      const child = p ? p + "/" + name : name;
      return `<tr data-name="${esc(name)}" data-folder data-size="0" data-date="0">
        <td data-label="Name"><a class="folder-link" href="/shared?path=${encodeURIComponent(child)}">${icon("folder")}${esc(name)}</a></td>
        <td class="muted" data-label="Size"></td>
        <td class="muted" data-label="Modified"></td>
        <td data-label="Actions"><div class="row-actions">${deleteForm("/shared/folder/delete", name, `<input type="hidden" name="name" value="${esc(name)}">${pathField}`)}</div></td>
      </tr>`;
    })
    .join("");

  const fileRows = files
    .map(
      (f) => `<tr data-name="${esc(f.name)}" data-size="${Number(f.size) || 0}" data-date="${dateMs(f.lastModified)}">
        <td data-label="Name">${esc(f.name)}</td>
        <td class="muted" data-label="Size">${esc(f.size != null ? humanSize(f.size) : "")}</td>
        <td class="muted" data-label="Modified">${esc(f.lastModified ? formatDate(f.lastModified) : "")}</td>
        <td data-label="Actions"><div class="row-actions">
          ${iconBtn(f.url, "download", "Download")}
          ${iconBtn(f.shareUrl, "link", "Get a shareable link")}
          ${iconBtn(f.renameUrl, "edit", "Rename")}
          ${deleteForm("/shared/delete", f.name, `<input type="hidden" name="name" value="${esc(f.name)}">${pathField}`)}
        </div></td>
      </tr>`
    )
    .join("");

  const list =
    folders.length || files.length
      ? `<div data-browse>
          ${toolbar()}
          <div class="card table-card">
            <table>
              <thead><tr><th>Name</th><th>Size</th><th>Modified</th><th style="text-align:right;">Actions</th></tr></thead>
              <tbody data-items>${folderRows}${fileRows}</tbody>
            </table>
          </div>
          <div class="empty-inline" data-no-matches hidden>Nothing matches your search.</div>
        </div>`
      : emptyState("This folder is empty. Upload a file or create a folder above.");

  const u = usage(files, MAX_FILES_SHARED, MAX_BYTES_SHARED);

  const body = `
    ${pageHeader("Shared Files", "A shared area every member can read and write. Organise files into folders.", "Azure Files · share “shared-files”")}
    ${breadcrumbs(p)}
    <div class="split">
      ${uploadForm("/shared/upload", "Upload to this folder", pathField)}
      ${usageMeter(u)}
    </div>
    ${newFolderForm(p)}
    ${list}
    ${explainer(SHARED_CALLS)}`;
  return appShell({ title: "Shared Files", active: "shared", user, flash, body });
}

// ---------- Members (Azure SQL) ----------

function renderMembers({ user, members, flash }) {
  const rows = members
    .map(
      (m) => `<tr>
        <td data-label="Name"><div class="member-name"><span class="avatar">${esc(initials(m.name))}</span>${esc(m.name)}${m.id === user.id ? ' <span class="muted">(you)</span>' : ""}</div></td>
        <td data-label="Email">${esc(m.email)}</td>
        <td class="muted" data-label="Joined">${esc(formatDate(m.createdAt))}</td>
      </tr>`
    )
    .join("");
  const table = members.length
    ? `<div class="card table-card"><table><thead><tr><th>Name</th><th>Email</th><th>Joined</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : emptyState("No members yet.");

  const body = `
    ${pageHeader("Members", "Everyone who has signed up. Each is one row in the users table.", "Azure SQL · table “users”")}
    ${table}
    ${explainer([
      { op: "List all members", call: "SELECT * FROM users ORDER BY created_at DESC" },
      { op: "Find by email (sign in)", call: "SELECT TOP 1 * FROM users WHERE email = @email" },
      { op: "Create member (sign up)", call: "INSERT INTO users (id, name, email) VALUES (...)" },
    ])}
    ${nosqlVsSqlPanel()}`;
  return appShell({ title: "Members", active: "members", user, flash, body });
}

function formatDate(iso) {
  if (!iso) return "";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleString("en-GB", { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return "";
  return d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

// ---------- Shareable link (SAS) page ----------

function renderShareLink({ user, name, url, expiresOn, backHref }) {
  const body = `
    ${pageHeader("Shareable link", `A temporary, read-only link to “${name}”.`, "Shared Access Signature (SAS)")}
    <div class="card">
      <p>Anyone with this link can <strong>download this one file</strong> until
      <strong>${esc(formatDateTime(expiresOn))}</strong>, with no sign-in needed. After that, the link stops working.</p>
      <label for="sasurl">Link</label>
      <div class="copy-row">
        <input id="sasurl" type="text" readonly value="${esc(url)}" onclick="this.select()">
        <button class="btn" type="button" data-copy="#sasurl">Copy</button>
      </div>
      <p class="muted" style="margin-top:14px;">This is an Azure <strong>Shared Access Signature</strong>: the
      <code>?sv=…&amp;se=…&amp;sig=…</code> query string grants temporary, scoped access, signed with the
      storage account key, without exposing the key itself.</p>
      <a class="btn secondary" href="${backHref}" style="margin-top:8px;">← Back</a>
    </div>`;
  return appShell({
    title: "Shareable link",
    active: backHref === "/shared" ? "shared" : "files",
    user,
    flash: null,
    body,
  });
}

// ---------- Rename page ----------

function renderRename({ user, name, action, hidden, backHref, active }) {
  const fields = Object.entries(hidden || {})
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("");
  const body = `
    ${pageHeader("Rename file", `Give “${name}” a new name.`, "Copy + delete")}
    <div class="card" style="max-width:560px;">
      <p class="muted" style="margin-top:0;">Blobs and files can't be renamed in place, so the app copies the
      file to the new name and deletes the old one. A small but useful Azure detail.</p>
      <form class="stacked validated" method="post" action="${action}">
        ${fields}
        <label for="newName">New name</label>
        <input type="text" id="newName" name="newName" value="${esc(name)}" required autofocus>
        <div style="display:flex; gap:10px; margin-top:18px;">
          <button class="btn" type="submit">Rename</button>
          <a class="btn secondary" href="${backHref}">Cancel</a>
        </div>
      </form>
    </div>`;
  return appShell({ title: "Rename file", active, user, flash: null, body });
}

// ---------- Storage-not-configured page ----------

function renderNotConfigured() {
  const html = `
  <main class="auth-wrap">
    <div class="auth-card">
      <div class="brand"><span class="logo">${brandMark()}</span>${esc(APP_NAME)}</div>
      <h1>Almost there</h1>
      <p class="sub">The backend isn't fully set up yet, so files and accounts are paused.</p>
      <div class="flash error" style="margin-top:4px;">Set <code>AZURE_SQL_CONNECTION_STRING</code> (the database) and <code>AZURE_STORAGE_CONNECTION_STRING</code> (blob &amp; files), then restart the app.</div>
      <p class="auth-switch">The app itself is running; this page confirms it's reachable.</p>
    </div>
  </main>`;
  return htmlDoc("Setup needed", html);
}

// ---------- Error page ----------

function renderError(message) {
  const html = `
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="brand"><span class="logo">${brandMark()}</span>${esc(APP_NAME)}</div>
      <h1>Something went wrong</h1>
      <div class="flash error" style="margin-top:8px;">${esc(message || "Unknown error")}</div>
      <p class="sub">Check that <code>AZURE_STORAGE_CONNECTION_STRING</code> is correct and that this machine can reach the storage account.</p>
      <a class="btn full" href="/dashboard" style="margin-top:8px;">Back to dashboard</a>
    </div>
  </div>`;
  return htmlDoc("Error", html);
}

module.exports = {
  esc,
  renderLogin,
  renderSignup,
  renderDashboard,
  renderFiles,
  renderShared,
  renderMembers,
  renderShareLink,
  renderRename,
  renderNotConfigured,
  renderError,
};
