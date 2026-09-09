import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

declare global {
  var prismaGlobal: PrismaClient;
}

const appDirectory = dirname(fileURLToPath(import.meta.url));
const defaultDatabasePath = resolve(appDirectory, "../prisma/dev.sqlite");
const databaseUrl = process.env.DATABASE_URL ?? `file:${defaultDatabasePath}`;

// Keep the legacy SQLite timestamp encoding so existing DateTime values remain readable.
const adapter = new PrismaBetterSQLite3(
  { url: databaseUrl },
  { timestampFormat: "unixepoch-ms" },
);

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient({ adapter });
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient({ adapter });

export default prisma;
