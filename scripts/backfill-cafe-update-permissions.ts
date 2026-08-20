/**
 * Upserts cafe.update.* permissions and grants them to every role that already
 * has cafe.write (so existing cafe editors keep full access after the split).
 *
 * Run: npx ts-node --transpile-only scripts/backfill-cafe-update-permissions.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const catalog: Array<{ key: string; description: string }> = [
  {
    key: 'cafe.update.basics',
    description: 'Cafes → Basics — name, tables, organization, and manager',
  },
  {
    key: 'cafe.update.menu',
    description: 'Cafes → Menu — categories, subcategories, and items',
  },
  {
    key: 'cafe.update.agents',
    description: 'Cafes → POS agents — assign and manage cafe POS users',
  },
  {
    key: 'cafe.update.event',
    description: 'Cafes → Assign event — link or unlink the active event',
  },
];

async function main() {
  const ids: string[] = [];
  for (const item of catalog) {
    const permission = await prisma.permission.upsert({
      where: { key: item.key },
      update: { description: item.description },
      create: { key: item.key, description: item.description },
    });
    ids.push(permission.id);
    console.log(`Upserted ${item.key}`);
  }

  await prisma.permission
    .update({
      where: { key: 'cafe.write' },
      data: {
        description: 'Cafes menu — create cafes and unlock Advanced update sections',
      },
    })
    .catch(() => null);

  const write = await prisma.permission.findUnique({ where: { key: 'cafe.write' } });
  if (!write) {
    throw new Error('Permission cafe.write is missing. Run prisma seed first.');
  }

  const roles = await prisma.role.findMany({
    where: { permissions: { some: { permissionId: write.id } } },
    include: { permissions: true },
  });

  let links = 0;
  for (const role of roles) {
    const have = new Set(role.permissions.map((item) => item.permissionId));
    for (const permissionId of ids) {
      if (have.has(permissionId)) continue;
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId },
      });
      links += 1;
    }
  }

  console.log(
    `Granted cafe.update.* to ${roles.length} cafe.write role(s); new links: ${links}`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
