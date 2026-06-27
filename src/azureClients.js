// Builds one client per Azure Storage service, all from the SAME connection
// string. This is the only place that reads the connection string, so the rest
// of the app just imports the ready-to-use clients.
//
// If the connection string is missing or invalid, the app still boots: the
// clients are left null and `configured` is false, so the server can run and
// serve pages (e.g. health checks) while storage features stay disabled until a
// valid connection string is set. This avoids crash-looping a fresh deploy.

const { TableClient } = require("@azure/data-tables");
const { BlobServiceClient } = require("@azure/storage-blob");
const { ShareServiceClient } = require("@azure/storage-file-share");

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

// Fixed names for the resources the demo uses.
const USERS_TABLE = "users"; // Azure table name: letters/digits, starts with a letter.
const SHARED_FILE_SHARE = "shared-files"; // The one shared Azure file share.

let tableClient = null;
let blobServiceClient = null;
let shareServiceClient = null;
let configured = false;
let configError = null;

if (connectionString) {
  try {
    tableClient = TableClient.fromConnectionString(connectionString, USERS_TABLE);
    blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    shareServiceClient = ShareServiceClient.fromConnectionString(connectionString);
    configured = true;
  } catch (err) {
    // Present but invalid (e.g. just the access key, or a malformed string).
    configError = err.message;
  }
}

module.exports = {
  USERS_TABLE,
  SHARED_FILE_SHARE,
  tableClient,
  blobServiceClient,
  shareServiceClient,
  configured,
  configError,
};
