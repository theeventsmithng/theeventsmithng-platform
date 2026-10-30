// prisma/seed.ts
//
// CLI entry point for `prisma db seed` / `npm run prisma:seed`. The actual
// seeding logic lives in src/lib/seedDatabase.ts so it can be shared with
// the production bootstrap route (src/app/api/admin/bootstrap/route.ts) —
// see that file for why a one-off CLI seed isn't enough on Vercel.

import { PrismaClient } from "@prisma/client";
import { seedDatabase } from "../src/lib/seedDatabase";

const prisma = new PrismaClient();

seedDatabase(prisma)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
