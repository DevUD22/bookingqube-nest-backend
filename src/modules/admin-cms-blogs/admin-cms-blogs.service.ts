import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PublishStatus, Prisma } from '@prisma/client';

import { sanitizeCmsHtmlOrNull } from '../../common/html/sanitize-cms-html';
import { PrismaService } from '../../database/prisma.service';
import { MediaStorageService } from '../media-storage/media-storage.service';
import { UpsertAdminCmsBlogDto } from './dto/admin-cms-blog.dto';

const blogInclude = {
  heroMedia: true,
  translations: true,
} satisfies Prisma.BlogInclude;

type BlogRecord = Prisma.BlogGetPayload<{ include: typeof blogInclude }>;

export type AdminCmsBlogSerialized = {
  id: string;
  name: string;
  name_ar: string | null;
  title: string | null;
  title_ar: string | null;
  slug: string;
  status: string;
  excerpt: string | null;
  excerpt_ar: string | null;
  body_html: string | null;
  body_html_ar: string | null;
  category: string | null;
  category_ar: string | null;
  meta_description: string | null;
  meta_description_ar: string | null;
  image_url: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

@Injectable()
export class AdminCmsBlogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaStorage: MediaStorageService,
  ) {}

  async list(q?: string) {
    const query = q?.trim();
    const blogs = await this.prisma.blog.findMany({
      include: blogInclude,
      orderBy: [{ publishedAt: 'desc' }, { updatedAt: 'desc' }],
      ...(query
        ? {
            where: {
              OR: [
                { slug: { contains: query, mode: 'insensitive' as const } },
                {
                  translations: {
                    some: {
                      OR: [
                        { title: { contains: query, mode: 'insensitive' as const } },
                        { metaTitle: { contains: query, mode: 'insensitive' as const } },
                        { category: { contains: query, mode: 'insensitive' as const } },
                      ],
                    },
                  },
                },
              ],
            },
          }
        : {}),
    });

    return {
      success: true,
      data: {
        blogs: blogs.map((blog) => this.serialize(blog)),
      },
    };
  }

  async get(id: string) {
    const blog = await this.prisma.blog.findUnique({
      where: { id },
      include: blogInclude,
    });
    if (!blog) throw new NotFoundException('Blog not found.');
    return { success: true, data: { blog: this.serialize(blog) } };
  }

  async create(body: UpsertAdminCmsBlogDto, adminUserId: string) {
    const name = body.name.trim();
    if (!name) throw new BadRequestException('Enter a blog name.');

    const slug = this.normalizeSlug(body.slug) || this.slugify(name);
    if (!slug) throw new BadRequestException('Enter a valid slug.');
    await this.assertSlugAvailable(slug);

    const heroMediaId = await this.saveHeroImage(
      body.hero_image_data_url,
      body.hero_image_file_name,
      adminUserId,
    );

    const status = (body.status as PublishStatus | undefined) ?? PublishStatus.draft;
    const created = await this.prisma.blog.create({
      data: {
        slug,
        status,
        heroMediaId,
        authorUserId: adminUserId,
        publishedAt: status === PublishStatus.published ? new Date() : null,
        translations: {
          create: this.buildTranslations(body, name),
        },
      },
      include: blogInclude,
    });

    return {
      success: true,
      data: { blog: this.serialize(created) },
      message: 'Blog created.',
    };
  }

  async update(id: string, body: UpsertAdminCmsBlogDto, adminUserId: string) {
    const existing = await this.prisma.blog.findUnique({
      where: { id },
      include: { translations: true },
    });
    if (!existing) throw new NotFoundException('Blog not found.');

    const name = body.name.trim();
    if (!name) throw new BadRequestException('Enter a blog name.');

    const slug =
      body.slug === undefined || body.slug === null || body.slug.trim() === ''
        ? existing.slug
        : this.normalizeSlug(body.slug) || existing.slug;
    if (!slug) throw new BadRequestException('Enter a valid slug.');
    if (slug !== existing.slug) await this.assertSlugAvailable(slug, id);

    const heroMediaId = body.hero_image_data_url
      ? await this.saveHeroImage(
          body.hero_image_data_url,
          body.hero_image_file_name,
          adminUserId,
        )
      : existing.heroMediaId;

    const status = (body.status as PublishStatus | undefined) ?? existing.status;
    const publishedAt =
      status === PublishStatus.published
        ? existing.publishedAt ?? new Date()
        : status === PublishStatus.draft || status === PublishStatus.archived
          ? null
          : existing.publishedAt;

    const translations = this.buildTranslations(body, name);

    const updated = await this.prisma.$transaction(async (tx) => {
      for (const translation of translations) {
        await tx.blogTranslation.upsert({
          where: {
            blogId_locale: { blogId: id, locale: translation.locale },
          },
          create: { blogId: id, ...translation },
          update: {
            title: translation.title,
            excerpt: translation.excerpt,
            bodyHtml: translation.bodyHtml,
            bodyJson: translation.bodyJson,
            metaTitle: translation.metaTitle,
            metaDescription: translation.metaDescription,
            category: translation.category,
            tag: translation.tag,
          },
        });
      }

      // Drop Arabic translation when cleared.
      const ar = translations.find((item) => item.locale === 'ar');
      if (!ar) {
        await tx.blogTranslation.deleteMany({ where: { blogId: id, locale: 'ar' } });
      }

      return tx.blog.update({
        where: { id },
        data: {
          slug,
          status,
          heroMediaId,
          publishedAt,
        },
        include: blogInclude,
      });
    });

    return {
      success: true,
      data: { blog: this.serialize(updated) },
      message: 'Blog saved.',
    };
  }

  async remove(id: string) {
    const existing = await this.prisma.blog.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Blog not found.');

    await this.prisma.blog.delete({ where: { id } });
    return {
      success: true,
      data: { id },
      message: 'Blog deleted.',
    };
  }

  private buildTranslations(body: UpsertAdminCmsBlogDto, name: string) {
    const nameAr = this.nullableTrim(body.name_ar);
    const titleEn = this.nullableTrim(body.title) ?? name;
    const titleAr = this.nullableTrim(body.title_ar) ?? nameAr;
    const excerptEn = this.nullableTrim(body.excerpt);
    const excerptAr = this.nullableTrim(body.excerpt_ar);
    const bodyHtmlEn = this.nullableHtml(body.body_html);
    const bodyHtmlAr = this.nullableHtml(body.body_html_ar);
    const categoryEn = this.nullableTrim(body.category);
    const categoryAr = this.nullableTrim(body.category_ar);
    const metaDescriptionEn = this.nullableTrim(body.meta_description) ?? excerptEn;
    const metaDescriptionAr = this.nullableTrim(body.meta_description_ar) ?? excerptAr;

    const translations: Array<{
      locale: string;
      title: string;
      excerpt: string | null;
      bodyHtml: string | null;
      bodyJson: Prisma.InputJsonValue;
      metaTitle: string | null;
      metaDescription: string | null;
      category: string | null;
      tag: string | null;
    }> = [
      {
        locale: 'en',
        title: name,
        excerpt: excerptEn,
        bodyHtml: bodyHtmlEn,
        bodyJson: this.htmlToBodyJson(bodyHtmlEn),
        metaTitle: titleEn,
        metaDescription: metaDescriptionEn,
        category: categoryEn,
        tag: categoryEn,
      },
    ];

    if (nameAr) {
      translations.push({
        locale: 'ar',
        title: nameAr,
        excerpt: excerptAr,
        bodyHtml: bodyHtmlAr,
        bodyJson: this.htmlToBodyJson(bodyHtmlAr),
        metaTitle: titleAr,
        metaDescription: metaDescriptionAr,
        category: categoryAr,
        tag: categoryAr,
      });
    }

    return translations;
  }

  private async saveHeroImage(
    dataUrl: string | null | undefined,
    fileName: string | null | undefined,
    adminUserId: string,
  ) {
    if (!dataUrl?.trim()) return null;
    const media = await this.mediaStorage.uploadDataUrl({
      folder: 'blogs',
      dataUrl,
      fileName: fileName?.trim() || undefined,
      maxBytes: 10 * 1024 * 1024,
      allowJpgAlias: true,
      altText: fileName?.trim() || null,
      uploadedByUserId: adminUserId,
      errorLabel: 'blog image',
    });
    return media.id;
  }

  private serialize(blog: BlogRecord): AdminCmsBlogSerialized {
    const en = this.pickTranslation(blog.translations, 'en');
    const ar = this.pickTranslation(blog.translations, 'ar');

    return {
      id: blog.id,
      name: en?.title ?? blog.slug,
      name_ar: ar?.title ?? null,
      title: en?.metaTitle ?? null,
      title_ar: ar?.metaTitle ?? null,
      slug: blog.slug,
      status: blog.status,
      excerpt: en?.excerpt ?? null,
      excerpt_ar: ar?.excerpt ?? null,
      body_html: en?.bodyHtml ?? null,
      body_html_ar: ar?.bodyHtml ?? null,
      category: en?.category ?? null,
      category_ar: ar?.category ?? null,
      meta_description: en?.metaDescription ?? null,
      meta_description_ar: ar?.metaDescription ?? null,
      image_url: blog.heroMedia?.url ?? null,
      published_at: blog.publishedAt?.toISOString() ?? null,
      created_at: blog.createdAt.toISOString(),
      updated_at: blog.updatedAt.toISOString(),
    };
  }

  private pickTranslation<T extends { locale: string }>(translations: T[], locale: string) {
    return (
      translations.find((item) => item.locale === locale) ??
      (locale === 'en' ? translations[0] : undefined) ??
      null
    );
  }

  private async assertSlugAvailable(slug: string, excludeId?: string) {
    const existing = await this.prisma.blog.findUnique({ where: { slug } });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException('A blog with this slug already exists.');
    }
  }

  private normalizeSlug(value: string | null | undefined) {
    if (value == null) return null;
    const slug = this.slugify(value);
    return slug || null;
  }

  private slugify(value: string) {
    return value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 180);
  }

  private nullableTrim(value: string | null | undefined) {
    if (value == null) return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private nullableHtml(value: string | null | undefined) {
    return sanitizeCmsHtmlOrNull(value);
  }

  private htmlToBodyJson(html: string | null): Prisma.InputJsonValue {
    if (!html) return [];
    const lines = html
      .replace(/<\/p>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .split(/\n+/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    return lines;
  }
}
