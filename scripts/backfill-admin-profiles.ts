/**
 * Ensure password staff (assignments + organisers) have AdminProfile so they can use /login.
 * Also migrates panel roles onto panel.access (and strips admin.access from non-admin panel roles).
 *
 * Usage: npx tsx --env-file=.env scripts/backfill-admin-profiles.ts
 *
 * Run `npx prisma db seed` first so panel.access exists in the permission catalog.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PANEL_ROLE_NAMES = [
  'admin',
  'organiser',
  'pos',
  'cafe_pos',
  'scanner',
  'event_manager',
  'finance-manager',
  'hr',
] as const;

async function ensurePanelAccessOnRoles() {
  const panelAccess = await prisma.permission.findUnique({
    where: { key: 'panel.access' },
  });
  if (!panelAccess) {
    throw new Error('Permission panel.access is not seeded. Run prisma seed first.');
  }

  const adminAccess = await prisma.permission.findUnique({
    where: { key: 'admin.access' },
  });

  const roles = await prisma.role.findMany({
    where: {
      OR: [
        { name: { in: [...PANEL_ROLE_NAMES] } },
        ...(adminAccess
          ? [{ permissions: { some: { permissionId: adminAccess.id } } }]
          : []),
      ],
    },
    include: {
      permissions: true,
    },
  });

  let linked = 0;
  let stripped = 0;

  for (const role of roles) {
    const hasPanel = role.permissions.some((rp) => rp.permissionId === panelAccess.id);
    if (!hasPanel) {
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: panelAccess.id },
      });
      linked += 1;
    }

    // Non-admin panel roles keep feature perms only — admin.access is for admin tools.
    if (
      adminAccess &&
      role.name !== 'admin' &&
      PANEL_ROLE_NAMES.includes(role.name as (typeof PANEL_ROLE_NAMES)[number])
    ) {
      const removed = await prisma.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: adminAccess.id },
      });
      stripped += removed.count;
    }
  }

  return { linked, stripped };
}

async function backfillProfiles() {
  let created = 0;
  const coveredUserIds = new Set<string>();

  const staffWithoutProfile = await prisma.staffAssignment.findMany({
    where: {
      status: 'active',
      role: { name: { in: [...PANEL_ROLE_NAMES] } },
      user: { adminProfile: null, status: 'active' },
    },
    select: { userId: true, roleId: true },
    distinct: ['userId'],
  });

  for (const row of staffWithoutProfile) {
    await prisma.adminProfile.create({
      data: { userId: row.userId, roleId: row.roleId, status: 'active' },
    });
    coveredUserIds.add(row.userId);
    created += 1;
  }

  const organiserRole = await prisma.role.findUnique({ where: { name: 'organiser' } });
  if (organiserRole) {
    const organisersWithoutProfile = await prisma.organizationMember.findMany({
      where: {
        status: 'active',
        user: { adminProfile: null, status: 'active', passwordHash: { not: null } },
      },
      select: { userId: true },
      distinct: ['userId'],
    });
    for (const row of organisersWithoutProfile) {
      if (coveredUserIds.has(row.userId)) continue;
      await prisma.adminProfile.create({
        data: { userId: row.userId, roleId: organiserRole.id, status: 'active' },
      });
      coveredUserIds.add(row.userId);
      created += 1;
    }

    // Primary organisers assigned on events without org membership / staff assignment.
    const primaryOrganisers = await prisma.event.findMany({
      where: {
        primaryOrganizerId: { not: null },
        primaryOrganizer: {
          adminProfile: null,
          status: 'active',
          passwordHash: { not: null },
        },
      },
      select: { primaryOrganizerId: true },
      distinct: ['primaryOrganizerId'],
    });
    for (const row of primaryOrganisers) {
      const userId = row.primaryOrganizerId;
      if (!userId || coveredUserIds.has(userId)) continue;
      await prisma.adminProfile.create({
        data: { userId, roleId: organiserRole.id, status: 'active' },
      });
      coveredUserIds.add(userId);
      created += 1;
    }
  }

  return created;
}

async function ensureDashboardReportDefaultsOnCustomRoles() {
  const neededKeys = [
    'dashboard.read',
    'dashboard.widget.gross_sales',
    'dashboard.widget.net_revenue',
    'dashboard.widget.tickets_sold',
    'dashboard.widget.total_orders',
    'dashboard.widget.revenue_mix',
    'dashboard.widget.revenue_analytics',
    'dashboard.widget.order_status',
    'dashboard.widget.secondary_kpis',
    'dashboard.widget.event_reports',
    'dashboard.widget.recent_orders',
    'dashboard.filter.event',
    'dashboard.filter.date_range',
    'reports.read',
    'reports.tab.overview',
    'reports.tab.tickets',
    'reports.tab.visitors',
    'reports.tab.payments',
    'reports.overview.revenue',
    'reports.overview.payment_mix',
    'reports.filter.date_range',
    'reports.filter.basis',
  ];

  const permissions = await prisma.permission.findMany({
    where: {
      key: {
        in: ['orders.read', 'events.read', 'dashboard.read', 'reports.read', ...neededKeys],
      },
    },
  });
  const byKey = new Map(permissions.map((item) => [item.key, item]));
  const ordersRead = byKey.get('orders.read');
  const eventsRead = byKey.get('events.read');
  const dashboardRead = byKey.get('dashboard.read');
  if (!ordersRead || !eventsRead || !dashboardRead) {
    throw new Error(
      'Missing orders.read/events.read/dashboard.read. Run prisma seed first.',
    );
  }

  const grantIds = neededKeys
    .map((key) => byKey.get(key)?.id)
    .filter((id): id is string => Boolean(id));

  const roles = await prisma.role.findMany({
    where: {
      name: { notIn: [...PANEL_ROLE_NAMES, 'customer'] },
      AND: [
        { permissions: { some: { permissionId: ordersRead.id } } },
        { permissions: { some: { permissionId: eventsRead.id } } },
        { permissions: { none: { permissionId: dashboardRead.id } } },
      ],
    },
    select: { id: true, name: true },
  });

  let linked = 0;
  for (const role of roles) {
    for (const permissionId of grantIds) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: role.id, permissionId },
        },
        update: {},
        create: { roleId: role.id, permissionId },
      });
      linked += 1;
    }
    console.log(`Granted dashboard/report defaults to custom role "${role.name}".`);
  }

  return { roles: roles.length, links: linked };
}

async function ensureEventUpdateDefaultsOnWriteRoles() {
  const updateKeys = [
    'events.update.basics',
    'events.update.schedule',
    'events.update.place_media',
    'events.update.more',
    'events.update.review',
    'events.update.lifecycle',
    'events.update.tickets',
  ];
  const permissions = await prisma.permission.findMany({
    where: { key: { in: ['events.write', ...updateKeys] } },
  });
  const byKey = new Map(permissions.map((item) => [item.key, item]));
  const write = byKey.get('events.write');
  if (!write) {
    throw new Error('Permission events.write is not seeded. Run prisma seed first.');
  }
  const grantIds = updateKeys
    .map((key) => byKey.get(key)?.id)
    .filter((id): id is string => Boolean(id));

  const roles = await prisma.role.findMany({
    where: {
      permissions: { some: { permissionId: write.id } },
    },
    include: { permissions: true },
  });

  let links = 0;
  for (const role of roles) {
    const have = new Set(role.permissions.map((item) => item.permissionId));
    for (const permissionId of grantIds) {
      if (have.has(permissionId)) continue;
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId },
      });
      links += 1;
    }
  }
  return { roles: roles.length, links };
}

async function ensureCafeUpdateDefaultsOnWriteRoles() {
  const updateKeys = [
    'cafe.update.basics',
    'cafe.update.menu',
    'cafe.update.agents',
    'cafe.update.event',
  ];
  const permissions = await prisma.permission.findMany({
    where: { key: { in: ['cafe.write', ...updateKeys] } },
  });
  const byKey = new Map(permissions.map((item) => [item.key, item]));
  const write = byKey.get('cafe.write');
  if (!write) {
    throw new Error('Permission cafe.write is not seeded. Run prisma seed first.');
  }
  const grantIds = updateKeys
    .map((key) => byKey.get(key)?.id)
    .filter((id): id is string => Boolean(id));

  const roles = await prisma.role.findMany({
    where: {
      permissions: { some: { permissionId: write.id } },
    },
    include: { permissions: true },
  });

  let links = 0;
  for (const role of roles) {
    const have = new Set(role.permissions.map((item) => item.permissionId));
    for (const permissionId of grantIds) {
      if (have.has(permissionId)) continue;
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId },
      });
      links += 1;
    }
  }
  return { roles: roles.length, links };
}

async function main() {
  const { linked, stripped } = await ensurePanelAccessOnRoles();
  const created = await backfillProfiles();
  const reportDefaults = await ensureDashboardReportDefaultsOnCustomRoles();
  const eventUpdates = await ensureEventUpdateDefaultsOnWriteRoles();
  const cafeUpdates = await ensureCafeUpdateDefaultsOnWriteRoles();
  console.log(`Linked panel.access on ${linked} role(s).`);
  console.log(`Removed admin.access from ${stripped} non-admin panel role link(s).`);
  console.log(`Created ${created} AdminProfile row(s).`);
  console.log(
    `Backfilled dashboard/report defaults on ${reportDefaults.roles} custom role(s) (${reportDefaults.links} links).`,
  );
  console.log(
    `Backfilled events.update.* on ${eventUpdates.roles} write role(s) (${eventUpdates.links} links).`,
  );
  console.log(
    `Backfilled cafe.update.* on ${cafeUpdates.roles} write role(s) (${cafeUpdates.links} links).`,
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
