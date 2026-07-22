import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
    // בסיס נתוני צל למיגרציות. בפיתוח מקומי זהו המופע של `prisma dev`
    // (פורט 51215). בענן — Railway — המשתנה לא מוגדר, ו-Prisma מייצר
    // בסיס צל זמני בעצמו.
    shadowDatabaseUrl: process.env["SHADOW_DATABASE_URL"],
  },
});
