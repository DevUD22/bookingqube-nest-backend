import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Blog, BlogTranslation, Prisma, PublishStatus } from '@prisma/client';

import { sanitizeCmsHtmlOrNull } from '../../common/html/sanitize-cms-html';
import { PrismaService } from '../../database/prisma.service';
import { MediaStorageService } from '../media-storage/media-storage.service';
import { AdminBlogsListQueryDto, UpsertAdminBlogDto } from './dto/admin-blog.dto';

const detailInclude = { heroMedia: true, author: true, translations: true } satisfies Prisma.BlogInclude;
type Detail = Prisma.BlogGetPayload<{ include: typeof detailInclude }>;

@Injectable()
export class AdminBlogsService {
  constructor(private readonly prisma: PrismaService, private readonly media: MediaStorageService) {}

  async list(query: AdminBlogsListQueryDto) {
    const q = query.q?.trim();
    const rows = await this.prisma.blog.findMany({
      where: {
        ...(query.status && query.status !== 'all' ? { status: query.status as PublishStatus } : {}),
        ...(q
          ? {
              OR: [
                { slug: { contains: q, mode: 'insensitive' as const } },
                { authorName: { contains: q, mode: 'insensitive' as const } },
                { translations: { some: { title: { contains: q, mode: 'insensitive' as const } } } },
              ],
            }
          : {}),
      },
      include: detailInclude,
      orderBy: [{ publishedAt: 'desc' }, { updatedAt: 'desc' }],
    });
    return { success: true, data: { items: rows.map((row) => this.serialize(row)) } };
  }

  async get(id: string) {
    const row = await this.prisma.blog.findUnique({ where: { id }, include: detailInclude });
    if (!row) throw new NotFoundException('Blog post not found.');
    return { success: true, data: { item: this.serialize(row) } };
  }

  async create(body: UpsertAdminBlogDto, adminUserId: string) {
    await this.assertSlug(body.slug);
    const media = body.hero_image_data_url
      ? await this.uploadHero(body, adminUserId)
      : null;
    const row = await this.prisma.blog.create({
      data: {
        slug: body.slug,
        status: body.status,
        authorName: this.nullable(body.author_name),
        showOnHomepage: body.show_on_homepage,
        publishedAt: this.date(body.published_at),
        heroMediaId: media?.id ?? null,
        translations: { create: this.translationCreates(body) },
      },
      include: detailInclude,
    });
    return { success: true, data: { item: this.serialize(row) }, message: 'Blog post created.' };
  }

  async update(id: string, body: UpsertAdminBlogDto, adminUserId: string) {
    const existing = await this.prisma.blog.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Blog post not found.');
    await this.assertSlug(body.slug, id);
    const media = body.hero_image_data_url ? await this.uploadHero(body, adminUserId) : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.blog.update({
        where: { id },
        data: {
          slug: body.slug,
          status: body.status,
          authorName: this.nullable(body.author_name),
          showOnHomepage: body.show_on_homepage,
          publishedAt: this.date(body.published_at),
          heroMediaId: media?.id ?? (body.remove_hero_image ? null : existing.heroMediaId),
        },
      });
      await this.upsertTranslation(tx, id, 'en', body);
      if (this.hasArabic(body)) await this.upsertTranslation(tx, id, 'ar', body);
      else await tx.blogTranslation.deleteMany({ where: { blogId: id, locale: 'ar' } });
    });
    return this.get(id);
  }

  async archive(id: string) {
    const row = await this.prisma.blog.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Blog post not found.');
    await this.prisma.blog.update({ where: { id }, data: { status: 'archived', showOnHomepage: false } });
    return { success: true, data: { id }, message: 'Blog post archived.' };
  }

  private async assertSlug(slug: string, excludeId?: string) {
    const found = await this.prisma.blog.findUnique({ where: { slug } });
    if (found && found.id !== excludeId) throw new ConflictException('This blog slug is already in use.');
  }

  private async uploadHero(body: UpsertAdminBlogDto, adminUserId: string) {
    if (!body.hero_image_data_url) throw new BadRequestException('Image data is missing.');
    return this.media.uploadDataUrl({
      folder: 'blogs', dataUrl: body.hero_image_data_url,
      fileName: body.hero_image_file_name ?? `${body.slug}.jpg`, maxBytes: 10 * 1024 * 1024,
      allowJpgAlias: true, altText: body.title_en, uploadedByUserId: adminUserId,
      errorLabel: 'blog hero image',
    });
  }

  private translationCreates(body: UpsertAdminBlogDto) {
    const rows = [this.translationData('en', body)];
    if (this.hasArabic(body)) rows.push(this.translationData('ar', body));
    return rows;
  }

  private async upsertTranslation(tx: Prisma.TransactionClient, blogId: string, locale: 'en' | 'ar', body: UpsertAdminBlogDto) {
    const data = this.translationData(locale, body);
    await tx.blogTranslation.upsert({
      where: { blogId_locale: { blogId, locale } }, update: data, create: { blogId, ...data },
    });
  }

  private translationData(locale: 'en' | 'ar', body: UpsertAdminBlogDto) {
    const get = (key: string) => (body as unknown as Record<string, unknown>)[`${key}_${locale}`] as string | null | undefined;
    return {
      locale,
      title: (get('title') ?? '').trim(), excerpt: this.nullable(get('excerpt')),
      bodyHtml: sanitizeCmsHtmlOrNull(get('body_html')), bodyJson: Prisma.JsonNull,
      metaTitle: this.nullable(get('meta_title')), metaDescription: this.nullable(get('meta_description')),
      category: this.nullable(get('category')), tag: this.nullable(get('tag')),
    };
  }

  private hasArabic(body: UpsertAdminBlogDto) {
    return Boolean(body.title_ar?.trim() || body.body_html_ar?.trim());
  }

  private date(value: string | null | undefined) { return value ? new Date(value) : null; }
  private nullable(value: string | null | undefined) { return value?.trim() || null; }

  private serialize(row: Detail) {
    const en = row.translations.find((item) => item.locale === 'en');
    const ar = row.translations.find((item) => item.locale === 'ar');
    const tr = (item: BlogTranslation | undefined, key: keyof BlogTranslation) => (item?.[key] as string | null | undefined) ?? null;
    return {
      id: row.id, slug: row.slug, status: row.status, author_name: row.authorName ?? row.author?.name ?? '',
      show_on_homepage: row.showOnHomepage, published_at: row.publishedAt?.toISOString() ?? null,
      hero_image_url: row.heroMedia?.url ?? null, updated_at: row.updatedAt.toISOString(),
      title_en: tr(en, 'title') ?? '', excerpt_en: tr(en, 'excerpt'), body_html_en: tr(en, 'bodyHtml') ?? '',
      meta_title_en: tr(en, 'metaTitle'), meta_description_en: tr(en, 'metaDescription'), category_en: tr(en, 'category'), tag_en: tr(en, 'tag'),
      title_ar: tr(ar, 'title'), excerpt_ar: tr(ar, 'excerpt'), body_html_ar: tr(ar, 'bodyHtml'),
      meta_title_ar: tr(ar, 'metaTitle'), meta_description_ar: tr(ar, 'metaDescription'), category_ar: tr(ar, 'category'), tag_ar: tr(ar, 'tag'),
    };
  }
}
