import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AdminOrganizationsService } from './admin-organizations.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  getRounds: jest.fn(() => 12),
}));

describe('AdminOrganizationsService', () => {
  const prisma = {
    organization: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };

  const service = new AdminOrganizationsService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('create trims name, lowercases owner email, and hashes password', async () => {
    const tx = {
      user: {
        create: jest.fn().mockResolvedValue({
          id: 'user-1',
          name: 'Owner',
          email: 'owner@example.com',
        }),
      },
      organization: {
        create: jest.fn().mockResolvedValue({
          id: 'org-1',
          slug: 'sky-cafe',
          name: 'Sky Cafe',
          status: 'active',
          members: [
            {
              user: { name: 'Owner', email: 'owner@example.com' },
            },
          ],
        }),
      },
    };
    prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    );

    const result = await service.create({
      name: '  Sky Cafe  ',
      owner_name: '  Owner  ',
      owner_email: '  Owner@Example.com  ',
      owner_password: 'Secret123!',
    });

    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'owner@example.com',
          passwordHash: 'hashed-password',
        }),
      }),
    );
    expect(tx.organization.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Sky Cafe',
          slug: 'sky-cafe',
        }),
      }),
    );
    expect(result.data.organization.slug).toBe('sky-cafe');
    expect(result.data.organization.owner.email).toBe('owner@example.com');
  });

  it('create uses provided slug when set', async () => {
    const tx = {
      user: {
        create: jest.fn().mockResolvedValue({ id: 'user-1', name: 'Owner', email: 'a@b.com' }),
      },
      organization: {
        create: jest.fn().mockResolvedValue({
          id: 'org-1',
          slug: 'custom-slug',
          name: 'Custom',
          status: 'active',
          members: [{ user: { name: 'Owner', email: 'a@b.com' } }],
        }),
      },
    };
    prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    );

    await service.create({
      name: 'Custom',
      slug: 'custom-slug',
      owner_name: 'Owner',
      owner_email: 'a@b.com',
      owner_password: 'Secret123!',
    });

    expect(tx.organization.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ slug: 'custom-slug' }),
      }),
    );
  });

  it('create maps P2002 to ConflictException', async () => {
    prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.create({
        name: 'Dup Org',
        owner_name: 'Owner',
        owner_email: 'dup@example.com',
        owner_password: 'Secret123!',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('slugify strips accents and non-alphanumerics', () => {
    const slugify = (service as unknown as { slugify: (value: string) => string }).slugify;
    expect(slugify('Café Résumé!')).toBe('cafe-resume');
  });
});
