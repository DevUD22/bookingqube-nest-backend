import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { OtpService } from '../src/modules/auth/otp.service';
import { HoldExpirationService } from '../src/modules/checkout/hold-expiration.service';
import { HealthService } from '../src/modules/health/health.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { ReportingService } from '../src/modules/reporting/reporting.service';

const sampleSlug = 'sample-family-experience';
const sampleDate = '2026-08-15';
const sampleTime = '10:00 AM';
const sampleRegistrationSlug = 'sample-registration-workshop';

const TEST_PASSWORD = 'TestPass123!';

async function registerAndLogin(
  app: NestFastifyApplication,
  email: string,
  password = TEST_PASSWORD,
): Promise<string> {
  await app.inject({
    method: 'POST',
    url: '/api/v2/register',
    payload: {
      name: 'E2E Tester',
      email,
      password,
      password_confirmation: password,
      accept: true,
    },
  });

  const loginResponse = await app.inject({
    method: 'POST',
    url: '/api/v2/login',
    payload: {
      email,
      password,
      device_name: 'jest',
    },
  });

  const body = JSON.parse(loginResponse.body);
  return body.token as string;
}

describe('Public API contracts (e2e)', () => {
  let app: NestFastifyApplication;
  let customerEmail: string;
  let customerToken: string;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.NODE_ENV ??= 'test';
    process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/bookingqube';
    process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
    process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
    process.env.POS_JWT_ACCESS_SECRET ??= 'test-pos-access-secret';
    process.env.CAFE_POS_JWT_ACCESS_SECRET ??= 'test-cafe-pos-access-secret';
    process.env.ADMIN_JWT_ACCESS_SECRET ??= 'test-admin-access-secret';
    process.env.ADMIN_JWT_REFRESH_SECRET ??= 'test-admin-refresh-secret';
    process.env.GOOGLE_OAUTH_CLIENT_ID ??= 'test-google-client-id';
    process.env.APPLE_OAUTH_CLIENT_ID ??= 'test-apple-client-id';
    process.env.BOOKING_JOBS_ENABLED = 'false';
    process.env.HOLD_EXPIRATION_WORKER_ENABLED = 'false';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v2');

    const healthService = app.get(HealthService);
    app
      .getHttpAdapter()
      .getInstance()
      .get('/health', async (_request, reply) => {
        return reply.send(await healthService.getHealth());
      });

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);

    customerEmail = `e2e-customer-${Date.now()}@example.com`;
    customerToken = await registerAndLogin(app, customerEmail);
  });

  afterAll(async () => {
    await app.close();
  });

  it('/health (GET)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      service: 'bookingqube-backend',
    });
  });

  it('/api/v2/health (GET)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/health',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      service: 'bookingqube-backend',
    });
  });

  it('/api/v2/events/:slug/detail (GET)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v2/events/${sampleSlug}/detail?lang=en`,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        slug: sampleSlug,
        title: 'Sample Family Experience',
        booking_mode: 'ticketed',
        currency: 'QAR',
        location: {
          venue_name: 'Doha Exhibition Center',
        },
        payment_methods: expect.any(Array),
      },
    });
  });

  it('/api/v2/events/:slug/detail payment_methods reflect admin-enabled gateways', async () => {
    await prisma.paymentGatewayConfig.updateMany({
      data: { enabled: false, isActive: false },
    });

    const emptyResponse = await app.inject({
      method: 'GET',
      url: `/api/v2/events/${sampleSlug}/detail?lang=en`,
    });
    expect(emptyResponse.statusCode).toBe(200);
    expect(JSON.parse(emptyResponse.body).data.payment_methods).toEqual([]);

    await prisma.paymentGatewayConfig.upsert({
      where: {
        gateway_environment: { gateway: 'myfatoorah', environment: 'sandbox' },
      },
      create: {
        gateway: 'myfatoorah',
        environment: 'sandbox',
        enabled: true,
        isActive: true,
        configJson: {
          api_key: 'test-key',
          country_iso: 'QAT',
        },
      },
      update: {
        enabled: true,
        isActive: true,
      },
    });
    await prisma.paymentGatewayConfig.upsert({
      where: {
        gateway_environment: { gateway: 'qpay', environment: 'live' },
      },
      create: {
        gateway: 'qpay',
        environment: 'live',
        enabled: true,
        isActive: true,
        configJson: {
          secret_key: 'qpay-secret',
          merchant_id: 'merchant',
        },
      },
      update: {
        enabled: true,
        isActive: true,
      },
    });

    const enabledResponse = await app.inject({
      method: 'GET',
      url: `/api/v2/events/${sampleSlug}/detail?lang=en`,
    });
    expect(enabledResponse.statusCode).toBe(200);
    expect(JSON.parse(enabledResponse.body).data.payment_methods).toEqual([
      { id: 10, name: 'Apple Pay' },
      { id: 11, name: 'Google Pay' },
      { id: 12, name: 'MyFatoorah Card' },
      { id: 7, name: 'NAPS' },
    ]);
  });

  it('/api/v2/book-ticket (POST) rejects disabled gateway payment methods', async () => {
    await prisma.paymentGatewayConfig.updateMany({
      where: { gateway: 'mastercard' },
      data: { enabled: false, isActive: false },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/book-ticket?lang=en',
      headers: {
        authorization: `Bearer ${customerToken}`,
      },
      payload: {
        event_slug: sampleSlug,
        schedule: {
          date: sampleDate,
          time: sampleTime,
        },
        tickets: [
          {
            ticket_id: 'child-pass',
            variant_id: null,
            quantity: 1,
            unit_price: 45,
          },
        ],
        payment_method: 8,
        totals: {
          subtotal: 45,
          discount_amount: 0,
          total: 45,
          currency: 'QAR',
        },
        customer: {
          user_id: null,
          name: 'Test Guest',
          email: `disabled-gateway-${Date.now()}@example.com`,
          phone: null,
        },
        metadata: {
          source: 'web',
          locale: 'en',
        },
        success_url: 'http://localhost:3000/success',
        failed_url: 'http://localhost:3000/fail',
        base_domain: 'http://localhost:3000',
        idempotency_key: `disabled-mc-${Date.now()}`,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).message).toMatch(/Mastercard/i);
  });

  it('/api/v2/homepage/hero-and-category-section (GET)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/homepage/hero-and-category-section?lang=en',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        hero_banners: [
          {
            title: 'Sample Family Experience',
            description: 'Seeded event for the new BookingQube backend',
            media_type: 'image',
            cta_link: `/events/${sampleSlug}`,
            tags: ['Experiences'],
          },
        ],
        categories: [
          {
            slug: 'experiences',
            name: 'Experiences',
          },
        ],
      },
    });
  });

  it('/api/v2/homepage/hero-and-category-section (GET) supports Arabic', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/homepage/hero-and-category-section?lang=ar',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        hero_banners: [
          {
            title: 'تجربة عائلية تجريبية',
            description: 'فعالية تجريبية للباكند الجديد',
            tags: ['التجارب'],
          },
        ],
        categories: [
          {
            slug: 'experiences',
            name: 'التجارب',
          },
        ],
      },
    });
  });

  it('/api/v2/homepage/sections (GET)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/homepage/sections?lang=en',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        sections: [
          {
            section_id: 'top-events',
            section_title: 'Top Events',
            view_all_link: '/events?sort=top',
            items: [
              {
                slug: sampleSlug,
                title: 'Sample Family Experience',
                price_from: 45,
                currency: 'QAR',
                event_type: 'general',
                booking_mode: 'ticketed',
                location: 'Doha Exhibition Center',
                tags: ['Experiences'],
                category_slug: 'experiences',
                status: 'best_seller',
                status_label: 'Best Seller',
              },
            ],
          },
          {
            section_id: 'venues',
            section_title: 'Venues',
            view_all_link: '/venues',
            items: [
              {
                slug: 'doha-exhibition-center',
                name: 'Doha Exhibition Center',
              },
            ],
          },
          {
            section_id: 'events-today',
            section_title: 'Events Today',
            view_all_link: '/event-listing-by-slug/events_today',
            items: [
              {
                slug: sampleSlug,
              },
            ],
          },
          {
            section_id: 'category-experiences',
            section_title: 'Experiences',
            view_all_link: '/event-listing-by-slug/experiences',
            items: [
              {
                slug: sampleSlug,
              },
            ],
          },
        ],
      },
    });
  });

  it('/api/v2/homepage/sections (GET) supports Arabic', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/homepage/sections?lang=ar',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        sections: [
          {
            section_id: 'top-events',
            section_title: 'أفضل الفعاليات',
            items: [
              {
                slug: sampleSlug,
                title: 'تجربة عائلية تجريبية',
                location: 'مركز الدوحة للمعارض',
                tags: ['التجارب'],
                category: 'التجارب',
                status: 'best_seller',
                status_label: 'الأكثر مبيعاً',
              },
            ],
          },
          {
            section_id: 'venues',
            section_title: 'الأماكن',
            items: [
              {
                slug: 'doha-exhibition-center',
                name: 'مركز الدوحة للمعارض',
              },
            ],
          },
          {
            section_id: 'events-today',
            section_title: 'فعاليات اليوم',
          },
          {
            section_id: 'category-experiences',
            section_title: 'التجارب',
          },
        ],
      },
    });
  });

  it('/api/v2/homepage/venues-section (GET)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/homepage/venues-section?lang=en',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: [
        {
          slug: 'doha-exhibition-center',
          name: 'Doha Exhibition Center',
          location: 'Doha, Qatar',
        },
      ],
    });
  });

  it('/api/v2/homepage/venues-section (GET) supports Arabic', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/homepage/venues-section?lang=ar',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: [
        {
          slug: 'doha-exhibition-center',
          name: 'مركز الدوحة للمعارض',
          location: 'الدوحة، قطر',
        },
      ],
    });
  });

  it('/api/v2/homepage/feeds (GET)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/homepage/feeds?lang=en',
    });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      success: true,
      data: {
        promotions: [
          {
            title: 'Family Day Out Offer',
            subtitle: 'Save on selected family experiences',
            cta_url: '/promos/family-day-out-offer',
          },
        ],
        blog_posts: [
          {
            slug: 'planning-a-family-day-out',
            title: 'Planning a Family Day Out in Qatar',
            published_date: '2026-07-01',
            author: 'BookingQube Admin',
          },
        ],
      },
    });
    expect(body.data.faqs[0]).toMatchObject({
      question: 'How do I book an event?',
    });
  });

  it('/api/v2/homepage/feeds (GET) supports Arabic', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/homepage/feeds?lang=ar',
    });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      success: true,
      data: {
        promotions: [
          {
            title: 'عرض اليوم العائلي',
            subtitle: 'وفّر على تجارب عائلية مختارة',
            cta_url: '/promos/family-day-out-offer',
          },
        ],
        blog_posts: [
          {
            slug: 'planning-a-family-day-out',
            title: 'التخطيط ليوم عائلي في قطر',
            author: 'BookingQube Admin',
          },
        ],
      },
    });
    expect(body.data.faqs[0]).toMatchObject({
      question: 'كيف أحجز فعالية؟',
    });
  });

  it('/api/v2/homepage/offers-detail/:slug (GET)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/homepage/offers-detail/family-day-out-offer?lang=en',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        slug: 'family-day-out-offer',
        title: 'Family Day Out Offer',
        subtitle: 'Save on selected family experiences',
        category: 'Family',
        isFeatured: true,
        tags: ['Family', 'Experiences', 'Qatar'],
        tag: 'Limited offer',
        validTill: '2026-12-31',
        events: [
          {
            slug: sampleSlug,
            name: 'Sample Family Experience',
          },
        ],
      },
    });
  });

  it('/api/v2/homepage/offers-detail/:slug (GET) supports Arabic', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/homepage/offers-detail/family-day-out-offer?lang=ar',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        slug: 'family-day-out-offer',
        title: 'عرض اليوم العائلي',
        subtitle: 'وفّر على تجارب عائلية مختارة',
        category: 'العائلة',
        tags: ['العائلة', 'التجارب', 'قطر'],
        tag: 'عرض محدود',
        events: [
          {
            slug: sampleSlug,
            name: 'تجربة عائلية تجريبية',
          },
        ],
      },
    });
  });

  it('/api/v2/homepage/offers-detail/:slug (GET) returns 404 for missing offer', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/homepage/offers-detail/missing-offer?lang=en',
    });

    expect(response.statusCode).toBe(404);
  });

  it('/api/v2/registration-form/:slugOrId (GET)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v2/registration-form/${sampleRegistrationSlug}?lang=en`,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        event: {
          slug: sampleRegistrationSlug,
          title: 'Sample Registration Workshop',
          event_type: 'registration_only',
          is_registration_only: true,
          booking_mode: 'registration',
          venue: 'Doha Exhibition Center',
        },
        registration_form_fields: [
          {
            label: 'Full name',
            field_name: 'full_name',
            field_type: 'text',
            is_required: true,
          },
          {
            label: 'Email address',
            field_name: 'email',
            field_type: 'email',
            is_required: true,
          },
          {
            label: 'Attendance preference',
            field_name: 'attendance_preference',
            field_type: 'dropdown',
            field_options: ['In person', 'Online'],
          },
        ],
      },
    });
  });

  it('/api/v2/registration-form/:slugOrId (GET) supports Arabic', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v2/registration-form/${sampleRegistrationSlug}?lang=ar`,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        event: {
          slug: sampleRegistrationSlug,
          title: 'ورشة تسجيل تجريبية',
          venue: 'مركز الدوحة للمعارض',
        },
      },
    });
  });

  it('/api/v2/registration-form/:slugOrId (GET) returns 404 for missing form', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/registration-form/missing-registration?lang=en',
    });

    expect(response.statusCode).toBe(404);
  });

  it('/api/v2/registration-form/submit (POST) validates required fields', async () => {
    const formResponse = await app.inject({
      method: 'GET',
      url: `/api/v2/registration-form/${sampleRegistrationSlug}?lang=en`,
    });
    const formBody = JSON.parse(formResponse.body);
    const nameField = formBody.data.registration_form_fields.find(
      (field: { field_name: string }) => field.field_name === 'full_name',
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/registration-form/submit',
      payload: {
        slug: sampleRegistrationSlug,
        event_id: formBody.data.event.id,
        fields: {
          [String(nameField.id)]: '',
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body)).toMatchObject({
      success: false,
      errors: {
        [String(nameField.id)]: 'Full name is required.',
      },
    });
  });

  it('/api/v2/registration-form/submit (POST)', async () => {
    const formResponse = await app.inject({
      method: 'GET',
      url: `/api/v2/registration-form/${sampleRegistrationSlug}?lang=en`,
    });
    const formBody = JSON.parse(formResponse.body);
    const fields = formBody.data.registration_form_fields as Array<{
      id: number;
      field_name: string;
    }>;
    const fieldIdByName = new Map(fields.map((field) => [field.field_name, field.id]));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/registration-form/submit',
      payload: {
        slug: sampleRegistrationSlug,
        event_id: formBody.data.event.id,
        fields: {
          [String(fieldIdByName.get('full_name'))]: 'Test Registrant',
          [String(fieldIdByName.get('email'))]: `registrant-${Date.now()}@example.com`,
          [String(fieldIdByName.get('attendance_preference'))]: 'In person',
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        event_id: Number(formBody.data.event.id),
        email_sent: false,
        created_count: 1,
        failed_count: 0,
      },
    });
    expect(JSON.parse(response.body).data.registration_no).toMatch(/^BQ-REG-/);
  });

  it('/api/v2/promocodes/apply (POST)', async () => {
    const ticketsResponse = await app.inject({
      method: 'GET',
      url: `/api/v2/events/${sampleSlug}/tickets?date=${sampleDate}&time=${encodeURIComponent(
        sampleTime,
      )}&lang=en`,
    });
    const ticketsBody = JSON.parse(ticketsResponse.body);
    const childTicket = ticketsBody.data.tickets.find(
      (ticket: { title: string }) => ticket.title === 'Child Pass',
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/promocodes/apply?lang=en',
      payload: {
        code: 'family10',
        event_slug: sampleSlug,
        selected_tickets: [
          {
            ticket_id: childTicket.ticket_id,
            variant_id: null,
            quantity: 2,
            unit_price: 45,
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      valid: true,
      code: 'FAMILY10',
      discount_type: 'total_order',
      summary_label: '10% off',
      total_discount_text: 'QAR 9.00',
      total_discount_amount: 9,
      currency: 'QAR',
      applied_breakdown: [
        {
          target_type: 'ticket',
          target_id: childTicket.ticket_id,
          discount_applied_per_unit: 4.5,
          total_item_discount: 9,
        },
      ],
    });
  });

  it('/api/v2/promocodes/apply (POST) supports Arabic labels', async () => {
    const ticketsResponse = await app.inject({
      method: 'GET',
      url: `/api/v2/events/${sampleSlug}/tickets?date=${sampleDate}&time=${encodeURIComponent(
        sampleTime,
      )}&lang=en`,
    });
    const ticketsBody = JSON.parse(ticketsResponse.body);
    const adultTicket = ticketsBody.data.tickets.find(
      (ticket: { title: string }) => ticket.title === 'Adult Pass',
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/promocodes/apply?lang=ar',
      payload: {
        code: 'FAMILY10',
        event_slug: sampleSlug,
        selected_tickets: [
          {
            ticket_id: adultTicket.ticket_id,
            variant_id: null,
            quantity: 1,
            unit_price: 75,
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      valid: true,
      code: 'FAMILY10',
      summary_label: 'خصم 10%',
      total_discount_amount: 7.5,
    });
  });

  it('/api/v2/promocodes/apply (POST) applies ticket-specific promo codes', async () => {
    const ticketsResponse = await app.inject({
      method: 'GET',
      url: `/api/v2/events/${sampleSlug}/tickets?date=${sampleDate}&time=${encodeURIComponent(
        sampleTime,
      )}&lang=en`,
    });
    const ticketsBody = JSON.parse(ticketsResponse.body);
    const childTicket = ticketsBody.data.tickets.find(
      (ticket: { title: string }) => ticket.title === 'Child Pass',
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/promocodes/apply?lang=en',
      payload: {
        code: 'CHILD5',
        event_slug: sampleSlug,
        selected_tickets: [
          {
            ticket_id: childTicket.ticket_id,
            variant_id: null,
            quantity: 2,
            unit_price: 45,
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      valid: true,
      code: 'CHILD5',
      discount_type: 'ticket_specific',
      summary_label: 'QAR 5.00 off',
      total_discount_text: 'QAR 10.00',
      total_discount_amount: 10,
      applied_breakdown: [
        {
          target_type: 'ticket_specific',
          target_id: childTicket.ticket_id,
          discount_applied_per_unit: 5,
          total_item_discount: 10,
        },
      ],
    });
  });

  it('/api/v2/promocodes/apply (POST) rejects ticket-specific promo codes for other tickets', async () => {
    const ticketsResponse = await app.inject({
      method: 'GET',
      url: `/api/v2/events/${sampleSlug}/tickets?date=${sampleDate}&time=${encodeURIComponent(
        sampleTime,
      )}&lang=en`,
    });
    const ticketsBody = JSON.parse(ticketsResponse.body);
    const adultTicket = ticketsBody.data.tickets.find(
      (ticket: { title: string }) => ticket.title === 'Adult Pass',
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/promocodes/apply?lang=en',
      payload: {
        code: 'CHILD5',
        event_slug: sampleSlug,
        selected_tickets: [
          {
            ticket_id: adultTicket.ticket_id,
            variant_id: null,
            quantity: 1,
            unit_price: 75,
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      valid: false,
      code: 'CHILD5',
      message: 'This promo code is not valid for the selected tickets.',
    });
  });

  it('/api/v2/promocodes/apply (POST) applies variant-specific promo codes', async () => {
    const ticketsResponse = await app.inject({
      method: 'GET',
      url: `/api/v2/events/${sampleSlug}/tickets?date=${sampleDate}&time=${encodeURIComponent(
        sampleTime,
      )}&lang=en`,
    });
    const ticketsBody = JSON.parse(ticketsResponse.body);
    const vipTicket = ticketsBody.data.tickets.find(
      (ticket: { title: string }) => ticket.title === 'VIP Pass',
    );
    const morningVariant = vipTicket.variants.find(
      (variant: { name: string }) => variant.name === 'VIP Morning',
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/promocodes/apply?lang=en',
      payload: {
        code: 'VIPMORNING15',
        event_slug: sampleSlug,
        selected_tickets: [
          {
            ticket_id: vipTicket.ticket_id,
            variant_id: morningVariant.variant_id,
            quantity: 2,
            unit_price: 100,
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      valid: true,
      code: 'VIPMORNING15',
      discount_type: 'ticket_specific',
      summary_label: '15% off',
      total_discount_text: 'QAR 30.00',
      total_discount_amount: 30,
      applied_breakdown: [
        {
          target_type: 'ticket_specific',
          target_id: morningVariant.variant_id,
          discount_applied_per_unit: 15,
          total_item_discount: 30,
        },
      ],
    });
  });

  it('/api/v2/promocodes/apply (POST) rejects variant-specific promo codes for other variants', async () => {
    const ticketsResponse = await app.inject({
      method: 'GET',
      url: `/api/v2/events/${sampleSlug}/tickets?date=${sampleDate}&time=${encodeURIComponent(
        sampleTime,
      )}&lang=en`,
    });
    const ticketsBody = JSON.parse(ticketsResponse.body);
    const vipTicket = ticketsBody.data.tickets.find(
      (ticket: { title: string }) => ticket.title === 'VIP Pass',
    );
    const eveningVariant = vipTicket.variants.find(
      (variant: { name: string }) => variant.name === 'VIP Evening',
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/promocodes/apply?lang=en',
      payload: {
        code: 'VIPMORNING15',
        event_slug: sampleSlug,
        selected_tickets: [
          {
            ticket_id: vipTicket.ticket_id,
            variant_id: eveningVariant.variant_id,
            quantity: 1,
            unit_price: 120,
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      valid: false,
      code: 'VIPMORNING15',
      message: 'This promo code is not valid for the selected tickets.',
    });
  });

  it('/api/v2/promocodes/apply (POST) rejects invalid code', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/promocodes/apply?lang=en',
      payload: {
        code: 'NOPE',
        event_slug: sampleSlug,
        selected_tickets: [
          {
            ticket_id: 'ticket-id',
            variant_id: null,
            quantity: 1,
            unit_price: 45,
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      valid: false,
      code: 'NOPE',
      message: 'This promo code is invalid or inactive.',
    });
  });

  it('/api/v2/promocodes/apply (POST) rejects empty ticket selection', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/promocodes/apply?lang=en',
      payload: {
        code: 'FAMILY10',
        event_slug: sampleSlug,
        selected_tickets: [],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      valid: false,
      code: 'FAMILY10',
      message: 'Select at least one ticket before applying a promo code.',
    });
  });

  it('/api/v2/book-ticket (POST) creates a local pending order', async () => {
    const idempotencyKey = `test-book-${Date.now()}-${Math.random()}`;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/book-ticket?lang=en',
      headers: {
        authorization: `Bearer ${customerToken}`,
      },
      payload: {
        event_slug: sampleSlug,
        schedule: {
          date: sampleDate,
          time: sampleTime,
        },
        tickets: [
          {
            ticket_id: 'child-pass',
            variant_id: null,
            quantity: 2,
            unit_price: 0.01,
          },
        ],
        addons: [
          {
            addon_id: 'meal-combo',
            variant_id: null,
            quantity: 1,
            unit_price: 0.01,
          },
        ],
        promo_code: {
          code: 'CHILD5',
          ticket_id: 'child-pass',
          variant_id: null,
        },
        payment_method: 2,
        totals: {
          subtotal: 0.03,
          discount_amount: 0,
          total: 0.03,
          currency: 'USD',
        },
        waiver: {
          accepted: false,
          signed_by: null,
          accepted_at: null,
        },
        customer: {
          user_id: null,
          name: 'Test Guest',
          email: `book-${Date.now()}@example.com`,
          phone: null,
        },
        metadata: {
          source: 'web',
          locale: 'en',
        },
        success_url: 'http://localhost:3000/success',
        failed_url: 'http://localhost:3000/fail',
        base_domain: 'http://localhost:3000',
        idempotency_key: idempotencyKey,
      },
    });

    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      success: true,
      data: {
        redirect_required: false,
        payment_flow: 'local_pending',
        payment_method: 2,
        total: 105,
        currency: 'QAR',
        temp_order_id: idempotencyKey,
        status: 'pending_payment',
      },
    });
    expect(body.data.common_order).toMatch(/^BQ-/);
    expect(Array.isArray(body.data.ticket_orders)).toBe(true);
    expect(body.data.ticket_orders.length).toBeGreaterThan(0);
    expect(body.data.order_numbers).toBeUndefined();
    for (const row of body.data.ticket_orders) {
      expect(row.order_number).toMatch(/^BQ-[0-9A-F]{10}-[0-9A-F]{4}$/);
      expect(row.ticket_id).toBeTruthy();
    }

    const secondResponse = await app.inject({
      method: 'POST',
      url: '/api/v2/book-ticket?lang=en',
      payload: {
        event_slug: sampleSlug,
        schedule: {
          date: sampleDate,
          time: sampleTime,
        },
        tickets: [
          {
            ticket_id: 'child-pass',
            variant_id: null,
            quantity: 2,
            unit_price: 45,
          },
        ],
        totals: {
          subtotal: 90,
          discount_amount: 0,
          total: 90,
          currency: 'QAR',
        },
        idempotency_key: idempotencyKey,
      },
    });

    expect(secondResponse.statusCode).toBe(200);
    expect(JSON.parse(secondResponse.body).data.common_order).toBe(body.data.common_order);
  });

  it('/api/v2/book-ticket (POST) ignores client paid flags and keeps the order pending', async () => {
    const idempotencyKey = `test-paid-${Date.now()}-${Math.random()}`;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/book-ticket?lang=en',
      payload: {
        orderDetailPayload: {
          eventSlug: sampleSlug,
          customer: {
            id: 123,
          },
          schedule: {
            bookingDate: {
              start_date: sampleDate,
              end_date: sampleDate,
            },
            timingSlot: sampleTime,
          },
          tickets: [
            {
              ticket_id: 'vip-pass',
              variant_id: 'vip-morning',
              quantity: 1,
              unit_price: 100,
            },
          ],
          addons: [],
          promocode: {
            code: 'VIPMORNING15',
            ticket_id: 'vip-pass',
            variant_id: 'vip-morning',
          },
          totals: {
            subtotal: 100,
            discount_amount: 15,
            total: 85,
            currency: 'QAR',
          },
          waiver: {
            accepted: true,
            signed_by: 'Test Guest',
            accepted_at: new Date().toISOString(),
          },
          metadata: {
            source: 'web',
            locale: 'en',
          },
        },
        payment_method: 2,
        paymentDetailPayload: {
          provider: 'myfatoorah',
          status: 'paid',
          amount: 85,
          currency: 'QAR',
          providerResponse: {
            invoiceId: 'INV-TEST',
            paymentId: 'PAY-TEST',
            sessionId: 'QAT-TEST',
          },
        },
        idempotency_key: idempotencyKey,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        redirect_required: false,
        payment_flow: 'local_pending',
        payment_method: 2,
        total: 85,
        currency: 'QAR',
        temp_order_id: idempotencyKey,
        status: 'pending_payment',
      },
    });
  });

  it('/api/v2/customer/bookings (GET)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/customer/bookings?from_date=2026-01-01&to_date=2026-12-31&page=1&per_page=6&lang=en',
      headers: {
        authorization: `Bearer ${customerToken}`,
      },
    });

    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      success: true,
      data: {
        pagination: {
          current_page: 1,
          per_page: 6,
        },
      },
    });
    expect(body.data.bookings.length).toBeGreaterThan(0);
    expect(body.data.bookings[0]).toMatchObject({
      event_title: 'Sample Family Experience',
      currency: 'QAR',
    });
  });

  it('/api/v2/bookings/:order/tickets (GET)', async () => {
    const bookingsResponse = await app.inject({
      method: 'GET',
      url: '/api/v2/customer/bookings?from_date=2026-01-01&to_date=2026-12-31&page=1&per_page=1&lang=en',
      headers: {
        authorization: `Bearer ${customerToken}`,
      },
    });
    const bookingsBody = JSON.parse(bookingsResponse.body);
    const commonOrder = bookingsBody.data.bookings[0].common_order;

    const response = await app.inject({
      method: 'GET',
      url: `/api/v2/bookings/${commonOrder}/tickets?format=card`,
      headers: {
        authorization: `Bearer ${customerToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain(
      `tickets-${commonOrder}.pdf`,
    );
    expect(Buffer.isBuffer(response.rawPayload) || response.body.length > 0).toBe(
      true,
    );
  });

  it('/api/v2/customer/profile (GET)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/customer/profile?lang=en',
      headers: {
        authorization: `Bearer ${customerToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        name: expect.any(String),
        email: expect.any(String),
        avatar_url: expect.any(String),
      },
    });
  });

  it('/api/v2/customer/profile (GET) returns 401 without a token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/customer/profile?lang=en',
    });

    expect(response.statusCode).toBe(401);
  });

  it('/api/v2/customer/profile (POST)', async () => {
    const uniqueSuffix = Date.now();
    const phone = `+974${String(uniqueSuffix).slice(-8)}`;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/customer/profile?lang=en',
      headers: {
        authorization: `Bearer ${customerToken}`,
      },
      payload: {
        name: 'Updated Customer',
        email: customerEmail,
        phone,
        address: 'Doha, Qatar',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        name: 'Updated Customer',
        email: customerEmail,
        phone,
        address: 'Doha, Qatar',
      },
    });
  });

  it('/api/v2/customer/profile email change stays pending until OTP', async () => {
    const uniqueSuffix = Date.now();
    const nextEmail = `pending-customer-${uniqueSuffix}@example.com`;

    const missingPassword = await app.inject({
      method: 'POST',
      url: '/api/v2/customer/profile?lang=en',
      headers: { authorization: `Bearer ${customerToken}` },
      payload: {
        name: 'Updated Customer',
        email: nextEmail,
        phone: `+974${String(uniqueSuffix).slice(-8)}`,
      },
    });
    expect(missingPassword.statusCode).toBe(400);

    const started = await app.inject({
      method: 'POST',
      url: '/api/v2/customer/profile?lang=en',
      headers: { authorization: `Bearer ${customerToken}` },
      payload: {
        name: 'Updated Customer',
        email: nextEmail,
        current_password: TEST_PASSWORD,
      },
    });
    expect(started.statusCode).toBe(200);
    expect(JSON.parse(started.body)).toMatchObject({
      success: true,
      data: {
        email: customerEmail,
        pending_email: nextEmail,
      },
    });

    const badOtp = await app.inject({
      method: 'POST',
      url: '/api/v2/customer/profile/email/confirm',
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { otp: '000000' },
    });
    expect(badOtp.statusCode).toBe(400);
  });

  it('/api/v2/customer/profile/password (PUT)', async () => {
    const wrongCurrentResponse = await app.inject({
      method: 'PUT',
      url: '/api/v2/customer/profile/password',
      headers: {
        authorization: `Bearer ${customerToken}`,
      },
      payload: {
        current: 'wrong-password',
        password: 'NewPassword1!',
        password_confirmation: 'NewPassword1!',
      },
    });

    expect(wrongCurrentResponse.statusCode).toBe(400);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/v2/customer/profile/password',
      headers: {
        authorization: `Bearer ${customerToken}`,
      },
      payload: {
        current: TEST_PASSWORD,
        password: 'NewPassword1!',
        password_confirmation: 'NewPassword1!',
      },
    });

    expect(response.statusCode).toBe(200);
    const passwordBody = JSON.parse(response.body);
    expect(passwordBody).toMatchObject({
      success: true,
      message: 'Password updated successfully.',
    });
    expect(typeof passwordBody.token).toBe('string');

    const staleSession = await app.inject({
      method: 'GET',
      url: '/api/v2/customer/profile',
      headers: {
        authorization: `Bearer ${customerToken}`,
      },
    });
    expect(staleSession.statusCode).toBe(401);

    const rotatedSession = await app.inject({
      method: 'GET',
      url: '/api/v2/customer/profile',
      headers: {
        authorization: `Bearer ${passwordBody.token}`,
      },
    });
    expect(rotatedSession.statusCode).toBe(200);

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/v2/login',
      payload: {
        email: customerEmail,
        password: 'NewPassword1!',
        device_name: 'jest',
      },
    });
    expect(loginResponse.statusCode).toBe(200);
    customerToken = JSON.parse(loginResponse.body).token;
  });

  it('/api/v2/customer/favorites (GET/POST/DELETE)', async () => {
    const eventResponse = await app.inject({
      method: 'GET',
      url: `/api/v2/events/${sampleSlug}/detail?lang=en`,
    });
    const eventId = JSON.parse(eventResponse.body).data.event_id;

    const addResponse = await app.inject({
      method: 'POST',
      url: '/api/v2/customer/favorites?lang=en',
      headers: {
        authorization: `Bearer ${customerToken}`,
      },
      payload: {
        event_id: eventId,
      },
    });

    expect(addResponse.statusCode).toBe(200);
    expect(JSON.parse(addResponse.body)).toMatchObject({
      success: true,
      data: {
        id: eventId,
        slug: sampleSlug,
        title: 'Sample Family Experience',
      },
    });

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/v2/customer/favorites?lang=en',
      headers: {
        authorization: `Bearer ${customerToken}`,
      },
    });
    const listBody = JSON.parse(listResponse.body);

    expect(listResponse.statusCode).toBe(200);
    expect(listBody.success).toBe(true);
    expect(listBody.data.some((event: { id: string }) => event.id === eventId)).toBe(true);

    const removeResponse = await app.inject({
      method: 'DELETE',
      url: `/api/v2/customer/favorites/${eventId}`,
      headers: {
        authorization: `Bearer ${customerToken}`,
      },
    });

    expect(removeResponse.statusCode).toBe(200);
    expect(JSON.parse(removeResponse.body)).toMatchObject({
      success: true,
      message: 'Favourite removed successfully.',
    });
  });

  it('/api/v2/register (POST) rejects duplicate registered email', async () => {
    const email = `e2e-dup-${Date.now()}@example.com`;
    const first = await app.inject({
      method: 'POST',
      url: '/api/v2/register',
      payload: {
        name: 'First User',
        email,
        password: TEST_PASSWORD,
        password_confirmation: TEST_PASSWORD,
        accept: true,
      },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v2/register',
      payload: {
        name: 'Second User',
        email,
        password: TEST_PASSWORD,
        password_confirmation: TEST_PASSWORD,
        accept: true,
      },
    });

    expect(second.statusCode).toBe(400);
    const body = JSON.parse(second.body);
    expect(`${body.message} ${JSON.stringify(body.errors ?? {})}`.toLowerCase()).toContain(
      'already',
    );
  });

  it('/api/v2/register (POST) completes a guest account created during checkout', async () => {
    const guestEmail = `e2e-guest-${Date.now()}@example.com`;
    const idempotencyKey = `test-guest-book-${Date.now()}-${Math.random()}`;

    const bookResponse = await app.inject({
      method: 'POST',
      url: '/api/v2/book-ticket?lang=en',
      payload: {
        event_slug: sampleSlug,
        schedule: { date: sampleDate, time: sampleTime },
        tickets: [{ ticket_id: 'child-pass', variant_id: null, quantity: 1, unit_price: 45 }],
        totals: { subtotal: 45, discount_amount: 0, total: 45, currency: 'QAR' },
        customer: { name: 'Guest Customer', email: guestEmail },
        idempotency_key: idempotencyKey,
      },
    });
    expect(bookResponse.statusCode).toBe(200);

    const registerResponse = await app.inject({
      method: 'POST',
      url: '/api/v2/register',
      payload: {
        name: 'Guest Customer',
        email: guestEmail,
        password: TEST_PASSWORD,
        password_confirmation: TEST_PASSWORD,
        accept: true,
      },
    });
    expect(registerResponse.statusCode).toBe(200);

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/v2/login',
      payload: { email: guestEmail, password: TEST_PASSWORD, device_name: 'jest' },
    });
    expect(loginResponse.statusCode).toBe(200);
    expect(JSON.parse(loginResponse.body).token).toEqual(expect.any(String));
  });

  it('/api/v2/login (POST) rejects a wrong password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/login',
      payload: { email: customerEmail, password: 'totally-wrong', device_name: 'jest' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('/api/v2/refresh rotates customer sessions and logout revokes them', async () => {
    const email = `refresh-customer-${Date.now()}@example.com`;
    await app.inject({
      method: 'POST',
      url: '/api/v2/register',
      payload: {
        name: 'Refresh Customer',
        email,
        password: TEST_PASSWORD,
        password_confirmation: TEST_PASSWORD,
        accept: true,
      },
    });
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/v2/login',
      payload: { email, password: TEST_PASSWORD, device_name: 'jest' },
    });
    expect(loginResponse.statusCode).toBe(200);
    const login = JSON.parse(loginResponse.body);
    expect(login.token).toEqual(expect.any(String));
    expect(login.refresh_token).toEqual(expect.any(String));

    const profile = await app.inject({
      method: 'GET',
      url: '/api/v2/customer/profile',
      headers: { authorization: `Bearer ${login.token}` },
    });
    expect(profile.statusCode).toBe(200);

    const refreshResponse = await app.inject({
      method: 'POST',
      url: '/api/v2/refresh',
      payload: { refresh_token: login.refresh_token },
    });
    expect(refreshResponse.statusCode).toBe(200);
    const refreshed = JSON.parse(refreshResponse.body);
    expect(refreshed.refresh_token).toEqual(expect.any(String));
    expect(refreshed.refresh_token).not.toBe(login.refresh_token);
    expect(refreshed.token).toEqual(expect.any(String));

    const reused = await app.inject({
      method: 'POST',
      url: '/api/v2/refresh',
      payload: { refresh_token: login.refresh_token },
    });
    expect(reused.statusCode).toBe(401);

    const rotatedProfile = await app.inject({
      method: 'GET',
      url: '/api/v2/customer/profile',
      headers: { authorization: `Bearer ${refreshed.token}` },
    });
    expect(rotatedProfile.statusCode).toBe(200);

    const logoutResponse = await app.inject({
      method: 'POST',
      url: '/api/v2/logout',
      payload: { refresh_token: refreshed.refresh_token },
    });
    expect(logoutResponse.statusCode).toBe(200);

    const afterLogout = await app.inject({
      method: 'POST',
      url: '/api/v2/refresh',
      payload: { refresh_token: refreshed.refresh_token },
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it('/api/v2/admin/auth supports login, permission identity, rotation, and logout', async () => {
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/auth/login',
      payload: { email: 'admin@bookingqube.test', password: 'AdminPass123!' },
    });
    expect(loginResponse.statusCode).toBe(200);
    const login = JSON.parse(loginResponse.body);
    expect(login.data.admin).toMatchObject({
      email: 'admin@bookingqube.test',
      role: 'super_admin',
    });
    expect(login.data.admin.permissions).toContain('panel.access');
    expect(login.data.admin.permissions).toContain('admin.access');

    const meResponse = await app.inject({
      method: 'GET',
      url: '/api/v2/admin/auth/me',
      headers: { authorization: `Bearer ${login.data.access_token}` },
    });
    expect(meResponse.statusCode).toBe(200);
    expect(JSON.parse(meResponse.body).data.permissions).toContain('events.write');

    const customerTokenResponse = await app.inject({
      method: 'GET',
      url: '/api/v2/admin/auth/me',
      headers: { authorization: `Bearer ${customerToken}` },
    });
    expect(customerTokenResponse.statusCode).toBe(401);

    const refreshResponse = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/auth/refresh',
      payload: { refresh_token: login.data.refresh_token },
    });
    expect(refreshResponse.statusCode).toBe(200);
    const refreshed = JSON.parse(refreshResponse.body);
    expect(refreshed.data.refresh_token).not.toBe(login.data.refresh_token);

    const reusedRefresh = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/auth/refresh',
      payload: { refresh_token: login.data.refresh_token },
    });
    expect(reusedRefresh.statusCode).toBe(401);

    const logoutResponse = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/auth/logout',
      payload: { refresh_token: refreshed.data.refresh_token },
    });
    expect(logoutResponse.statusCode).toBe(200);

    const loggedOutMe = await app.inject({
      method: 'GET',
      url: '/api/v2/admin/auth/me',
      headers: { authorization: `Bearer ${refreshed.data.access_token}` },
    });
    expect(loggedOutMe.statusCode).toBe(401);
  });

  it('/api/v2/admin/events lists, searches, filters, and paginates protected events', async () => {
    const unauthorized = await app.inject({ method: 'GET', url: '/api/v2/admin/events' });
    expect(unauthorized.statusCode).toBe(401);

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/auth/login',
      payload: { email: 'admin@bookingqube.test', password: 'AdminPass123!' },
    });
    const login = JSON.parse(loginResponse.body);
    const authorization = `Bearer ${login.data.access_token}`;

    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/admin/events?page=1&per_page=10&lang=en',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toMatchObject({
      success: true,
      data: {
        pagination: { page: 1, per_page: 10 },
      },
    });
    expect(
      body.data.events.find((event: { slug: string }) => event.slug === sampleSlug),
    ).toMatchObject({
      slug: sampleSlug,
      title: 'Sample Family Experience',
      status: 'published',
      counts: { sessions: 1, ticket_types: 3 },
    });
    expect(body.data.status_counts.published).toBeGreaterThanOrEqual(1);

    const filtered = await app.inject({
      method: 'GET',
      url: '/api/v2/admin/events?status=published&search=family&lang=ar',
      headers: { authorization },
    });
    expect(filtered.statusCode).toBe(200);
    expect(JSON.parse(filtered.body).data.events[0]).toMatchObject({
      slug: sampleSlug,
      title: 'تجربة عائلية تجريبية',
    });

    const invalid = await app.inject({
      method: 'GET',
      url: '/api/v2/admin/events?status=deleted',
      headers: { authorization },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('/api/v2/admin/dashboard/overview returns reconciled protected metrics and analytics', async () => {
    const unauthorized = await app.inject({
      method: 'GET',
      url: '/api/v2/admin/dashboard/overview',
    });
    expect(unauthorized.statusCode).toBe(401);

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/v2/admin/auth/login',
      payload: { email: 'admin@bookingqube.test', password: 'AdminPass123!' },
    });
    const authorization = `Bearer ${JSON.parse(loginResponse.body).data.access_token}`;
    const from = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v2/admin/dashboard/overview?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      headers: { authorization },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body).data;
    expect(body.period.currency).toBe('QAR');
    expect(body.metrics.total_orders.value).toBeGreaterThan(0);
    expect(body.metrics.gross_sales.value).toBeGreaterThanOrEqual(body.metrics.net_revenue.value);
    expect(body.sales_trend.length).toBeGreaterThanOrEqual(7);
    expect(
      body.order_status_mix.reduce((sum: number, item: { count: number }) => sum + item.count, 0),
    ).toBe(body.metrics.total_orders.value);
    expect(body.data_quality.revenue_verification).toBe('unverified_provider_state');
    expect(body.event_options.some((event: { slug: string }) => event.slug === sampleSlug)).toBe(
      true,
    );

    const invalid = await app.inject({
      method: 'GET',
      url: '/api/v2/admin/dashboard/overview?from=2026-08-01&to=2026-07-01',
      headers: { authorization },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('/api/v2/login (POST) rejects a guest-only account with no password', async () => {
    const guestOnlyEmail = `e2e-guest-only-${Date.now()}@example.com`;
    const idempotencyKey = `test-guest-only-book-${Date.now()}-${Math.random()}`;

    await app.inject({
      method: 'POST',
      url: '/api/v2/book-ticket?lang=en',
      payload: {
        event_slug: sampleSlug,
        schedule: { date: sampleDate, time: sampleTime },
        tickets: [{ ticket_id: 'child-pass', variant_id: null, quantity: 1, unit_price: 45 }],
        totals: { subtotal: 45, discount_amount: 0, total: 45, currency: 'QAR' },
        customer: { name: 'Guest Only', email: guestOnlyEmail },
        idempotency_key: idempotencyKey,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/login',
      payload: { email: guestOnlyEmail, password: 'anything', device_name: 'jest' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('/api/v2/social_login (POST) rejects an invalid token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/social_login',
      payload: {
        provider: 'google',
        access_token: 'garbage-token',
        other_data: JSON.stringify({ name: 'Fake User', email: 'fake@example.com' }),
      },
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('/api/v2/password/forgot, verify-otp, and reset (POST) full flow', async () => {
    const email = `e2e-reset-${Date.now()}@example.com`;
    await registerAndLogin(app, email);

    const forgotResponse = await app.inject({
      method: 'POST',
      url: '/api/v2/password/forgot',
      payload: { email },
    });
    expect(forgotResponse.statusCode).toBe(200);

    const otpService = app.get(OtpService);
    const otp = await otpService.generateAndStore(email);

    const verifyResponse = await app.inject({
      method: 'POST',
      url: '/api/v2/password/verify-otp',
      payload: { email, otp },
    });
    expect(verifyResponse.statusCode).toBe(200);

    const wrongOtpResponse = await app.inject({
      method: 'POST',
      url: '/api/v2/password/verify-otp',
      payload: { email, otp: '000000' },
    });
    expect(wrongOtpResponse.statusCode).toBe(400);

    const resetResponse = await app.inject({
      method: 'POST',
      url: '/api/v2/password/reset',
      payload: {
        email,
        otp,
        password: 'ResetPassword1!',
        password_confirmation: 'ResetPassword1!',
      },
    });
    expect(resetResponse.statusCode).toBe(200);

    const reusedOtpResponse = await app.inject({
      method: 'POST',
      url: '/api/v2/password/reset',
      payload: {
        email,
        otp,
        password: 'AnotherPassword1!',
        password_confirmation: 'AnotherPassword1!',
      },
    });
    expect(reusedOtpResponse.statusCode).toBe(400);

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/v2/login',
      payload: { email, password: 'ResetPassword1!', device_name: 'jest' },
    });
    expect(loginResponse.statusCode).toBe(200);
  });

  it('/api/v2/homepage/quick-book-section (GET)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/homepage/quick-book-section?lang=en',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        AllcategoryList: [
          {
            slug: 'experiences',
            name: 'Experiences',
            has_any_event: true,
          },
        ],
        AllcategoryEventsMovies: [
          {
            title: 'Sample Family Experience',
            slug: sampleSlug,
            event_slug: sampleSlug,
            category_slug: 'experiences',
            genre: ['Experiences'],
            tags: ['Experiences'],
            location: 'Doha Exhibition Center',
          },
        ],
      },
    });
  });

  it('/api/v2/homepage/quick-book-section (GET) supports Arabic', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/homepage/quick-book-section?lang=ar',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        AllcategoryList: [
          {
            slug: 'experiences',
            name: 'التجارب',
            has_any_event: true,
          },
        ],
        AllcategoryEventsMovies: [
          {
            title: 'تجربة عائلية تجريبية',
            event_slug: sampleSlug,
            category_slug: 'experiences',
            genre: ['التجارب'],
            tags: ['التجارب'],
            location: 'مركز الدوحة للمعارض',
          },
        ],
      },
    });
  });

  it('/api/v2/footer (GET)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/footer?lang=en',
    });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      success: true,
      data: {
        why_book: {
          title: 'Why book with BookingQube?',
        },
        brand: {
          tagline: 'Book Everything Entertainment',
        },
        contact: {
          phone: '+974 5113 8418',
          email: 'info@bookingqube.com',
          hotline: {
            label: 'Ticket Info hotline',
          },
        },
        we_accept: {
          title: 'We accept',
        },
        support_center: {
          button: 'Support center',
          url: '/pages/faqs',
        },
      },
    });
    expect(body.data.why_book.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Trusted Checkout',
        }),
      ]),
    );
  });

  it('/api/v2/footer (GET) supports Arabic', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/footer?lang=ar',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        why_book: {
          title: 'لماذا تحجز مع BookingQube؟',
        },
        brand: {
          tagline: 'احجز كل تجارب الترفيه',
        },
        contact: {
          queries_heading: 'لديك أسئلة؟ لدينا الإجابات',
          hotline: {
            label: 'خط معلومات التذاكر',
          },
        },
        support_center: {
          button: 'مركز الدعم',
        },
      },
    });
  });

  it('/api/v2/events/search (GET)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/events/search?q=family&lang=en&limit=10',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        query: 'family',
        events: [
          {
            slug: sampleSlug,
            title: 'Sample Family Experience',
            category_slug: 'experiences',
            price: 'QAR 45',
          },
        ],
      },
      items: [
        {
          slug: sampleSlug,
        },
      ],
      total: 1,
    });
  });

  it('/api/v2/events/search (GET) supports Arabic', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v2/events/search?q=${encodeURIComponent('عائلية')}&lang=ar`,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        query: 'عائلية',
        events: [
          {
            slug: sampleSlug,
            title: 'تجربة عائلية تجريبية',
            category: 'التجارب',
          },
        ],
      },
      total: 1,
    });
  });

  it('/api/v2/events/search (GET) returns empty results for blank query', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/events/search?q=&lang=en',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        query: '',
        events: [],
      },
      items: [],
      total: 0,
    });
  });

  it('/api/v2/venue-detail/:slug (GET)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/venue-detail/doha-exhibition-center?lang=en',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        slug: 'doha-exhibition-center',
        name: 'Doha Exhibition Center',
        about: 'A central venue for BookingQube sample events.',
        location: {
          venue: 'Doha Exhibition Center',
          address: 'Doha, Qatar',
          city: 'Doha',
          country: 'QA',
        },
        upcomingEvents: [
          {
            slug: sampleSlug,
            title: 'Sample Family Experience',
            price: 'QAR 45',
            category_slug: 'experiences',
            status: 'available',
          },
        ],
        primaryEventSlug: sampleSlug,
        primaryEventDetail: {
          slug: sampleSlug,
          title: 'Sample Family Experience',
          priceFrom: 45,
          currency: 'QAR',
        },
        stats: {
          upcomingEventsCount: 1,
          pastEventsCount: 0,
          liveEventsCount: 1,
        },
      },
    });
  });

  it('/api/v2/venue-detail/:slug (GET) supports Arabic', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/venue-detail/doha-exhibition-center?lang=ar',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        slug: 'doha-exhibition-center',
        name: 'مركز الدوحة للمعارض',
        about: 'موقع تجريبي لفعاليات BookingQube.',
        location: {
          venue: 'مركز الدوحة للمعارض',
          address: 'الدوحة، قطر',
        },
        upcomingEvents: [
          {
            slug: sampleSlug,
            title: 'تجربة عائلية تجريبية',
            category: 'التجارب',
          },
        ],
      },
    });
  });

  it('/api/v2/venue-detail/:slug (GET) returns 404 for missing venue', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/venue-detail/missing?lang=en',
    });

    expect(response.statusCode).toBe(404);
  });

  it('/api/v2/artist/:slug (GET)', async () => {
    const event = await prisma.event.findUnique({
      where: { slug: sampleSlug },
      select: { id: true },
    });
    expect(event).toBeTruthy();

    const artist = await prisma.artist.upsert({
      where: { slug: 'sample-family-host' },
      update: {
        name: 'Sample Family Host',
        status: 'published',
        publishedAt: new Date(),
      },
      create: {
        slug: 'sample-family-host',
        name: 'Sample Family Host',
        status: 'published',
        publishedAt: new Date(),
        translations: {
          create: [
            {
              locale: 'en',
              name: 'Sample Family Host',
              subtitle: 'Family entertainment',
              bio: 'A sample artist profile used to verify public artist detail pages in the new BookingQube backend.',
            },
            {
              locale: 'ar',
              name: 'مقدم عائلي تجريبي',
              subtitle: 'ترفيه عائلي',
              bio: 'ملف فنان تجريبي للتحقق من صفحات تفاصيل الفنان في باكند BookingQube الجديد.',
            },
          ],
        },
      },
      include: { translations: true },
    });

    for (const translation of [
      {
        locale: 'en',
        name: 'Sample Family Host',
        subtitle: 'Family entertainment',
        bio: 'A sample artist profile used to verify public artist detail pages in the new BookingQube backend.',
      },
      {
        locale: 'ar',
        name: 'مقدم عائلي تجريبي',
        subtitle: 'ترفيه عائلي',
        bio: 'ملف فنان تجريبي للتحقق من صفحات تفاصيل الفنان في باكند BookingQube الجديد.',
      },
    ]) {
      await prisma.artistTranslation.upsert({
        where: {
          artistId_locale: { artistId: artist.id, locale: translation.locale },
        },
        update: {
          name: translation.name,
          subtitle: translation.subtitle,
          bio: translation.bio,
        },
        create: {
          artistId: artist.id,
          ...translation,
        },
      });
    }

    await prisma.eventArtist.upsert({
      where: {
        eventId_artistId: { eventId: event!.id, artistId: artist.id },
      },
      update: { sortOrder: 1 },
      create: { eventId: event!.id, artistId: artist.id, sortOrder: 1 },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/artist/sample-family-host?lang=en',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        slug: 'sample-family-host',
        name: 'Sample Family Host',
        genre: 'Family entertainment',
        genres: ['Family entertainment', 'Experiences'],
        tagline: 'Family entertainment',
        about: [
          'A sample artist profile used to verify public artist detail pages in the new BookingQube backend.',
        ],
        biography:
          'A sample artist profile used to verify public artist detail pages in the new BookingQube backend.',
        profile: {
          occupation: 'Family entertainment',
          netWorthCurrency: 'USD',
        },
        upcomingEvents: [
          {
            slug: sampleSlug,
            title: 'Sample Family Experience',
            price_from: 45,
            currency: 'QAR',
            category_slug: 'experiences',
            status: 'available',
          },
        ],
        pastEvents: [],
        similarArtists: [],
      },
    });
  });

  it('/api/v2/artist/:slug (GET) supports Arabic', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/artist/sample-family-host?lang=ar',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        slug: 'sample-family-host',
        name: 'مقدم عائلي تجريبي',
        genre: 'ترفيه عائلي',
        tagline: 'ترفيه عائلي',
        about: ['ملف فنان تجريبي للتحقق من صفحات تفاصيل الفنان في باكند BookingQube الجديد.'],
        upcomingEvents: [
          {
            slug: sampleSlug,
            title: 'تجربة عائلية تجريبية',
            category: 'التجارب',
          },
        ],
      },
    });
  });

  it('/api/v2/artist/:slug (GET) returns 404 for missing artist', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/artist/missing?lang=en',
    });

    expect(response.statusCode).toBe(404);
  });

  it('/api/v2/blog/:slug (GET)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/blog/planning-a-family-day-out?lang=en',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        slug: 'planning-a-family-day-out',
        tag: 'Family',
        category: 'Guides',
        title: 'Planning a Family Day Out in Qatar',
        published_date: '2026-07-01',
        reading_time_minutes: 1,
        views: 0,
        author: 'BookingQube Admin',
        excerpt:
          'Simple planning tips for choosing family-friendly experiences, tickets, and venues.',
        content: [
          'BookingQube helps families discover events, compare schedules, and prepare for a smooth day out.',
          'Start with the event location, check available ticket types, and review the schedule before checkout.',
        ],
        categories: [
          {
            name: 'Guides',
            slug: 'guides',
            post_count: 1,
          },
        ],
        prev_post: null,
        next_post: null,
      },
    });
  });

  it('/api/v2/blog/:slug (GET) supports Arabic', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/blog/planning-a-family-day-out?lang=ar',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        slug: 'planning-a-family-day-out',
        tag: 'العائلة',
        category: 'الأدلة',
        title: 'التخطيط ليوم عائلي في قطر',
        excerpt: 'نصائح بسيطة لاختيار التجارب والتذاكر والمواقع المناسبة للعائلة.',
        categories: [
          {
            name: 'الأدلة',
            post_count: 1,
          },
        ],
      },
    });
  });

  it('/api/v2/blog/:slug (GET) returns 404 for missing blog', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/blog/missing?lang=en',
    });

    expect(response.statusCode).toBe(404);
  });

  it('/api/v2/event-listing (GET)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/event-listing?lang=en',
    });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      success: true,
      data: {
        AllEvents: [
          {
            slug: sampleSlug,
            title: 'Sample Family Experience',
            price: 'QAR 45',
            category: 'Experiences',
            category_slug: 'experiences',
            status: 'available',
            status_label: 'Available',
            event_type: 'general',
            currentEventDate: sampleDate,
            is_favourite: false,
          },
        ],
        featuredEvents: [
          {
            slug: sampleSlug,
          },
        ],
      },
    });
  });

  it('/api/v2/event-listing (GET) supports Arabic', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/event-listing?lang=ar',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        AllEvents: [
          {
            slug: sampleSlug,
            title: 'تجربة عائلية تجريبية',
            category: 'التجارب',
          },
        ],
      },
    });
  });

  it('/api/v2/events/:slug/detail (GET) supports Arabic', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v2/events/${sampleSlug}/detail?lang=ar`,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        slug: sampleSlug,
        title: 'تجربة عائلية تجريبية',
        location: {
          venue_name: 'مركز الدوحة للمعارض',
        },
      },
    });
  });

  it('/api/v2/events/:slug/detail (GET) returns 404 for missing event', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/events/missing/detail?lang=en',
    });

    expect(response.statusCode).toBe(404);
  });

  it('/api/v2/events/:slug/schedule (GET)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v2/events/${sampleSlug}/schedule?month=2026-08&page=1&lang=en`,
    });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      success: true,
      data: {
        schedule: [
          {
            date: sampleDate,
            day_label: 'Sat',
            month_label: 'Aug',
            status: 'available',
            time_slots: [
              {
                time: sampleTime,
                status: 'available',
              },
            ],
          },
        ],
        pagination: {
          current_page: 1,
          total_dates: 1,
          has_more: false,
        },
      },
    });
  });

  it('/api/v2/events/:slug/schedule (GET) returns empty schedule for unmatched month', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v2/events/${sampleSlug}/schedule?month=2026-09&page=1&lang=en`,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: {
        schedule: [],
        pagination: {
          total_dates: 0,
        },
      },
    });
  });

  it('/api/v2/events/:slug/tickets (GET)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v2/events/${sampleSlug}/tickets?date=${sampleDate}&time=${encodeURIComponent(
        sampleTime,
      )}&lang=en`,
    });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      success: true,
      data: {
        booking_mode: 'ticketed',
        selected_context: {
          time_display: sampleTime,
        },
        tickets: [
          {
            ticket_id: 'adult-pass',
            price: 75,
            currency: 'QAR',
            max_qty: 10,
          },
          {
            ticket_id: 'child-pass',
            price: 45,
            currency: 'QAR',
            max_qty: 10,
          },
          {
            ticket_id: 'vip-pass',
            has_variants: true,
            variants: [
              {
                variant_id: 'vip-morning',
                price: 100,
                currency: 'QAR',
                max_qty: 6,
              },
              {
                variant_id: 'vip-evening',
                price: 120,
                currency: 'QAR',
                max_qty: 6,
              },
            ],
          },
        ],
        addons: [
          {
            addon_id: 'meal-combo',
            price: 25,
            currency: 'QAR',
            max_qty: 10,
          },
        ],
      },
    });
  });

  it('/api/v2/events/:slug/tickets (GET) validates required date and time', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v2/events/${sampleSlug}/tickets?date=${sampleDate}&lang=en`,
    });

    expect(response.statusCode).toBe(400);
  });

  it('/api/v2/events/:slug/tickets (GET) returns 404 for missing selected session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v2/events/${sampleSlug}/tickets?date=${sampleDate}&time=${encodeURIComponent(
        '11:00 AM',
      )}&lang=en`,
    });

    expect(response.statusCode).toBe(404);
  });

  it('/api/v2/book-ticket atomically caps concurrent holds and releases them on expiry', async () => {
    const testPrefix = `concurrency-${Date.now()}`;
    const event = await prisma.event.findUniqueOrThrow({
      where: { slug: sampleSlug },
      include: { ticketTypes: true, sessions: true },
    });
    const childTicket = event.ticketTypes.find((ticket) => ticket.externalKey === 'child-pass');
    const session = event.sessions.find((item) => item.displayTime === sampleTime);
    expect(childTicket).toBeDefined();
    expect(session).toBeDefined();

    const inventory = await prisma.inventoryItem.findUniqueOrThrow({
      where: {
        eventSessionId_itemType_itemId: {
          eventSessionId: session!.id,
          itemType: 'ticket_type',
          itemId: childTicket!.id,
        },
      },
    });
    const original = {
      totalQuantity: inventory.totalQuantity,
      soldQuantity: inventory.soldQuantity,
      heldQuantity: inventory.heldQuantity,
    };

    try {
      await prisma.inventoryItem.update({
        where: { id: inventory.id },
        data: { totalQuantity: 10, soldQuantity: 0, heldQuantity: 0, status: 'active' },
      });
      const inventoryService = app.get(InventoryService);
      await inventoryService.invalidate([inventory.id]);

      const duplicatePayload = {
        event_slug: sampleSlug,
        schedule: { date: sampleDate, time: sampleTime },
        tickets: [{ ticket_id: 'child-pass', quantity: 1, unit_price: 0.01 }],
        customer: { email: `${testPrefix}-duplicate@example.com` },
        idempotency_key: `${testPrefix}-duplicate`,
      };
      const duplicateResponses = await Promise.all([
        app.inject({
          method: 'POST',
          url: '/api/v2/book-ticket?lang=en',
          payload: duplicatePayload,
        }),
        app.inject({
          method: 'POST',
          url: '/api/v2/book-ticket?lang=en',
          payload: duplicatePayload,
        }),
      ]);
      expect(duplicateResponses.map((response) => response.statusCode)).toEqual([200, 200]);
      expect(
        duplicateResponses.map((response) => JSON.parse(response.body).data.common_order),
      ).toEqual([
        JSON.parse(duplicateResponses[0].body).data.common_order,
        JSON.parse(duplicateResponses[0].body).data.common_order,
      ]);

      const duplicateOrder = await prisma.order.findUniqueOrThrow({
        where: { idempotencyKey: `${testPrefix}-duplicate` },
      });
      await prisma.order.delete({ where: { id: duplicateOrder.id } });
      await prisma.ticketHold.delete({ where: { id: duplicateOrder.holdId! } });
      await prisma.inventoryItem.update({ where: { id: inventory.id }, data: { heldQuantity: 0 } });
      await inventoryService.invalidate([inventory.id]);

      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          app.inject({
            method: 'POST',
            url: '/api/v2/book-ticket?lang=en',
            payload: {
              event_slug: sampleSlug,
              schedule: { date: sampleDate, time: sampleTime },
              tickets: [{ ticket_id: 'child-pass', quantity: 1, unit_price: 0.01 }],
              totals: { subtotal: 0.01, total: 0.01, currency: 'USD' },
              customer: { email: `${testPrefix}-${index}@example.com` },
              idempotency_key: `${testPrefix}-${index}`,
            },
          }),
        ),
      );

      const successful = responses.filter((response) => response.statusCode === 200);
      const soldOut = responses.filter((response) => response.statusCode === 400);
      expect(successful).toHaveLength(10);
      expect(soldOut).toHaveLength(10);
      expect(successful.map((response) => JSON.parse(response.body).data.total)).toEqual(
        Array(10).fill(45),
      );

      const reserved = await prisma.inventoryItem.findUniqueOrThrow({
        where: { id: inventory.id },
      });
      expect(reserved.heldQuantity).toBe(10);

      await prisma.ticketHold.updateMany({
        where: { idempotencyKey: { startsWith: testPrefix }, status: 'active' },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });
      const expirationService = app.get(HoldExpirationService);
      expect(await expirationService.releaseExpiredHolds()).toBeGreaterThanOrEqual(10);

      const released = await prisma.inventoryItem.findUniqueOrThrow({
        where: { id: inventory.id },
      });
      expect(released.heldQuantity).toBe(0);
      expect(
        await prisma.order.count({
          where: { idempotencyKey: { startsWith: testPrefix }, status: 'expired' },
        }),
      ).toBe(10);
    } finally {
      const orders = await prisma.order.findMany({
        where: { idempotencyKey: { startsWith: testPrefix } },
        select: { holdId: true },
      });
      await prisma.order.deleteMany({ where: { idempotencyKey: { startsWith: testPrefix } } });
      await prisma.ticketHold.deleteMany({
        where: { id: { in: orders.flatMap((order) => (order.holdId ? [order.holdId] : [])) } },
      });
      await prisma.user.deleteMany({ where: { email: { startsWith: testPrefix } } });
      await prisma.inventoryItem.update({ where: { id: inventory.id }, data: original });
      await app.get(InventoryService).invalidate([inventory.id]);
    }
  });

  it('/api/v2/book-ticket handles unordered multi-SKU carts without deadlock', async () => {
    const testPrefix = `multisku-${Date.now()}`;
    const event = await prisma.event.findUniqueOrThrow({
      where: { slug: sampleSlug },
      include: { ticketTypes: true, sessions: true },
    });
    const childTicket = event.ticketTypes.find((ticket) => ticket.externalKey === 'child-pass');
    const adultTicket = event.ticketTypes.find(
      (ticket) => ticket.externalKey === 'adult-pass' || ticket.externalKey === 'family-pass',
    );
    const session = event.sessions.find((item) => item.displayTime === sampleTime);
    expect(childTicket).toBeDefined();
    expect(adultTicket).toBeDefined();
    expect(session).toBeDefined();

    const childInventory = await prisma.inventoryItem.findUniqueOrThrow({
      where: {
        eventSessionId_itemType_itemId: {
          eventSessionId: session!.id,
          itemType: 'ticket_type',
          itemId: childTicket!.id,
        },
      },
    });
    const adultInventory = await prisma.inventoryItem.findUniqueOrThrow({
      where: {
        eventSessionId_itemType_itemId: {
          eventSessionId: session!.id,
          itemType: 'ticket_type',
          itemId: adultTicket!.id,
        },
      },
    });
    const originals = [
      {
        id: childInventory.id,
        totalQuantity: childInventory.totalQuantity,
        soldQuantity: childInventory.soldQuantity,
        heldQuantity: childInventory.heldQuantity,
      },
      {
        id: adultInventory.id,
        totalQuantity: adultInventory.totalQuantity,
        soldQuantity: adultInventory.soldQuantity,
        heldQuantity: adultInventory.heldQuantity,
      },
    ];
    const inventoryService = app.get(InventoryService);

    try {
      await prisma.inventoryItem.update({
        where: { id: childInventory.id },
        data: { totalQuantity: 20, soldQuantity: 0, heldQuantity: 0, status: 'active' },
      });
      await prisma.inventoryItem.update({
        where: { id: adultInventory.id },
        data: { totalQuantity: 20, soldQuantity: 0, heldQuantity: 0, status: 'active' },
      });
      await inventoryService.invalidate([childInventory.id, adultInventory.id]);

      const responses = await Promise.all(
        Array.from({ length: 12 }, (_, index) => {
          const tickets =
            index % 2 === 0
              ? [
                  { ticket_id: childTicket!.externalKey, quantity: 1, unit_price: 0.01 },
                  { ticket_id: adultTicket!.externalKey, quantity: 1, unit_price: 0.01 },
                ]
              : [
                  { ticket_id: adultTicket!.externalKey, quantity: 1, unit_price: 0.01 },
                  { ticket_id: childTicket!.externalKey, quantity: 1, unit_price: 0.01 },
                ];
          return app.inject({
            method: 'POST',
            url: '/api/v2/book-ticket?lang=en',
            payload: {
              event_slug: sampleSlug,
              schedule: { date: sampleDate, time: sampleTime },
              tickets,
              customer: { email: `${testPrefix}-${index}@example.com` },
              idempotency_key: `${testPrefix}-${index}`,
            },
          });
        }),
      );

      const successful = responses.filter((response) => response.statusCode === 200);
      expect(successful.length).toBe(12);
      expect(responses.every((response) => response.statusCode !== 500)).toBe(true);

      const reporting = app.get(ReportingService);
      const counters = await reporting.getEventCounters(event.id);
      expect(counters.length).toBeGreaterThan(0);
    } finally {
      const orders = await prisma.order.findMany({
        where: { idempotencyKey: { startsWith: testPrefix } },
        select: { holdId: true },
      });
      await prisma.order.deleteMany({ where: { idempotencyKey: { startsWith: testPrefix } } });
      await prisma.ticketHold.deleteMany({
        where: { id: { in: orders.flatMap((order) => (order.holdId ? [order.holdId] : [])) } },
      });
      await prisma.user.deleteMany({ where: { email: { startsWith: testPrefix } } });
      for (const row of originals) {
        await prisma.inventoryItem.update({
          where: { id: row.id },
          data: {
            totalQuantity: row.totalQuantity,
            soldQuantity: row.soldQuantity,
            heldQuantity: row.heldQuantity,
          },
        });
      }
      await inventoryService.invalidate([childInventory.id, adultInventory.id]);
    }
  });

  it('/api/v2/payments/confirm rejects unverified settlement', async () => {
    const testPrefix = `confirm-${Date.now()}`;
    const book = await app.inject({
      method: 'POST',
      url: '/api/v2/book-ticket?lang=en',
      payload: {
        event_slug: sampleSlug,
        schedule: { date: sampleDate, time: sampleTime },
        tickets: [{ ticket_id: 'child-pass', quantity: 1, unit_price: 0.01 }],
        customer: { email: `${testPrefix}@example.com` },
        idempotency_key: `${testPrefix}-key`,
      },
    });
    expect(book.statusCode).toBe(200);
    const bookBody = JSON.parse(book.body);
    const commonOrder = bookBody.data.common_order as string;

    const confirm = await app.inject({
      method: 'POST',
      url: '/api/v2/payments/confirm',
      payload: {
        common_order: commonOrder,
        amount: bookBody.data.total,
        currency: bookBody.data.currency,
      },
    });
    expect(confirm.statusCode).toBe(402);
    expect(JSON.parse(confirm.body).message).toMatch(/not been verified|payment provider|not been confirmed/i);

    const order = await prisma.order.findUniqueOrThrow({
      where: { commonOrder },
      include: { items: true },
    });
    expect(order.status).toBe('pending_payment');

    const inventoryIds = order.items
      .map((item) => item.inventoryItemId)
      .filter((id): id is string => Boolean(id));
    for (const item of order.items) {
      if (!item.inventoryItemId) continue;
      await prisma.$executeRaw`
        UPDATE "inventory_items"
        SET "sold_quantity" = GREATEST(0, "sold_quantity" - ${item.quantity}), "updated_at" = NOW()
        WHERE "id" = ${item.inventoryItemId}::uuid
      `;
    }
    await app.get(InventoryService).invalidate(inventoryIds);

    await prisma.order.delete({ where: { id: order.id } });
    if (order.holdId) await prisma.ticketHold.delete({ where: { id: order.holdId } });
    await prisma.user.deleteMany({ where: { email: `${testPrefix}@example.com` } });
  });

  it('creates and resolves customer payment recovery for web confirm', async () => {
    const testPrefix = `recovery-${Date.now()}`;
    const book = await app.inject({
      method: 'POST',
      url: '/api/v2/book-ticket?lang=en',
      payload: {
        event_slug: sampleSlug,
        schedule: { date: sampleDate, time: sampleTime },
        tickets: [{ ticket_id: 'child-pass', quantity: 1, unit_price: 0.01 }],
        customer: { email: `${testPrefix}@example.com` },
        idempotency_key: `${testPrefix}-key`,
        metadata: { source: 'web' },
      },
    });
    expect(book.statusCode).toBe(200);
    const bookBody = JSON.parse(book.body);
    const commonOrder = bookBody.data.common_order as string;

    const order = await prisma.order.findUniqueOrThrow({
      where: { commonOrder },
      include: { items: true },
    });

    const opened = await prisma.customerPaymentRecovery.findFirst({
      where: { commonOrder },
      orderBy: { createdAt: 'desc' },
    });
    expect(opened?.status).toBe('open');
    expect(opened?.reason).toBe('awaiting_confirm');
    expect(opened?.orderId).toBe(order.id);
    expect(opened?.idempotencyKey).toBe(`${testPrefix}-key`);

    const confirm = await app.inject({
      method: 'POST',
      url: '/api/v2/payments/confirm',
      payload: {
        common_order: commonOrder,
        amount: Number(order.totalAmount),
        currency: order.currency,
      },
    });
    expect(confirm.statusCode).toBe(402);

    const resolved = await prisma.customerPaymentRecovery.findFirst({
      where: { commonOrder },
      orderBy: { createdAt: 'desc' },
    });
    expect(resolved?.status).toBe('open');

    for (const item of order.items) {
      if (!item.inventoryItemId) continue;
      await prisma.$executeRaw`
        UPDATE "inventory_items"
        SET "sold_quantity" = GREATEST(0, "sold_quantity" - ${item.quantity}), "updated_at" = NOW()
        WHERE "id" = ${item.inventoryItemId}::uuid
      `;
    }
    await app.get(InventoryService).invalidate(
      order.items
        .map((item) => item.inventoryItemId)
        .filter((id): id is string => Boolean(id)),
    );

    await prisma.customerPaymentRecovery.deleteMany({ where: { commonOrder } });
    await prisma.order.delete({ where: { id: order.id } });
    if (order.holdId) await prisma.ticketHold.delete({ where: { id: order.holdId } });
    await prisma.user.deleteMany({ where: { email: `${testPrefix}@example.com` } });
  });

  it('excludes POS sources from customer payment recovery', async () => {
    const { PaymentRecoveryService } = await import(
      '../src/modules/checkout/payment-recovery.service'
    );
    const recoveryService = app.get(PaymentRecoveryService);
    expect(recoveryService.isCustomerOnlineSource('pos', false)).toBe(false);
    expect(recoveryService.isCustomerOnlineSource('web', true)).toBe(false);
    expect(recoveryService.isCustomerOnlineSource('web', false)).toBe(true);
  });
});
