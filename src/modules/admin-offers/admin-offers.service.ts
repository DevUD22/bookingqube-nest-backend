import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OfferTranslation, Prisma, PublishStatus } from '@prisma/client';

import { sanitizeCmsHtmlOrNull } from '../../common/html/sanitize-cms-html';
import { PrismaService } from '../../database/prisma.service';
import { MediaStorageService } from '../media-storage/media-storage.service';
import { AdminOffersListQueryDto, UpsertAdminOfferDto } from './dto/admin-offer.dto';

const detailInclude = {
  heroMedia: true, translations: true,
  events: { orderBy: { sortOrder: 'asc' as const }, include: { event: { include: { translations: true } } } },
} satisfies Prisma.OfferInclude;
type Detail = Prisma.OfferGetPayload<{ include: typeof detailInclude }>;

@Injectable()
export class AdminOffersService {
  constructor(private readonly prisma: PrismaService, private readonly media: MediaStorageService) {}

  async list(query: AdminOffersListQueryDto) {
    const q = query.q?.trim();
    const rows = await this.prisma.offer.findMany({
      where: {
        ...(query.status && query.status !== 'all' ? { status: query.status as PublishStatus } : {}),
        ...(q ? { OR: [
          { slug: { contains: q, mode: 'insensitive' as const } },
          { translations: { some: { title: { contains: q, mode: 'insensitive' as const } } } },
        ] } : {}),
      },
      include: detailInclude,
      orderBy: [{ sortOrder: 'asc' }, { publishedAt: 'desc' }, { updatedAt: 'desc' }],
    });
    return { success: true, data: { items: rows.map((row) => this.serialize(row)) } };
  }

  async eventOptions() {
    const events = await this.prisma.event.findMany({
      where: { status: { not: 'archived' } },
      select: { id: true, slug: true, status: true, translations: { select: { locale: true, title: true } } },
      orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }], take: 300,
    });
    return { success: true, data: { events: events.map((event) => ({
      id: event.id, slug: event.slug, status: event.status,
      title: event.translations.find((item) => item.locale === 'en')?.title ?? event.slug,
    })) } };
  }

  async get(id: string) {
    const row = await this.prisma.offer.findUnique({ where: { id }, include: detailInclude });
    if (!row) throw new NotFoundException('Offer not found.');
    return { success: true, data: { item: this.serialize(row) } };
  }

  async create(body: UpsertAdminOfferDto, adminUserId: string) {
    await this.assertSlug(body.slug);
    const image = body.hero_image_data_url ? await this.uploadHero(body, adminUserId) : null;
    const row = await this.prisma.offer.create({
      data: {
        slug: body.slug, status: body.status, isFeatured: body.is_featured,
        showOnHomepage: body.show_on_homepage, sortOrder: body.sort_order,
        validUntil: this.date(body.valid_until), publishedAt: this.date(body.published_at),
        heroMediaId: image?.id ?? null,
        translations: { create: this.translationCreates(body) },
        events: { create: body.event_ids.map((eventId, sortOrder) => ({ eventId, sortOrder })) },
      }, include: detailInclude,
    });
    return { success: true, data: { item: this.serialize(row) }, message: 'Offer created.' };
  }

  async update(id: string, body: UpsertAdminOfferDto, adminUserId: string) {
    const existing = await this.prisma.offer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Offer not found.');
    await this.assertSlug(body.slug, id);
    const image = body.hero_image_data_url ? await this.uploadHero(body, adminUserId) : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.offer.update({ where: { id }, data: {
        slug: body.slug, status: body.status, isFeatured: body.is_featured,
        showOnHomepage: body.show_on_homepage, sortOrder: body.sort_order,
        validUntil: this.date(body.valid_until), publishedAt: this.date(body.published_at),
        heroMediaId: image?.id ?? (body.remove_hero_image ? null : existing.heroMediaId),
      } });
      await this.upsertTranslation(tx, id, 'en', body);
      if (this.hasArabic(body)) await this.upsertTranslation(tx, id, 'ar', body);
      else await tx.offerTranslation.deleteMany({ where: { offerId: id, locale: 'ar' } });
      await tx.offerEvent.deleteMany({ where: { offerId: id } });
      if (body.event_ids.length) await tx.offerEvent.createMany({ data: body.event_ids.map((eventId, sortOrder) => ({ offerId: id, eventId, sortOrder })) });
    });
    return this.get(id);
  }

  async archive(id: string) {
    const found = await this.prisma.offer.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Offer not found.');
    await this.prisma.offer.update({ where: { id }, data: { status: 'archived', showOnHomepage: false } });
    return { success: true, data: { id }, message: 'Offer archived.' };
  }

  private async assertSlug(slug: string, excludeId?: string) {
    const found = await this.prisma.offer.findUnique({ where: { slug } });
    if (found && found.id !== excludeId) throw new ConflictException('This offer slug is already in use.');
  }
  private async uploadHero(body: UpsertAdminOfferDto, adminUserId: string) {
    return this.media.uploadDataUrl({ folder: 'offers', dataUrl: body.hero_image_data_url!,
      fileName: body.hero_image_file_name ?? `${body.slug}.jpg`, maxBytes: 10 * 1024 * 1024,
      allowJpgAlias: true, altText: body.title_en, uploadedByUserId: adminUserId, errorLabel: 'offer image' });
  }
  private translationCreates(body: UpsertAdminOfferDto) {
    const rows = [this.translationData('en', body)];
    if (this.hasArabic(body)) rows.push(this.translationData('ar', body));
    return rows;
  }
  private async upsertTranslation(tx: Prisma.TransactionClient, offerId: string, locale: 'en' | 'ar', body: UpsertAdminOfferDto) {
    const data = this.translationData(locale, body);
    await tx.offerTranslation.upsert({ where: { offerId_locale: { offerId, locale } }, update: data, create: { offerId, ...data } });
  }
  private translationData(locale: 'en' | 'ar', body: UpsertAdminOfferDto) {
    const row = body as unknown as Record<string, unknown>;
    const value = (name: string) => row[`${name}_${locale}`] as string | null | undefined;
    const tags = (row[`tags_${locale}`] as string[]).map((item) => item.trim()).filter(Boolean);
    return { locale, title: (value('title') ?? '').trim(), subtitle: this.nullable(value('subtitle')),
      description: sanitizeCmsHtmlOrNull(value('description')), category: this.nullable(value('category')),
      tag: this.nullable(value('tag')), tagsJson: tags, metaTitle: this.nullable(value('meta_title')),
      metaDescription: this.nullable(value('meta_description')) };
  }
  private hasArabic(body: UpsertAdminOfferDto) { return Boolean(body.title_ar?.trim() || body.description_ar?.trim()); }
  private date(value: string | null | undefined) { return value ? new Date(value) : null; }
  private nullable(value: string | null | undefined) { return value?.trim() || null; }
  private tags(value: Prisma.JsonValue | null | undefined) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
  private serialize(row: Detail) {
    const en = row.translations.find((item) => item.locale === 'en');
    const ar = row.translations.find((item) => item.locale === 'ar');
    const tr = (item: OfferTranslation | undefined, key: keyof OfferTranslation) => (item?.[key] as string | null | undefined) ?? null;
    return {
      id: row.id, slug: row.slug, status: row.status, is_featured: row.isFeatured,
      show_on_homepage: row.showOnHomepage, sort_order: row.sortOrder,
      valid_until: row.validUntil?.toISOString() ?? null, published_at: row.publishedAt?.toISOString() ?? null,
      hero_image_url: row.heroMedia?.url ?? null, event_ids: row.events.map((item) => item.eventId), updated_at: row.updatedAt.toISOString(),
      title_en: tr(en, 'title') ?? '', subtitle_en: tr(en, 'subtitle'), description_en: tr(en, 'description'), category_en: tr(en, 'category'), tag_en: tr(en, 'tag'), tags_en: this.tags(en?.tagsJson), meta_title_en: tr(en, 'metaTitle'), meta_description_en: tr(en, 'metaDescription'),
      title_ar: tr(ar, 'title'), subtitle_ar: tr(ar, 'subtitle'), description_ar: tr(ar, 'description'), category_ar: tr(ar, 'category'), tag_ar: tr(ar, 'tag'), tags_ar: this.tags(ar?.tagsJson), meta_title_ar: tr(ar, 'metaTitle'), meta_description_ar: tr(ar, 'metaDescription'),
    };
  }
}
