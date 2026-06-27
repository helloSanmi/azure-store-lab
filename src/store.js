// User accounts, stored in Azure Table Storage.
// Each account is one entity: PartitionKey "users", RowKey a UUID, plus
// name, email (stored lower-cased so lookups are case-insensitive) and createdAt.

const { randomUUID } = require("crypto");
const { odata } = require("@azure/data-tables");
const { tableClient } = require("./azureClients");

const PARTITION = "users";

async function ensureTable() {
  await tableClient.createTable(); // idempotent: ignored if the table already exists.
}

function toUser(entity) {
  return {
    rowKey: entity.rowKey,
    name: entity.name,
    email: entity.email,
    createdAt: entity.createdAt || null,
  };
}

// All accounts, newest first.
async function listUsers() {
  await ensureTable();
  const users = [];
  for await (const entity of tableClient.listEntities()) {
    users.push(toUser(entity));
  }
  users.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return users;
}

// Find one account by email (case-insensitive). Returns null if none.
async function findUserByEmail(email) {
  await ensureTable();
  const normalized = String(email).trim().toLowerCase();
  // odata`` safely escapes the value into the filter string.
  const iter = tableClient.listEntities({
    queryOptions: { filter: odata`PartitionKey eq ${PARTITION} and email eq ${normalized}` },
  });
  for await (const entity of iter) {
    return toUser(entity);
  }
  return null;
}

// Create a new account and return it.
async function createUser({ name, email }) {
  await ensureTable();
  const entity = {
    partitionKey: PARTITION,
    rowKey: randomUUID(),
    name: String(name).trim(),
    email: String(email).trim().toLowerCase(),
    createdAt: new Date().toISOString(),
  };
  await tableClient.createEntity(entity);
  return toUser(entity);
}

module.exports = { listUsers, findUserByEmail, createUser };
