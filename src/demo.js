// Demo mode: run the whole app with in-memory data and no Azure services.
// Active when DEMO=1, or when NEITHER connection string is set (so a bare
// `npm start` with no config still lets you look around). Data resets on restart.

const isDemo =
  process.env.DEMO === "1" ||
  (!process.env.AZURE_SQL_CONNECTION_STRING && !process.env.AZURE_STORAGE_CONNECTION_STRING);

const DEMO_NAME = "Ada Lovelace";
const DEMO_EMAIL = "ada@example.com";

module.exports = { isDemo, DEMO_NAME, DEMO_EMAIL };
