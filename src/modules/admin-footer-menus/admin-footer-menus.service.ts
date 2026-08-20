import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PublishStatus } from '@prisma/client';

import { sanitizeCmsHtmlOrNull } from '../../common/html/sanitize-cms-html';
import { PrismaService } from '../../database/prisma.service';
import {
  FooterMenuReorderNodeDto,
  ReorderFooterMenusDto,
  UpsertFooterMenuItemDto,
} from './dto/admin-footer-menu.dto';

const itemInclude = {
  children: {
    orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
  },
};

export type FooterMenuSerialized = {
  id: string;
  parent_id: string | null;
  title_en: string;
  title_ar: string | null;
  description_en: string | null;
  description_ar: string | null;
  body_html_en: string | null;
  body_html_ar: string | null;
  slug: string | null;
  url: string | null;
  target: string;
  sort_order: number;
  status: string;
  created_at: string;
  updated_at: string;
  children?: FooterMenuSerialized[];
};

type FooterMenuRow = {
  id: string;
  parentId: string | null;
  titleEn: string;
  titleAr: string | null;
  descriptionEn: string | null;
  descriptionAr: string | null;
  bodyHtmlEn: string | null;
  bodyHtmlAr: string | null;
  slug: string | null;
  url: string | null;
  target: string;
  sortOrder: number;
  status: PublishStatus;
  createdAt: Date;
  updatedAt: Date;
  children?: FooterMenuRow[];
};

@Injectable()
export class AdminFooterMenusService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const roots = (await this.prisma.footerMenuItem.findMany({
      where: { parentId: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: itemInclude,
    })) as FooterMenuRow[];

    return {
      success: true,
      data: {
        items: roots.map((row) => this.serialize(row)),
      },
    };
  }

  async get(id: string) {
    const item = (await this.prisma.footerMenuItem.findUnique({
      where: { id },
      include: itemInclude,
    })) as FooterMenuRow | null;
    if (!item) throw new NotFoundException('Footer menu item not found.');
    return { success: true, data: { item: this.serialize(item) } };
  }

  async create(body: UpsertFooterMenuItemDto) {
    const parentId = this.normalizeParentId(body.parent_id);
    if (parentId) await this.assertParentExists(parentId);

    const slug = this.normalizeSlug(body.slug);
    if (slug) await this.assertSlugAvailable(slug);

    const sortOrder =
      body.sort_order ??
      (await this.nextSortOrder(parentId));

    const created = (await this.prisma.footerMenuItem.create({
      data: {
        parentId,
        titleEn: body.title_en.trim(),
        titleAr: this.nullableTrim(body.title_ar),
        descriptionEn: this.nullableHtml(body.description_en),
        descriptionAr: this.nullableHtml(body.description_ar),
        bodyHtmlEn: this.nullableHtml(body.body_html_en),
        bodyHtmlAr: this.nullableHtml(body.body_html_ar),
        slug,
        url: this.normalizeUrl(body.url),
        target: body.target ?? '_self',
        sortOrder,
        status: (body.status as PublishStatus | undefined) ?? PublishStatus.draft,
      },
      include: itemInclude,
    })) as FooterMenuRow;

    return {
      success: true,
      data: { item: this.serialize(created) },
      message: 'Footer menu item created.',
    };
  }

  async update(id: string, body: UpsertFooterMenuItemDto) {
    const existing = await this.prisma.footerMenuItem.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Footer menu item not found.');

    const parentId =
      body.parent_id === undefined
        ? existing.parentId
        : this.normalizeParentId(body.parent_id);

    if (parentId === id) {
      throw new BadRequestException('A menu item cannot be its own parent.');
    }
    if (parentId) {
      await this.assertParentExists(parentId);
      await this.assertNotDescendant(id, parentId);
    }

    const slug =
      body.slug === undefined ? existing.slug : this.normalizeSlug(body.slug);
    if (slug && slug !== existing.slug) await this.assertSlugAvailable(slug, id);

    const updated = (await this.prisma.footerMenuItem.update({
      where: { id },
      data: {
        parentId,
        titleEn: body.title_en.trim(),
        titleAr: this.nullableTrim(body.title_ar),
        descriptionEn: this.nullableHtml(body.description_en),
        descriptionAr: this.nullableHtml(body.description_ar),
        bodyHtmlEn: this.nullableHtml(body.body_html_en),
        bodyHtmlAr: this.nullableHtml(body.body_html_ar),
        slug,
        url: body.url === undefined ? existing.url : this.normalizeUrl(body.url),
        target: body.target ?? existing.target,
        sortOrder: body.sort_order ?? existing.sortOrder,
        status: (body.status as PublishStatus | undefined) ?? existing.status,
      },
      include: itemInclude,
    })) as FooterMenuRow;

    return {
      success: true,
      data: { item: this.serialize(updated) },
      message: 'Footer menu item updated.',
    };
  }

  async remove(id: string) {
    const existing = await this.prisma.footerMenuItem.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Footer menu item not found.');

    await this.prisma.footerMenuItem.delete({ where: { id } });
    return {
      success: true,
      data: { id },
      message: 'Footer menu item deleted.',
    };
  }

  async reorder(body: ReorderFooterMenusDto) {
    const flat: Array<{ id: string; parentId: string | null; sortOrder: number }> = [];
    const walk = (nodes: FooterMenuReorderNodeDto[], parentId: string | null) => {
      nodes.forEach((node, index) => {
        flat.push({ id: node.id, parentId, sortOrder: index });
        if (node.children?.length) walk(node.children, node.id);
      });
    };
    walk(body.items, null);

    const ids = flat.map((row) => row.id);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Duplicate ids in reorder payload.');
    }

    const existing = await this.prisma.footerMenuItem.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    if (existing.length !== ids.length) {
      throw new BadRequestException('One or more menu items were not found.');
    }

    await this.prisma.$transaction(
      flat.map((row) =>
        this.prisma.footerMenuItem.update({
          where: { id: row.id },
          data: { parentId: row.parentId, sortOrder: row.sortOrder },
        }),
      ),
    );

    return this.list();
  }

  private serialize(row: FooterMenuRow): FooterMenuSerialized {
    const children: FooterMenuSerialized[] | undefined = row.children
      ? row.children.map((child) => this.serialize(child))
      : undefined;

    return {
      id: row.id,
      parent_id: row.parentId,
      title_en: row.titleEn,
      title_ar: row.titleAr,
      description_en: row.descriptionEn,
      description_ar: row.descriptionAr,
      body_html_en: row.bodyHtmlEn,
      body_html_ar: row.bodyHtmlAr,
      slug: row.slug,
      url: row.url,
      target: row.target,
      sort_order: row.sortOrder,
      status: row.status,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      ...(children ? { children } : {}),
    };
  }

  private normalizeParentId(value?: string | null) {
    if (!value) return null;
    return value;
  }

  private normalizeSlug(value?: string | null) {
    if (value == null) return null;
    const trimmed = value.trim().toLowerCase().replace(/^\/+|\/+$/g, '');
    if (!trimmed) return null;
    return trimmed
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9/_-]/g, '')
      .replace(/-+/g, '-')
      .slice(0, 160);
  }

  private normalizeUrl(value?: string | null) {
    if (value == null) return null;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  private nullableTrim(value?: string | null) {
    if (value == null) return null;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  private nullableHtml(value?: string | null) {
    return sanitizeCmsHtmlOrNull(value);
  }

  private async assertParentExists(parentId: string) {
    const parent = await this.prisma.footerMenuItem.findUnique({
      where: { id: parentId },
      select: { id: true, parentId: true },
    });
    if (!parent) throw new BadRequestException('Parent menu item not found.');
    // Keep the tree to two levels in the admin UX (section → links).
    if (parent.parentId) {
      throw new BadRequestException(
        'Links can only be nested under a top-level section, not under another link.',
      );
    }
  }

  private async assertNotDescendant(itemId: string, candidateParentId: string) {
    let cursor: string | null = candidateParentId;
    const seen = new Set<string>();
    while (cursor) {
      if (cursor === itemId) {
        throw new BadRequestException('Cannot move a section under one of its own links.');
      }
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const row: { parentId: string | null } | null =
        await this.prisma.footerMenuItem.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
      cursor = row?.parentId ?? null;
    }
  }

  private async assertSlugAvailable(slug: string, excludeId?: string) {
    const clash = await this.prisma.footerMenuItem.findFirst({
      where: {
        slug,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(`Slug "${slug}" is already in use.`);
    }
  }

  private async nextSortOrder(parentId: string | null) {
    const last = await this.prisma.footerMenuItem.findFirst({
      where: { parentId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return (last?.sortOrder ?? -1) + 1;
  }
}
