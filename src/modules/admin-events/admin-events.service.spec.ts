import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { AdminEventsService } from './admin-events.service';

describe('AdminEventsService', () => {
  const prisma = {
    venue: { findUnique: jest.fn() },
    eventCategory: { findUnique: jest.fn() },
    organization: { findFirst: jest.fn(), findUnique: jest.fn() },
    event: {
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    },
  };

  const mediaStorage = {
    storeFile: jest.fn(),
    uploadBuffer: jest.fn(),
    uploadDataUrl: jest.fn(),
    uploadDataUrlFileOnly: jest.fn(),
  };

  const service = new AdminEventsService(prisma as never, mediaStorage as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('create rejects arabic_content without title_ar', async () => {
    await expect(
      service.create(
        {
          title: 'Family Day',
          event_type: 'general',
          booking_mode: 'ticketed',
          visibility: 'public',
          arabic_content: true,
        } as never,
        'admin-1',
      ),
    ).rejects.toThrow(/Arabic title is required/);
  });

  it('create rejects general events that are not ticketed', async () => {
    await expect(
      service.create(
        {
          title: 'Family Day',
          event_type: 'general',
          booking_mode: 'registration',
          visibility: 'public',
        } as never,
        'admin-1',
      ),
    ).rejects.toThrow(/must use ticketed booking/);
  });

  it('create rejects end date before start date', async () => {
    await expect(
      service.create(
        {
          title: 'Family Day',
          event_type: 'general',
          booking_mode: 'ticketed',
          visibility: 'public',
          starts_at: '2026-08-10T10:00:00.000Z',
          ends_at: '2026-08-09T10:00:00.000Z',
        } as never,
        'admin-1',
      ),
    ).rejects.toThrow(/End date must be after/);
  });

  it('create writes English and Arabic translations', async () => {
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-1' });
    prisma.event.create.mockResolvedValue({
      id: 'event-1',
      slug: 'family-day',
      eventType: 'general',
      bookingMode: 'ticketed',
      visibility: 'public',
      status: 'draft',
      requiresWaiver: false,
      isFeatured: false,
      seatSelectionEnabled: false,
      currency: 'QAR',
      startsAt: null,
      endsAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      organizationId: 'org-1',
      organization: { id: 'org-1', name: 'Org', slug: 'org' },
      venue: null,
      category: null,
      translations: [
        { locale: 'en', title: 'Family Day', subtitle: null, description: null },
        { locale: 'ar', title: 'يوم عائلي', subtitle: null, description: null },
      ],
      media: [],
      ticketTypes: [],
      primaryOrganizer: null,
      moreOpsConfig: null,
      seatsIoEventKey: null,
      seatsIoChartKey: null,
    });
    jest.spyOn(service as never, 'toDto' as never).mockReturnValue({
      id: 'event-1',
      title: 'Family Day',
      title_ar: 'يوم عائلي',
    } as never);

    const result = await service.create(
      {
        title: 'Family Day',
        title_ar: ' يوم عائلي ',
        event_type: 'general',
        booking_mode: 'ticketed',
        visibility: 'public',
      } as never,
      'admin-1',
    );

    expect(prisma.event.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          translations: {
            create: expect.arrayContaining([
              expect.objectContaining({ locale: 'en', title: 'Family Day' }),
              expect.objectContaining({ locale: 'ar', title: 'يوم عائلي' }),
            ]),
          },
        }),
      }),
    );
    expect((result.data.event as { title_ar?: string }).title_ar).toBe('يوم عائلي');
  });

  it('deleteEvent rejects events that already have orders', async () => {
    prisma.event.findUnique.mockResolvedValue({
      id: 'event-1',
      _count: { orders: 3 },
    });

    await expect(service.deleteEvent('event-1')).rejects.toThrow(/cannot be deleted/);
  });

  it('assertEventReadyToPublish collects readiness issues', async () => {
    prisma.event.findUnique.mockResolvedValue({
      id: 'event-1',
      startsAt: null,
      endsAt: null,
      bookingMode: 'ticketed',
      translations: [{ locale: 'en', title: '' }],
      ticketTypes: [],
      media: [],
    });

    const assertEventReadyToPublish = (
      service as unknown as {
        assertEventReadyToPublish: (eventId: string) => Promise<unknown>;
      }
    ).assertEventReadyToPublish.bind(service);

    await expect(assertEventReadyToPublish('event-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('assertThirdPartyVendorRules rejects invalid share totals and duplicates', () => {
    const assertThirdPartyVendorRules = (
      service as unknown as {
        assertThirdPartyVendorRules: (
          rows: Array<{
            name: string;
            organiser_share: number;
            vendor_share: number;
            owner_name?: string;
            owner_percentage_type?: string;
          }>,
        ) => void;
      }
    ).assertThirdPartyVendorRules.bind(service);

    expect(() =>
      assertThirdPartyVendorRules([
        { name: 'Vendor A', organiser_share: 40, vendor_share: 40 },
      ]),
    ).toThrow(BadRequestException);

    expect(() =>
      assertThirdPartyVendorRules([
        { name: 'Vendor A', organiser_share: 50, vendor_share: 50, owner_name: 'Owner', owner_percentage_type: 'percent' },
        { name: 'vendor a', organiser_share: 50, vendor_share: 50 },
      ]),
    ).toThrow(ConflictException);
  });

  it('deleteEvent throws NotFoundException when missing', async () => {
    prisma.event.findUnique.mockResolvedValue(null);
    await expect(service.deleteEvent('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
