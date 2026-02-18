// Prisma configuration for MOBO backend (PostgreSQL / Neon)
// Uses the same dotenv loader as the rest of the backend to ensure
// .env files are resolved correctly from both source and dist.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
