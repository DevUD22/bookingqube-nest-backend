import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { HomepageFaq, PublishStatus } from '@prisma/client';

import { sanitizeCmsHtmlOrNull } from '../../common/html/sanitize-cms-html';
import { PrismaService } from '../../database/prisma.service';
import { ReorderHomepageFaqsDto, UpsertHomepageFaqDto } from './dto/admin-homepage-faq.dto';

type HomepageFaqLocale = 'en' | 'ar';

@Injectable()
export class AdminHomepageFaqsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(locale?: string) {
    const normalizedLocale = locale ? this.normalizeLocale(locale) : undefined;
    const items = await this.prisma.homepageFaq.findMany({
      where: normalizedLocale ? { locale: normalizedLocale } : undefined,
      orderBy: [{ locale: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    return {
      success: true,
      data: { items: items.map((item) => this.serialize(item)) },
    };
  }

  async create(body: UpsertHomepageFaqDto) {
    const locale = this.normalizeLocale(body.locale);
    const created = await this.prisma.homepageFaq.create({
      data: {
        locale,
        question: body.question.trim(),
        answer: sanitizeCmsHtmlOrNull(body.answer) ?? '',
        status: (body.status as PublishStatus | undefined) ?? PublishStatus.published,
        sortOrder: body.sort_order ?? (await this.nextSortOrder(locale)),
      },
    });

    return {
      success: true,
      data: { item: this.serialize(created) },
      message: 'Homepage FAQ created.',
    };
  }

  async update(id: string, body: UpsertHomepageFaqDto) {
    const existing = await this.prisma.homepageFaq.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Homepage FAQ not found.');

    const updated = await this.prisma.homepageFaq.update({
      where: { id },
      data: {
        locale: this.normalizeLocale(body.locale),
        question: body.question.trim(),
        answer: sanitizeCmsHtmlOrNull(body.answer) ?? '',
        status: (body.status as PublishStatus | undefined) ?? existing.status,
        sortOrder: body.sort_order ?? existing.sortOrder,
      },
    });

    return {
      success: true,
      data: { item: this.serialize(updated) },
      message: 'Homepage FAQ updated.',
    };
  }

  async remove(id: string) {
    const existing = await this.prisma.homepageFaq.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Homepage FAQ not found.');

    await this.prisma.homepageFaq.delete({ where: { id } });
    return {
      success: true,
      data: { id },
      message: 'Homepage FAQ deleted.',
    };
  }

  async reorder(body: ReorderHomepageFaqsDto) {
    const locale = this.normalizeLocale(body.locale);
    const rows = await this.prisma.homepageFaq.findMany({
      where: { id: { in: body.ids } },
      select: { id: true, locale: true },
    });

    if (rows.length !== body.ids.length) {
      throw new BadRequestException('One or more homepage FAQs were not found.');
    }
    if (rows.some((row) => row.locale !== locale)) {
      throw new BadRequestException('All reordered FAQs must use the selected language.');
    }

    await this.prisma.$transaction(
      body.ids.map((id, sortOrder) =>
        this.prisma.homepageFaq.update({ where: { id }, data: { sortOrder } }),
      ),
    );

    return this.list(locale);
  }

  private normalizeLocale(locale: string): HomepageFaqLocale {
    const normalized = locale.trim().toLowerCase();
    if (normalized !== 'en' && normalized !== 'ar') {
      throw new BadRequestException('Locale must be en or ar.');
    }
    return normalized;
  }

  private async nextSortOrder(locale: HomepageFaqLocale) {
    const latest = await this.prisma.homepageFaq.findFirst({
      where: { locale },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return (latest?.sortOrder ?? -1) + 1;
  }

  private serialize(item: HomepageFaq) {
    return {
      id: item.id,
      locale: item.locale,
      question: item.question,
      answer: item.answer,
      status: item.status,
      sort_order: item.sortOrder,
      created_at: item.createdAt.toISOString(),
      updated_at: item.updatedAt.toISOString(),
    };
  }
}
