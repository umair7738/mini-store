import mysql from "mysql2/promise";

const DEVELOPMENT_DATABASE = "mini_store_dev";
const TEST_DATABASE = "mini_store_test";
const database = (process.env.DB_NAME || "").toLowerCase();
const user = (process.env.DB_USER || "").toLowerCase();
const isTestRun = process.env.NODE_ENV === "test";
const isDevelopmentApp = process.env.NODE_ENV === "development";

if (isTestRun && (database === DEVELOPMENT_DATABASE || user === DEVELOPMENT_DATABASE)) {
  throw new Error(
    `Test runs are permanently blocked from the development database (${DEVELOPMENT_DATABASE}); use a separate test database and user.`,
  );
}
if (isDevelopmentApp && database !== DEVELOPMENT_DATABASE) {
  throw new Error(
    `The development API must use the original development database (${DEVELOPMENT_DATABASE}); refusing DB_NAME=${process.env.DB_NAME || "(unset)"}.`,
  );
}
if (!isTestRun && !isDevelopmentApp && (database === TEST_DATABASE || user === TEST_DATABASE)) {
  throw new Error(
    `The application is not allowed to use the test database (${TEST_DATABASE}); set DB_NAME to the development database.`,
  );
}
if (isTestRun && !database) {
  throw new Error("DB_NAME must be set for test runs");
}

export const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  timezone: "Z",
  supportBigNumbers: true,
  bigNumberStrings: false,
});
