import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export async function initDatabase() {
  // Ensure connection is established
  await prisma.$connect();
  console.log("✅ Database connected");
}

