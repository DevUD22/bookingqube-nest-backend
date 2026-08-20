import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StaffAssignmentStatus, UserStatus } from '@prisma/client';

import { revokeAuthSessionsForUser } from '../../common/auth/session-revocation';
import { hashPassword } from '../../common/crypto/password';
import { PrismaService } from '../../database/prisma.service';
import { AuthenticatedAdmin } from '../admin-auth/strategies/admin-jwt.strategy';
import {
  CreateStaffAssignmentDto,
  CreateStaffUserDto,
  UpdateStaffAssignmentDto,
  UpdateStaffUserDto,
} from './dto/admin-staff.dto';

const STAFF_ROLES = new Set([
  'admin',
  'organiser',
  'pos',
  'cafe_pos',
  'scanner',
  'event_manager',
  'finance-manager',
  'hr',
]);

/** Roles that are never assignable as event/org staff from creatable-roles. */
const NON_ASSIGNABLE_ROLES = new Set(['admin', 'customer']);

const EVENT_SCOPED_ROLES = new Set(['pos', 'scanner', 'event_manager']);
/** Roles that may sign in to the admin panel (/login) via AdminProfile + panel.access. */
const ADMIN_PANEL_ROLES = new Set([
  'admin',
  'organiser',
  'pos',
  'cafe_pos',
  // 'scanner',
  'event_manager',
  'finance-manager',
  'hr',
]);
const USERNAME_ROLES = new Set(['pos', 'cafe_pos']);

const TOP_LEVEL_ROLES = [
  'admin',
  'organiser',
  'pos',
  'cafe_pos',
  'event_manager',
  'finance-manager',
  'hr',
] as const;

const UNDER_ORGANISER_ROLES = [
  'pos',
  'cafe_pos',
  'scanner',
  'event_manager',
  'finance-manager',
  'hr',
] as const;

const UNDER_EVENT_MANAGER_ROLES = ['pos'] as const;

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  organiser: 'Organiser',
  pos: 'POS',
  cafe_pos: 'Cafe POS agent',
  scanner: 'Scanner',
  event_manager: 'Event manager',
  'finance-manager': 'Finance manager',
  hr: 'HR',
};

function formatRoleLabel(name: string) {
  return (
    ROLE_LABELS[name] ??
    name.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
  );
}

function isBuiltinStaffRole(name: string) {
  return STAFF_ROLES.has(name);
}

function isShareholderScopedRole(role: {
  name: string;
  isThirdPartyShareholder?: boolean | null;
}) {
  if (role.isThirdPartyShareholder) return true;
  const key = role.name.trim().toLowerCase();
  return key === 'event_manager' || key === 'event-manager';
}

const assignmentInclude = {
  user: {
    select: { id: true, name: true, email: true, username: true, status: true },
  },
  role: true,
  organization: { select: { id: true, name: true, slug: true } },
  event: {
    select: {
      id: true,
      slug: true,
      translations: { where: { locale: 'en' }, select: { title: true }, take: 1 },
    },
  },
  thirdPartyVendor: { select: { id: true, name: true, isMain: true, isCafe: true } },
  managedBy: { select: { id: true, name: true, email: true } },
} as const;

type AssignmentRow = {
  id: string;
  status: string;
  ticketTypeIds: string[];
  thirdPartyVendorIds: string[];
  isCafeAgent: boolean;
  managedByUserId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  user: { id: string; name: string; email: string; username: string | null; status: string };
  role: { name: string };
  organization: { id: string; name: string; slug: string };
  event: {
    id: string;
    slug: string;
    translations: Array<{ title: string }>;
  } | null;
  thirdPartyVendor: { id: string; name: string; isMain: boolean; isCafe: boolean } | null;
  managedBy: { id: string; name: string; email: string } | null;
};

@Injectable()
export class AdminStaffService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    filters?: {
      organization_id?: string;
      role?: string;
      q?: string;
      status?: string;
      sort?: string;
      page?: string;
      per_page?: string;
    },
    caller?: AuthenticatedAdmin,
  ) {
    const page = Math.max(1, Number(filters?.page) || 1);
    const perPage = Math.min(100, Math.max(10, Number(filters?.per_page) || 25));
    const search = filters?.q?.trim();
    const status =
      filters?.status && ['active', 'suspended', 'deleted'].includes(filters.status)
        ? (filters.status as UserStatus)
        : undefined;
    if (filters?.status && !status) {
      throw new BadRequestException('Invalid user status filter.');
    }

    const emScoped = caller && this.isEventManagerRole(caller.role);

    const baseAnd: Prisma.UserWhereInput[] = [
      emScoped
        ? {
            staffAssignments: {
              some: {
                managedByUserId: caller.id,
                role: { name: 'pos' },
              },
            },
          }
        : {
            OR: [
              { staffAssignments: { some: {} } },
              { organizationMemberships: { some: {} } },
              { adminProfile: { isNot: null } },
            ],
          },
    ];

    if (search) {
      baseAnd.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { username: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    if (filters?.organization_id) {
      baseAnd.push({
        OR: [
          { staffAssignments: { some: { organizationId: filters.organization_id } } },
          {
            organizationMemberships: {
              some: { organizationId: filters.organization_id },
            },
          },
        ],
      });
    }

    if (status) {
      baseAnd.push({ status });
    }

    const roleWhere = (role: string): Prisma.UserWhereInput => ({
      OR: [
        { staffAssignments: { some: { role: { name: role } } } },
        { adminProfile: { role: { name: role } } },
        ...(role === 'organiser'
          ? [{ organizationMemberships: { some: {} } }]
          : []),
      ],
    });

    const and = [...baseAnd];
    if (filters?.role) {
      and.push(roleWhere(filters.role));
    }

    const where: Prisma.UserWhereInput = { AND: and };
    const baseWhere: Prisma.UserWhereInput = { AND: baseAnd };
    const orderBy: Prisma.UserOrderByWithRelationInput[] =
      filters?.sort === 'name_asc'
        ? [{ name: 'asc' }, { id: 'asc' }]
        : filters?.sort === 'last_login_desc'
          ? [{ lastLoginAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }]
          : [{ createdAt: 'desc' }, { id: 'asc' }];

    const staffAssignmentsWhere = emScoped
      ? {
          where: {
            managedByUserId: caller.id,
            role: { name: 'pos' },
          },
          include: assignmentInclude,
          orderBy: { createdAt: 'desc' as const },
        }
      : {
          include: assignmentInclude,
          orderBy: { createdAt: 'desc' as const },
        };

    const [users, total, allPeople, organisers, eventManagers, agents] =
      await Promise.all([
        this.prisma.user.findMany({
          where,
          include: {
            adminProfile: { include: { role: true } },
            organizationMemberships: {
              include: {
                organization: { select: { id: true, name: true, slug: true } },
              },
            },
            staffAssignments: staffAssignmentsWhere,
          },
          orderBy,
          skip: (page - 1) * perPage,
          take: perPage,
        }),
        this.prisma.user.count({ where }),
        this.prisma.user.count({ where: baseWhere }),
        emScoped
          ? Promise.resolve(0)
          : this.prisma.user.count({
              where: { AND: [baseWhere, roleWhere('organiser')] },
            }),
        emScoped
          ? Promise.resolve(0)
          : this.prisma.user.count({
              where: { AND: [baseWhere, roleWhere('event_manager')] },
            }),
        this.prisma.user.count({
          where: emScoped
            ? baseWhere
            : {
                AND: [
                  baseWhere,
                  {
                    staffAssignments: {
                      some: {
                        role: {
                          name: {
                            in: ['pos', 'scanner', 'finance-manager', 'hr'],
                          },
                        },
                      },
                    },
                  },
                ],
              },
        }),
      ]);

    return {
      success: true,
      data: {
        users: users.map((user) => this.serializeUser(user)),
        pagination: {
          page,
          per_page: perPage,
          total,
          total_pages: Math.max(1, Math.ceil(total / perPage)),
        },
        summary: {
          people: allPeople,
          organisers,
          event_managers: eventManagers,
          agents,
        },
        filters: {
          q: search ?? '',
          organization_id: filters?.organization_id ?? null,
          role: filters?.role ?? null,
          status: status ?? null,
          sort: filters?.sort ?? 'created_desc',
        },
      },
    };
  }

  /** Event-first hierarchy for Users page. */
  async listEventTree(
    filters?: {
      organization_id?: string;
      event_id?: string;
      q?: string;
    },
    caller?: AuthenticatedAdmin,
  ) {
    const emScoped = caller && this.isEventManagerRole(caller.role);
    let allowedEventIds: string[] | null = null;

    if (emScoped) {
      const emAssignments = await this.prisma.staffAssignment.findMany({
        where: {
          userId: caller.id,
          status: 'active',
          role: { name: 'event_manager' },
          eventId: { not: null },
        },
        select: { eventId: true },
      });
      allowedEventIds = [
        ...new Set(emAssignments.map((row) => row.eventId!).filter(Boolean)),
      ];
      if (filters?.event_id && !allowedEventIds.includes(filters.event_id)) {
        return { success: true, data: { events: [] } };
      }
      if (!allowedEventIds.length) {
        return { success: true, data: { events: [] } };
      }
    }

    const events = await this.prisma.event.findMany({
      where: {
        ...(filters?.organization_id ? { organizationId: filters.organization_id } : {}),
        ...(filters?.event_id
          ? { id: filters.event_id }
          : allowedEventIds
            ? { id: { in: allowedEventIds } }
            : {}),
      },
      include: {
        translations: { where: { locale: 'en' }, take: 1 },
        organization: true,
        primaryOrganizer: {
          select: {
            id: true,
            name: true,
            email: true,
            username: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const eventIds = events.map((event) => event.id);
    const assignments = eventIds.length
      ? await this.prisma.staffAssignment.findMany({
          where: {
            eventId: { in: eventIds },
            ...(emScoped
              ? {
                  OR: [
                    { userId: caller.id, role: { name: 'event_manager' } },
                    {
                      managedByUserId: caller.id,
                      role: { name: 'pos' },
                    },
                  ],
                }
              : {}),
            ...(filters?.q
              ? {
                  user: {
                    OR: [
                      { name: { contains: filters.q, mode: 'insensitive' } },
                      { email: { contains: filters.q, mode: 'insensitive' } },
                      { username: { contains: filters.q, mode: 'insensitive' } },
                    ],
                  },
                }
              : {}),
          },
          include: assignmentInclude,
          orderBy: { createdAt: 'desc' },
        })
      : [];

    const shareIds = [
      ...new Set(assignments.flatMap((row) => row.thirdPartyVendorIds).filter(Boolean)),
    ];
    const shares = shareIds.length
      ? await this.prisma.thirdPartyVendor.findMany({
          where: { id: { in: shareIds } },
          select: { id: true, name: true, isMain: true, isCafe: true },
        })
      : [];
    const shareMap = new Map(shares.map((share) => [share.id, share]));

    const tree = events.map((event) => {
      // One explicitly assigned primary organiser per event.
      const organisers =
        emScoped || !event.primaryOrganizer
          ? []
          : [
              {
                id: event.primaryOrganizer.id,
                name: event.primaryOrganizer.name,
                email: event.primaryOrganizer.email,
                username: event.primaryOrganizer.username,
                status: event.primaryOrganizer.status,
                member_role: 'organiser',
              },
            ];

      const eventAssignments = assignments.filter((row) => row.eventId === event.id);
      const eventManagers = eventAssignments.filter((row) => {
        if (row.role.name !== 'event_manager') return false;
        if (emScoped) return row.user.id === caller.id;
        return true;
      });
      const emIds = new Set(eventManagers.map((row) => row.user.id));
      const nestedUnderEm = new Set<string>();

      const emNodes = eventManagers.map((em) => {
        const children = eventAssignments.filter((row) => {
          if (row.role.name !== 'pos') return false;
          if (row.managedByUserId === em.user.id) return true;
          if (
            !emScoped &&
            !row.managedByUserId &&
            em.thirdPartyVendorId &&
            (row.thirdPartyVendorId === em.thirdPartyVendorId ||
              row.thirdPartyVendorIds.includes(em.thirdPartyVendorId))
          ) {
            return true;
          }
          return false;
        });
        children.forEach((child) => nestedUnderEm.add(child.id));
        return {
          ...this.serializeAssignment(em, shareMap),
          agents: children.map((child) => this.serializeAssignment(child, shareMap)),
        };
      });

      const otherAgents = emScoped
        ? []
        : eventAssignments
            .filter((row) => {
              if (row.role.name === 'event_manager') return false;
              if (nestedUnderEm.has(row.id)) return false;
              if (row.managedByUserId && emIds.has(row.managedByUserId)) return false;
              return true;
            })
            .map((row) => this.serializeAssignment(row, shareMap));

      return {
        id: event.id,
        slug: event.slug,
        title: event.translations[0]?.title ?? event.slug,
        status: event.status,
        event_type: event.eventType,
        booking_mode: event.bookingMode,
        organization: {
          id: event.organization.id,
          name: event.organization.name,
          slug: event.organization.slug,
        },
        organisers,
        event_managers: emNodes,
        agents: otherAgents,
      };
    });

    return {
      success: true,
      data: {
        events: emScoped
          ? tree.filter((event) => event.event_managers.length > 0)
          : tree,
      },
    };
  }

  async listAvailablePos(
    filters: { organization_id: string; event_id?: string },
    caller?: AuthenticatedAdmin,
  ) {
    if (!filters.organization_id) {
      throw new BadRequestException('organization_id is required.');
    }

    const emScoped = caller && this.isEventManagerRole(caller.role);

    const users = await this.prisma.user.findMany({
      where: {
        status: 'active',
        staffAssignments: {
          some: {
            organizationId: filters.organization_id,
            role: { name: 'pos' },
            status: 'active',
            ...(emScoped ? { managedByUserId: caller.id } : {}),
          },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        status: true,
        staffAssignments: {
          where: {
            organizationId: filters.organization_id,
            role: { name: 'pos' },
            status: 'active',
            ...(emScoped ? { managedByUserId: caller.id } : {}),
          },
          select: {
            id: true,
            eventId: true,
            managedByUserId: true,
            event: { select: { id: true, slug: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
      take: 200,
    });

    return {
      success: true,
      data: {
        users: users.map((user) => {
          const onEventAssignment = filters.event_id
            ? user.staffAssignments.find((row) => row.eventId === filters.event_id)
            : undefined;
          return {
            id: user.id,
            name: user.name,
            email: user.email,
            username: user.username,
            status: user.status,
            already_on_event: Boolean(onEventAssignment),
            managed_by_user_id: onEventAssignment?.managedByUserId ?? null,
            events: user.staffAssignments
              .filter((row) => row.event)
              .map((row) => ({ id: row.event!.id, slug: row.event!.slug })),
          };
        }),
      },
    };
  }

  async creatableRoles(managedByUserId?: string, caller?: AuthenticatedAdmin) {
    const effectiveManagedBy =
      caller && this.isEventManagerRole(caller.role)
        ? caller.id
        : managedByUserId;

    const customRoles = await this.loadCustomAssignableRoles();

    if (!effectiveManagedBy) {
      const values = [
        ...TOP_LEVEL_ROLES,
        ...customRoles.map((role) => role.name),
      ];
      return {
        success: true,
        data: {
          parent_context: 'top_level' as const,
          roles: [
            ...TOP_LEVEL_ROLES.map((value) =>
              this.toCreatableRole(value, value === 'event_manager'),
            ),
            ...customRoles.map((role) =>
              this.toCreatableRole(role.name, role.isThirdPartyShareholder),
            ),
          ],
          scope: null,
        },
      };
    }

    const context = await this.resolveManagerContext(effectiveManagedBy);
    if (context.parentRole === 'event_manager') {
      return {
        success: true,
        data: {
          parent_context: context.parentRole,
          roles: UNDER_EVENT_MANAGER_ROLES.map((value) => this.toCreatableRole(value)),
          scope: {
            managed_by_user_id: context.userId,
            organization_id: context.organizationId,
            event_id: context.eventId,
            third_party_vendor_id: context.thirdPartyVendorId,
            parent_name: context.parentName,
            parent_email: context.parentEmail,
          },
        },
      };
    }

    return {
      success: true,
      data: {
        parent_context: context.parentRole,
        roles: [
          ...UNDER_ORGANISER_ROLES.map((value) =>
            this.toCreatableRole(value, value === 'event_manager'),
          ),
          ...customRoles.map((role) =>
            this.toCreatableRole(role.name, role.isThirdPartyShareholder),
          ),
        ],
        scope: {
          managed_by_user_id: context.userId,
          organization_id: context.organizationId,
          event_id: context.eventId,
          third_party_vendor_id: context.thirdPartyVendorId,
          parent_name: context.parentName,
          parent_email: context.parentEmail,
        },
      },
    };
  }

  private toCreatableRole(value: string, isThirdPartyShareholder = false) {
    const custom = !isBuiltinStaffRole(value);
    const needsShare =
      value === 'event_manager' || isThirdPartyShareholder;
    return {
      value,
      label: formatRoleLabel(value),
      needs_org: value !== 'admin',
      // Built-in event roles + any custom role created in Roles & permissions.
      needs_event: EVENT_SCOPED_ROLES.has(value) || custom || needsShare,
      needs_share: needsShare,
      needs_username: USERNAME_ROLES.has(value),
      needs_multi_shares: value === 'pos',
      is_custom: custom,
      is_third_party_shareholder: needsShare,
    };
  }

  private async loadCustomAssignableRoles() {
    return this.prisma.role.findMany({
      where: {
        name: {
          notIn: [...STAFF_ROLES, 'customer'],
        },
      },
      select: {
        id: true,
        name: true,
        description: true,
        isThirdPartyShareholder: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  private async assertAssignableRole(roleName: string) {
    if (NON_ASSIGNABLE_ROLES.has(roleName)) {
      throw new BadRequestException(`Cannot assign role: ${roleName}`);
    }
    const role = await this.prisma.role.findUnique({
      where: { name: roleName },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) {
      throw new BadRequestException(`Role ${roleName} was not found. Create it under Roles & permissions first.`);
    }
    return role;
  }

  private roleHasPanelAccess(
    role: {
      name: string;
      permissions: Array<{ permission: { key: string } }>;
    },
  ) {
    if (ADMIN_PANEL_ROLES.has(role.name)) return true;
    return role.permissions.some((item) => item.permission.key === 'panel.access');
  }

  async listAssignments(
    filters?: { organization_id?: string; event_id?: string },
    caller?: AuthenticatedAdmin,
  ) {
    const emScoped = caller && this.isEventManagerRole(caller.role);
    const assignments = await this.prisma.staffAssignment.findMany({
      where: {
        ...(filters?.organization_id ? { organizationId: filters.organization_id } : {}),
        ...(filters?.event_id ? { eventId: filters.event_id } : {}),
        ...(emScoped
          ? {
              OR: [
                { userId: caller.id, role: { name: 'event_manager' } },
                { managedByUserId: caller.id, role: { name: 'pos' } },
              ],
            }
          : {}),
      },
      include: assignmentInclude,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const shareIds = [
      ...new Set(assignments.flatMap((row) => row.thirdPartyVendorIds).filter(Boolean)),
    ];
    const shares = shareIds.length
      ? await this.prisma.thirdPartyVendor.findMany({
          where: { id: { in: shareIds } },
          select: { id: true, name: true, isMain: true, isCafe: true },
        })
      : [];
    const shareMap = new Map(shares.map((share) => [share.id, share]));

    return {
      success: true,
      data: {
        assignments: assignments.map((row) => this.serializeAssignment(row, shareMap)),
      },
    };
  }

  async createUser(
    input: CreateStaffUserDto,
    createdByUserId?: string,
    caller?: AuthenticatedAdmin,
  ) {
    let roleName = input.role.trim().toLowerCase();
    let organizationId = input.organization_id;
    let eventId = input.event_id;
    let thirdPartyVendorId = input.third_party_vendor_id;
    let thirdPartyVendorIds = input.third_party_vendor_ids ?? [];
    let managedByUserId = input.managed_by_user_id;
    const ticketTypeIds = input.ticket_type_ids ?? [];
    const isCafeAgent = Boolean(input.is_cafe_agent);

    if (caller && this.isEventManagerRole(caller.role)) {
      managedByUserId = caller.id;
      roleName = 'pos';
    }

    if (managedByUserId) {
      const resolved = await this.applyManagerConstraints({
        roleName,
        managedByUserId,
        organizationId,
        eventId,
        thirdPartyVendorId,
        thirdPartyVendorIds,
      });
      roleName = resolved.roleName;
      organizationId = resolved.organizationId;
      eventId = resolved.eventId;
      thirdPartyVendorId = resolved.thirdPartyVendorId;
      thirdPartyVendorIds = resolved.thirdPartyVendorIds;
      managedByUserId = resolved.managedByUserId;
    } else if (
      !(TOP_LEVEL_ROLES as readonly string[]).includes(roleName) &&
      isBuiltinStaffRole(roleName)
    ) {
      throw new BadRequestException(`Unsupported role: ${roleName}`);
    }

    const role = await this.assertAssignableRole(roleName);
    const roleNeedsShare = isShareholderScopedRole(role);

    if (roleName !== 'admin' && !organizationId) {
      throw new BadRequestException('organization_id is required for this role.');
    }

    if (roleNeedsShare && !thirdPartyVendorId && !thirdPartyVendorIds.length) {
      throw new BadRequestException(
        'Select a third-party vendor for this shareholder role.',
      );
    }
    if (roleNeedsShare && !thirdPartyVendorId && thirdPartyVendorIds.length) {
      thirdPartyVendorId = thirdPartyVendorIds[0];
    }

    if (roleName === 'pos' || roleName === 'cafe_pos') {
      if (!input.username?.trim()) {
        throw new BadRequestException(
          roleName === 'cafe_pos'
            ? 'username is required for Cafe POS agents.'
            : 'username is required for POS agents.',
        );
      }
      // Vendors are optional for POS: no vendors = all event tickets;
      // selected vendors = that vendor scope (further narrowed by ticket_type_ids).
      if (roleName === 'pos' && !thirdPartyVendorIds.length && thirdPartyVendorId) {
        thirdPartyVendorIds = [thirdPartyVendorId];
      }
    }

    const organization = organizationId
      ? await this.prisma.organization.findUnique({ where: { id: organizationId } })
      : null;
    if (organizationId && !organization) {
      throw new NotFoundException('Organization not found.');
    }

    if (organization) {
      await this.validateScope({
        roleName,
        organizationId: organization.id,
        eventId,
        thirdPartyVendorId,
        thirdPartyVendorIds,
        ticketTypeIds,
      });
    }

    const email = input.email.trim().toLowerCase();
    const username = input.username?.trim().toLowerCase() || null;
    const passwordHash = await hashPassword(input.password);

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            name: input.name.trim(),
            email,
            username,
            passwordHash,
            status: 'active',
          },
        });

        if (roleName === 'organiser' && organization) {
          await tx.organizationMember.create({
            data: {
              organizationId: organization.id,
              userId: created.id,
              role: 'owner',
              status: 'active',
            },
          });
        }

        if (this.roleHasPanelAccess(role)) {
          await tx.adminProfile.create({
            data: {
              userId: created.id,
              roleId: role.id,
              status: 'active',
            },
          });
        }

        if (organization && roleName !== 'organiser' && roleName !== 'admin') {
          if (roleName === 'pos' && eventId) {
            await this.assertPosUniquePerEvent(tx, created.id, eventId);
          }
          await tx.staffAssignment.create({
            data: {
              userId: created.id,
              roleId: role.id,
              organizationId: organization.id,
              eventId: eventId ?? null,
              thirdPartyVendorId: roleNeedsShare
                ? (thirdPartyVendorId ?? null)
                : roleName === 'pos'
                  ? thirdPartyVendorIds[0] ?? thirdPartyVendorId ?? null
                  : thirdPartyVendorIds[0] ?? thirdPartyVendorId ?? null,
              thirdPartyVendorIds: roleName === 'pos' ? thirdPartyVendorIds : [],
              ticketTypeIds,
              isCafeAgent: roleName === 'pos' ? isCafeAgent : roleName === 'cafe_pos',
              managedByUserId: managedByUserId ?? null,
              createdByUserId: createdByUserId ?? null,
              status: 'active',
            },
          });
        }

        return tx.user.findUniqueOrThrow({
          where: { id: created.id },
          include: {
            adminProfile: { include: { role: true } },
            organizationMemberships: {
              include: { organization: { select: { id: true, name: true, slug: true } } },
            },
            staffAssignments: { include: assignmentInclude },
          },
        });
      });

      return { success: true, data: { user: this.serializeUser(user) } };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = (error.meta?.target as string[] | undefined)?.join(',') ?? '';
        if (target.includes('username')) {
          throw new ConflictException('That username is already in use.');
        }
        throw new ConflictException('That email is already in use.');
      }
      throw error;
    }
  }

  async updateUser(
    id: string,
    input: UpdateStaffUserDto,
    caller?: AuthenticatedAdmin,
  ) {
    await this.assertEventManagerCanMutateUser(caller, id);

    const existing = await this.prisma.user.findUnique({
      where: { id },
      include: {
        adminProfile: { include: { role: true } },
        organizationMemberships: {
          include: { organization: { select: { id: true, name: true, slug: true } } },
        },
        staffAssignments: { include: assignmentInclude },
      },
    });
    if (!existing) throw new NotFoundException('User not found.');

    const data: Prisma.UserUpdateInput = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.email !== undefined) data.email = input.email.trim().toLowerCase();
    if (input.username !== undefined) {
      data.username = input.username?.trim().toLowerCase() || null;
    }
    if (input.status !== undefined) data.status = input.status as UserStatus;
    if (input.password?.trim()) {
      data.passwordHash = await hashPassword(input.password.trim());
      data.tokenVersion = { increment: 1 };
    }

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        if (Object.keys(data).length > 0) {
          await tx.user.update({ where: { id }, data });
        }
        if (input.password?.trim()) {
          await revokeAuthSessionsForUser(tx, id);
        }

        // Org organisers can exist without AdminProfile (legacy / event-only assignment).
        // Recreate it on user update so panel login keeps working.
        if (!existing.adminProfile && existing.organizationMemberships.length > 0) {
          const organiserRole = await tx.role.findUnique({
            where: { name: 'organiser' },
            select: { id: true },
          });
          if (organiserRole && ADMIN_PANEL_ROLES.has('organiser')) {
            await tx.adminProfile.create({
              data: { userId: id, roleId: organiserRole.id, status: 'active' },
            });
          }
        }

        if (input.assignment_id) {
          const assignment = await tx.staffAssignment.findUnique({
            where: { id: input.assignment_id },
            include: { role: true },
          });
          if (!assignment || assignment.userId !== id) {
            throw new NotFoundException('Assignment not found for this user.');
          }

          const roleName = assignment.role.name;
          const thirdPartyVendorId =
            input.third_party_vendor_id === undefined
              ? assignment.thirdPartyVendorId
              : input.third_party_vendor_id;
          const thirdPartyVendorIds =
            input.third_party_vendor_ids ?? assignment.thirdPartyVendorIds;
          const ticketTypeIds =
            input.ticket_type_ids ?? assignment.ticketTypeIds;
          const isCafeAgent =
            input.is_cafe_agent === undefined
              ? assignment.isCafeAgent
              : input.is_cafe_agent;

          await this.validateScope({
            roleName,
            organizationId: assignment.organizationId,
            eventId: assignment.eventId ?? undefined,
            thirdPartyVendorId: thirdPartyVendorId ?? undefined,
            thirdPartyVendorIds,
            ticketTypeIds,
          });

          await tx.staffAssignment.update({
            where: { id: assignment.id },
            data: {
              thirdPartyVendorId: isShareholderScopedRole(assignment.role)
                ? thirdPartyVendorId
                : thirdPartyVendorIds[0] ?? thirdPartyVendorId ?? null,
              thirdPartyVendorIds: roleName === 'pos' ? thirdPartyVendorIds : [],
              ticketTypeIds,
              isCafeAgent: roleName === 'pos' ? isCafeAgent : false,
              status:
                (input.assignment_status as StaffAssignmentStatus | undefined) ??
                undefined,
            },
          });
        }

        return tx.user.findUniqueOrThrow({
          where: { id },
          include: {
            adminProfile: { include: { role: true } },
            organizationMemberships: {
              include: { organization: { select: { id: true, name: true, slug: true } } },
            },
            staffAssignments: { include: assignmentInclude },
          },
        });
      });

      return { success: true, data: { user: this.serializeUser(user) } };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = (error.meta?.target as string[] | undefined)?.join(',') ?? '';
        if (target.includes('username')) {
          throw new ConflictException('That username is already in use.');
        }
        throw new ConflictException('That email is already in use.');
      }
      throw error;
    }
  }

  async createAssignment(
    input: CreateStaffAssignmentDto,
    createdByUserId?: string,
    caller?: AuthenticatedAdmin,
  ) {
    let roleName = input.role.trim().toLowerCase();
    let organizationId = input.organization_id;
    let eventId = input.event_id;
    let thirdPartyVendorId = input.third_party_vendor_id;
    let thirdPartyVendorIds = input.third_party_vendor_ids ?? [];
    let managedByUserId = input.managed_by_user_id;
    const ticketTypeIds = input.ticket_type_ids ?? [];
    const isCafeAgent = Boolean(input.is_cafe_agent);

    if (caller && this.isEventManagerRole(caller.role)) {
      managedByUserId = caller.id;
      roleName = 'pos';
    }

    if (managedByUserId) {
      const resolved = await this.applyManagerConstraints({
        roleName,
        managedByUserId,
        organizationId,
        eventId,
        thirdPartyVendorId,
        thirdPartyVendorIds,
      });
      roleName = resolved.roleName;
      organizationId = resolved.organizationId;
      eventId = resolved.eventId;
      thirdPartyVendorId = resolved.thirdPartyVendorId;
      thirdPartyVendorIds = resolved.thirdPartyVendorIds;
      managedByUserId = resolved.managedByUserId;
    }

    if (NON_ASSIGNABLE_ROLES.has(roleName)) {
      throw new BadRequestException(`Cannot assign role: ${roleName}`);
    }

    const role = await this.assertAssignableRole(roleName);
    const roleNeedsShare = isShareholderScopedRole(role);

    const user = await this.prisma.user.findUnique({ where: { id: input.user_id } });
    if (!user) throw new NotFoundException('User not found.');

    if (roleName === 'pos') {
      if (!thirdPartyVendorIds.length && thirdPartyVendorId) thirdPartyVendorIds = [thirdPartyVendorId];
    }

    if (roleNeedsShare && !thirdPartyVendorId && !thirdPartyVendorIds.length) {
      throw new BadRequestException(
        'Select a third-party vendor for this shareholder role.',
      );
    }
    if (roleNeedsShare && !thirdPartyVendorId && thirdPartyVendorIds.length) {
      thirdPartyVendorId = thirdPartyVendorIds[0];
    }

    await this.validateScope({
      roleName,
      organizationId,
      eventId,
      thirdPartyVendorId,
      thirdPartyVendorIds,
      ticketTypeIds,
    });

    // Attaching an org POS that is already on this event reparents/updates
    // the existing assignment (e.g. move from organiser → event manager).
    if (roleName === 'pos' && eventId) {
      const existingPos = await this.prisma.staffAssignment.findFirst({
        where: {
          userId: input.user_id,
          eventId,
          role: { name: 'pos' },
          status: 'active',
        },
      });
      if (existingPos) {
        const updated = await this.prisma.staffAssignment.update({
          where: { id: existingPos.id },
          data: {
            thirdPartyVendorId: thirdPartyVendorIds[0] ?? thirdPartyVendorId ?? null,
            thirdPartyVendorIds,
            ticketTypeIds,
            isCafeAgent,
            managedByUserId: managedByUserId ?? existingPos.managedByUserId,
          },
          include: assignmentInclude,
        });
        await this.ensureAdminProfile(input.user_id, role.id);
        return {
          success: true,
          data: { assignment: this.serializeAssignment(updated) },
        };
      }
    }

    if (roleName === 'organiser') {
      await this.prisma.organizationMember.upsert({
        where: {
          organizationId_userId: {
            organizationId,
            userId: input.user_id,
          },
        },
        update: { status: 'active', role: 'manager' },
        create: {
          organizationId,
          userId: input.user_id,
          role: 'manager',
          status: 'active',
        },
      });
      await this.ensureAdminProfile(input.user_id, role.id);
      return {
        success: true,
        data: {
          assignment: {
            type: 'organization_member',
            user_id: input.user_id,
            organization_id: organizationId,
            role: 'organiser',
          },
        },
      };
    }

    const assignment = await this.prisma.staffAssignment.create({
      data: {
        userId: input.user_id,
        roleId: role.id,
        organizationId,
        eventId: eventId ?? null,
        thirdPartyVendorId: roleNeedsShare
          ? (thirdPartyVendorId ?? null)
          : thirdPartyVendorIds[0] ?? thirdPartyVendorId ?? null,
        thirdPartyVendorIds: roleName === 'pos' ? thirdPartyVendorIds : [],
        ticketTypeIds,
        isCafeAgent: roleName === 'pos' ? isCafeAgent : false,
        managedByUserId: managedByUserId ?? null,
        createdByUserId: createdByUserId ?? null,
        status: 'active',
      },
      include: assignmentInclude,
    });

    await this.ensureAdminProfile(input.user_id, role.id);

    return { success: true, data: { assignment: this.serializeAssignment(assignment) } };
  }

  async updateAssignment(
    id: string,
    input: UpdateStaffAssignmentDto,
    caller?: AuthenticatedAdmin,
  ) {
    const existing = await this.prisma.staffAssignment.findUnique({
      where: { id },
      include: { role: true },
    });
    if (!existing) throw new NotFoundException('Assignment not found.');
    await this.assertEventManagerCanMutateAssignment(caller, existing);

    const organizationId = input.organization_id ?? existing.organizationId;
    const eventId =
      input.event_id === undefined ? existing.eventId : input.event_id;
    const thirdPartyVendorId =
      input.third_party_vendor_id === undefined ? existing.thirdPartyVendorId : input.third_party_vendor_id;
    const thirdPartyVendorIds = input.third_party_vendor_ids ?? existing.thirdPartyVendorIds;
    const ticketTypeIds = input.ticket_type_ids ?? existing.ticketTypeIds;
    const managedByUserId =
      caller && this.isEventManagerRole(caller.role)
        ? caller.id
        : input.managed_by_user_id === undefined
          ? existing.managedByUserId
          : input.managed_by_user_id;
    const isCafeAgent =
      input.is_cafe_agent === undefined ? existing.isCafeAgent : input.is_cafe_agent;

    await this.validateScope({
      roleName: existing.role.name,
      organizationId,
      eventId: eventId ?? undefined,
      thirdPartyVendorId: thirdPartyVendorId ?? undefined,
      thirdPartyVendorIds,
      ticketTypeIds,
    });

    if (
      existing.role.name === 'pos' &&
      eventId &&
      input.status !== 'suspended'
    ) {
      const other = await this.prisma.staffAssignment.findFirst({
        where: {
          userId: existing.userId,
          role: { name: 'pos' },
          status: 'active',
          eventId,
          NOT: { id },
        },
      });
      if (other && (input.status === 'active' || input.status === undefined)) {
        throw new BadRequestException(
          'This POS user already has an active assignment for this event.',
        );
      }
    }

    const updated = await this.prisma.staffAssignment.update({
      where: { id },
      data: {
        organizationId,
        eventId,
        thirdPartyVendorId,
        thirdPartyVendorIds,
        ticketTypeIds,
        isCafeAgent,
        managedByUserId,
        status: (input.status as StaffAssignmentStatus | undefined) ?? undefined,
      },
      include: assignmentInclude,
    });

    if (ADMIN_PANEL_ROLES.has(existing.role.name)) {
      const profileStatus: 'active' | 'suspended' =
        updated.status === 'suspended' ? 'suspended' : 'active';
      await this.prisma.adminProfile.upsert({
        where: { userId: existing.userId },
        update: { roleId: existing.roleId, status: profileStatus },
        create: {
          userId: existing.userId,
          roleId: existing.roleId,
          status: profileStatus,
        },
      });
    }

    return { success: true, data: { assignment: this.serializeAssignment(updated) } };
  }

  async removeAssignment(id: string, caller?: AuthenticatedAdmin) {
    const existing = await this.prisma.staffAssignment.findUnique({
      where: { id },
      include: { role: true },
    });
    if (!existing) throw new NotFoundException('Assignment not found.');
    await this.assertEventManagerCanMutateAssignment(caller, existing);
    await this.prisma.staffAssignment.delete({ where: { id } });
    return { success: true, data: { deleted: true } };
  }

  /**
   * Event ids the admin may see in Dashboard / Reports / Events / Cafes / Bookings.
   * - admin: null (unrestricted)
   * - organiser: events they primarily organize + events with an active staff assignment
   * - other panel roles: events from active staff assignments
   */
  async resolveReportEventIds(userId: string, roleName: string): Promise<string[] | null> {
    if (roleName === 'admin' || roleName === 'super_admin') return null;

    if (roleName === 'organiser') {
      const [organized, assignments] = await Promise.all([
        this.prisma.event.findMany({
          where: { primaryOrganizerId: userId },
          select: { id: true },
        }),
        this.prisma.staffAssignment.findMany({
          where: { userId, status: 'active', eventId: { not: null } },
          select: { eventId: true },
        }),
      ]);
      return [
        ...new Set([
          ...organized.map((event) => event.id),
          ...assignments.map((row) => row.eventId!).filter(Boolean),
        ]),
      ];
    }

    const assignments = await this.prisma.staffAssignment.findMany({
      where: { userId, status: 'active', eventId: { not: null } },
      select: { eventId: true },
    });
    return [...new Set(assignments.map((row) => row.eventId!).filter(Boolean))];
  }

  /**
   * Third-party vendor scope for shareholder / event-manager roles.
   * `null` = unrestricted; otherwise only these vendor IDs (may be empty).
   */
  async resolveReportVendorIds(
    userId: string,
    roleName: string,
    eventId?: string,
  ): Promise<string[] | null> {
    if (roleName === 'admin' || roleName === 'super_admin' || roleName === 'organiser') {
      return null;
    }

    const role = await this.prisma.role.findUnique({
      where: { name: roleName },
      select: { name: true, isThirdPartyShareholder: true },
    });
    if (!role || !isShareholderScopedRole(role)) {
      // Still check assignments in case login role differs from a shareholder assignment.
      const shareholderAssignments = await this.prisma.staffAssignment.findMany({
        where: {
          userId,
          status: 'active',
          ...(eventId ? { eventId } : { eventId: { not: null } }),
          OR: [
            { role: { isThirdPartyShareholder: true } },
            { role: { name: { in: ['event_manager', 'event-manager'] } } },
          ],
        },
        select: { thirdPartyVendorId: true, eventId: true },
      });
      if (!shareholderAssignments.length) return null;
      return [
        ...new Set(
          shareholderAssignments
            .map((row) => row.thirdPartyVendorId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
    }

    const assignments = await this.prisma.staffAssignment.findMany({
      where: {
        userId,
        status: 'active',
        ...(eventId ? { eventId } : { eventId: { not: null } }),
        OR: [
          { role: { isThirdPartyShareholder: true } },
          { role: { name: { in: ['event_manager', 'event-manager'] } } },
          { role: { name: roleName } },
        ],
      },
      select: { thirdPartyVendorId: true },
    });

    return [
      ...new Set(
        assignments
          .map((row) => row.thirdPartyVendorId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
  }

  /**
   * Vendor id the caller may manage tickets for on a given event.
   * `null` = unrestricted; otherwise must match (or be empty → no ticket write).
   */
  async resolveEventTicketVendorId(
    userId: string,
    roleName: string,
    eventId: string,
  ): Promise<string | null | undefined> {
    const vendorIds = await this.resolveReportVendorIds(userId, roleName, eventId);
    if (vendorIds === null) return undefined; // unrestricted
    if (!vendorIds.length) return null; // scoped but no vendor → block
    // Prefer the assignment for this event; if multiple, first wins.
    return vendorIds[0];
  }

  /** Cafe visibility tied to accessible events (active link or current assignment). */
  async resolveAccessibleCafeIds(
    scopedEventIds: string[] | null,
  ): Promise<string[] | null> {
    if (scopedEventIds === null) return null;
    if (!scopedEventIds.length) return [];

    const cafes = await this.prisma.cafe.findMany({
      where: {
        OR: [
          { activeEventId: { in: scopedEventIds } },
          {
            assignments: {
              some: { eventId: { in: scopedEventIds }, unassignedAt: null },
            },
          },
        ],
      },
      select: { id: true },
    });
    return cafes.map((cafe) => cafe.id);
  }

  private isEventManagerRole(roleName: string) {
    const key = roleName.trim().toLowerCase();
    return key === 'event_manager' || key === 'event-manager';
  }

  private async assertEventManagerCanMutateUser(
    caller: AuthenticatedAdmin | undefined,
    userId: string,
  ) {
    if (!caller || !this.isEventManagerRole(caller.role)) return;
    const pos = await this.prisma.staffAssignment.findFirst({
      where: {
        userId,
        managedByUserId: caller.id,
        role: { name: 'pos' },
      },
      select: { id: true },
    });
    if (!pos) {
      throw new ForbiddenException(
        'Event managers can only edit POS agents registered under them.',
      );
    }
  }

  private async assertEventManagerCanMutateAssignment(
    caller: AuthenticatedAdmin | undefined,
    assignment: {
      role: { name: string };
      managedByUserId: string | null;
    },
  ) {
    if (!caller || !this.isEventManagerRole(caller.role)) return;
    if (
      assignment.role.name !== 'pos' ||
      assignment.managedByUserId !== caller.id
    ) {
      throw new ForbiddenException(
        'Event managers can only update or remove POS agents registered under them.',
      );
    }
  }

  private async ensureAdminProfile(userId: string, roleId: string) {
    await this.prisma.adminProfile.upsert({
      where: { userId },
      update: { roleId, status: 'active' },
      create: { userId, roleId, status: 'active' },
    });
  }

  private async assertPosUniquePerEvent(
    db: Prisma.TransactionClient | PrismaService,
    userId: string,
    eventId: string,
  ) {
    const existing = await db.staffAssignment.findFirst({
      where: {
        userId,
        eventId,
        role: { name: 'pos' },
        status: 'active',
      },
    });
    if (existing) {
      throw new BadRequestException(
        'This POS user already has an active assignment for this event.',
      );
    }
  }

  private async resolveManagerContext(managedByUserId: string) {
    const membership = await this.prisma.organizationMember.findFirst({
      where: { userId: managedByUserId, status: 'active' },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (membership) {
      return {
        userId: membership.user.id,
        parentName: membership.user.name,
        parentEmail: membership.user.email,
        parentRole: 'organiser' as const,
        organizationId: membership.organizationId,
        eventId: undefined as string | undefined,
        thirdPartyVendorId: undefined as string | undefined,
      };
    }

    const emAssignment = await this.prisma.staffAssignment.findFirst({
      where: {
        userId: managedByUserId,
        status: 'active',
        role: { name: 'event_manager' },
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (emAssignment) {
      return {
        userId: emAssignment.user.id,
        parentName: emAssignment.user.name,
        parentEmail: emAssignment.user.email,
        parentRole: 'event_manager' as const,
        organizationId: emAssignment.organizationId,
        eventId: emAssignment.eventId ?? undefined,
        thirdPartyVendorId: emAssignment.thirdPartyVendorId ?? undefined,
      };
    }

    throw new BadRequestException(
      'managed_by_user_id must be an organiser or event_manager.',
    );
  }

  private async applyManagerConstraints(input: {
    roleName: string;
    managedByUserId: string;
    organizationId?: string;
    eventId?: string;
    thirdPartyVendorId?: string;
    thirdPartyVendorIds: string[];
  }) {
    const context = await this.resolveManagerContext(input.managedByUserId);
    const roleName = input.roleName.trim().toLowerCase();

    if (context.parentRole === 'event_manager') {
      if (!(UNDER_EVENT_MANAGER_ROLES as readonly string[]).includes(roleName)) {
        throw new BadRequestException(
          'Event managers can only create or attach POS agents under their event.',
        );
      }
      if (!context.eventId) {
        throw new BadRequestException(
          'Event manager is missing event scope; cannot assign POS.',
        );
      }
      // Keep caller-selected multi-shares; if none, default to EM's single share.
      const thirdPartyVendorIds =
        input.thirdPartyVendorIds.length > 0
          ? input.thirdPartyVendorIds
          : context.thirdPartyVendorId
            ? [context.thirdPartyVendorId]
            : [];
      return {
        roleName,
        managedByUserId: context.userId,
        organizationId: context.organizationId,
        eventId: context.eventId,
        thirdPartyVendorId: context.thirdPartyVendorId,
        thirdPartyVendorIds,
      };
    }

    if (!(UNDER_ORGANISER_ROLES as readonly string[]).includes(roleName)) {
      // Allow custom roles created under Roles & permissions.
      if (isBuiltinStaffRole(roleName)) {
        throw new BadRequestException(
          `Organisers cannot create role: ${roleName}. Allowed: ${UNDER_ORGANISER_ROLES.join(', ')}.`,
        );
      }
      await this.assertAssignableRole(roleName);
    }
    const assignedEvent = input.eventId
      ? await this.prisma.event.findFirst({
          where: {
            id: input.eventId,
            primaryOrganizerId: context.userId,
          },
          select: { organizationId: true },
        })
      : null;
    if (input.eventId && !assignedEvent) {
      throw new BadRequestException(
        'The organiser must be assigned to this event before managing its staff.',
      );
    }
    return {
      roleName,
      managedByUserId: context.userId,
      organizationId: assignedEvent?.organizationId ?? input.organizationId ?? context.organizationId,
      eventId: input.eventId,
      thirdPartyVendorId: input.thirdPartyVendorId,
      thirdPartyVendorIds: input.thirdPartyVendorIds,
    };
  }

  private async validateScope(input: {
    roleName: string;
    organizationId: string;
    eventId?: string;
    thirdPartyVendorId?: string;
    thirdPartyVendorIds: string[];
    ticketTypeIds: string[];
  }) {
    if (EVENT_SCOPED_ROLES.has(input.roleName) && !input.eventId) {
      throw new BadRequestException(`${input.roleName} requires an event_id.`);
    }
    // Custom roles assigned from an event staff tree should be event-scoped.
    if (!isBuiltinStaffRole(input.roleName) && !input.eventId) {
      throw new BadRequestException(`${input.roleName} requires an event_id.`);
    }

    if (!input.eventId) return;

    const roleRecord = await this.prisma.role.findUnique({
      where: { name: input.roleName },
      select: { name: true, isThirdPartyShareholder: true },
    });
    if (
      roleRecord &&
      isShareholderScopedRole(roleRecord) &&
      !input.thirdPartyVendorId &&
      !input.thirdPartyVendorIds.length
    ) {
      throw new BadRequestException(
        'Select a third-party vendor for this shareholder role.',
      );
    }

    const event = await this.prisma.event.findUnique({
      where: { id: input.eventId },
      select: {
        id: true,
        organizationId: true,
        bookingMode: true,
      },
    });
    if (!event) throw new NotFoundException('Event not found.');
    if (event.organizationId !== input.organizationId) {
      throw new BadRequestException('Event does not belong to the selected organization.');
    }
    if (event.bookingMode === 'registration' && input.roleName === 'pos') {
      throw new BadRequestException(
        'POS agents are not available for registration-only events.',
      );
    }

    const shareIdsToCheck = [
      ...new Set(
        [
          ...(input.thirdPartyVendorId ? [input.thirdPartyVendorId] : []),
          ...input.thirdPartyVendorIds,
        ].filter(Boolean),
      ),
    ];

    if (shareIdsToCheck.length) {
      const shares = await this.prisma.thirdPartyVendor.findMany({
        where: { id: { in: shareIdsToCheck }, eventId: input.eventId },
        select: { id: true },
      });
      if (shares.length !== shareIdsToCheck.length) {
        throw new BadRequestException(
          'One or more vendors do not belong to the selected event.',
        );
      }
    }

    if (input.ticketTypeIds.length) {
      const tickets = await this.prisma.ticketType.findMany({
        where: { id: { in: input.ticketTypeIds }, eventId: input.eventId },
        select: { id: true, thirdPartyVendorId: true },
      });
      if (tickets.length !== input.ticketTypeIds.length) {
        throw new BadRequestException('One or more ticket_type_ids are invalid for this event.');
      }
      if (input.thirdPartyVendorIds.length) {
        const allowed = new Set(input.thirdPartyVendorIds);
        const invalid = tickets.filter(
          (ticket) => ticket.thirdPartyVendorId && !allowed.has(ticket.thirdPartyVendorId),
        );
        if (invalid.length) {
          throw new BadRequestException(
            'Selected products must belong to one of the chosen vendors.',
          );
        }
      } else if (input.thirdPartyVendorId) {
        const invalid = tickets.filter(
          (ticket) => ticket.thirdPartyVendorId && ticket.thirdPartyVendorId !== input.thirdPartyVendorId,
        );
        if (invalid.length) {
          throw new BadRequestException(
            'POS products must belong to the selected vendor.',
          );
        }
      }
    }
  }

  private serializeUser(user: {
    id: string;
    name: string;
    email: string;
    username?: string | null;
    status: string;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    adminProfile: { role: { name: string }; status: string } | null;
    organizationMemberships: Array<{
      role: string;
      status: string;
      organization: { id: string; name: string; slug: string };
    }>;
    staffAssignments: AssignmentRow[];
  }) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username ?? null,
      status: user.status,
      admin_role: user.adminProfile?.role.name ?? null,
      organizations: user.organizationMemberships.map((membership) => ({
        id: membership.organization.id,
        name: membership.organization.name,
        slug: membership.organization.slug,
        member_role: membership.role,
        status: membership.status,
      })),
      assignments: user.staffAssignments.map((assignment) =>
        this.serializeAssignment(assignment),
      ),
      last_login_at: user.lastLoginAt?.toISOString() ?? null,
      created_at: user.createdAt.toISOString(),
      updated_at: user.updatedAt.toISOString(),
    };
  }

  private serializeAssignment(
    row: {
      id?: string;
      status: string;
      ticketTypeIds?: string[];
      thirdPartyVendorIds?: string[];
      isCafeAgent?: boolean;
      managedByUserId?: string | null;
      createdByUserId?: string | null;
      createdAt?: Date;
      user: {
        id: string;
        name: string;
        email: string;
        username?: string | null;
        status: string;
      };
      role: { name: string };
      organization: { id: string; name: string; slug: string };
      event: {
        id: string;
        slug: string;
        translations?: Array<{ title: string }>;
      } | null;
      thirdPartyVendor: {
        id: string;
        name: string;
        isMain: boolean;
        isCafe?: boolean;
      } | null;
      managedBy?: { id: string; name: string; email: string } | null;
    },
    shareMap?: Map<
      string,
      { id: string; name: string; isMain: boolean; isCafe: boolean }
    >,
  ) {
    const thirdPartyVendorIds = row.thirdPartyVendorIds ?? [];
    const thirdPartyVendors = thirdPartyVendorIds
      .map((id) => shareMap?.get(id))
      .filter(Boolean)
      .map((share) => ({
        id: share!.id,
        name: share!.name,
        is_main: share!.isMain,
        is_cafe: share!.isCafe,
      }));

    return {
      id: row.id,
      status: row.status,
      role: row.role.name,
      ticket_type_ids: row.ticketTypeIds ?? [],
      third_party_vendor_ids: thirdPartyVendorIds,
      third_party_vendors: thirdPartyVendors,
      is_cafe_agent: Boolean(row.isCafeAgent),
      managed_by_user_id: row.managedByUserId ?? null,
      created_by_user_id: row.createdByUserId ?? null,
      managed_by: row.managedBy
        ? {
            id: row.managedBy.id,
            name: row.managedBy.name,
            email: row.managedBy.email,
          }
        : null,
      user: {
        id: row.user.id,
        name: row.user.name,
        email: row.user.email,
        username: row.user.username ?? null,
        status: row.user.status,
      },
      organization: row.organization,
      event: row.event
        ? {
            id: row.event.id,
            slug: row.event.slug,
            title: row.event.translations?.[0]?.title ?? row.event.slug,
          }
        : null,
      third_party_vendor: row.thirdPartyVendor
        ? {
            id: row.thirdPartyVendor.id,
            name: row.thirdPartyVendor.name,
            is_main: row.thirdPartyVendor.isMain,
            is_cafe: Boolean(row.thirdPartyVendor.isCafe),
          }
        : null,
      created_at: row.createdAt?.toISOString() ?? null,
    };
  }
}
