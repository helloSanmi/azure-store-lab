# Azure Store Lab

A small Node.js + Express app that demonstrates the three core **Azure Storage**
services behind a simple, signed-in dashboard. It's a teaching tool: no database
other than Azure Storage, passwordless sign-in, and plain server-rendered HTML
with one stylesheet.

## How the pages map to Azure services

| Page | Azure service | SDK | What it does |
|---|---|---|---|
| **Sign in / Sign up** | **Table Storage** | `@azure/data-tables` | Passwordless accounts. Each account is one table entity: `PartitionKey = "users"`, a UUID `RowKey`, plus name, email, and join date. |
| **Dashboard** | (none) | (none) | Landing page after sign-in: counts of your files, shared files, and members, plus quick links. |
| **My Files** | **Blob Storage** | `@azure/storage-blob` | Upload and browse **your own** files. Each user has a private container named after their `RowKey`. Images preview inline; other files get a download link. |
| **Shared Files** | **Azure Files** | `@azure/storage-file-share` | A single file share called `shared-files` that every signed-in member can upload to and download from. |
| **Members** | **Table Storage** | `@azure/data-tables` | Lists every registered account from the users table. |

### Storage layout

```
Table Storage
  └─ table "users"
       └─ entity { PartitionKey: "users", RowKey: <uuid>, name, email, createdAt }

Blob Storage
  └─ container <user-row-key>      (one private container per user)
       └─ blob <original-filename>

Azure Files
  └─ file share "shared-files"
       └─ file <original-filename>
```

The table, each user's blob container, and the file share are all **created
automatically on first use**, so there's nothing to pre-create in Azure.

> **Naming note:** a user's row key is a lowercase UUID, which is a valid Azure
> Blob *container* name (3–63 chars, lowercase letters/digits/hyphens), so the
> row key is used directly as the container name.

## How sign-in works (passwordless)

- **Sign up** with a name + email → creates an account in Table Storage and
  starts a session.
- **Sign in** with an email → if that email exists, you're signed in; if not,
  you're sent to sign up.
- Sessions are cookie-backed (`express-session`). There are **no passwords**:
  this is a demo, so it deliberately skips password hashing, email verification,
  and rate limiting.

## Prerequisites

- Node.js 22+ (developed and deployed on Node 24 LTS).
- An Azure Storage account and its **connection string**.

## Run it locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your `.env` in the **project root** (same folder as `server.js`):

   ```bash
   cp .env.example .env
   ```

   Then edit `.env` and set the connection string. Get it from the Azure Portal:
   **Storage account → Security + networking → Access keys → Connection string**
   (copy the **Connection string** field, not the shorter **Key** field). It
   should look like:

   ```
   AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net
   ```

3. Start the app:

   ```bash
   npm start
   ```

4. Open <http://localhost:3000>, create an account, and you're in.

## Configuration (`.env`)

| Variable | Required | Description |
|---|---|---|
| `AZURE_STORAGE_CONNECTION_STRING` | yes | Connection string for the storage account used by all three services. |
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
The VM only needs outbound access to the storage account endpoints. Sessions are
stored in memory, so they reset when the app restarts, which is fine for a demo.

> **Production notes (not implemented here):** use a Managed Identity with
> `DefaultAzureCredential` instead of a connection string; add real password (or
> SSO) auth; and use a persistent session store. This app keeps all three simple
> on purpose.

## Project layout

```
.
├── server.js              # Express setup: sessions, static files, routers
├── routes/
│   ├── auth.js            # sign in / sign up / sign out (Table Storage)
│   └── main.js            # dashboard, my files, shared files, members
├── src/
│   ├── azureClients.js    # builds the 3 SDK clients from the connection string
│   ├── store.js           # Table Storage helpers (find/create/list users)
│   ├── auth.js            # session + flash helpers, requireAuth middleware
│   └── views.js           # all HTML rendering (shells, components, pages)
├── public/
│   └── styles.css         # the single stylesheet
├── .env.example
├── package.json
└── README.md
```
