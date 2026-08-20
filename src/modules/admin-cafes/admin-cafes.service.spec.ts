import { BadRequestException } from '@nestjs/common';

import { AdminCafesService } from './admin-cafes.service';

describe('AdminCafesService publish guards', () => {
  const prisma = {
    cafeMenuItem: { count: jest.fn() },
    cafePosAgent: { count: jest.fn() },
    cafe: { update: jest.fn() },
  };

  const service = new AdminCafesService(prisma as never, {
    uploadDataUrl: jest.fn(),
  } as never);

  const baseCafe = {
    id: 'cafe-1',
    name: 'Sky Cafe',
    tableCount: 8,
    activeEventId: 'event-1',
    status: 'draft',
    organizationId: 'org-1',
    managerUserId: null,
    details: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    organization: { id: 'org-1', name: 'Org', slug: 'org' },
    manager: null,
    activeEvent: null,
    categories: [],
    agents: [],
    assignments: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists all publish blockers when cafe is incomplete', async () => {
    prisma.cafeMenuItem.count.mockResolvedValue(0);
    prisma.cafePosAgent.count.mockResolvedValue(0);

    const blockers = await service.getPublishBlockers({
      ...baseCafe,
      name: '',
      tableCount: 0,
      activeEventId: null,
    } as never);

    expect(blockers).toEqual(
      expect.arrayContaining([
        'name_required',
        'table_count_required',
        'active_event_required',
        'menu_item_required',
        'pos_agent_required',
      ]),
    );
  });

  it('returns no blockers when cafe is ready', async () => {
    prisma.cafeMenuItem.count.mockResolvedValue(2);
    prisma.cafePosAgent.count.mockResolvedValue(1);

    const blockers = await service.getPublishBlockers(baseCafe as never);
    expect(blockers).toEqual([]);
  });

  it('rejects publish when blockers exist', async () => {
    jest.spyOn(service as never, 'requireCafe' as never).mockResolvedValue(baseCafe as never);
    prisma.cafeMenuItem.count.mockResolvedValue(0);
    prisma.cafePosAgent.count.mockResolvedValue(0);

    await expect(service.setStatus('cafe-1', 'published')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.cafe.update).not.toHaveBeenCalled();
  });

  it('publishes when readiness checks pass', async () => {
    jest.spyOn(service as never, 'requireCafe' as never).mockResolvedValue(baseCafe as never);
    prisma.cafeMenuItem.count.mockResolvedValue(1);
    prisma.cafePosAgent.count.mockResolvedValue(1);
    prisma.cafe.update.mockResolvedValue({
      ...baseCafe,
      status: 'published',
    });

    const result = await service.setStatus('cafe-1', 'published');
    expect(result.success).toBe(true);
    expect(prisma.cafe.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cafe-1' },
        data: { status: 'published' },
      }),
    );
  });
});
