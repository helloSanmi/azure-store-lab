# Azure Store Lab

A small Node.js + Express app that teaches how a **database** and **object
storage** work together, plus the core Azure Storage services, behind a simple
signed-in dashboard. Passwordless sign-in, plain server-rendered HTML, one
stylesheet.

## The big idea: database vs. storage

> **Store the file *bytes* in Storage. Store everything you'd put in a `WHERE`,
> `ORDER BY`, `JOIN`, or `COUNT` in the Database, plus a pointer from the DB row
> to the bytes.**

- **Azure SQL** holds the structured, queryable "truth": accounts and file
  metadata. A file row points at its bytes.
- **Blob / Azure Files** hold only the payloads. The database is the index into
  storage.

## How the pages map to services

| Page | Backing service | What it does |
|---|---|---|
| **Sign in / Sign up** | **Azure SQL** (`users` table) | Passwordless accounts: id (GUID), name, email, joined. |
| **Dashboard** | Azure SQL (+ Files) | Counts + storage donut, all from SQL (`COUNT`, `SUM`). |
| **My Files** | **Azure SQL** (`files` metadata) + **Blob** (bytes) | Your private files. Metadata in SQL; bytes in a per-user container, each blob named by the file's id. Rename is a pure `UPDATE`. |
| **Shared Files** | **Azure Files** | A shared `shared-files` share with folders that every member can read/write. (Pure storage, no DB.) |
| **Members** | **Azure SQL** (`users`) | Everyone who signed up. Includes a NoSQL-vs-SQL explainer. |

### Where data lives

```
Azure SQL (database)
  ├─ users(id, name, email, created_at)
  └─ files(id, owner_id → users.id, display_name, content_type, size_bytes, uploaded_at)

Blob Storage (My Files bytes)
  └─ container <user id>
       └─ blob <file id>           # named by id, not filename

Azure Files (Shared bytes + folders)
  └─ file share "shared-files"
       └─ folders / files
```

The tables are created automatically on startup (from [`schema.sql`](schema.sql));
each user's blob container and the file share are created on first use. The
database itself must exist first (on Azure it's provisioned separately).

> **Why ids, not filenames?** Blobs are keyed by the file's immutable id, so a
> rename is one SQL `UPDATE` (the bytes never move) and there are no name clashes.
> The GUID is lower-cased so it's a valid Azure container/blob name.
>
> **Retired:** Azure Table Storage (the old NoSQL account store), replaced by
> Azure SQL. The Members page keeps a short NoSQL-vs-SQL explainer on why.

## How sign-in works (passwordless)

- **Sign up** with a name + email → inserts a row in the SQL `users` table and
  starts a session.
- **Sign in** with an email → if that email exists, you're signed in; if not,
  you're sent to sign up.
- Sessions are cookie-backed (`express-session`). There are **no passwords**:
  this is a demo, so it deliberately skips password hashing, email verification,
  and rate limiting.

## Prerequisites

- Node.js 22+ (developed and deployed on Node 24 LTS).
- An **Azure SQL Database** and its ADO.NET connection string.
- An **Azure Storage account** and its connection string.

The app still boots if either is missing, it just shows a "setup needed" page
for the affected features, so a fresh deploy won't crash-loop.

## Run it locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your `.env` in the **project root** (same folder as `server.js`):

   ```bash
   cp .env.example .env
   ```

   Then edit `.env` and set both connection strings:
   - **`AZURE_SQL_CONNECTION_STRING`**, your SQL database → *Connection strings*
     → *ADO.NET* (fill in the password).
   - **`AZURE_STORAGE_CONNECTION_STRING`**, Storage account → *Access keys* →
     *Connection string* (the long field, not the short *Key*).

3. Start the app (it creates the SQL tables from `schema.sql` on startup):

   ```bash
   npm start
   ```

4. Open <http://localhost:3000>, create an account, and you're in.

## Configuration (`.env`)

| Variable | Required | Description |
|---|---|---|
| `AZURE_SQL_CONNECTION_STRING` | yes | ADO.NET connection string for the Azure SQL database (accounts + file metadata). |
| `AZURE_STORAGE_CONNECTION_STRING` | yes | Connection string for the storage account (Blob for My Files, Azure Files for Shared). |
| `SESSION_SECRET` | no | Secret used to sign session cookies. If unset, a random secret is generated per restart (sessions reset on restart). Set a fixed value (e.g. `openssl rand -hex 32`) for stable sessions. |
| `PORT` | no | HTTP port (default `3000`). |

### Upload rules

Both upload areas enforce the same limits, defined in one place
([`src/uploads.js`](src/uploads.js)) and enforced server-side:

- **Max size:** 10 MB per file (oversize uploads are rejected with a friendly message).
- **Allowed types:** images (`jpg`, `jpeg`, `png`, `gif`, `webp`), documents
  (`pdf`, `txt`, `csv`, `doc`, `docx`, `xls`, `xlsx`, `ppt`, `pptx`), and video
  (`mp4`, `mov`, `webm`). SVG is intentionally excluded (it can carry scripts).
- **Storage caps (so storage can't grow without bound):** each user is limited to
  **20 files / 50 MB**, and the shared area to **50 files / 200 MB**. When an area
  is full, new uploads are refused until something is deleted. Usage meters on the
  Dashboard, My Files, and Shared Files pages show how full each area is.

The upload widget shows these limits up front and validates the chosen file in
the browser before uploading; the server re-checks regardless. **My Files is
private**: each user only ever sees and downloads files from their own
container.

## Hosting on a VM

Copy the project to the VM, run `npm install`, create `.env` with the connection
string, and run `npm start` (e.g. behind `pm2`, `systemd`, or a reverse proxy).
The VM needs outbound access to the SQL database and the storage endpoints, and
the SQL server firewall must allow the VM's IP. Sessions are stored in memory, so
they reset when the app restarts, which is fine for a demo. See
[DEPLOY.md](DEPLOY.md) for App Service + Application Gateway.

> **Production notes (not implemented here):** use a Managed Identity with
> `DefaultAzureCredential` instead of connection strings; add real password (or
> SSO) auth; and use a persistent session store. This app keeps them simple on
> purpose.

## Project layout

```
.
├── server.js              # Express setup: sessions, static files, DB init, routers
├── schema.sql             # SQL tables (users, files); applied on startup
├── routes/
│   ├── auth.js            # sign in / sign up / sign out (Azure SQL)
│   └── main.js            # dashboard, my files, shared files, members
├── src/
│   ├── db.js              # Azure SQL connection pool + ensureSchema
│   ├── store.js           # SQL queries for users + file metadata
│   ├── azureClients.js    # Blob + Files clients from the storage connection string
│   ├── uploads.js         # limits, allowed types, quota, categories
│   ├── auth.js            # session/flash helpers, requireAuth/requireDb/requireStorage
│   └── views.js           # all HTML rendering (shells, components, pages)
├── public/
│   └── styles.css         # the single stylesheet
├── .env.example
├── package.json
└── README.md
```
