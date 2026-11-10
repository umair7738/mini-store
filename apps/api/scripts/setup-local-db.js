import { randomBytes } from "node:crypto";
import { writeFile, access } from "node:fs/promises";
import mysql from "mysql2/promise";

const rootPassword = process.env.MYSQL_ROOT_PASSWORD;
if (!rootPassword)
  throw new Error("Set MYSQL_ROOT_PASSWORD for the local MySQL administrator");
for (const path of [
  new URL("../.env", import.meta.url),
  new URL("../.env.test", import.meta.url),
]) {
  try {
    await access(path);
    throw new Error(
      "Local environment files already exist; setup will not rotate database passwords",
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

const connection = await mysql.createConnection({
  host: "127.0.0.1",
  user: "root",
  password: rootPassword,
});
try {
  const devPassword = randomBytes(32).toString("base64url");
  const testPassword = randomBytes(32).toString("base64url");
  for (const [name, password] of [
    ["mini_store_dev", devPassword],
    ["mini_store_test", testPassword],
  ]) {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS ${name} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
    await connection.query(
      `CREATE USER IF NOT EXISTS '${name}'@'127.0.0.1' IDENTIFIED BY ${connection.escape(password)}`,
    );
    await connection.query(
      `ALTER USER '${name}'@'127.0.0.1' IDENTIFIED BY ${connection.escape(password)}`,
    );
    await connection.query(
      `GRANT ALL PRIVILEGES ON ${name}.* TO '${name}'@'127.0.0.1'`,
    );
  }

  const apiDir = new URL("../", import.meta.url);
  const env = (name, password, mode) =>
    [
      "PORT=4000",
      "WEB_ORIGIN=http://localhost:3000",
      "DB_HOST=127.0.0.1",
      "DB_PORT=3306",
      `DB_USER=${name}`,
      `DB_PASSWORD=${password}`,
      `DB_NAME=${name}`,
      `CSRF_SECRET=${randomBytes(32).toString("base64url")}`,
      `NODE_ENV=${mode}`,
      "",
    ].join("\n");
  await writeFile(
    new URL(".env", apiDir),
    env("mini_store_dev", devPassword, "development"),
    { flag: "wx" },
  );
  await writeFile(
    new URL(".env.test", apiDir),
    env("mini_store_test", testPassword, "test"),
    { flag: "wx" },
  );
  await writeFile(
    new URL("../../web/.env.local", import.meta.url),
    "API_TARGET=http://127.0.0.1:4000\nNEXT_PUBLIC_SITE_URL=http://localhost:3000\n",
    { flag: "wx" },
  );
  console.log(
    "Created isolated development and test databases and local environment files",
  );
} finally {
  await connection.end();
}
