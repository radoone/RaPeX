import "dotenv/config";
import { defineConfig } from "prisma/config";

const databaseUrl = process.env.DATABASE_URL ?? "file:./prisma/dev.sqlite";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});
