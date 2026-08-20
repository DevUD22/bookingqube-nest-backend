import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../src/common/crypto/password';

const prisma = new PrismaClient();

async function main() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'AdminPass123!';
  const adminPasswordHash = await hashPassword(adminPassword);
  const customerPassword = process.env.SEED_CUSTOMER_PASSWORD ?? 'CustomerPass123!';
  const customerPasswordHash = await hashPassword(customerPassword);
  const organizerPassword = process.env.SEED_ORGANIZER_PASSWORD ?? 'OrganizerPass123!';
  const organizerPasswordHash = await hashPassword(organizerPassword);
  await prisma.healthCheck.upsert({
    where: { name: 'seed' },
    update: {},
    create: { name: 'seed' },
  });

  /**
   * Admin RBAC — capability keys aligned to current admin menus:
   * Dashboard, Events, Cafes, Bookings, Promocodes, Users, Settings (Payments / Roles).
   * Roles: admin, organiser, pos, cafe_pos, scanner, event_manager, finance-manager, hr (+ customer).
   */
  const permissionCatalog: Array<{ key: string; description: string }> = [
    // Platform / Settings
    {
      key: 'panel.access',
      description: 'Sign in to the admin workspace and use assigned menus/reports',
    },
    {
      key: 'admin.access',
      description: 'Admin-only tools (Migration, Organizations)',
    },
    { key: 'roles.manage', description: 'Settings → Roles & permissions' },
    { key: 'users.read', description: 'Users menu — view staff directory and event staffing tree' },
    {
      key: 'users.write',
      description:
        'Users menu — create and edit staff (event managers: POS agents under them only)',
    },
    { key: 'settings.payments.manage', description: 'Settings → Payment settings' },
    { key: 'settings.storage.manage', description: 'Settings → File storage (Azure Blob)' },
    { key: 'settings.redis.manage', description: 'Settings → Redis' },
    {
      key: 'settings.general.manage',
      description: 'Settings → Website, social, mail & regional',
    },
    // Events
    { key: 'events.read', description: 'Events menu — view events and catalogs' },
    {
      key: 'events.write',
      description: 'Events menu — create events and unlock Advanced update sections',
    },
    {
      key: 'events.assigned.update',
      description: 'Events menu — update permitted fields on assigned events only',
    },
    { key: 'events.publish', description: 'Events menu — publish and unpublish events' },
    {
      key: 'events.update.basics',
      description:
        'Events → Basics — identity, visibility, category, organizer, waiver/seating switches',
    },
    {
      key: 'events.update.schedule',
      description: 'Events → Schedule — booking windows, dates, sessions, and capacity',
    },
    {
      key: 'events.update.place_media',
      description: 'Events → Place & media — venue and media assets',
    },
    {
      key: 'events.update.more',
      description:
        'Events → Other config — add-ons, taxes, vendors, registration, FAQs, SEO, and extras',
    },
    {
      key: 'events.update.review',
      description: 'Events → Review — submit event for review',
    },
    {
      key: 'events.update.lifecycle',
      description: 'Events list — archive, reactivate, and delete events',
    },
    {
      key: 'events.update.tickets',
      description: 'Events → Tickets — add and edit ticket types',
    },
    // Bookings
    { key: 'orders.read', description: 'Bookings menu — view orders' },
    { key: 'orders.write', description: 'Bookings menu — update bookings and order status' },
    // Dashboard
    { key: 'dashboard.read', description: 'Dashboard menu — open the dashboard page' },
    { key: 'dashboard.widget.gross_sales', description: 'Dashboard — Gross sales KPI' },
    { key: 'dashboard.widget.net_revenue', description: 'Dashboard — Net revenue KPI' },
    { key: 'dashboard.widget.tickets_sold', description: 'Dashboard — Tickets sold KPI' },
    { key: 'dashboard.widget.total_orders', description: 'Dashboard — Total orders KPI' },
    {
      key: 'dashboard.widget.revenue_mix',
      description: 'Dashboard — Revenue mix (tickets vs cafe)',
    },
    {
      key: 'dashboard.widget.revenue_analytics',
      description: 'Dashboard — Revenue analytics chart',
    },
    { key: 'dashboard.widget.order_status', description: 'Dashboard — Order status breakdown' },
    {
      key: 'dashboard.widget.secondary_kpis',
      description: 'Dashboard — Average order, Refunds, Pending orders, Capacity used',
    },
    {
      key: 'dashboard.widget.event_reports',
      description: 'Dashboard — Event reports table and Insights links',
    },
    { key: 'dashboard.widget.recent_orders', description: 'Dashboard — Recent orders table' },
    { key: 'dashboard.filter.event', description: 'Dashboard — Event selector filter' },
    {
      key: 'dashboard.filter.date_range',
      description: 'Dashboard — Date presets and custom range filter',
    },
    // Event Insights / Full Report
    {
      key: 'reports.read',
      description: 'Event Insights / Full Report — open the report shell',
    },
    { key: 'reports.tab.overview', description: 'Event Insights — Overview tab' },
    { key: 'reports.tab.tickets', description: 'Event Insights — Tickets tab' },
    { key: 'reports.tab.visitors', description: 'Event Insights — Visitors tab' },
    { key: 'reports.tab.payments', description: 'Event Insights — Payments tab' },
    { key: 'reports.tab.vendors_pos', description: 'Event Insights — Vendors & POS tab' },
    {
      key: 'reports.overview.revenue',
      description: 'Event Insights Overview — revenue KPIs, breakdown, cafe list, and sales trend',
    },
    {
      key: 'reports.overview.payment_mix',
      description: 'Event Insights Overview — payment mix',
    },
    {
      key: 'reports.overview.demographics',
      description: 'Event Insights Overview — visitor mix, age groups, regions',
    },
    {
      key: 'reports.filter.date_range',
      description: 'Event Insights — Date presets and custom range filter',
    },
    {
      key: 'reports.filter.basis',
      description: 'Event Insights — Reporting basis (trx date / event date)',
    },
    {
      key: 'reports.filter.visitor_search',
      description: 'Event Insights Visitors — search and pagination',
    },
    {
      key: 'reports.filter.vendor_select',
      description: 'Event Insights Vendors & POS — vendor filter',
    },
    // Promocodes
    { key: 'promocodes.read', description: 'Promocodes menu — view promocodes' },
    { key: 'promocodes.write', description: 'Promocodes menu — create and manage promocodes' },
    // Cafes
    { key: 'cafe.read', description: 'Cafes menu — view cafes, menus, and cafe agents' },
    // Daily closings & settlements
    { key: 'closings.read', description: 'Closings menu — view daily closings and discrepancies' },
    { key: 'closings.write', description: 'Closings — create and update daily closings' },
    { key: 'closings.approve', description: 'Closings — approve or reject daily closings' },
    { key: 'settlements.read', description: 'Closings — view settlements' },
    {
      key: 'settlements.write',
      description: 'Closings — create settlements from approved closings',
    },
    {
      key: 'cafe.write',
      description: 'Cafes menu — create cafes and unlock Advanced update sections',
    },
    { key: 'cafe.publish', description: 'Cafes menu — publish and unpublish cafes' },
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
    // CMS
    { key: 'cms.faqs.read', description: 'CMS → Homepage FAQs — view homepage questions' },
    {
      key: 'cms.faqs.write',
      description: 'CMS → Homepage FAQs — create, edit, order, and publish homepage questions',
    },
    { key: 'cms.blogs.read', description: 'CMS → Blogs — view blog posts' },
    {
      key: 'cms.blogs.write',
      description: 'CMS → Blogs — create, edit, archive, and publish blog posts',
    },
    { key: 'cms.offers.read', description: 'CMS → Offers & Promotions — view offers' },
    {
      key: 'cms.offers.write',
      description: 'CMS → Offers & Promotions — create, edit, archive, and publish offers',
    },
    { key: 'cms.footer.read', description: 'CMS → Footer — view footer menu columns and links' },
    {
      key: 'cms.footer.write',
      description: 'CMS → Footer — create, edit, reorder, and publish footer menus',
    },
    { key: 'cms.artists.read', description: 'CMS → Artists — view artist catalog' },
    {
      key: 'cms.artists.write',
      description: 'CMS → Artists — create artists in the catalog',
    },
    { key: 'cms.venues.read', description: 'CMS → Venues — view venue catalog' },
    {
      key: 'cms.venues.write',
      description: 'CMS → Venues — create venues in the catalog',
    },
    { key: 'reviews.read', description: 'Reviews — view event reviews and settings' },
    {
      key: 'reviews.manage',
      description: 'Reviews — moderate reviews and update global or event settings',
    },
  ];

  const permissionByKey = new Map<string, { id: string; key: string }>();
  for (const item of permissionCatalog) {
    const permission = await prisma.permission.upsert({
      where: { key: item.key },
      update: { description: item.description },
      create: { key: item.key, description: item.description },
    });
    permissionByKey.set(item.key, permission);
  }

  // Migrate legacy tickets.write → events.update.tickets before pruning obsolete keys.
  const legacyTicketsWrite = await prisma.permission.findUnique({
    where: { key: 'tickets.write' },
  });
  const ticketsUpdate = permissionByKey.get('events.update.tickets');
  if (legacyTicketsWrite && ticketsUpdate) {
    const links = await prisma.rolePermission.findMany({
      where: { permissionId: legacyTicketsWrite.id },
    });
    for (const link of links) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: link.roleId,
            permissionId: ticketsUpdate.id,
          },
        },
        update: {},
        create: { roleId: link.roleId, permissionId: ticketsUpdate.id },
      });
    }
  }

  await prisma.permission.deleteMany({
    where: { key: { notIn: permissionCatalog.map((item) => item.key) } },
  });

  const allPermissionKeys = permissionCatalog.map((item) => item.key);

  const dashboardFull = [
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
  ];

  const reportsFull = [
    'reports.read',
    'reports.tab.overview',
    'reports.tab.tickets',
    'reports.tab.visitors',
    'reports.tab.payments',
    'reports.tab.vendors_pos',
    'reports.overview.revenue',
    'reports.overview.payment_mix',
    'reports.overview.demographics',
    'reports.filter.date_range',
    'reports.filter.basis',
    'reports.filter.visitor_search',
    'reports.filter.vendor_select',
  ];

  const dashboardOps = [
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
  ];

  const reportsOps = [
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

  const dashboardNarrow = [
    'dashboard.read',
    'dashboard.widget.tickets_sold',
    'dashboard.widget.total_orders',
    'dashboard.widget.order_status',
    'dashboard.widget.recent_orders',
    'dashboard.filter.event',
    'dashboard.filter.date_range',
  ];

  const reportsNarrow = [
    'reports.read',
    'reports.tab.overview',
    'reports.tab.tickets',
    'reports.overview.revenue',
    'reports.filter.date_range',
  ];

  const cafeUpdateFull = [
    'cafe.update.basics',
    'cafe.update.menu',
    'cafe.update.agents',
    'cafe.update.event',
  ];

  const organiserPermissions = [
    'panel.access',
    'events.read',
    'events.assigned.update',
    'orders.read',
    'cafe.read',
    'cafe.write',
    'cafe.publish',
    ...cafeUpdateFull,
    ...dashboardOps,
    ...reportsOps,
  ];

  const roleCatalog: Array<{
    name: string;
    description: string;
    permissions: string[];
    isThirdPartyShareholder?: boolean;
  }> = [
    {
      name: 'admin',
      description: 'BookingQube Super Admin — full platform access across organisations',
      permissions: allPermissionKeys,
    },
    {
      name: 'organiser',
      description:
        'Assigned-event organiser — Dashboard, Reports, Events, Cafes, and bookings only for events they organize or are assigned to',
      permissions: organiserPermissions,
    },
    {
      name: 'pos',
      description: 'On-site sales for one event — sell tickets and manage assigned-event bookings',
      permissions: [
        'panel.access',
        'orders.read',
        'orders.write',
        'events.read',
        'closings.read',
        'closings.write',
        ...dashboardNarrow,
        ...reportsNarrow,
      ],
    },
    {
      name: 'cafe_pos',
      description: 'Cafe POS agent — open tables and settle cafe sales for assigned cafe outlets',
      permissions: [
        'panel.access',
        'orders.read',
        'orders.write',
        'events.read',
        'cafe.read',
        ...dashboardNarrow,
        ...reportsNarrow,
      ],
    },
    {
      name: 'scanner',
      description: 'Gate check-in and checkout for an assigned event',
      permissions: [
        'panel.access',
        'events.read',
        'orders.read',
        'dashboard.read',
        'dashboard.widget.tickets_sold',
        'dashboard.filter.event',
        'reports.read',
        'reports.tab.tickets',
        'reports.filter.date_range',
      ],
    },
    {
      name: 'event_manager',
      description:
        'Third-party vendor manager — scoped tickets, reports, and POS agents under them',
      isThirdPartyShareholder: true,
      permissions: [
        'panel.access',
        'events.read',
        'events.update.tickets',
        'orders.read',
        'cafe.read',
        'users.read',
        'users.write',
        ...dashboardOps,
        ...reportsOps,
        'reports.tab.vendors_pos',
        'reports.filter.vendor_select',
      ],
    },
    {
      name: 'finance-manager',
      description: 'Finance — payment settings, bookings, event reports, closings & settlements',
      permissions: [
        'panel.access',
        'orders.read',
        'events.read',
        'settings.payments.manage',
        'settings.storage.manage',
        'settings.redis.manage',
        'closings.read',
        'closings.write',
        'closings.approve',
        'settlements.read',
        'settlements.write',
        ...dashboardFull,
        ...reportsFull,
      ],
    },
    {
      name: 'hr',
      description: 'HR — staff users and event visibility',
      permissions: [
        'panel.access',
        'users.read',
        'users.write',
        'events.read',
        'dashboard.read',
        'dashboard.widget.event_reports',
        'dashboard.filter.event',
        'reports.read',
        'reports.tab.overview',
        'reports.filter.date_range',
      ],
    },
    {
      name: 'customer',
      description: 'Browse events, purchase tickets, manage own bookings',
      permissions: [],
    },
  ];

  const keptRoleNames = new Set(roleCatalog.map((role) => role.name));

  // Migrate legacy super_admin → admin before deleting obsolete roles.
  const adminRoleEarly = await prisma.role.upsert({
    where: { name: 'admin' },
    update: { description: 'Platform admin — full access across organisations' },
    create: {
      name: 'admin',
      description: 'Platform admin — full access across organisations',
    },
  });
  const legacySuperAdmin = await prisma.role.findUnique({ where: { name: 'super_admin' } });
  if (legacySuperAdmin) {
    await prisma.adminProfile.updateMany({
      where: { roleId: legacySuperAdmin.id },
      data: { roleId: adminRoleEarly.id },
    });
  }

  const obsoleteRoles = await prisma.role.findMany({
    where: { name: { notIn: [...keptRoleNames] } },
    include: { _count: { select: { admins: true } } },
  });
  for (const obsolete of obsoleteRoles) {
    if (obsolete._count.admins > 0) {
      await prisma.adminProfile.updateMany({
        where: { roleId: obsolete.id },
        data: { roleId: adminRoleEarly.id },
      });
    }
    await prisma.role.delete({ where: { id: obsolete.id } });
  }

  const roleByName = new Map<string, { id: string; name: string }>();
  for (const roleDef of roleCatalog) {
    const role = await prisma.role.upsert({
      where: { name: roleDef.name },
      update: {
        description: roleDef.description,
        isThirdPartyShareholder: Boolean(roleDef.isThirdPartyShareholder),
      },
      create: {
        name: roleDef.name,
        description: roleDef.description,
        isThirdPartyShareholder: Boolean(roleDef.isThirdPartyShareholder),
      },
    });
    roleByName.set(roleDef.name, role);

    const permissionIds = roleDef.permissions
      .map((key) => permissionByKey.get(key)?.id)
      .filter((id): id is string => Boolean(id));

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (permissionIds.length) {
      await prisma.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({
          roleId: role.id,
          permissionId,
        })),
      });
    }
  }

  const adminRole = roleByName.get('admin')!;

  const admin = await prisma.user.upsert({
    where: { email: 'admin@bookingqube.test' },
    update: {
      name: 'BookingQube Admin',
      passwordHash: adminPasswordHash,
      status: 'active',
      adminProfile: {
        upsert: {
          update: { roleId: adminRole.id, status: 'active' },
          create: { roleId: adminRole.id, status: 'active' },
        },
      },
    },
    create: {
      email: 'admin@bookingqube.test',
      name: 'BookingQube Admin',
      passwordHash: adminPasswordHash,
      status: 'active',
      adminProfile: {
        create: {
          roleId: adminRole.id,
          status: 'active',
        },
      },
    },
  });

  await prisma.user.upsert({
    where: { email: 'customer@bookingqube.test' },
    update: {
      name: 'BookingQube Customer',
      passwordHash: customerPasswordHash,
      status: 'active',
    },
    create: {
      email: 'customer@bookingqube.test',
      name: 'BookingQube Customer',
      passwordHash: customerPasswordHash,
      status: 'active',
    },
  });

  const platformOrganization = await prisma.organization.upsert({
    where: { slug: 'bookingqube' },
    update: { name: 'BookingQube', status: 'active' },
    create: { slug: 'bookingqube', name: 'BookingQube', status: 'active' },
  });
  const sampleOrganization = await prisma.organization.upsert({
    where: { slug: 'company-one' },
    update: { name: 'Company One', status: 'active' },
    create: { slug: 'company-one', name: 'Company One', status: 'active' },
  });
  const organizer = await prisma.user.upsert({
    where: { email: 'organizer@bookingqube.test' },
    update: {
      name: 'Company One Organizer',
      passwordHash: organizerPasswordHash,
      status: 'active',
    },
    create: {
      email: 'organizer@bookingqube.test',
      name: 'Company One Organizer',
      passwordHash: organizerPasswordHash,
      status: 'active',
    },
  });
  await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: { organizationId: sampleOrganization.id, userId: organizer.id },
    },
    update: { role: 'owner', status: 'active' },
    create: {
      organizationId: sampleOrganization.id,
      userId: organizer.id,
      role: 'owner',
      status: 'active',
    },
  });

  // Backfill AdminProfile for password staff who can use /login.
  const panelRoleNames = [
    'admin',
    'organiser',
    'pos',
    'cafe_pos',
    'scanner',
    'event_manager',
    'finance-manager',
    'hr',
  ] as const;
  let backfilledProfiles = 0;

  const staffWithoutProfile = await prisma.staffAssignment.findMany({
    where: {
      status: 'active',
      role: { name: { in: [...panelRoleNames] } },
      user: { adminProfile: null, status: 'active' },
    },
    select: { userId: true, roleId: true },
    distinct: ['userId'],
  });
  for (const row of staffWithoutProfile) {
    await prisma.adminProfile.create({
      data: { userId: row.userId, roleId: row.roleId, status: 'active' },
    });
    backfilledProfiles += 1;
  }

  const organiserRole = roleByName.get('organiser');
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
      await prisma.adminProfile.create({
        data: { userId: row.userId, roleId: organiserRole.id, status: 'active' },
      });
      backfilledProfiles += 1;
    }
  }
  if (backfilledProfiles > 0) {
    console.log(`Backfilled ${backfilledProfiles} AdminProfile row(s) for staff panel login.`);
  }

  const category = await prisma.eventCategory.upsert({
    where: { slug: 'experiences' },
    update: {},
    create: {
      slug: 'experiences',
      name: 'Experiences',
      status: 'active',
      translations: {
        create: [
          { locale: 'en', name: 'Experiences' },
          { locale: 'ar', name: 'التجارب' },
        ],
      },
    },
  });

  const venue = await prisma.venue.upsert({
    where: { slug: 'doha-exhibition-center' },
    update: {
      name: 'Doha Exhibition & Convention Center',
      status: 'published',
      address: 'West Bay, Doha, Qatar',
      city: 'Doha',
      latitude: '25.3255120',
      longitude: '51.5313350',
    },
    create: {
      slug: 'doha-exhibition-center',
      name: 'Doha Exhibition & Convention Center',
      status: 'published',
      address: 'West Bay, Doha, Qatar',
      city: 'Doha',
      country: 'QA',
      latitude: '25.3255120',
      longitude: '51.5313350',
      createdByUserId: admin.id,
      updatedByUserId: admin.id,
      publishedAt: new Date(),
      translations: {
        create: [
          {
            locale: 'en',
            name: 'Doha Exhibition & Convention Center',
            description: 'A modern, accessible venue in the heart of West Bay, Doha.',
            address: 'West Bay, Doha, Qatar',
          },
          {
            locale: 'ar',
            name: 'مركز الدوحة للمعارض',
            description: 'وجهة عصرية سهلة الوصول في قلب الخليج الغربي بالدوحة.',
            address: 'الخليج الغربي، الدوحة، قطر',
          },
        ],
      },
    },
  });

  await prisma.venueTranslation.upsert({
    where: { venueId_locale: { venueId: venue.id, locale: 'en' } },
    update: {
      name: 'Doha Exhibition & Convention Center',
      description: 'A modern, accessible venue in the heart of West Bay, Doha.',
      address: 'West Bay, Doha, Qatar',
      city: 'Doha',
      country: 'Qatar',
    },
    create: {
      venueId: venue.id,
      locale: 'en',
      name: 'Doha Exhibition & Convention Center',
      description: 'A modern, accessible venue in the heart of West Bay, Doha.',
      address: 'West Bay, Doha, Qatar',
      city: 'Doha',
      country: 'Qatar',
    },
  });
  await prisma.venueTranslation.upsert({
    where: { venueId_locale: { venueId: venue.id, locale: 'ar' } },
    update: {
      name: 'مركز الدوحة للمعارض والمؤتمرات',
      description: 'وجهة عصرية سهلة الوصول في قلب الخليج الغربي بالدوحة.',
      address: 'الخليج الغربي، الدوحة، قطر',
      city: 'الدوحة',
      country: 'قطر',
    },
    create: {
      venueId: venue.id,
      locale: 'ar',
      name: 'مركز الدوحة للمعارض والمؤتمرات',
      description: 'وجهة عصرية سهلة الوصول في قلب الخليج الغربي بالدوحة.',
      address: 'الخليج الغربي، الدوحة، قطر',
      city: 'الدوحة',
      country: 'قطر',
    },
  });

  const event = await prisma.event.upsert({
    where: { slug: 'sample-family-experience' },
    update: {
      organizationId: platformOrganization.id,
      isFeatured: true,
      status: 'published',
      visibility: 'public',
      venueId: venue.id,
      categoryId: category.id,
      bookingMode: 'ticketed',
      currency: 'QAR',
      requiresWaiver: true,
      startsAt: new Date('2026-10-09T07:00:00.000Z'),
      endsAt: new Date('2026-10-09T16:00:00.000Z'),
    },
    create: {
      organizationId: platformOrganization.id,
      slug: 'sample-family-experience',
      eventType: 'general',
      status: 'published',
      visibility: 'public',
      venueId: venue.id,
      categoryId: category.id,
      requiresWaiver: true,
      isFeatured: true,
      bookingMode: 'ticketed',
      currency: 'QAR',
      startsAt: new Date('2026-10-09T07:00:00.000Z'),
      endsAt: new Date('2026-10-09T16:00:00.000Z'),
      publishedAt: new Date(),
      createdByUserId: admin.id,
      updatedByUserId: admin.id,
      translations: {
        create: [
          {
            locale: 'en',
            title: 'Doha Family Discovery Festival',
            subtitle: 'A full day of discovery, creativity, and play for the whole family',
            description:
              'Step into a vibrant world of hands-on discovery at the Doha Family Discovery Festival.',
          },
          {
            locale: 'ar',
            title: 'مهرجان الدوحة العائلي للاستكشاف',
            subtitle: 'يوم متكامل من الاكتشاف والإبداع والمرح لجميع أفراد العائلة',
            description: 'استمتعوا بعالم نابض بالتجارب العملية لجميع أفراد العائلة.',
          },
        ],
      },
    },
  });

  const eventInclusions = [
    {
      title: 'Entry to all general discovery zones',
      title_ar: 'الدخول إلى جميع مناطق الاستكشاف العامة',
    },
    {
      title: 'Access to live family shows and demonstrations',
      title_ar: 'حضور العروض العائلية والتجارب الحية',
    },
    {
      title: 'One guided creative workshop per child',
      title_ar: 'ورشة إبداعية موجهة واحدة لكل طفل',
    },
    { title: 'Complimentary digital family photo', title_ar: 'صورة عائلية رقمية مجانية' },
    { title: 'Free parking at the venue', title_ar: 'مواقف مجانية في موقع الفعالية' },
  ];
  const eventExclusions = [
    { title: 'Food and beverages', title_ar: 'المأكولات والمشروبات' },
    { title: 'Premium workshops marked as add-ons', title_ar: 'ورش العمل المميزة المحددة كإضافات' },
    {
      title: 'Personal purchases and merchandise',
      title_ar: 'المشتريات الشخصية والمنتجات التذكارية',
    },
  ];
  const eventTerms = JSON.stringify([
    {
      title: 'Ticket validity',
      rule: 'Each ticket is valid only for the selected date and entry session. Tickets cannot be reused or transferred after check-in.',
      title_ar: 'صلاحية التذكرة',
      rule_ar:
        'تسري كل تذكرة على التاريخ وموعد الدخول المحددين فقط، ولا يمكن إعادة استخدامها أو نقلها بعد تسجيل الدخول.',
    },
    {
      title: 'Child supervision',
      rule: 'Guests under 13 must remain accompanied by a responsible adult throughout the experience.',
      title_ar: 'الإشراف على الأطفال',
      rule_ar: 'يجب أن يبقى الضيوف دون سن 13 عاماً برفقة شخص بالغ مسؤول طوال مدة التجربة.',
    },
    {
      title: 'Arrival time',
      rule: 'Please arrive 15 minutes before your selected session. Late entry is subject to capacity and may not be guaranteed.',
      title_ar: 'وقت الوصول',
      rule_ar:
        'يرجى الوصول قبل الموعد المحدد بـ15 دقيقة. يخضع الدخول المتأخر للسعة المتاحة ولا يمكن ضمانه.',
    },
    {
      title: 'Cancellations and refunds',
      rule: 'Tickets may be cancelled up to 48 hours before the selected session. Booking and payment processing fees are non-refundable.',
      title_ar: 'الإلغاء والاسترداد',
      rule_ar:
        'يمكن إلغاء التذاكر قبل 48 ساعة من الموعد المحدد. رسوم الحجز ومعالجة الدفع غير قابلة للاسترداد.',
    },
    {
      title: 'Safety and conduct',
      rule: 'Guests must follow venue instructions and age or height guidance displayed at individual activities.',
      title_ar: 'السلامة والسلوك',
      rule_ar: 'يجب على الضيوف اتباع تعليمات الموقع وإرشادات العمر أو الطول الموضحة عند الأنشطة.',
    },
  ]);
  const eventFaqsEn = [
    {
      id: 'recommended-age',
      question: 'What age group is the festival suitable for?',
      answer:
        'The experience is designed primarily for children aged 3–12, with activities for different ability levels. Older siblings and adults are welcome to participate in family challenges and live shows.',
    },
    {
      id: 'visit-duration',
      question: 'How long should we plan to stay?',
      answer:
        'Most families spend between three and five hours exploring. Your ticket provides access for the full session, so you can enjoy the zones at a comfortable pace.',
    },
    {
      id: 'food',
      question: 'Will food and drinks be available?',
      answer:
        'Yes. Family-friendly food, snacks, and beverages will be available for purchase. Outside food is not permitted, except for baby food and items required for medical or dietary needs.',
    },
    {
      id: 'strollers-accessibility',
      question: 'Is the venue accessible for strollers and wheelchairs?',
      answer:
        'Yes. The venue is wheelchair and stroller accessible, with lifts, accessible washrooms, and designated rest areas.',
    },
    {
      id: 'parking',
      question: 'Is parking available?',
      answer:
        'Complimentary parking is available at the venue. We recommend arriving early during peak entry periods.',
    },
    {
      id: 'bring-ticket',
      question: 'What do I need to bring?',
      answer:
        'Please have the booking QR code ready on your phone. Children should wear comfortable clothing and closed-toe shoes for hands-on activities.',
    },
  ];
  const eventFaqsAr = [
    {
      id: 'recommended-age',
      question: 'ما الفئة العمرية المناسبة للمهرجان؟',
      answer:
        'صُممت التجربة بشكل أساسي للأطفال من عمر 3 إلى 12 عاماً، مع أنشطة تناسب مستويات وقدرات مختلفة، كما يمكن للأشقاء الأكبر سناً والبالغين المشاركة.',
    },
    {
      id: 'visit-duration',
      question: 'كم من الوقت نحتاج للاستمتاع بالتجربة؟',
      answer:
        'تقضي معظم العائلات ما بين ثلاث وخمس ساعات في الاستكشاف، وتتيح التذكرة الدخول طوال الفترة المحجوزة.',
    },
    {
      id: 'food',
      question: 'هل تتوفر المأكولات والمشروبات؟',
      answer:
        'نعم، تتوفر خيارات مناسبة للعائلات للشراء. يُسمح بأغذية الأطفال والاحتياجات الغذائية أو الطبية الخاصة.',
    },
    {
      id: 'strollers-accessibility',
      question: 'هل الموقع مناسب لعربات الأطفال والكراسي المتحركة؟',
      answer: 'نعم، الموقع مجهز بالمصاعد ودورات المياه الميسرة ومناطق الاستراحة.',
    },
    {
      id: 'parking',
      question: 'هل تتوفر مواقف للسيارات؟',
      answer:
        'تتوفر مواقف مجانية في موقع الفعالية، وننصح بالحضور مبكراً خلال فترات الدخول المزدحمة.',
    },
    {
      id: 'bring-ticket',
      question: 'ما الذي يجب إحضاره؟',
      answer:
        'يرجى تجهيز رمز QR للحجز على الهاتف، وارتداء الأطفال ملابس مريحة وأحذية مغلقة للأنشطة العملية.',
    },
  ];

  await prisma.eventTranslation.upsert({
    where: { eventId_locale: { eventId: event.id, locale: 'en' } },
    update: {
      title: 'Doha Family Discovery Festival',
      subtitle: 'A full day of discovery, creativity, and play for the whole family',
      description:
        'Step into a vibrant world of hands-on discovery at the Doha Family Discovery Festival. Designed for curious young minds and the grown-ups who inspire them, this one-day experience brings together interactive science zones, creative workshops, live stage shows, family challenges, and playful learning under one roof. Explore at your own pace, meet expert facilitators, capture memorable family moments, and enjoy a thoughtfully planned day with comfortable rest areas and convenient dining options. Whether your child loves building, experimenting, performing, or simply trying something new, there is something here to spark every imagination.',
      inclusionsJson: eventInclusions,
      exclusionsJson: eventExclusions,
      termsContent: eventTerms,
      faqJson: eventFaqsEn,
      waiverContent:
        'I confirm that all participants in my booking may take part in age-appropriate, supervised festival activities. I understand that participation involves the normal risks associated with movement, creative workshops, and interactive play. I agree to follow venue and staff safety instructions, remain responsible for children in my care, disclose relevant medical or accessibility needs, and release the organiser and venue from claims arising from risks reasonably inherent in the activities, except where prohibited by law.',
      metaTitle: 'Doha Family Discovery Festival Tickets',
      metaDescription:
        'Book a memorable family day of interactive discovery, creative workshops, and live entertainment in Doha.',
    },
    create: {
      eventId: event.id,
      locale: 'en',
      title: 'Doha Family Discovery Festival',
      subtitle: 'A full day of discovery, creativity, and play for the whole family',
      description:
        'Step into a vibrant world of hands-on discovery at the Doha Family Discovery Festival. Designed for curious young minds and the grown-ups who inspire them, this one-day experience brings together interactive science zones, creative workshops, live stage shows, family challenges, and playful learning under one roof. Explore at your own pace, meet expert facilitators, capture memorable family moments, and enjoy a thoughtfully planned day with comfortable rest areas and convenient dining options. Whether your child loves building, experimenting, performing, or simply trying something new, there is something here to spark every imagination.',
      inclusionsJson: eventInclusions,
      exclusionsJson: eventExclusions,
      termsContent: eventTerms,
      faqJson: eventFaqsEn,
      waiverContent:
        'I confirm that all participants in my booking may take part in age-appropriate, supervised festival activities. I understand that participation involves the normal risks associated with movement, creative workshops, and interactive play. I agree to follow venue and staff safety instructions, remain responsible for children in my care, disclose relevant medical or accessibility needs, and release the organiser and venue from claims arising from risks reasonably inherent in the activities, except where prohibited by law.',
      metaTitle: 'Doha Family Discovery Festival Tickets',
      metaDescription:
        'Book a memorable family day of interactive discovery, creative workshops, and live entertainment in Doha.',
    },
  });

  await prisma.eventTranslation.upsert({
    where: { eventId_locale: { eventId: event.id, locale: 'ar' } },
    update: {
      title: 'مهرجان الدوحة العائلي للاستكشاف',
      subtitle: 'يوم متكامل من الاكتشاف والإبداع والمرح لجميع أفراد العائلة',
      description:
        'استمتعوا بعالم نابض بالتجارب العملية في مهرجان الدوحة العائلي للاستكشاف. تجمع هذه التجربة بين مناطق العلوم التفاعلية وورش الإبداع والعروض الحية والتحديات العائلية والتعلم الممتع تحت سقف واحد. تجولوا بالسرعة التي تناسبكم، والتقوا بالمشرفين المتخصصين، واصنعوا ذكريات عائلية جميلة في يوم مصمم بعناية لراحة جميع أفراد الأسرة.',
      inclusionsJson: eventInclusions,
      exclusionsJson: eventExclusions,
      termsContent: eventTerms,
      faqJson: eventFaqsAr,
      waiverContent:
        'أؤكد أن جميع المشاركين في حجزي يمكنهم المشاركة في أنشطة المهرجان المناسبة لأعمارهم وتحت الإشراف. وأتعهد باتباع تعليمات السلامة وتحمل مسؤولية الأطفال المرافقين لي والإفصاح عن أي احتياجات طبية أو متطلبات وصول ذات صلة.',
      metaTitle: 'تذاكر مهرجان الدوحة العائلي للاستكشاف',
      metaDescription:
        'احجزوا يوماً عائلياً مليئاً بالاكتشاف التفاعلي وورش الإبداع والعروض الحية في الدوحة.',
    },
    create: {
      eventId: event.id,
      locale: 'ar',
      title: 'مهرجان الدوحة العائلي للاستكشاف',
      subtitle: 'يوم متكامل من الاكتشاف والإبداع والمرح لجميع أفراد العائلة',
      description:
        'استمتعوا بعالم نابض بالتجارب العملية في مهرجان الدوحة العائلي للاستكشاف. تجمع هذه التجربة بين مناطق العلوم التفاعلية وورش الإبداع والعروض الحية والتحديات العائلية والتعلم الممتع تحت سقف واحد. تجولوا بالسرعة التي تناسبكم، والتقوا بالمشرفين المتخصصين، واصنعوا ذكريات عائلية جميلة في يوم مصمم بعناية لراحة جميع أفراد الأسرة.',
      inclusionsJson: eventInclusions,
      exclusionsJson: eventExclusions,
      termsContent: eventTerms,
      faqJson: eventFaqsAr,
      waiverContent:
        'أؤكد أن جميع المشاركين في حجزي يمكنهم المشاركة في أنشطة المهرجان المناسبة لأعمارهم وتحت الإشراف. وأتعهد باتباع تعليمات السلامة وتحمل مسؤولية الأطفال المرافقين لي والإفصاح عن أي احتياجات طبية أو متطلبات وصول ذات صلة.',
      metaTitle: 'تذاكر مهرجان الدوحة العائلي للاستكشاف',
      metaDescription:
        'احجزوا يوماً عائلياً مليئاً بالاكتشاف التفاعلي وورش الإبداع والعروض الحية في الدوحة.',
    },
  });

  const eventImages = [
    {
      storageKey: 'seed/doha-family-discovery-festival/hero.jpg',
      url: 'https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?auto=format&fit=crop&w=1800&q=85',
      altText: 'Children enjoying a colourful family discovery experience',
      role: 'hero' as const,
    },
    {
      storageKey: 'seed/doha-family-discovery-festival/gallery-creative-play.jpg',
      url: 'https://images.unsplash.com/photo-1596464716127-f2a82984de30?auto=format&fit=crop&w=1400&q=85',
      altText: 'Creative hands-on activities for children',
      role: 'gallery' as const,
    },
    {
      storageKey: 'seed/doha-family-discovery-festival/gallery-family.jpg',
      url: 'https://images.unsplash.com/photo-1602030028438-4cf153cbae9e?auto=format&fit=crop&w=1400&q=85',
      altText: 'A family sharing a playful learning moment',
      role: 'gallery' as const,
    },
    {
      storageKey: 'seed/doha-family-discovery-festival/tickets.jpg',
      url: 'https://images.unsplash.com/photo-1472162072942-cd5147eb3902?auto=format&fit=crop&w=1400&q=85',
      altText: 'Family activity area at the discovery festival',
      role: 'ticket_side' as const,
    },
  ];
  let seededPrimaryMediaId: string | undefined;
  for (const [index, image] of eventImages.entries()) {
    const mediaAsset =
      (await prisma.mediaAsset.findFirst({ where: { storageKey: image.storageKey } })) ??
      (await prisma.mediaAsset.create({
        data: {
          storageProvider: 'local',
          bucket: 'seed-assets',
          storageKey: image.storageKey,
          url: image.url,
          mimeType: 'image/jpeg',
          width: 1800,
          height: 1200,
          altText: image.altText,
          uploadedByUserId: admin.id,
        },
      }));
    await prisma.mediaAsset.update({
      where: { id: mediaAsset.id },
      data: { url: image.url, altText: image.altText },
    });
    const link = await prisma.eventMedia.findFirst({
      where: { eventId: event.id, mediaAssetId: mediaAsset.id, mediaRole: image.role },
    });
    if (!link) {
      await prisma.eventMedia.create({
        data: {
          eventId: event.id,
          mediaAssetId: mediaAsset.id,
          mediaRole: image.role,
          sortOrder: index,
        },
      });
    }
    if (index === 0) seededPrimaryMediaId = mediaAsset.id;
  }
  if (seededPrimaryMediaId) {
    await prisma.event.update({
      where: { id: event.id },
      data: { primaryMediaId: seededPrimaryMediaId },
    });
  }

  const artist = await prisma.artist.findUnique({
    where: { slug: 'sample-family-host' },
  });
  if (artist) {
    await prisma.eventArtist.deleteMany({ where: { artistId: artist.id } });
    await prisma.artistTranslation.deleteMany({ where: { artistId: artist.id } });
    await prisma.artist.delete({ where: { id: artist.id } });
  }

  await prisma.blog.upsert({
    where: { slug: 'planning-a-family-day-out' },
    update: {},
    create: {
      slug: 'planning-a-family-day-out',
      status: 'published',
      authorUserId: admin.id,
      publishedAt: new Date('2026-07-01T09:00:00.000Z'),
      translations: {
        create: [
          {
            locale: 'en',
            title: 'Planning a Family Day Out in Qatar',
            excerpt:
              'Simple planning tips for choosing family-friendly experiences, tickets, and venues.',
            category: 'Guides',
            tag: 'Family',
            bodyHtml:
              '<p>BookingQube helps families discover events, compare schedules, and prepare for a smooth day out.</p><p>Start with the event location, check available ticket types, and review the schedule before checkout.</p>',
            bodyJson: [
              'BookingQube helps families discover events, compare schedules, and prepare for a smooth day out.',
              'Start with the event location, check available ticket types, and review the schedule before checkout.',
            ],
            metaTitle: 'Planning a Family Day Out in Qatar',
            metaDescription:
              'Simple planning tips for choosing family-friendly experiences, tickets, and venues.',
          },
          {
            locale: 'ar',
            title: 'التخطيط ليوم عائلي في قطر',
            excerpt: 'نصائح بسيطة لاختيار التجارب والتذاكر والمواقع المناسبة للعائلة.',
            category: 'الأدلة',
            tag: 'العائلة',
            bodyHtml:
              '<p>يساعد BookingQube العائلات على اكتشاف الفعاليات ومقارنة الجداول والاستعداد ليوم ممتع.</p><p>ابدأ بالموقع، ثم تحقق من أنواع التذاكر المتاحة والجدول قبل إتمام الحجز.</p>',
            bodyJson: [
              'يساعد BookingQube العائلات على اكتشاف الفعاليات ومقارنة الجداول والاستعداد ليوم ممتع.',
              'ابدأ بالموقع، ثم تحقق من أنواع التذاكر المتاحة والجدول قبل إتمام الحجز.',
            ],
            metaTitle: 'التخطيط ليوم عائلي في قطر',
            metaDescription: 'نصائح بسيطة لاختيار التجارب والتذاكر والمواقع المناسبة للعائلة.',
          },
        ],
      },
    },
  });

  const offer = await prisma.offer.upsert({
    where: { slug: 'family-day-out-offer' },
    update: {
      status: 'published',
      authorUserId: admin.id,
      isFeatured: true,
      validUntil: new Date('2026-12-31T20:59:59.000Z'),
      sortOrder: 1,
      publishedAt: new Date('2026-07-01T09:00:00.000Z'),
    },
    create: {
      slug: 'family-day-out-offer',
      status: 'published',
      authorUserId: admin.id,
      isFeatured: true,
      validUntil: new Date('2026-12-31T20:59:59.000Z'),
      sortOrder: 1,
      publishedAt: new Date('2026-07-01T09:00:00.000Z'),
    },
  });

  await prisma.offerTranslation.upsert({
    where: {
      offerId_locale: {
        offerId: offer.id,
        locale: 'en',
      },
    },
    update: {
      title: 'Family Day Out Offer',
      subtitle: 'Save on selected family experiences',
      description:
        'A sample homepage promotion for validating offer cards, offer detail, and event links.',
      category: 'Family',
      tag: 'Limited offer',
      tagsJson: ['Family', 'Experiences', 'Qatar'],
    },
    create: {
      offerId: offer.id,
      locale: 'en',
      title: 'Family Day Out Offer',
      subtitle: 'Save on selected family experiences',
      description:
        'A sample homepage promotion for validating offer cards, offer detail, and event links.',
      category: 'Family',
      tag: 'Limited offer',
      tagsJson: ['Family', 'Experiences', 'Qatar'],
    },
  });

  await prisma.offerTranslation.upsert({
    where: {
      offerId_locale: {
        offerId: offer.id,
        locale: 'ar',
      },
    },
    update: {
      title: 'عرض اليوم العائلي',
      subtitle: 'وفّر على تجارب عائلية مختارة',
      description: 'عرض تجريبي للتحقق من بطاقات العروض وتفاصيل العرض وروابط الفعاليات.',
      category: 'العائلة',
      tag: 'عرض محدود',
      tagsJson: ['العائلة', 'التجارب', 'قطر'],
    },
    create: {
      offerId: offer.id,
      locale: 'ar',
      title: 'عرض اليوم العائلي',
      subtitle: 'وفّر على تجارب عائلية مختارة',
      description: 'عرض تجريبي للتحقق من بطاقات العروض وتفاصيل العرض وروابط الفعاليات.',
      category: 'العائلة',
      tag: 'عرض محدود',
      tagsJson: ['العائلة', 'التجارب', 'قطر'],
    },
  });

  await prisma.offerEvent.upsert({
    where: {
      offerId_eventId: {
        offerId: offer.id,
        eventId: event.id,
      },
    },
    update: {
      sortOrder: 1,
    },
    create: {
      offerId: offer.id,
      eventId: event.id,
      sortOrder: 1,
    },
  });

  const familyPromo = await prisma.promoCode.upsert({
    where: { code: 'FAMILY10' },
    update: {
      organizationId: platformOrganization.id,
      status: 'active',
      discountType: 'percent',
      discountValue: '10.000',
      currency: 'QAR',
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      endsAt: new Date('2026-12-31T20:59:59.000Z'),
      maxRedemptions: null,
      maxRedemptionsPerCustomer: null,
    },
    create: {
      organizationId: platformOrganization.id,
      code: 'FAMILY10',
      status: 'active',
      discountType: 'percent',
      discountValue: '10.000',
      currency: 'QAR',
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      endsAt: new Date('2026-12-31T20:59:59.000Z'),
    },
  });

  const existingFamilyPromoTarget = await prisma.promoCodeTarget.findFirst({
    where: {
      promoCodeId: familyPromo.id,
      targetType: 'event',
      targetId: event.id,
    },
  });

  if (!existingFamilyPromoTarget) {
    await prisma.promoCodeTarget.create({
      data: {
        promoCodeId: familyPromo.id,
        targetType: 'event',
        targetId: event.id,
      },
    });
  }

  const englishHomepageFaqCount = await prisma.homepageFaq.count({
    where: { locale: 'en' },
  });
  if (englishHomepageFaqCount === 0) {
    await prisma.homepageFaq.createMany({
      data: [
        {
          locale: 'en',
          question: 'How do I book an event?',
          answer:
            'Choose an event, select your date and tickets, then complete payment or registration.',
          status: 'published',
          sortOrder: 1,
        },
        {
          locale: 'en',
          question: 'Where can I find my tickets?',
          answer:
            'After checkout, you can review your tickets from the My Tickets page in your account.',
          status: 'published',
          sortOrder: 2,
        },
        {
          locale: 'en',
          question: 'How do I contact support?',
          answer: 'You can reach BookingQube support through the contact details in the footer.',
          status: 'published',
          sortOrder: 3,
        },
      ],
    });
  }

  const arabicHomepageFaqCount = await prisma.homepageFaq.count({
    where: { locale: 'ar' },
  });
  if (arabicHomepageFaqCount === 0) {
    await prisma.homepageFaq.createMany({
      data: [
        {
          locale: 'ar',
          question: 'كيف أحجز فعالية؟',
          answer: 'اختر الفعالية والتاريخ والتذاكر، ثم أكمل خطوات الدفع أو التسجيل.',
          status: 'published',
          sortOrder: 1,
        },
        {
          locale: 'ar',
          question: 'أين أجد تذاكري؟',
          answer: 'بعد إتمام الحجز، يمكنك مراجعة التذاكر من صفحة تذاكري في حسابك.',
          status: 'published',
          sortOrder: 2,
        },
        {
          locale: 'ar',
          question: 'كيف أتواصل مع الدعم؟',
          answer: 'يمكنك التواصل مع فريق BookingQube من خلال بيانات التواصل في أسفل الصفحة.',
          status: 'published',
          sortOrder: 3,
        },
      ],
    });
  }

  await prisma.footerContent.upsert({
    where: { locale: 'en' },
    update: {
      status: 'published',
      contentJson: footerContent('en'),
    },
    create: {
      locale: 'en',
      status: 'published',
      contentJson: footerContent('en'),
    },
  });

  await prisma.footerContent.upsert({
    where: { locale: 'ar' },
    update: {
      status: 'published',
      contentJson: footerContent('ar'),
    },
    create: {
      locale: 'ar',
      status: 'published',
      contentJson: footerContent('ar'),
    },
  });

  const existingFooterMenus = await prisma.footerMenuItem.count();
  if (existingFooterMenus === 0) {
    const ourServices = await prisma.footerMenuItem.create({
      data: {
        titleEn: 'Our Services',
        titleAr: 'خدماتنا',
        descriptionEn: 'Solutions that power events end to end',
        descriptionAr: 'حلول تدعم الفعاليات من البداية إلى النهاية',
        sortOrder: 0,
        status: 'published',
      },
    });

    const serviceLinks: Array<{
      titleEn: string;
      titleAr: string;
      slug: string;
      sortOrder: number;
    }> = [
      {
        titleEn: 'Event Ticketing',
        titleAr: 'تذاكر الفعاليات',
        slug: 'event-ticketing',
        sortOrder: 0,
      },
      {
        titleEn: 'Registration & Staffing',
        titleAr: 'التسجيل والموظفين',
        slug: 'registration-staffing',
        sortOrder: 1,
      },
      {
        titleEn: 'Box Office Solution',
        titleAr: 'حلول شباك التذاكر',
        slug: 'box-office-solution',
        sortOrder: 2,
      },
      {
        titleEn: 'BQ Concierge',
        titleAr: 'كونسيرج BookingQube',
        slug: 'bq-concierge',
        sortOrder: 3,
      },
      {
        titleEn: 'Theme Park Management Solution',
        titleAr: 'حلول إدارة الحدائق الترفيهية',
        slug: 'theme-park-management',
        sortOrder: 4,
      },
    ];

    for (const link of serviceLinks) {
      await prisma.footerMenuItem.create({
        data: {
          parentId: ourServices.id,
          titleEn: link.titleEn,
          titleAr: link.titleAr,
          slug: link.slug,
          url: `/${link.slug}`,
          sortOrder: link.sortOrder,
          status: 'published',
          bodyHtmlEn: `<p>Learn more about ${link.titleEn} with BookingQube.</p>`,
          bodyHtmlAr: `<p>تعرّف أكثر على ${link.titleAr} مع BookingQube.</p>`,
        },
      });
    }
  }

  const registrationEvent = await prisma.event.upsert({
    where: { slug: 'sample-registration-workshop' },
    update: {
      organizationId: platformOrganization.id,
      eventType: 'registration_only',
      status: 'published',
      visibility: 'unlisted',
      venueId: venue.id,
      categoryId: category.id,
      bookingMode: 'registration',
      startsAt: new Date('2026-09-10T14:00:00.000Z'),
      endsAt: new Date('2026-09-10T16:00:00.000Z'),
      publishedAt: new Date(),
      updatedByUserId: admin.id,
    },
    create: {
      organizationId: platformOrganization.id,
      slug: 'sample-registration-workshop',
      eventType: 'registration_only',
      status: 'published',
      visibility: 'unlisted',
      venueId: venue.id,
      categoryId: category.id,
      requiresWaiver: false,
      bookingMode: 'registration',
      currency: 'QAR',
      startsAt: new Date('2026-09-10T14:00:00.000Z'),
      endsAt: new Date('2026-09-10T16:00:00.000Z'),
      publishedAt: new Date(),
      createdByUserId: admin.id,
      updatedByUserId: admin.id,
      translations: {
        create: [
          {
            locale: 'en',
            title: 'Sample Registration Workshop',
            subtitle: 'Free registration-only experience',
            description:
              'A sample registration-only event used to verify public form loading and submission.',
          },
          {
            locale: 'ar',
            title: 'ورشة تسجيل تجريبية',
            subtitle: 'تجربة مجانية تتطلب التسجيل فقط',
            description: 'فعالية تجريبية للتحقق من تحميل نموذج التسجيل وإرساله.',
          },
        ],
      },
    },
  });

  await prisma.eventTranslation.upsert({
    where: {
      eventId_locale: {
        eventId: registrationEvent.id,
        locale: 'en',
      },
    },
    update: {
      title: 'Sample Registration Workshop',
      subtitle: 'Free registration-only experience',
      description:
        'A sample registration-only event used to verify public form loading and submission.',
    },
    create: {
      eventId: registrationEvent.id,
      locale: 'en',
      title: 'Sample Registration Workshop',
      subtitle: 'Free registration-only experience',
      description:
        'A sample registration-only event used to verify public form loading and submission.',
    },
  });

  await prisma.eventTranslation.upsert({
    where: {
      eventId_locale: {
        eventId: registrationEvent.id,
        locale: 'ar',
      },
    },
    update: {
      title: 'ورشة تسجيل تجريبية',
      subtitle: 'تجربة مجانية تتطلب التسجيل فقط',
      description: 'فعالية تجريبية للتحقق من تحميل نموذج التسجيل وإرساله.',
    },
    create: {
      eventId: registrationEvent.id,
      locale: 'ar',
      title: 'ورشة تسجيل تجريبية',
      subtitle: 'تجربة مجانية تتطلب التسجيل فقط',
      description: 'فعالية تجريبية للتحقق من تحميل نموذج التسجيل وإرساله.',
    },
  });

  const registrationForm =
    (await prisma.registrationForm.findFirst({
      where: {
        eventId: registrationEvent.id,
      },
    })) ??
    (await prisma.registrationForm.create({
      data: {
        eventId: registrationEvent.id,
        status: 'published',
        publishedAt: new Date(),
      },
    }));

  await prisma.registrationForm.update({
    where: { id: registrationForm.id },
    data: {
      status: 'published',
      publishedAt: registrationForm.publishedAt ?? new Date(),
    },
  });

  await prisma.registrationFormField.upsert({
    where: {
      formId_fieldKey: {
        formId: registrationForm.id,
        fieldKey: 'full_name',
      },
    },
    update: {
      label: 'Full name',
      fieldType: 'text',
      required: true,
      sortOrder: 1,
    },
    create: {
      formId: registrationForm.id,
      fieldKey: 'full_name',
      label: 'Full name',
      fieldType: 'text',
      required: true,
      sortOrder: 1,
    },
  });

  await prisma.registrationFormField.upsert({
    where: {
      formId_fieldKey: {
        formId: registrationForm.id,
        fieldKey: 'email',
      },
    },
    update: {
      label: 'Email address',
      fieldType: 'email',
      required: true,
      sortOrder: 2,
    },
    create: {
      formId: registrationForm.id,
      fieldKey: 'email',
      label: 'Email address',
      fieldType: 'email',
      required: true,
      sortOrder: 2,
    },
  });

  await prisma.registrationFormField.upsert({
    where: {
      formId_fieldKey: {
        formId: registrationForm.id,
        fieldKey: 'attendance_preference',
      },
    },
    update: {
      label: 'Attendance preference',
      fieldType: 'select',
      required: false,
      optionsJson: ['In person', 'Online'],
      sortOrder: 3,
    },
    create: {
      formId: registrationForm.id,
      fieldKey: 'attendance_preference',
      label: 'Attendance preference',
      fieldType: 'select',
      required: false,
      optionsJson: ['In person', 'Online'],
      sortOrder: 3,
    },
  });

  await prisma.eventDate.updateMany({
    where: { eventId: event.id },
    data: { status: 'hidden' },
  });
  const eventDate = await prisma.eventDate.upsert({
    where: {
      eventId_date: {
        eventId: event.id,
        date: new Date('2026-10-09T00:00:00.000Z'),
      },
    },
    update: { status: 'active' },
    create: {
      eventId: event.id,
      date: new Date('2026-10-09T00:00:00.000Z'),
      status: 'active',
    },
  });

  await prisma.eventSession.updateMany({
    where: { eventId: event.id },
    data: { status: 'hidden' },
  });
  const sessionDefinitions = [
    {
      startsAt: '2026-10-09T07:00:00.000Z',
      endsAt: '2026-10-09T10:00:00.000Z',
      displayTime: '10:00 AM',
    },
    {
      startsAt: '2026-10-09T11:00:00.000Z',
      endsAt: '2026-10-09T14:00:00.000Z',
      displayTime: '2:00 PM',
    },
    {
      startsAt: '2026-10-09T14:00:00.000Z',
      endsAt: '2026-10-09T17:00:00.000Z',
      displayTime: '5:00 PM',
    },
  ];
  const seededSessions: { id: string }[] = [];
  for (const definition of sessionDefinitions) {
    const startsAt = new Date(definition.startsAt);
    const existingSession = await prisma.eventSession.findFirst({
      where: { eventId: event.id, startsAt },
    });
    const seededSession = existingSession
      ? await prisma.eventSession.update({
          where: { id: existingSession.id },
          data: {
            eventDateId: eventDate.id,
            endsAt: new Date(definition.endsAt),
            displayTime: definition.displayTime,
            status: 'active',
            capacity: 200,
          },
        })
      : await prisma.eventSession.create({
          data: {
            eventId: event.id,
            eventDateId: eventDate.id,
            startsAt,
            endsAt: new Date(definition.endsAt),
            displayTime: definition.displayTime,
            status: 'active',
            capacity: 200,
          },
        });
    seededSessions.push(seededSession);
  }

  const ticketGroup =
    (await prisma.ticketGroup.findFirst({
      where: {
        eventId: event.id,
        title: 'Admission',
      },
    })) ??
    (await prisma.ticketGroup.create({
      data: {
        eventId: event.id,
        title: 'Admission',
        subtitle: 'General admission tickets',
        iconType: 'ticket',
        sortOrder: 1,
      },
    }));

  const adultTicket = await prisma.ticketType.upsert({
    where: {
      eventId_externalKey: {
        eventId: event.id,
        externalKey: 'adult-pass',
      },
    },
    update: {
      ticketGroupId: ticketGroup.id,
      title: 'Adult Pass',
      subtitle: 'Full-session admission for guests aged 13 and above',
      inclusions: ['All general discovery zones', 'Live shows', 'Digital family photo'],
      exclusions: ['Food and beverages', 'Premium workshops'],
      iconType: 'ticket',
      hasVariants: false,
      basePrice: '75.000',
      currency: 'QAR',
      maxQtyPerOrder: 10,
      status: 'active',
      sortOrder: 1,
    },
    create: {
      eventId: event.id,
      ticketGroupId: ticketGroup.id,
      externalKey: 'adult-pass',
      title: 'Adult Pass',
      subtitle: 'Full-session admission for guests aged 13 and above',
      inclusions: ['All general discovery zones', 'Live shows', 'Digital family photo'],
      exclusions: ['Food and beverages', 'Premium workshops'],
      iconType: 'ticket',
      hasVariants: false,
      basePrice: '75.000',
      currency: 'QAR',
      maxQtyPerOrder: 10,
      status: 'active',
      sortOrder: 1,
    },
  });

  const childTicket = await prisma.ticketType.upsert({
    where: {
      eventId_externalKey: {
        eventId: event.id,
        externalKey: 'child-pass',
      },
    },
    update: {
      ticketGroupId: ticketGroup.id,
      title: 'Child Discovery Pass',
      subtitle: 'Full-session admission and one guided workshop for ages 3–12',
      inclusions: [
        'All general discovery zones',
        'Live shows',
        'One guided creative workshop',
        'Digital family photo',
      ],
      exclusions: ['Food and beverages', 'Premium workshops'],
      iconType: 'ticket',
      hasVariants: false,
      basePrice: '45.000',
      currency: 'QAR',
      maxQtyPerOrder: 10,
      status: 'active',
      sortOrder: 2,
    },
    create: {
      eventId: event.id,
      ticketGroupId: ticketGroup.id,
      externalKey: 'child-pass',
      title: 'Child Discovery Pass',
      subtitle: 'Full-session admission and one guided workshop for ages 3–12',
      inclusions: [
        'All general discovery zones',
        'Live shows',
        'One guided creative workshop',
        'Digital family photo',
      ],
      exclusions: ['Food and beverages', 'Premium workshops'],
      iconType: 'ticket',
      hasVariants: false,
      basePrice: '45.000',
      currency: 'QAR',
      maxQtyPerOrder: 10,
      status: 'active',
      sortOrder: 2,
    },
  });

  const vipTicket = await prisma.ticketType.upsert({
    where: {
      eventId_externalKey: {
        eventId: event.id,
        externalKey: 'vip-pass',
      },
    },
    update: {
      ticketGroupId: ticketGroup.id,
      title: 'Family VIP Pass',
      subtitle: 'Premium family access with priority entry and reserved workshops',
      iconType: 'star',
      hasVariants: true,
      basePrice: null,
      currency: 'QAR',
      maxQtyPerOrder: 6,
      status: 'active',
      sortOrder: 3,
    },
    create: {
      eventId: event.id,
      ticketGroupId: ticketGroup.id,
      externalKey: 'vip-pass',
      title: 'Family VIP Pass',
      subtitle: 'Premium family access with priority entry and reserved workshops',
      iconType: 'star',
      hasVariants: true,
      basePrice: null,
      currency: 'QAR',
      maxQtyPerOrder: 6,
      status: 'active',
      sortOrder: 3,
    },
  });

  const vipMorningVariant = await prisma.ticketVariant.upsert({
    where: {
      ticketTypeId_externalKey: {
        ticketTypeId: vipTicket.id,
        externalKey: 'vip-morning',
      },
    },
    update: {
      name: 'Family of Four',
      description:
        'Admission for two adults and two children, priority entry, and a reserved workshop place.',
      basePrice: '220.000',
      currency: 'QAR',
      badge: 'Best value',
      maxQtyPerOrder: 6,
      status: 'active',
      sortOrder: 1,
    },
    create: {
      ticketTypeId: vipTicket.id,
      externalKey: 'vip-morning',
      name: 'Family of Four',
      description:
        'Admission for two adults and two children, priority entry, and a reserved workshop place.',
      basePrice: '220.000',
      currency: 'QAR',
      badge: 'Best value',
      maxQtyPerOrder: 6,
      status: 'active',
      sortOrder: 1,
    },
  });

  const vipEveningVariant = await prisma.ticketVariant.upsert({
    where: {
      ticketTypeId_externalKey: {
        ticketTypeId: vipTicket.id,
        externalKey: 'vip-evening',
      },
    },
    update: {
      name: 'Family of Six',
      description:
        'Admission for two adults and four children, priority entry, and reserved workshop places.',
      basePrice: '295.000',
      currency: 'QAR',
      badge: 'Limited',
      maxQtyPerOrder: 6,
      status: 'active',
      sortOrder: 2,
    },
    create: {
      ticketTypeId: vipTicket.id,
      externalKey: 'vip-evening',
      name: 'Family of Six',
      description:
        'Admission for two adults and four children, priority entry, and reserved workshop places.',
      basePrice: '295.000',
      currency: 'QAR',
      badge: 'Limited',
      maxQtyPerOrder: 6,
      status: 'active',
      sortOrder: 2,
    },
  });

  const childPromo = await prisma.promoCode.upsert({
    where: { code: 'CHILD5' },
    update: {
      organizationId: platformOrganization.id,
      status: 'active',
      discountType: 'fixed',
      discountValue: '5.000',
      currency: 'QAR',
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      endsAt: new Date('2026-12-31T20:59:59.000Z'),
      maxRedemptions: null,
      maxRedemptionsPerCustomer: null,
    },
    create: {
      organizationId: platformOrganization.id,
      code: 'CHILD5',
      status: 'active',
      discountType: 'fixed',
      discountValue: '5.000',
      currency: 'QAR',
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      endsAt: new Date('2026-12-31T20:59:59.000Z'),
    },
  });

  const existingChildPromoTarget = await prisma.promoCodeTarget.findFirst({
    where: {
      promoCodeId: childPromo.id,
      targetType: 'ticket_type',
      targetId: childTicket.id,
    },
  });

  if (!existingChildPromoTarget) {
    await prisma.promoCodeTarget.create({
      data: {
        promoCodeId: childPromo.id,
        targetType: 'ticket_type',
        targetId: childTicket.id,
      },
    });
  }

  const vipMorningPromo = await prisma.promoCode.upsert({
    where: { code: 'VIPMORNING15' },
    update: {
      organizationId: platformOrganization.id,
      status: 'active',
      discountType: 'percent',
      discountValue: '15.000',
      currency: 'QAR',
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      endsAt: new Date('2026-12-31T20:59:59.000Z'),
      maxRedemptions: null,
      maxRedemptionsPerCustomer: null,
    },
    create: {
      organizationId: platformOrganization.id,
      code: 'VIPMORNING15',
      status: 'active',
      discountType: 'percent',
      discountValue: '15.000',
      currency: 'QAR',
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      endsAt: new Date('2026-12-31T20:59:59.000Z'),
    },
  });

  const existingVipMorningPromoTarget = await prisma.promoCodeTarget.findFirst({
    where: {
      promoCodeId: vipMorningPromo.id,
      targetType: 'ticket_variant',
      targetId: vipMorningVariant.id,
    },
  });

  if (!existingVipMorningPromoTarget) {
    await prisma.promoCodeTarget.create({
      data: {
        promoCodeId: vipMorningPromo.id,
        targetType: 'ticket_variant',
        targetId: vipMorningVariant.id,
      },
    });
  }

  const mealAddon = await prisma.addon.upsert({
    where: {
      eventId_externalKey: {
        eventId: event.id,
        externalKey: 'meal-combo',
      },
    },
    update: {
      title: 'Family Snack Box',
      subtitle: 'A child-friendly snack, fresh fruit, and bottled water',
      iconType: 'meal',
      hasVariants: false,
      basePrice: '25.000',
      currency: 'QAR',
      maxQtyPerOrder: 10,
      status: 'active',
      sortOrder: 1,
    },
    create: {
      eventId: event.id,
      externalKey: 'meal-combo',
      title: 'Family Snack Box',
      subtitle: 'A child-friendly snack, fresh fruit, and bottled water',
      iconType: 'meal',
      hasVariants: false,
      basePrice: '25.000',
      currency: 'QAR',
      maxQtyPerOrder: 10,
      status: 'active',
      sortOrder: 1,
    },
  });

  const inventoryDefinitions = [
    { itemType: 'ticket_type' as const, itemId: adultTicket.id, totalQuantity: 120 },
    { itemType: 'ticket_type' as const, itemId: childTicket.id, totalQuantity: 80 },
    { itemType: 'ticket_variant' as const, itemId: vipMorningVariant.id, totalQuantity: 40 },
    { itemType: 'ticket_variant' as const, itemId: vipEveningVariant.id, totalQuantity: 30 },
    { itemType: 'addon' as const, itemId: mealAddon.id, totalQuantity: 150 },
  ];
  for (const seededSession of seededSessions) {
    for (const inventory of inventoryDefinitions) {
      const existingInventory = await prisma.inventoryItem.findFirst({
        where: {
          eventSessionId: seededSession.id,
          itemType: inventory.itemType,
          itemId: inventory.itemId,
        },
      });
      if (existingInventory) {
        await prisma.inventoryItem.update({
          where: { id: existingInventory.id },
          data: { totalQuantity: inventory.totalQuantity, status: 'active' },
        });
      } else {
        await prisma.inventoryItem.create({
          data: {
            eventId: event.id,
            eventSessionId: seededSession.id,
            itemType: inventory.itemType,
            itemId: inventory.itemId,
            totalQuantity: inventory.totalQuantity,
            soldQuantity: 0,
            heldQuantity: 0,
            status: 'active',
          },
        });
      }
    }
  }
}

function footerContent(locale: 'en' | 'ar') {
  const assetBaseUrl =
    'https://bookingqube-staging-deb2ecbxcrd5cmbq.eastus-01.azurewebsites.net/images';

  return {
    why_book: {
      title: locale === 'ar' ? 'لماذا تحجز مع BookingQube؟' : 'Why book with BookingQube?',
      items:
        locale === 'ar'
          ? [
              {
                title: 'دفع موثوق',
                description: 'دفع سريع وآمن',
                icon_url: `${assetBaseUrl}/trusted_icons.svg`,
              },
              {
                title: 'تأكيد فوري',
                description: 'ضمان حجز بدون تعقيد',
                icon_url: `${assetBaseUrl}/immediate_confirmation.svg`,
              },
              {
                title: 'بائع تذاكر موثوق',
                description: 'منصة موثوقة للفعاليات',
                icon_url: `${assetBaseUrl}/trusted_tickets.svg`,
              },
              {
                title: 'دعم متاح عند الحاجة',
                description: 'مساعدة مستمرة بعد الحجز',
                icon_url: `${assetBaseUrl}/support.svg`,
              },
            ]
          : [
              {
                title: 'Trusted Checkout',
                description: 'Fast and trusted payment',
                icon_url: `${assetBaseUrl}/trusted_icons.svg`,
              },
              {
                title: 'Immediate confirmation',
                description: 'Risk-free guarantee',
                icon_url: `${assetBaseUrl}/immediate_confirmation.svg`,
              },
              {
                title: 'Trusted Ticket Seller',
                description: 'Trusted event ticketing',
                icon_url: `${assetBaseUrl}/trusted_tickets.svg`,
              },
              {
                title: 'Support at Your Fingertips',
                description: 'Consistent after-sales help',
                icon_url: `${assetBaseUrl}/support.svg`,
              },
            ],
    },
    payment_methods: {
      title: locale === 'ar' ? 'اختر طريقة الدفع' : 'Choose Your Way to Pay',
      items: [
        { type: 'visa', image_url: `${assetBaseUrl}/visa-logo.svg` },
        { type: 'mastercard', image_url: `${assetBaseUrl}/mastercard-logo.svg` },
        { type: 'amex', image_url: `${assetBaseUrl}/american-express.svg` },
      ],
    },
    brand: {
      logo_url: 'https://bookingqube.blob.core.windows.net/bqcontainer/static/eeeqa-logo.png',
      logo_link: 'https://eeeqa.com',
      tagline: locale === 'ar' ? 'احجز كل تجارب الترفيه' : 'Book Everything Entertainment',
    },
    contact: {
      queries_heading:
        locale === 'ar' ? 'لديك أسئلة؟ لدينا الإجابات' : "Got Queries? We've Got Answers!",
      contact_heading: locale === 'ar' ? 'تواصل معنا' : 'Please contact us',
      phone: '+974 5113 8418',
      email: 'info@bookingqube.com',
      address:
        'Floor 36, Office 3602,\nPalm tower B, Majlis Al Taawon Street,\nWest Bay, P.O Box 38221, Doha',
      hotline: {
        label: locale === 'ar' ? 'خط معلومات التذاكر' : 'Ticket Info hotline',
        phone: '+974 5113 8418',
        hours: locale === 'ar' ? 'يوميا 09:00 AM - 12:00 PM' : 'Everyday 09:00 AM - 12:00 PM',
      },
      whatsapp: {
        url: 'https://wa.me/97451138418?text=Welcome%20to%20BookingQube%20Support%20Center%21%20How%20may%20we%20assist%20you%20today%3F',
        number: '97451138418',
        image_url: `${assetBaseUrl}/whatsapp-modern-round.svg`,
      },
      chat_online_enabled: false,
      chat_online_label: locale === 'ar' ? 'دردشة مباشرة' : 'Chat Online',
    },
    we_accept: {
      title: locale === 'ar' ? 'نقبل' : 'We accept',
      items: [
        { type: 'apple_pay', image_url: `${assetBaseUrl}/apple-pay.svg` },
        { type: 'google_pay', image_url: `${assetBaseUrl}/google-pay.png` },
        { type: 'visa', image_url: `${assetBaseUrl}/visa-logo.svg` },
        { type: 'mastercard', image_url: `${assetBaseUrl}/mastercard-logo.svg` },
      ],
    },
    app_downloads: {
      title: locale === 'ar' ? 'حمل التطبيق' : 'Download the app',
      items: [
        {
          type: 'google_play',
          url: 'https://play.google.com/store/apps/details?id=com.bookingqube.bookingqubeapp',
          image_url: `${assetBaseUrl}/google-play-black-en.svg`,
        },
        {
          type: 'app_store',
          url: 'https://apps.apple.com/qa/app/bookingqube/id6444101297',
          image_url: `${assetBaseUrl}/app-store-black-en.svg`,
        },
      ],
    },
    social: [
      {
        platform: 'facebook',
        url: 'https://www.facebook.com/bookingqube',
        icon: 'fab fa-facebook-f',
      },
      {
        platform: 'instagram',
        url: 'https://www.instagram.com/bookingqube/',
        icon: 'fab fa-instagram',
      },
      {
        platform: 'linkedin',
        url: 'https://www.linkedin.com/company/bookingqube/',
        icon: 'fab fa-linkedin',
      },
    ],
    support_center: {
      text: locale === 'ar' ? 'هل لديك أسئلة؟ زر' : 'Do you have any questions? Visit our',
      button: locale === 'ar' ? 'مركز الدعم' : 'Support center',
      url: '/pages/faqs',
    },
  };
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
