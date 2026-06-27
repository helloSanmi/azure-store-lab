// Builds one client per Azure Storage service, all from the SAME connection
// string. This is the only place that reads the connection string, so the rest
// of the app just imports the ready-to-use clients.

const { TableClient } = require("@azure/data-tables");
const { BlobServiceClient } = require("@azure/storage-blob");
const { ShareServiceClient } = require("@azure/storage-file-share");

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

if (!connectionString) {
  throw new Error(
    "AZURE_STORAGE_CONNECTION_STRING is not set. Copy .env.example to .env and " +
      "paste in your storage account connection string."
  );
}

// Fixed names for the resources the demo uses.
const USERS_TABLE = "users"; // Azure table name: letters/digits, starts with a letter.
const SHARED_FILE_SHARE = "shared-files"; // The one shared Azure file share.

// Table Storage: one TableClient scoped to the "users" table.
const tableClient = TableClient.fromConnectionString(connectionString, USERS_TABLE);

// Blob Storage: a service-level client; we create one container per user on demand.
const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);

// Azure Files: a service-level client; we use a single share called "shared-files".
const shareServiceClient = ShareServiceClient.fromConnectionString(connectionString);

module.exports = {
  USERS_TABLE,
  SHARED_FILE_SHARE,
  tableClient,
  blobServiceClient,
  shareServiceClient,
};
