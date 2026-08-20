import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hashPassword } from '../../common/crypto/password';
import { PrismaService } from '../../database/prisma.service';
import { CreateAdminOrganizationDto } from './dto/create-admin-organization.dto';

@Injectable()
export class AdminOrganizationsService {
  constructor(private readonly prisma: PrismaService) {}
  async list() {
    const organizations = await this.prisma.organization.findMany({ include: { _count: { select: { members: true, events: true } }, members: { where: { role: 'owner', status: 'active' }, include: { user: { select: { name: true, email: true } } }, take: 1 } }, orderBy: { name: 'asc' } });
    return { success: true, data: { organizations: organizations.map((organization) => ({ id: organization.id, slug: organization.slug, name: organization.name, status: organization.status, members: organization._count.members, events: organization._count.events, owner: organization.members[0]?.user ?? null, created_at: organization.createdAt.toISOString() })) } };
  }
  async create(input: CreateAdminOrganizationDto) {
    const name = input.name.trim(); const slug = input.slug?.trim() || this.slugify(name); const email = input.owner_email.trim().toLowerCase();
    try {
      const organization = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({ data: { name: input.owner_name.trim(), email, passwordHash: await hashPassword(input.owner_password), status: 'active' } });
        return tx.organization.create({ data: { name, slug, status: 'active', members: { create: { userId: user.id, role: 'owner', status: 'active' } } }, include: { members: { include: { user: true } } } });
      });
      return { success: true, data: { organization: { id: organization.id, slug: organization.slug, name: organization.name, status: organization.status, owner: { name: organization.members[0].user.name, email: organization.members[0].user.email } } } };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('That organization slug or owner email is already in use.');
      throw error;
    }
  }
  private slugify(value: string) { return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 180); }
}
