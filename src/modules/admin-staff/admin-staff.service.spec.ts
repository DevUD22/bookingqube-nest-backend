import { BadRequestException } from '@nestjs/common';

import { AdminStaffService } from './admin-staff.service';

describe('AdminStaffService', () => {
  const prisma = {
    role: { findUnique: jest.fn() },
    organization: { findUnique: jest.fn() },
    event: { findMany: jest.fn() },
    staffAssignment: { findMany: jest.fn() },
    user: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  const service = new AdminStaffService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('createUser requires organization_id for non-admin roles', async () => {
    prisma.role.findUnique.mockResolvedValue({
      id: 'role-pos',
      name: 'pos',
      isThirdPartyShareholder: false,
      permissions: [],
    });

    await expect(
      service.createUser({
        name: 'Agent',
        email: 'agent@example.com',
        password: 'Secret123!',
        role: 'pos',
        username: 'agent1',
        third_party_vendor_ids: ['vendor-1'],
      } as never),
    ).rejects.toThrow(/organization_id is required/);
  });

  it('createUser requires username for POS agents', async () => {
    prisma.role.findUnique.mockResolvedValue({
      id: 'role-pos',
      name: 'pos',
      isThirdPartyShareholder: false,
      permissions: [],
    });

    await expect(
      service.createUser({
        name: 'Agent',
        email: 'agent@example.com',
        password: 'Secret123!',
        role: 'pos',
        organization_id: 'org-1',
        third_party_vendor_ids: ['vendor-1'],
      } as never),
    ).rejects.toThrow(/username is required for POS/);
  });

  it('createUser allows POS without vendors when validateScope allows it', async () => {
    prisma.role.findUnique.mockResolvedValue({
      id: 'role-pos',
      name: 'pos',
      isThirdPartyShareholder: false,
      permissions: [],
    });
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-1' });
    jest.spyOn(service as never, 'validateScope' as never).mockResolvedValue(undefined as never);
    jest
      .spyOn(service as never, 'assertPosUniquePerEvent' as never)
      .mockResolvedValue(undefined as never);
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => {
      const createdUser = {
        id: 'user-1',
        name: 'Agent',
        email: 'agent@example.com',
        username: 'agent1',
        status: 'active',
        adminProfile: null,
        organizationMemberships: [],
        staffAssignments: [],
      };
      const tx = {
        user: {
          create: jest.fn().mockResolvedValue(createdUser),
          findUniqueOrThrow: jest.fn().mockResolvedValue(createdUser),
        },
        staffAssignment: {
          create: jest.fn().mockResolvedValue({}),
          findFirst: jest.fn().mockResolvedValue(null),
        },
        adminProfile: { create: jest.fn() },
        organizationMember: { create: jest.fn() },
      };
      return callback(tx);
    });
    jest.spyOn(service as never, 'serializeUser' as never).mockReturnValue({
      id: 'user-1',
      role: 'pos',
    } as never);

    await expect(
      service.createUser({
        name: 'Agent',
        email: 'agent@example.com',
        password: 'Secret123!',
        role: 'pos',
        username: 'agent1',
        organization_id: 'org-1',
        event_id: 'event-1',
        third_party_vendor_ids: [],
      } as never),
    ).resolves.toEqual({ success: true, data: { user: { id: 'user-1', role: 'pos' } } });
  });

  it('createUser forces role lookup for pos when caller is event_manager', async () => {
    prisma.role.findUnique.mockResolvedValue({
      id: 'role-pos',
      name: 'pos',
      isThirdPartyShareholder: false,
      permissions: [],
    });
    jest.spyOn(service as never, 'applyManagerConstraints' as never).mockResolvedValue({
      roleName: 'pos',
      organizationId: 'org-1',
      eventId: 'event-1',
      thirdPartyVendorId: 'vendor-1',
      thirdPartyVendorIds: ['vendor-1'],
      managedByUserId: 'manager-1',
    } as never);
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-1' });
    jest.spyOn(service as never, 'validateScope' as never).mockResolvedValue(undefined as never);
    jest
      .spyOn(service as never, 'assertPosUniquePerEvent' as never)
      .mockResolvedValue(undefined as never);
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => {
      const createdUser = {
        id: 'user-1',
        name: 'Agent',
        email: 'agent@example.com',
        username: 'agent1',
        status: 'active',
        adminProfile: null,
        organizationMemberships: [],
        staffAssignments: [],
      };
      const tx = {
        user: {
          create: jest.fn().mockResolvedValue(createdUser),
          findUniqueOrThrow: jest.fn().mockResolvedValue(createdUser),
        },
        staffAssignment: {
          create: jest.fn().mockResolvedValue({}),
          findFirst: jest.fn().mockResolvedValue(null),
        },
        adminProfile: { create: jest.fn() },
        organizationMember: { create: jest.fn() },
      };
      return callback(tx);
    });
    jest.spyOn(service as never, 'serializeUser' as never).mockReturnValue({
      id: 'user-1',
      role: 'pos',
    } as never);

    await service.createUser(
      {
        name: 'Agent',
        email: 'agent@example.com',
        password: 'Secret123!',
        role: 'scanner',
        username: 'agent1',
        organization_id: 'org-1',
        third_party_vendor_ids: ['vendor-1'],
      } as never,
      'admin-1',
      { id: 'manager-1', role: 'event_manager' } as never,
    );

    expect(prisma.role.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: 'pos' } }),
    );
  });

  it('assertAssignableRole rejects customer', async () => {
    const assertAssignableRole = (
      service as unknown as {
        assertAssignableRole: (roleName: string) => Promise<unknown>;
      }
    ).assertAssignableRole.bind(service);

    await expect(assertAssignableRole('customer')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('resolveReportEventIds returns null for admin and unions organiser scopes', async () => {
    await expect(service.resolveReportEventIds('user-1', 'admin')).resolves.toBeNull();

    prisma.event.findMany.mockResolvedValue([{ id: 'event-1' }]);
    prisma.staffAssignment.findMany.mockResolvedValue([{ eventId: 'event-2' }]);

    await expect(service.resolveReportEventIds('user-1', 'organiser')).resolves.toEqual([
      'event-1',
      'event-2',
    ]);
  });

  it('resolveReportVendorIds returns null for organiser and scoped ids for shareholder', async () => {
    await expect(service.resolveReportVendorIds('user-1', 'organiser')).resolves.toBeNull();

    prisma.role.findUnique.mockResolvedValue({
      name: 'event_manager',
      isThirdPartyShareholder: true,
    });
    prisma.staffAssignment.findMany.mockResolvedValue([
      { thirdPartyVendorId: 'vendor-1' },
      { thirdPartyVendorId: 'vendor-1' },
      { thirdPartyVendorId: 'vendor-2' },
    ]);

    await expect(service.resolveReportVendorIds('user-1', 'event_manager')).resolves.toEqual([
      'vendor-1',
      'vendor-2',
    ]);
  });
});
