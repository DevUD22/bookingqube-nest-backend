import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AdminRolesService } from './admin-roles.service';

describe('AdminRolesService', () => {
  const prisma = {
    role: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
    },
    permission: { findMany: jest.fn() },
    rolePermission: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const service = new AdminRolesService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('create slugifies name and attaches permission ids', async () => {
    prisma.permission.findMany.mockResolvedValue([
      { id: 'perm-1', key: 'panel.access', description: null },
    ]);
    prisma.role.create.mockResolvedValue({
      id: 'role-1',
      name: 'event_manager',
      description: 'Manages events',
      isThirdPartyShareholder: false,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      permissions: [
        {
          permission: { id: 'perm-1', key: 'panel.access', description: null },
        },
      ],
      _count: { admins: 0 },
    });

    const result = await service.create({
      name: 'Event Manager',
      description: 'Manages events',
      permission_keys: ['panel.access'],
    });

    expect(prisma.role.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'event_manager',
          isThirdPartyShareholder: false,
        }),
      }),
    );
    expect(result.data.role.display_name).toBe('Event manager');
    expect(result.data.role.permission_keys).toEqual(['panel.access']);
  });

  it('create rejects empty slugified name', async () => {
    await expect(service.create({ name: '!!!' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create maps unknown permission keys to BadRequestException', async () => {
    prisma.permission.findMany.mockResolvedValue([]);
    await expect(
      service.create({ name: 'ops', permission_keys: ['missing.perm'] }),
    ).rejects.toThrow(/Unknown permission keys/);
  });

  it('create maps P2002 to ConflictException', async () => {
    prisma.permission.findMany.mockResolvedValue([]);
    prisma.role.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.create({ name: 'ops' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('update blocks renaming the protected admin role', async () => {
    prisma.role.findUnique.mockResolvedValue({
      id: 'role-admin',
      name: 'admin',
      permissions: [],
    });

    await expect(service.update('role-admin', { name: 'superadmin' })).rejects.toThrow(
      /admin role name cannot be changed/,
    );
  });

  it('update requires panel.access and admin.access on admin role', async () => {
    prisma.role.findUnique.mockResolvedValue({
      id: 'role-admin',
      name: 'admin',
      permissions: [],
    });
    prisma.permission.findMany.mockResolvedValue([
      { id: 'perm-1', key: 'panel.access', description: null },
    ]);

    await expect(
      service.update('role-admin', { permission_keys: ['panel.access'] }),
    ).rejects.toThrow(/panel.access and admin.access/);
  });

  it('remove blocks protected admin and roles with admins', async () => {
    prisma.role.findUnique.mockResolvedValueOnce({
      id: 'role-admin',
      name: 'admin',
      _count: { admins: 0 },
    });
    await expect(service.remove('role-admin')).rejects.toThrow(/cannot be deleted/);

    prisma.role.findUnique.mockResolvedValueOnce({
      id: 'role-2',
      name: 'ops',
      _count: { admins: 2 },
    });
    await expect(service.remove('role-2')).rejects.toThrow(/assigned to admin users/);
  });

  it('get throws NotFoundException when missing', async () => {
    prisma.role.findUnique.mockResolvedValue(null);
    await expect(service.get('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
