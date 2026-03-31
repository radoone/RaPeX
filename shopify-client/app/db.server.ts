import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";

declare global {
  var prismaGlobal: PrismaClient;
}

const databaseUrl = process.env.DATABASE_URL ?? "file:./prisma/dev.sqlite";

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
