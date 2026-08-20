import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import {
  BlogCategoryDto,
  BlogDetailDto,
  BlogNavPostDto,
  BlogRecentPostDto,
} from './dto/blog-detail.dto';

const defaultImageUrl = 'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4';

const blogInclude = {
  author: true,
  heroMedia: true,
  translations: true,
} satisfies Prisma.BlogInclude;

type BlogRecord = Prisma.BlogGetPayload<{
  include: typeof blogInclude;
}>;

@Injectable()
export class BlogsService {
  constructor(private readonly prisma: PrismaService) {}

  async getBlogDetail(slug: string, lang: string): Promise<BlogDetailDto> {
    const locale = this.normalizeLocale(lang);
    const blog = await this.prisma.blog.findFirst({
      where: {
        slug,
        status: 'published',
      },
      include: blogInclude,
    });

    if (!blog) {
      throw new NotFoundException('Blog post not found');
    }

    const [recentPosts, allBlogs] = await Promise.all([
      this.prisma.blog.findMany({
        where: {
          status: 'published',
          slug: {
            not: slug,
          },
        },
        include: blogInclude,
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        take: 4,
      }),
      this.prisma.blog.findMany({
        where: {
          status: 'published',
        },
        include: {
          translations: true,
        },
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);

    return this.toBlogDetailDto(blog, recentPosts, allBlogs, locale);
  }

  private toBlogDetailDto(
    blog: BlogRecord,
    recentPosts: BlogRecord[],
    allBlogs: Array<Pick<BlogRecord, 'id' | 'slug' | 'publishedAt' | 'createdAt' | 'translations'>>,
    locale: string,
  ): BlogDetailDto {
    const translation = this.pickTranslation(blog.translations, locale);
    const publishedDate = blog.publishedAt ?? blog.createdAt;
    const content = this.getBodyLines(translation?.bodyJson);
    const body = translation?.bodyHtml ?? content.map((line) => `<p>${line}</p>`).join('');
    const orderedBlogs = [...allBlogs].sort(
      (left, right) => this.getPublishedTime(right) - this.getPublishedTime(left),
    );
    const currentIndex = orderedBlogs.findIndex((item) => item.id === blog.id);

    return {
      id: this.toNumericId(blog.id),
      slug: blog.slug,
      tag: translation?.tag ?? translation?.category ?? 'Blog',
      category: translation?.category ?? 'Blog',
      title: translation?.title ?? blog.slug,
      seo_title: translation?.metaTitle ?? translation?.title ?? blog.slug,
      meta: translation?.metaDescription ?? translation?.excerpt ?? '',
      published_date: this.toDateKey(publishedDate),
      published_date_label: this.formatDateLabel(publishedDate, locale),
      reading_time_minutes: this.estimateReadingTime(body),
      views: 0,
      author: blog.authorName?.trim() || blog.author?.name || 'BookingQube',
      excerpt: translation?.excerpt ?? '',
      image: blog.heroMedia?.url ?? defaultImageUrl,
      content,
      body,
      recent_posts: recentPosts.map((post) => this.toRecentPostDto(post, locale)),
      categories: this.toCategoryDtos(allBlogs, locale),
      prev_post:
        currentIndex >= 0 && orderedBlogs[currentIndex + 1]
          ? this.toNavPostDto(orderedBlogs[currentIndex + 1], locale)
          : null,
      next_post:
        currentIndex > 0 && orderedBlogs[currentIndex - 1]
          ? this.toNavPostDto(orderedBlogs[currentIndex - 1], locale)
          : null,
    };
  }

  private toRecentPostDto(blog: BlogRecord, locale: string): BlogRecentPostDto {
    const translation = this.pickTranslation(blog.translations, locale);

    return {
      id: this.toNumericId(blog.id),
      slug: blog.slug,
      title: translation?.title ?? blog.slug,
      published_date: this.toDateKey(blog.publishedAt ?? blog.createdAt),
      thumbnail_url: blog.heroMedia?.url ?? defaultImageUrl,
    };
  }

  private toCategoryDtos(
    blogs: Array<Pick<BlogRecord, 'translations'>>,
    locale: string,
  ): BlogCategoryDto[] {
    const counts = new Map<string, { name: string; count: number }>();

    for (const blog of blogs) {
      const translation = this.pickTranslation(blog.translations, locale);
      const name = translation?.category ?? 'Blog';
      const slug = this.slugify(name);
      const current = counts.get(slug);
      counts.set(slug, {
        name,
        count: (current?.count ?? 0) + 1,
      });
    }

    return Array.from(counts.entries()).map(([slug, value], index) => ({
      id: index + 1,
      name: value.name,
      slug,
      post_count: value.count,
      color: ['violet', 'amber', 'emerald', 'rose', 'sky'][index % 5],
    }));
  }

  private toNavPostDto(
    blog: Pick<BlogRecord, 'slug' | 'translations'>,
    locale: string,
  ): BlogNavPostDto {
    const translation = this.pickTranslation(blog.translations, locale);
    return {
      slug: blog.slug,
      title: translation?.title ?? blog.slug,
    };
  }

  private getBodyLines(value: Prisma.JsonValue | null | undefined) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
  }

  private estimateReadingTime(body: string) {
    const words = body
      .replace(/<[^>]+>/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 200));
  }

  private normalizeLocale(locale: string) {
    return locale.trim().toLowerCase() === 'ar' ? 'ar' : 'en';
  }

  private pickTranslation<T extends { locale: string }>(translations: T[], locale: string) {
    return (
      translations.find((translation) => translation.locale === locale) ??
      translations.find((translation) => translation.locale === 'en') ??
      translations[0] ??
      null
    );
  }

  private formatDateLabel(date: Date, locale: string) {
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(date);
  }

  private toDateKey(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  private getPublishedTime(blog: Pick<BlogRecord, 'publishedAt' | 'createdAt'>) {
    return (blog.publishedAt ?? blog.createdAt).getTime();
  }

  private toNumericId(id: string) {
    return Number.parseInt(id.replace(/-/g, '').slice(0, 8), 16);
  }

  private slugify(value: string) {
    return (
      value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\u0600-\u06ff]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'blog'
    );
  }
}
