import { Prisma } from '@prisma/client';

type SessionDb = {
  adminSession: {
    updateMany: (args: Prisma.AdminSessionUpdateManyArgs) => Promise<Prisma.BatchPayload>;
  };
  organizerSession: {
    updateMany: (
      args: Prisma.OrganizerSessionUpdateManyArgs,
    ) => Promise<Prisma.BatchPayload>;
  };
  customerSession: {
    updateMany: (
      args: Prisma.CustomerSessionUpdateManyArgs,
    ) => Promise<Prisma.BatchPayload>;
  };
};

/** Revoke admin, organizer, and customer sessions after a password change. */
export async function revokeAuthSessionsForUser(
  db: SessionDb,
  userId: string,
  options?: { exceptAdminSessionId?: string },
): Promise<void> {
  const now = new Date();
  await db.adminSession.updateMany({
    where: {
      revokedAt: null,
      adminProfile: { userId },
      ...(options?.exceptAdminSessionId
        ? { id: { not: options.exceptAdminSessionId } }
        : {}),
    },
    data: { revokedAt: now, lastUsedAt: now },
  });
  await db.organizerSession.updateMany({
    where: {
      revokedAt: null,
      organizationMember: { userId },
    },
    data: { revokedAt: now, lastUsedAt: now },
  });
  await db.customerSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now, lastUsedAt: now },
  });
}

export function tokenVersionMatches(
  payloadTv: unknown,
  storedVersion: number,
): boolean {
  return Number(payloadTv ?? 0) === storedVersion;
}
