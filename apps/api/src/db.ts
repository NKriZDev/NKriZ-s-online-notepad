import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
});

export async function getAccount() {
  return prisma.account.findUnique({ where: { id: 1 } });
}
