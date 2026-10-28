// src/lib/db.ts
// Standard Next.js-safe Prisma singleton — avoids exhausting connections
// during hot-reload in development.

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
