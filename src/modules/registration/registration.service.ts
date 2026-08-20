import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  RegistrationFieldTypeDto,
  RegistrationFormDataDto,
  RegistrationFormFieldDto,
  RegistrationSubmitFailureDto,
  RegistrationSubmitSuccessDto,
} from './dto/registration-form.dto';

const defaultImageUrl = 'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4';

const registrationFormInclude = {
  event: {
    include: {
      translations: true,
      venue: {
        include: {
          translations: true,
        },
      },
      primaryMedia: true,
      media: {
        include: {
          mediaAsset: true,
        },
        orderBy: {
          sortOrder: 'asc',
        },
      },
    },
  },
  fields: {
    orderBy: {
      sortOrder: 'asc',
    },
  },
} satisfies Prisma.RegistrationFormInclude;

type RegistrationFormRecord = Prisma.RegistrationFormGetPayload<{
  include: typeof registrationFormInclude;
}>;

type RegistrationFieldRecord = RegistrationFormRecord['fields'][number];

interface SubmitInput {
  event_id?: number | string;
  slug?: string;
  fields?: Record<string, unknown>;
}

@Injectable()
export class RegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async getRegistrationForm(slugOrId: string, lang: string): Promise<RegistrationFormDataDto> {
    const locale = this.normalizeLocale(lang);
    const form = await this.findPublishedForm(slugOrId);

    if (!form) {
      throw new NotFoundException('Registration form not found');
    }

    return this.toRegistrationFormDataDto(form, locale);
  }

  async submitRegistrationForm(
    body: unknown,
  ): Promise<RegistrationSubmitSuccessDto | RegistrationSubmitFailureDto> {
    const input = this.normalizeSubmitInput(body);
    const form = await this.findFormForSubmit(input);

    if (!form) {
      throw new NotFoundException('Registration form not found');
    }

    const validationErrors = this.validateSubmissionFields(form.fields, input.fields);
    if (Object.keys(validationErrors).length > 0) {
      return {
        success: false,
        message: 'Please correct the highlighted fields.',
        errors: validationErrors,
      };
    }

    const guestUser = await this.findOrCreateGuestUser(form, input.fields);
    const registrationNo = this.buildRegistrationNo();

    await this.prisma.registrationSubmission.create({
      data: {
        formId: form.id,
        eventId: form.eventId,
        customerId: guestUser.id,
        status: 'submitted',
        metadata: {
          registration_no: registrationNo,
          source: 'public_registration_form',
        },
        values: {
          create: form.fields.map((field) => {
            const rawValue = input.fields[String(this.toNumericId(field.id))] ?? input.fields[field.fieldKey];
            const normalizedValue = this.normalizeFieldValue(rawValue);

            return {
              fieldId: field.id,
              valueText: Array.isArray(normalizedValue) ? null : normalizedValue,
              valueJson: Array.isArray(normalizedValue) ? normalizedValue : undefined,
            };
          }),
        },
      },
    });

    const emailSent = await this.mailService.sendEventRegistrationEmailSafe({
      to: guestUser.email,
      customerName: guestUser.name || 'Guest',
      registrationNo,
      eventId: form.eventId,
    });

    return {
      success: true,
      message: 'Registration submitted successfully.',
      data: {
        event_id: this.toNumericId(form.eventId),
        registration_no: registrationNo,
        qrcode_url: null,
        email_sent: emailSent,
        created_count: 1,
        failed_count: 0,
        registrations: [
          {
            registration_no: registrationNo,
            qrcode_url: null,
            email_sent: emailSent,
          },
        ],
        errors: [],
      },
    };
  }

  private async findPublishedForm(slugOrId: string) {
    const numericId = Number.parseInt(slugOrId, 10);

    const forms = await this.prisma.registrationForm.findMany({
      where: {
        status: 'published',
        event: {
          status: 'published',
          bookingMode: 'registration',
          OR: [
            { slug: slugOrId },
            ...(Number.isFinite(numericId) ? [] : []),
          ],
        },
      },
      include: registrationFormInclude,
      take: 50,
    });

    return (
      forms.find(
        (form) => form.event.slug === slugOrId || String(this.toNumericId(form.eventId)) === slugOrId,
      ) ??
      null
    );
  }

  private async findFormForSubmit(input: SubmitInput) {
    if (input.slug) {
      return this.findPublishedForm(input.slug);
    }

    if (input.event_id === undefined || input.event_id === null) {
      throw new BadRequestException('event_id or slug is required.');
    }

    return this.findPublishedForm(String(input.event_id));
  }

  private toRegistrationFormDataDto(
    form: RegistrationFormRecord,
    locale: string,
  ): RegistrationFormDataDto {
    const event = form.event;
    const translation = this.pickTranslation(event.translations, locale);
    const venueTranslation = event.venue ? this.pickTranslation(event.venue.translations, locale) : null;
    const image = event.primaryMedia?.url ?? event.media[0]?.mediaAsset.url ?? defaultImageUrl;
    const startDate = event.startsAt ? this.toDateKey(event.startsAt) : null;
    const endDate = event.endsAt ? this.toDateKey(event.endsAt) : null;

    return {
      event: {
        id: String(this.toNumericId(event.id)),
        slug: event.slug,
        title: translation?.title ?? event.slug,
        description: translation?.description ?? translation?.subtitle ?? '',
        date_label: event.startsAt ? this.formatDateLabel(event.startsAt, locale) : '',
        start_date: startDate,
        end_date: endDate,
        venue: venueTranslation?.name ?? event.venue?.name ?? '',
        location: venueTranslation?.address ?? event.venue?.address ?? event.venue?.city ?? 'Qatar',
        banner_image_url: image,
        event_type: 'registration_only',
        is_registration_only: true,
        booking_mode: 'registration',
        private_registration: false,
        enable_registration_mail: true,
      },
      registration_form_fields: form.fields.map((field) => this.toFieldDto(field)),
      file_fields: form.fields
        .filter((field) => field.fieldType === 'file')
        .map((field) => String(this.toNumericId(field.id))),
    };
  }

  private toFieldDto(field: RegistrationFieldRecord): RegistrationFormFieldDto {
    const options = this.toStringArray(field.optionsJson);
    const defaultValue =
      field.optionsJson &&
      typeof field.optionsJson === 'object' &&
      !Array.isArray(field.optionsJson) &&
      typeof field.optionsJson.default_value === 'string'
        ? field.optionsJson.default_value
        : undefined;

    return {
      id: this.toNumericId(field.id),
      label: field.label,
      field_name: field.fieldKey,
      field_type: this.toFrontendFieldType(field.fieldType),
      field_options: options,
      is_required: field.required,
      is_unique: false,
      sort_order: field.sortOrder,
      is_hidden: false,
      default_value: defaultValue,
      file_size: null,
      file_type: null,
    };
  }

  private normalizeSubmitInput(body: unknown): SubmitInput & { fields: Record<string, unknown> } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Invalid registration payload.');
    }

    const input = body as SubmitInput;

    return {
      event_id: input.event_id,
      slug: typeof input.slug === 'string' ? input.slug : '',
      fields:
        input.fields && typeof input.fields === 'object' && !Array.isArray(input.fields)
          ? input.fields
          : {},
    };
  }

  private validateSubmissionFields(
    fields: RegistrationFieldRecord[],
    values: Record<string, unknown>,
  ) {
    const errors: Record<string, string> = {};

    for (const field of fields) {
      const numericFieldId = String(this.toNumericId(field.id));
      const value = values[numericFieldId] ?? values[field.fieldKey];
      const normalizedValue = this.normalizeFieldValue(value);

      if (field.required && this.isEmptyValue(normalizedValue)) {
        errors[numericFieldId] = `${field.label} is required.`;
        continue;
      }

      if (this.isEmptyValue(normalizedValue)) {
        continue;
      }

      if (field.fieldType === 'email' && typeof normalizedValue === 'string') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedValue)) {
          errors[numericFieldId] = 'Please enter a valid email address.';
        }
      }
    }

    return errors;
  }

  private async findOrCreateGuestUser(
    form: RegistrationFormRecord,
    values: Record<string, unknown>,
  ) {
    const emailField = form.fields.find((field) => field.fieldType === 'email');
    const phoneField = form.fields.find((field) => field.fieldType === 'phone');
    const nameField = form.fields.find((field) => field.fieldKey.includes('name'));
    const email = emailField
      ? this.getFieldString(values, emailField) || this.buildGuestEmail()
      : this.buildGuestEmail();
    const phone = phoneField ? this.getFieldString(values, phoneField) || null : null;
    const name = nameField ? this.getFieldString(values, nameField) || 'Guest Registrant' : 'Guest Registrant';

    return this.prisma.user.upsert({
      where: {
        email,
      },
      update: {
        name,
        phone,
      },
      create: {
        email,
        phone,
        name,
        status: 'active',
      },
    });
  }

  private getFieldString(values: Record<string, unknown>, field: RegistrationFieldRecord) {
    const rawValue = values[String(this.toNumericId(field.id))] ?? values[field.fieldKey];
    const normalized = this.normalizeFieldValue(rawValue);
    return typeof normalized === 'string' ? normalized.trim() : '';
  }

  private normalizeFieldValue(value: unknown): string | string[] {
    if (Array.isArray(value)) {
      return value.map((item) => String(item)).filter((item) => item.trim() !== '');
    }

    if (value === null || value === undefined) {
      return '';
    }

    return String(value).trim();
  }

  private isEmptyValue(value: string | string[]) {
    return Array.isArray(value) ? value.length === 0 : value.trim() === '';
  }

  private toFrontendFieldType(fieldType: RegistrationFieldRecord['fieldType']): RegistrationFieldTypeDto {
    if (fieldType === 'select') {
      return 'dropdown';
    }

    if (fieldType === 'number' || fieldType === 'date') {
      return 'text';
    }

    return fieldType;
  }

  private toStringArray(value: Prisma.JsonValue | null | undefined) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
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

  private toNumericId(id: string) {
    return Number.parseInt(id.replace(/-/g, '').slice(0, 8), 16);
  }

  private buildRegistrationNo() {
    const random = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `BQ-REG-${new Date().getFullYear()}-${random}`;
  }

  private buildGuestEmail() {
    return `guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@bookingqube.local`;
  }
}
