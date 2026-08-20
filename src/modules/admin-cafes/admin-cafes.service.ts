import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CatalogStatus,
  Prisma,
  PublishStatus,
  StaffAssignmentStatus,
} from '@prisma/client';

import { hashPassword } from '../../common/crypto/password';
import { PrismaService } from '../../database/prisma.service';
import { MediaStorageService } from '../media-storage/media-storage.service';
import {
  AdminCafeListQueryDto,
  AssignCafeEventDto,
  CafeMenuItemVariantDto,
  CreateAdminCafeDto,
  CreateCafePosAgentDto,
  UpdateAdminCafeDto,
  UpsertCafeMenuCategoryDto,
  UpsertCafeMenuItemDto,
  UpsertCafeMenuSubcategoryDto,
} from './dto/admin-cafe.dto';

const UNGROUPED_SUBCATEGORY_TITLE = 'Ungrouped';

const categoryImageSelect = { select: { id: true, url: true, altText: true } } as const;

const cafeInclude = {
  organization: { select: { id: true, name: true, slug: true } },
  manager: { select: { id: true, name: true, email: true } },
  activeEvent: {
    select: {
      id: true,
      slug: true,
      translations: { where: { locale: 'en' }, select: { title: true }, take: 1 },
    },
  },
  categories: {
    orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
    include: {
      imageMedia: categoryImageSelect,
      subcategories: {
        orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
        include: {
          imageMedia: categoryImageSelect,
          items: {
            orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
            include: {
              imageMedia: categoryImageSelect,
              variants: {
                orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
              },
            },
          },
        },
      },
    },
  },
  agents: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      user: {
        select: { id: true, name: true, email: true, username: true, status: true },
      },
    },
  },
  assignments: {
    orderBy: { assignedAt: 'desc' as const },
    take: 20,
    include: {
      event: {
        select: {
          id: true,
          slug: true,
          translations: { where: { locale: 'en' }, select: { title: true }, take: 1 },
        },
      },
      assignedBy: { select: { id: true, name: true, email: true } },
    },
  },
} satisfies Prisma.CafeInclude;

type CafeRecord = Prisma.CafeGetPayload<{ include: typeof cafeInclude }>;

@Injectable()
export class AdminCafesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaStorage: MediaStorageService,
  ) {}

  async list(query: AdminCafeListQueryDto, scopedEventIds?: string[] | null) {
    if (scopedEventIds && !scopedEventIds.length) {
      return { success: true, data: { cafes: [] } };
    }

    const where: Prisma.CafeWhereInput = {};
    if (query.organization_id) where.organizationId = query.organization_id;
    if (query.status) where.status = query.status as PublishStatus;
    if (query.q?.trim()) {
      where.OR = [
        { name: { contains: query.q.trim(), mode: 'insensitive' } },
        { details: { contains: query.q.trim(), mode: 'insensitive' } },
      ];
    }
    if (scopedEventIds) {
      const orgIds = await this.organizationIdsForEvents(scopedEventIds);
      const scopeFilter: Prisma.CafeWhereInput = {
        OR: [
          { activeEventId: { in: scopedEventIds } },
          {
            assignments: {
              some: { eventId: { in: scopedEventIds }, unassignedAt: null },
            },
          },
          // Unassigned cafes in orgs of their events (so create → assign still works).
          ...(orgIds.length
            ? [
                {
                  organizationId: { in: orgIds },
                  activeEventId: null,
                  assignments: { none: { unassignedAt: null } },
                },
              ]
            : []),
        ],
      };
      where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), scopeFilter];
    }

    const cafes = await this.prisma.cafe.findMany({
      where,
      include: cafeInclude,
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
      take: 200,
    });

    return {
      success: true,
      data: { cafes: cafes.map((cafe) => this.serializeCafe(cafe)) },
    };
  }

  async get(id: string, scopedEventIds?: string[] | null) {
    await this.assertCafeAccess(id, scopedEventIds);
    const cafe = await this.requireCafe(id);
    return { success: true, data: { cafe: this.serializeCafe(cafe) } };
  }

  async create(dto: CreateAdminCafeDto, scopedEventIds?: string[] | null) {
    await this.requireOrganization(dto.organization_id);
    await this.assertCafeOrganizationAccess(dto.organization_id, scopedEventIds);
    if (dto.manager_user_id) {
      await this.requireUser(dto.manager_user_id);
    }

    const cafe = await this.prisma.cafe.create({
      data: {
        organizationId: dto.organization_id,
        name: dto.name.trim(),
        details: dto.details?.trim() || null,
        tableCount: dto.table_count,
        managerUserId: dto.manager_user_id ?? null,
        status: 'draft',
      },
      include: cafeInclude,
    });

    return {
      success: true,
      data: { cafe: this.serializeCafe(cafe) },
      message: 'Cafe created.',
    };
  }

  async update(id: string, dto: UpdateAdminCafeDto, scopedEventIds?: string[] | null) {
    await this.assertCafeAccess(id, scopedEventIds);
    await this.requireCafe(id);
    if (dto.manager_user_id) {
      await this.requireUser(dto.manager_user_id);
    }

    const cafe = await this.prisma.cafe.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.details !== undefined ? { details: dto.details?.trim() || null } : {}),
        ...(dto.table_count !== undefined ? { tableCount: dto.table_count } : {}),
        ...(dto.manager_user_id !== undefined
          ? { managerUserId: dto.manager_user_id }
          : {}),
      },
      include: cafeInclude,
    });

    return {
      success: true,
      data: { cafe: this.serializeCafe(cafe) },
      message: 'Cafe updated.',
    };
  }

  async setStatus(
    id: string,
    status: 'draft' | 'published' | 'archived',
    scopedEventIds?: string[] | null,
  ) {
    await this.assertCafeAccess(id, scopedEventIds);
    const cafe = await this.requireCafe(id);

    if (status === 'published') {
      const blockers = await this.getPublishBlockers(cafe);
      if (blockers.length) {
        throw new BadRequestException({
          message: 'Cafe is not ready to publish.',
          blockers,
        });
      }
    }

    const updated = await this.prisma.cafe.update({
      where: { id },
      data: { status },
      include: cafeInclude,
    });

    return {
      success: true,
      data: { cafe: this.serializeCafe(updated) },
      message: `Cafe marked as ${status}.`,
    };
  }

  /** Exposed for unit tests. */
  async getPublishBlockers(cafe: CafeRecord): Promise<string[]> {
    const blockers: string[] = [];
    if (!cafe.name?.trim()) blockers.push('name_required');
    if (!cafe.tableCount || cafe.tableCount < 1) blockers.push('table_count_required');
    if (!cafe.activeEventId) blockers.push('active_event_required');

    const activeItemCount = await this.prisma.cafeMenuItem.count({
      where: {
        status: 'active',
        subcategory: {
          status: 'active',
          category: { cafeId: cafe.id, status: 'active' },
        },
      },
    });
    if (activeItemCount < 1) blockers.push('menu_item_required');

    const activeAgentCount = await this.prisma.cafePosAgent.count({
      where: { cafeId: cafe.id, status: 'active' },
    });
    if (activeAgentCount < 1) blockers.push('pos_agent_required');

    return blockers;
  }

  async listCategories(cafeId: string) {
    const cafe = await this.requireCafe(cafeId);
    return {
      success: true,
      data: {
        categories: cafe.categories.map((category) => this.serializeCategory(category)),
      },
    };
  }

  async createCategory(cafeId: string, dto: UpsertCafeMenuCategoryDto) {
    await this.requireCafe(cafeId);
    const imageMediaId = await this.resolveImageMediaId(cafeId, dto);

    const category = await this.prisma.cafeMenuCategory.create({
      data: {
        cafeId,
        titleEn: dto.title_en.trim(),
        titleAr: dto.title_ar?.trim() || null,
        imageMediaId,
        sortOrder: dto.sort_order ?? 0,
        status: (dto.status as CatalogStatus) ?? 'active',
      },
      include: {
        imageMedia: categoryImageSelect,
        subcategories: {
          include: {
            imageMedia: categoryImageSelect,
            items: {
              include: {
                imageMedia: categoryImageSelect,
              },
            },
          },
        },
      },
    });

    return {
      success: true,
      data: { category: this.serializeCategory(category) },
      message: 'Menu category created.',
    };
  }

  async updateCategory(
    cafeId: string,
    categoryId: string,
    dto: UpsertCafeMenuCategoryDto,
  ) {
    await this.requireCategory(cafeId, categoryId);
    const imageMediaId = await this.resolveImageMediaId(cafeId, dto, true);

    const category = await this.prisma.cafeMenuCategory.update({
      where: { id: categoryId },
      data: {
        titleEn: dto.title_en.trim(),
        titleAr: dto.title_ar?.trim() || null,
        ...(imageMediaId !== undefined ? { imageMediaId } : {}),
        ...(dto.sort_order !== undefined ? { sortOrder: dto.sort_order } : {}),
        ...(dto.status !== undefined ? { status: dto.status as CatalogStatus } : {}),
      },
      include: {
        imageMedia: categoryImageSelect,
        subcategories: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            imageMedia: categoryImageSelect,
            items: {
              orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
              include: {
                imageMedia: categoryImageSelect,
              },
            },
          },
        },
      },
    });

    return {
      success: true,
      data: { category: this.serializeCategory(category) },
      message: 'Menu category updated.',
    };
  }

  async deleteCategory(cafeId: string, categoryId: string) {
    await this.requireCategory(cafeId, categoryId);
    await this.prisma.cafeMenuCategory.delete({ where: { id: categoryId } });
    return { success: true, data: { id: categoryId }, message: 'Menu category deleted.' };
  }

  async createSubcategory(
    cafeId: string,
    categoryId: string,
    dto: UpsertCafeMenuSubcategoryDto,
  ) {
    await this.requireCategory(cafeId, categoryId);
    const imageMediaId = await this.resolveImageMediaId(cafeId, dto);

    const subcategory = await this.prisma.cafeMenuSubcategory.create({
      data: {
        categoryId,
        titleEn: dto.title_en.trim(),
        titleAr: dto.title_ar?.trim() || null,
        imageMediaId,
        isUngrouped: false,
        sortOrder: dto.sort_order ?? 0,
        status: (dto.status as CatalogStatus) ?? 'active',
      },
      include: {
        imageMedia: categoryImageSelect,
        items: {
          include: {
            imageMedia: categoryImageSelect,
          },
        },
      },
    });

    return {
      success: true,
      data: { subcategory: this.serializeSubcategory(subcategory) },
      message: 'Menu subcategory created.',
    };
  }

  async updateSubcategory(
    cafeId: string,
    categoryId: string,
    subcategoryId: string,
    dto: UpsertCafeMenuSubcategoryDto,
  ) {
    await this.requireSubcategory(cafeId, categoryId, subcategoryId);
    const imageMediaId = await this.resolveImageMediaId(cafeId, dto, true);

    const subcategory = await this.prisma.cafeMenuSubcategory.update({
      where: { id: subcategoryId },
      data: {
        titleEn: dto.title_en.trim(),
        titleAr: dto.title_ar?.trim() || null,
        ...(imageMediaId !== undefined ? { imageMediaId } : {}),
        ...(dto.sort_order !== undefined ? { sortOrder: dto.sort_order } : {}),
        ...(dto.status !== undefined ? { status: dto.status as CatalogStatus } : {}),
      },
      include: {
        imageMedia: categoryImageSelect,
        items: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            imageMedia: categoryImageSelect,
          },
        },
      },
    });

    return {
      success: true,
      data: { subcategory: this.serializeSubcategory(subcategory) },
      message: 'Menu subcategory updated.',
    };
  }

  async deleteSubcategory(cafeId: string, categoryId: string, subcategoryId: string) {
    await this.requireSubcategory(cafeId, categoryId, subcategoryId);
    await this.prisma.cafeMenuSubcategory.delete({ where: { id: subcategoryId } });
    return {
      success: true,
      data: { id: subcategoryId },
      message: 'Menu subcategory deleted.',
    };
  }

  async createItemUnderCategory(
    cafeId: string,
    categoryId: string,
    dto: UpsertCafeMenuItemDto,
  ) {
    await this.requireCategory(cafeId, categoryId);
    const subcategory = await this.ensureUngroupedSubcategory(categoryId);
    return this.createItem(cafeId, subcategory.id, dto);
  }

  async createItem(cafeId: string, subcategoryId: string, dto: UpsertCafeMenuItemDto) {
    await this.requireSubcategoryById(cafeId, subcategoryId);
    const imageMediaId = await this.resolveImageMediaId(cafeId, dto);
    const variants = this.normalizeVariantInput(dto.variants);
    const price =
      variants.length > 0
        ? Math.min(...variants.map((variant) => variant.price))
        : dto.price;

    const item = await this.prisma.$transaction(async (tx) => {
      const created = await tx.cafeMenuItem.create({
        data: {
          subcategoryId,
          titleEn: dto.title_en.trim(),
          titleAr: dto.title_ar?.trim() || null,
          description: dto.description?.trim() || null,
          price: new Prisma.Decimal(price),
          currency: dto.currency?.trim() || 'QAR',
          imageMediaId,
          isKot: dto.is_kot ?? false,
          sortOrder: dto.sort_order ?? 0,
          status: (dto.status as CatalogStatus) ?? 'active',
          ...(variants.length
            ? {
                variants: {
                  create: variants.map((variant, index) => ({
                    titleEn: variant.title_en,
                    titleAr: variant.title_ar,
                    price: new Prisma.Decimal(variant.price),
                    sortOrder: variant.sort_order ?? index,
                    status: (variant.status as CatalogStatus) ?? 'active',
                  })),
                },
              }
            : {}),
        },
        include: {
          imageMedia: categoryImageSelect,
          variants: {
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          },
        },
      });
      return created;
    });

    return {
      success: true,
      data: { item: this.serializeItem(item) },
      message: 'Menu item created.',
    };
  }

  async updateItem(
    cafeId: string,
    subcategoryId: string,
    itemId: string,
    dto: UpsertCafeMenuItemDto,
  ) {
    await this.requireItem(cafeId, subcategoryId, itemId);
    const imageMediaId = await this.resolveImageMediaId(cafeId, dto, true);
    const replaceVariants = dto.variants !== undefined;
    const variants = replaceVariants ? this.normalizeVariantInput(dto.variants) : null;
    const price =
      variants && variants.length > 0
        ? Math.min(...variants.map((variant) => variant.price))
        : dto.price;

    const item = await this.prisma.$transaction(async (tx) => {
      if (replaceVariants) {
        await tx.cafeMenuItemVariant.deleteMany({ where: { itemId } });
      }

      return tx.cafeMenuItem.update({
        where: { id: itemId },
        data: {
          titleEn: dto.title_en.trim(),
          titleAr: dto.title_ar?.trim() || null,
          description: dto.description?.trim() || null,
          price: new Prisma.Decimal(price),
          ...(dto.currency !== undefined ? { currency: dto.currency.trim() || 'QAR' } : {}),
          ...(imageMediaId !== undefined ? { imageMediaId } : {}),
          ...(dto.is_kot !== undefined ? { isKot: dto.is_kot } : {}),
          ...(dto.sort_order !== undefined ? { sortOrder: dto.sort_order } : {}),
          ...(dto.status !== undefined ? { status: dto.status as CatalogStatus } : {}),
          ...(variants && variants.length
            ? {
                variants: {
                  create: variants.map((variant, index) => ({
                    titleEn: variant.title_en,
                    titleAr: variant.title_ar,
                    price: new Prisma.Decimal(variant.price),
                    sortOrder: variant.sort_order ?? index,
                    status: (variant.status as CatalogStatus) ?? 'active',
                  })),
                },
              }
            : {}),
        },
        include: {
          imageMedia: categoryImageSelect,
          variants: {
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          },
        },
      });
    });

    return {
      success: true,
      data: { item: this.serializeItem(item) },
      message: 'Menu item updated.',
    };
  }

  async deleteItem(cafeId: string, subcategoryId: string, itemId: string) {
    await this.requireItem(cafeId, subcategoryId, itemId);
    await this.prisma.cafeMenuItem.delete({ where: { id: itemId } });
    return { success: true, data: { id: itemId }, message: 'Menu item deleted.' };
  }

  async listAgents(cafeId: string) {
    const cafe = await this.requireCafe(cafeId);
    return {
      success: true,
      data: { agents: cafe.agents.map((agent) => this.serializeAgent(agent)) },
    };
  }

  async addAgent(cafeId: string, dto: CreateCafePosAgentDto, actorUserId?: string) {
    const cafe = await this.requireCafe(cafeId);

    let userId = dto.user_id?.trim() || '';
    if (!userId) {
      if (!dto.name?.trim() || !dto.email?.trim() || !dto.password || !dto.username?.trim()) {
        throw new BadRequestException(
          'Provide user_id, or name, email, username, and password to create a Cafe POS agent.',
        );
      }
      userId = await this.createCafePosUser({
        cafe,
        name: dto.name.trim(),
        email: dto.email.trim(),
        password: dto.password,
        username: dto.username.trim(),
        actorUserId,
      });
    } else {
      await this.requireUser(userId);
    }

    const existing = await this.prisma.cafePosAgent.findUnique({
      where: { cafeId_userId: { cafeId, userId } },
    });
    if (existing) {
      throw new ConflictException('User is already a POS agent for this cafe.');
    }

    const agent = await this.prisma.cafePosAgent.create({
      data: {
        cafeId,
        userId,
        status: 'active',
      },
      include: {
        user: {
          select: { id: true, name: true, email: true, username: true, status: true },
        },
      },
    });

    if (cafe.activeEventId) {
      await this.syncStaffAssignment({
        cafe,
        userId,
        eventId: cafe.activeEventId,
        status: 'active',
        actorUserId,
      });
    }

    return {
      success: true,
      data: { agent: this.serializeAgent(agent) },
      message: 'Cafe POS agent added.',
    };
  }

  async updateAgentStatus(
    cafeId: string,
    agentId: string,
    status: 'active' | 'suspended',
    actorUserId?: string,
  ) {
    const cafe = await this.requireCafe(cafeId);
    const agent = cafe.agents.find((row) => row.id === agentId);
    if (!agent) throw new NotFoundException('Cafe POS agent not found.');

    const updated = await this.prisma.cafePosAgent.update({
      where: { id: agentId },
      data: { status },
      include: {
        user: {
          select: { id: true, name: true, email: true, username: true, status: true },
        },
      },
    });

    if (cafe.activeEventId) {
      await this.syncStaffAssignment({
        cafe,
        userId: agent.userId,
        eventId: cafe.activeEventId,
        status,
        actorUserId,
      });
    }

    return {
      success: true,
      data: { agent: this.serializeAgent(updated) },
      message: `Cafe POS agent marked as ${status}.`,
    };
  }

  async removeAgent(cafeId: string, agentId: string) {
    const cafe = await this.requireCafe(cafeId);
    const agent = cafe.agents.find((row) => row.id === agentId);
    if (!agent) throw new NotFoundException('Cafe POS agent not found.');

    await this.prisma.cafePosAgent.delete({ where: { id: agentId } });

    if (cafe.activeEventId) {
      await this.suspendCafeStaffAssignment(agent.userId, cafe.activeEventId);
    }

    return {
      success: true,
      data: { id: agentId },
      message: 'Cafe POS agent removed.',
    };
  }

  async assignEvent(cafeId: string, dto: AssignCafeEventDto, actorUserId?: string) {
    const cafe = await this.requireCafe(cafeId);
    const event = await this.prisma.event.findUnique({
      where: { id: dto.event_id },
      select: { id: true, organizationId: true },
    });
    if (!event) throw new NotFoundException('Event not found.');
    if (event.organizationId !== cafe.organizationId) {
      throw new BadRequestException('Event must belong to the same organization as the cafe.');
    }

    if (cafe.activeEventId === event.id) {
      return {
        success: true,
        data: { cafe: this.serializeCafe(cafe) },
        message: 'Event already assigned to this cafe.',
      };
    }

    const previousEventId = cafe.activeEventId;

    await this.prisma.$transaction(async (tx) => {
      if (previousEventId) {
        await tx.cafeEventAssignment.updateMany({
          where: { cafeId, unassignedAt: null },
          data: { unassignedAt: new Date() },
        });
      }

      await tx.cafeEventAssignment.create({
        data: {
          cafeId,
          eventId: event.id,
          assignedByUserId: actorUserId ?? null,
        },
      });

      await tx.cafe.update({
        where: { id: cafeId },
        data: { activeEventId: event.id },
      });
    });

    if (previousEventId) {
      for (const agent of cafe.agents) {
        await this.suspendCafeStaffAssignment(agent.userId, previousEventId);
      }
    }

    const refreshed = await this.requireCafe(cafeId);
    for (const agent of refreshed.agents.filter((row) => row.status === 'active')) {
      await this.syncStaffAssignment({
        cafe: refreshed,
        userId: agent.userId,
        eventId: event.id,
        status: 'active',
        actorUserId,
      });
    }

    return {
      success: true,
      data: { cafe: this.serializeCafe(refreshed) },
      message: 'Event assigned to cafe.',
    };
  }

  async unassignEvent(cafeId: string) {
    const cafe = await this.requireCafe(cafeId);
    if (!cafe.activeEventId) {
      return {
        success: true,
        data: { cafe: this.serializeCafe(cafe) },
        message: 'Cafe has no active event.',
      };
    }

    const previousEventId = cafe.activeEventId;

    await this.prisma.$transaction(async (tx) => {
      await tx.cafeEventAssignment.updateMany({
        where: { cafeId, unassignedAt: null },
        data: { unassignedAt: new Date() },
      });
      await tx.cafe.update({
        where: { id: cafeId },
        data: {
          activeEventId: null,
          ...(cafe.status === 'published' ? { status: 'draft' } : {}),
        },
      });
    });

    for (const agent of cafe.agents) {
      await this.suspendCafeStaffAssignment(agent.userId, previousEventId);
    }

    const refreshed = await this.requireCafe(cafeId);
    return {
      success: true,
      data: { cafe: this.serializeCafe(refreshed) },
      message: 'Event unassigned from cafe.',
    };
  }

  private async createCafePosUser(params: {
    cafe: Pick<CafeRecord, 'id' | 'organizationId' | 'name'>;
    name: string;
    email: string;
    password: string;
    username: string;
    actorUserId?: string;
  }) {
    const role = await this.prisma.role.findUnique({ where: { name: 'cafe_pos' } });
    if (!role) {
      throw new BadRequestException(
        'Cafe POS agent role is not seeded. Run prisma seed, then try again.',
      );
    }

    const email = params.email.toLowerCase();
    const username = params.username.toLowerCase();
    const passwordHash = await hashPassword(params.password);

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            name: params.name,
            email,
            username,
            passwordHash,
            status: 'active',
          },
        });

        await tx.staffAssignment.create({
          data: {
            userId: created.id,
            roleId: role.id,
            organizationId: params.cafe.organizationId,
            isCafeAgent: true,
            status: 'active',
            createdByUserId: params.actorUserId ?? null,
          },
        });

        return created;
      });
      return user.id;
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

  private async syncStaffAssignment(params: {
    cafe: Pick<CafeRecord, 'id' | 'organizationId' | 'name'>;
    userId: string;
    eventId: string;
    status: 'active' | 'suspended';
    actorUserId?: string;
  }) {
    const cafePosRole = await this.prisma.role.findUnique({ where: { name: 'cafe_pos' } });
    const posRole = await this.prisma.role.findUnique({ where: { name: 'pos' } });
    const roleIds = [cafePosRole?.id, posRole?.id].filter(Boolean) as string[];
    if (!roleIds.length) return;

    const existing = await this.prisma.staffAssignment.findFirst({
      where: {
        userId: params.userId,
        eventId: params.eventId,
        OR: [
          ...(cafePosRole ? [{ roleId: cafePosRole.id }] : []),
          ...(posRole ? [{ roleId: posRole.id, isCafeAgent: true }] : []),
        ],
      },
    });

    if (existing) {
      await this.prisma.staffAssignment.update({
        where: { id: existing.id },
        data: { status: params.status as StaffAssignmentStatus },
      });
      return;
    }

    if (params.status !== 'active') return;

    const roleId = cafePosRole?.id ?? posRole!.id;
    await this.prisma.staffAssignment.create({
      data: {
        userId: params.userId,
        roleId,
        organizationId: params.cafe.organizationId,
        eventId: params.eventId,
        isCafeAgent: true,
        status: 'active',
        createdByUserId: params.actorUserId ?? null,
      },
    });
  }

  private async suspendCafeStaffAssignment(userId: string, eventId: string) {
    const cafePosRole = await this.prisma.role.findUnique({ where: { name: 'cafe_pos' } });
    const posRole = await this.prisma.role.findUnique({ where: { name: 'pos' } });

    await this.prisma.staffAssignment.updateMany({
      where: {
        userId,
        eventId,
        status: 'active',
        OR: [
          ...(cafePosRole ? [{ roleId: cafePosRole.id }] : []),
          ...(posRole ? [{ roleId: posRole.id, isCafeAgent: true }] : []),
        ],
      },
      data: { status: 'suspended' },
    });
  }

  private async ensureUngroupedSubcategory(categoryId: string) {
    const existing = await this.prisma.cafeMenuSubcategory.findFirst({
      where: { categoryId, isUngrouped: true },
      select: { id: true },
    });
    if (existing) return existing;

    return this.prisma.cafeMenuSubcategory.create({
      data: {
        categoryId,
        titleEn: UNGROUPED_SUBCATEGORY_TITLE,
        isUngrouped: true,
        sortOrder: 0,
        status: 'active',
      },
      select: { id: true },
    });
  }

  /**
   * Resolves an image media id from either an uploaded data URL or an existing media id.
   * When `forUpdate` is true and neither field is provided, returns `undefined` (leave unchanged).
   */
  private async resolveImageMediaId(
    cafeId: string,
    dto: {
      image_media_id?: string | null;
      thumbnail_data_url?: string;
      thumbnail_file_name?: string;
    },
    forUpdate = false,
  ): Promise<string | null | undefined> {
    if (dto.thumbnail_data_url?.trim()) {
      return this.saveMenuThumbnail(
        cafeId,
        dto.thumbnail_data_url,
        dto.thumbnail_file_name,
      );
    }
    if (dto.image_media_id !== undefined) {
      if (dto.image_media_id) {
        await this.requireMedia(dto.image_media_id);
      }
      return dto.image_media_id;
    }
    return forUpdate ? undefined : null;
  }

  private async saveMenuThumbnail(
    cafeId: string,
    dataUrl: string,
    fileName?: string,
  ) {
    const asset = await this.mediaStorage.uploadDataUrl({
      folder: `cafes/${cafeId}/menu`,
      dataUrl,
      fileName,
      maxBytes: 5 * 1024 * 1024,
      altText: fileName?.trim() || null,
      errorLabel: 'thumbnail',
    });
    return asset.id;
  }

  private async requireCafe(id: string) {
    const cafe = await this.prisma.cafe.findUnique({
      where: { id },
      include: cafeInclude,
    });
    if (!cafe) throw new NotFoundException('Cafe not found.');
    return cafe;
  }

  async assertCafeAccess(cafeId: string, scopedEventIds?: string[] | null) {
    if (scopedEventIds == null) return;
    if (!scopedEventIds.length) {
      throw new ForbiddenException('You do not have access to this cafe.');
    }
    const orgIds = await this.organizationIdsForEvents(scopedEventIds);
    const cafe = await this.prisma.cafe.findFirst({
      where: {
        id: cafeId,
        OR: [
          { activeEventId: { in: scopedEventIds } },
          {
            assignments: {
              some: { eventId: { in: scopedEventIds }, unassignedAt: null },
            },
          },
          ...(orgIds.length
            ? [
                {
                  organizationId: { in: orgIds },
                  activeEventId: null,
                  assignments: { none: { unassignedAt: null } },
                },
              ]
            : []),
        ],
      },
      select: { id: true },
    });
    if (!cafe) {
      throw new ForbiddenException('You do not have access to this cafe.');
    }
  }

  private async assertCafeOrganizationAccess(
    organizationId: string,
    scopedEventIds?: string[] | null,
  ) {
    if (scopedEventIds == null) return;
    if (!scopedEventIds.length) {
      throw new ForbiddenException(
        'You can only manage cafes for your assigned or organised events.',
      );
    }
    const hit = await this.prisma.event.findFirst({
      where: { id: { in: scopedEventIds }, organizationId },
      select: { id: true },
    });
    if (!hit) {
      throw new ForbiddenException(
        'You can only create cafes for organisations of your assigned or organised events.',
      );
    }
  }

  private async organizationIdsForEvents(eventIds: string[]) {
    if (!eventIds.length) return [] as string[];
    const rows = await this.prisma.event.findMany({
      where: { id: { in: eventIds } },
      select: { organizationId: true },
      distinct: ['organizationId'],
    });
    return rows.map((row) => row.organizationId);
  }

  private async requireOrganization(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!org) throw new NotFoundException('Organization not found.');
    return org;
  }

  private async requireUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!user || user.status === 'deleted') {
      throw new NotFoundException('User not found.');
    }
    return user;
  }

  private async requireMedia(id: string) {
    const media = await this.prisma.mediaAsset.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!media) throw new NotFoundException('Media asset not found.');
    return media;
  }

  private async requireCategory(cafeId: string, categoryId: string) {
    const category = await this.prisma.cafeMenuCategory.findFirst({
      where: { id: categoryId, cafeId },
      select: { id: true },
    });
    if (!category) throw new NotFoundException('Menu category not found.');
    return category;
  }

  private async requireSubcategory(
    cafeId: string,
    categoryId: string,
    subcategoryId: string,
  ) {
    const subcategory = await this.prisma.cafeMenuSubcategory.findFirst({
      where: {
        id: subcategoryId,
        categoryId,
        category: { cafeId },
      },
      select: { id: true },
    });
    if (!subcategory) throw new NotFoundException('Menu subcategory not found.');
    return subcategory;
  }

  private async requireSubcategoryById(cafeId: string, subcategoryId: string) {
    const subcategory = await this.prisma.cafeMenuSubcategory.findFirst({
      where: {
        id: subcategoryId,
        category: { cafeId },
      },
      select: { id: true, categoryId: true },
    });
    if (!subcategory) throw new NotFoundException('Menu subcategory not found.');
    return subcategory;
  }

  private async requireItem(cafeId: string, subcategoryId: string, itemId: string) {
    const item = await this.prisma.cafeMenuItem.findFirst({
      where: {
        id: itemId,
        subcategoryId,
        subcategory: { category: { cafeId } },
      },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('Menu item not found.');
    return item;
  }

  private serializeCafe(cafe: CafeRecord) {
    return {
      id: cafe.id,
      organization_id: cafe.organizationId,
      organization: cafe.organization,
      name: cafe.name,
      details: cafe.details,
      table_count: cafe.tableCount,
      manager_user_id: cafe.managerUserId,
      manager: cafe.manager,
      status: cafe.status,
      active_event_id: cafe.activeEventId,
      active_event: cafe.activeEvent
        ? {
            id: cafe.activeEvent.id,
            slug: cafe.activeEvent.slug,
            title: cafe.activeEvent.translations[0]?.title ?? null,
          }
        : null,
      categories: cafe.categories.map((category) => this.serializeCategory(category)),
      agents: cafe.agents.map((agent) => this.serializeAgent(agent)),
      assignments: cafe.assignments.map((row) => ({
        id: row.id,
        event_id: row.eventId,
        event: {
          id: row.event.id,
          slug: row.event.slug,
          title: row.event.translations[0]?.title ?? null,
        },
        assigned_at: row.assignedAt,
        unassigned_at: row.unassignedAt,
        assigned_by: row.assignedBy,
      })),
      created_at: cafe.createdAt,
      updated_at: cafe.updatedAt,
    };
  }

  private serializeCategory(
    category: {
      id: string;
      cafeId: string;
      titleEn: string;
      titleAr: string | null;
      imageMediaId?: string | null;
      sortOrder: number;
      status: CatalogStatus;
      createdAt: Date;
      updatedAt: Date;
      imageMedia?: { id: string; url: string; altText: string | null } | null;
      subcategories: Array<{
        id: string;
        categoryId: string;
        titleEn: string;
        titleAr: string | null;
        imageMediaId?: string | null;
        isUngrouped?: boolean;
        sortOrder: number;
        status: CatalogStatus;
        createdAt: Date;
        updatedAt: Date;
        imageMedia?: { id: string; url: string; altText: string | null } | null;
        items: Array<{
          id: string;
          subcategoryId: string;
          titleEn: string;
          titleAr: string | null;
          description: string | null;
          price: Prisma.Decimal;
          currency: string;
          imageMediaId: string | null;
          isKot: boolean;
          sortOrder: number;
          status: CatalogStatus;
          createdAt: Date;
          updatedAt: Date;
          imageMedia: { id: string; url: string; altText: string | null } | null;
          variants?: Array<{
            id: string;
            itemId: string;
            titleEn: string;
            titleAr: string | null;
            price: Prisma.Decimal;
            sortOrder: number;
            status: CatalogStatus;
            createdAt: Date;
            updatedAt: Date;
          }>;
        }>;
      }>;
    },
  ) {
    return {
      id: category.id,
      cafe_id: category.cafeId,
      title_en: category.titleEn,
      title_ar: category.titleAr,
      image_media_id: category.imageMediaId ?? null,
      image_media: category.imageMedia ?? null,
      sort_order: category.sortOrder,
      status: category.status,
      subcategories: category.subcategories.map((sub) => this.serializeSubcategory(sub)),
      created_at: category.createdAt,
      updated_at: category.updatedAt,
    };
  }

  private serializeSubcategory(subcategory: {
    id: string;
    categoryId: string;
    titleEn: string;
    titleAr: string | null;
    imageMediaId?: string | null;
    isUngrouped?: boolean;
    sortOrder: number;
    status: CatalogStatus;
    createdAt: Date;
    updatedAt: Date;
    imageMedia?: { id: string; url: string; altText: string | null } | null;
    items: Array<{
      id: string;
      subcategoryId: string;
      titleEn: string;
      titleAr: string | null;
      description: string | null;
      price: Prisma.Decimal;
      currency: string;
      imageMediaId: string | null;
      isKot: boolean;
      sortOrder: number;
      status: CatalogStatus;
      createdAt: Date;
      updatedAt: Date;
      imageMedia: { id: string; url: string; altText: string | null } | null;
      variants?: Array<{
        id: string;
        itemId: string;
        titleEn: string;
        titleAr: string | null;
        price: Prisma.Decimal;
        sortOrder: number;
        status: CatalogStatus;
        createdAt: Date;
        updatedAt: Date;
      }>;
    }>;
  }) {
    return {
      id: subcategory.id,
      category_id: subcategory.categoryId,
      title_en: subcategory.titleEn,
      title_ar: subcategory.titleAr,
      image_media_id: subcategory.imageMediaId ?? null,
      image_media: subcategory.imageMedia ?? null,
      is_ungrouped: Boolean(subcategory.isUngrouped),
      sort_order: subcategory.sortOrder,
      status: subcategory.status,
      items: subcategory.items.map((item) => this.serializeItem(item)),
      created_at: subcategory.createdAt,
      updated_at: subcategory.updatedAt,
    };
  }

  private serializeItem(item: {
    id: string;
    subcategoryId: string;
    titleEn: string;
    titleAr: string | null;
    description: string | null;
    price: Prisma.Decimal;
    currency: string;
    imageMediaId: string | null;
    isKot: boolean;
    sortOrder: number;
    status: CatalogStatus;
    createdAt: Date;
    updatedAt: Date;
    imageMedia: { id: string; url: string; altText: string | null } | null;
    variants?: Array<{
      id: string;
      itemId: string;
      titleEn: string;
      titleAr: string | null;
      price: Prisma.Decimal;
      sortOrder: number;
      status: CatalogStatus;
      createdAt: Date;
      updatedAt: Date;
    }>;
  }) {
    const variants = (item.variants ?? []).map((variant) => ({
      id: variant.id,
      item_id: variant.itemId,
      title_en: variant.titleEn,
      title_ar: variant.titleAr,
      price: Number(variant.price),
      sort_order: variant.sortOrder,
      status: variant.status,
      created_at: variant.createdAt,
      updated_at: variant.updatedAt,
    }));
    return {
      id: item.id,
      subcategory_id: item.subcategoryId,
      title_en: item.titleEn,
      title_ar: item.titleAr,
      description: item.description,
      price: Number(item.price),
      currency: item.currency,
      image_media_id: item.imageMediaId,
      image_media: item.imageMedia,
      is_kot: item.isKot,
      sort_order: item.sortOrder,
      status: item.status,
      has_variants: variants.length > 0,
      variants,
      created_at: item.createdAt,
      updated_at: item.updatedAt,
    };
  }

  private normalizeVariantInput(variants?: CafeMenuItemVariantDto[]) {
    if (!variants?.length) return [];
    return variants
      .map((variant, index) => ({
        title_en: variant.title_en.trim(),
        title_ar: variant.title_ar?.trim() || null,
        price: Number(variant.price),
        sort_order: variant.sort_order ?? index,
        status: variant.status,
      }))
      .filter((variant) => variant.title_en.length > 0 && Number.isFinite(variant.price));
  }

  private serializeAgent(agent: {
    id: string;
    cafeId: string;
    userId: string;
    status: StaffAssignmentStatus;
    createdAt: Date;
    updatedAt: Date;
    user: {
      id: string;
      name: string;
      email: string;
      username: string | null;
      status: string;
    };
  }) {
    return {
      id: agent.id,
      cafe_id: agent.cafeId,
      user_id: agent.userId,
      status: agent.status,
      user: agent.user,
      created_at: agent.createdAt,
      updated_at: agent.updatedAt,
    };
  }
}
