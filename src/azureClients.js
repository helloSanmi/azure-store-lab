// Builds the Azure *Storage* clients (Blob + Files) from the storage connection
// string. Accounts and file metadata now live in Azure SQL (see src/db.js), so
// Table Storage is no longer used.
//
// Degrades gracefully: if the connection string is missing or invalid, the
// clients are left null and `configured` is false, so the app still boots and
// storage features show a "setup needed" page instead of crash-looping.

const { BlobServiceClient } = require("@azure/storage-blob");
const { ShareServiceClient } = require("@azure/storage-file-share");
const { isDemo } = require("./demo");

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

// The one shared Azure file share (the "Shared Files" area).
const SHARED_FILE_SHARE = "shared-files";

let blobServiceClient = null;
let shareServiceClient = null;
let configured = false;
let configError = null;

if (isDemo) {
  // In-memory storage: no Azure account needed.
  const demo = require("./demoBackend");
  blobServiceClient = demo.blobServiceClient;
  shareServiceClient = demo.shareServiceClient;
  configured = true;
} else if (connectionString) {
  try {
    blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    shareServiceClient = ShareServiceClient.fromConnectionString(connectionString);
    configured = true;
  } catch (err) {
    configError = err.message;
  }
}

module.exports = {
  SHARED_FILE_SHARE,
  blobServiceClient,
  shareServiceClient,
  configured,
  configError,
};
