-- Shopify's Prisma session storage adapter may write refresh token columns in
-- newer versions. The Prisma model maps to "session"; SQLite resolves that to
-- the existing "Session" table case-insensitively.
ALTER TABLE "Session" ADD COLUMN "refreshToken" TEXT;
ALTER TABLE "Session" ADD COLUMN "refreshTokenExpires" DATETIME;
