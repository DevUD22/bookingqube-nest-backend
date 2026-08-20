import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { CreateAdminRoleDto, UpdateAdminRoleDto } from './dto/admin-roles.dto';

const PROTECTED_ROLE_NAMES = new Set(['admin']);

/** Human titles for machine role slugs (underscores / hyphens in storage). */
const ROLE_DISPLAY_NAMES: Record<string, string> = {
  admin: 'Admin',
  organiser: 'Organiser',
  pos: 'POS',
  cafe_pos: 'Cafe POS agent',
  scanner: 'Scanner',
  event_manager: 'Event manager',
  'event-manager': 'Event manager',
  'finance-manager': 'Finance manager',
  finance_manager: 'Finance manager',
  hr: 'HR',
  customer: 'Customer',
};

/** Preserve `_` / `-` from input; spaces become underscores (matches seed: event_manager). */
function slugifyRoleName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/_+/g, '_')
    .replace(/-+/g, '-')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 80);
}

function displayRoleName(name: string) {
  const key = name.trim().toLowerCase();
  return (
    ROLE_DISPLAY_NAMES[key] ??
    ROLE_DISPLAY_NAMES[key.replace(/-/g, '_')] ??
    name.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
  );
}

function permissionGroup(key: string) {
  const [group] = key.split('.');
  return group || 'other';
}

@Injectable()
export class AdminRolesService {
  constructor(private readonly prisma: PrismaService) {}

  async listPermissions() {
    const permissions = await this.prisma.permission.findMany({
      orderBy: { key: 'asc' },
    });
    const groups = new Map<string, typeof permissions>();
    for (const permission of permissions) {
      const group = permissionGroup(permission.key);
      const bucket = groups.get(group) ?? [];
      bucket.push(permission);
      groups.set(group, bucket);
    }
    return {
      success: true,
      data: {
        permissions: permissions.map((permission) => ({
          id: permission.id,
          key: permission.key,
          description: permission.description,
          group: permissionGroup(permission.key),
        })),
        groups: [...groups.entries()].map(([name, items]) => ({
          name,
          permissions: items.map((permission) => ({
            id: permission.id,
            key: permission.key,
            description: permission.description,
          })),
        })),
      },
    };
  }

  async list() {
    const roles = await this.prisma.role.findMany({
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { admins: true } },
      },
      orderBy: { name: 'asc' },
    });

    return {
      success: true,
      data: {
        roles: roles.map((role) => this.serializeRole(role)),
      },
    };
  }

  async get(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { admins: true } },
      },
    });
    if (!role) throw new NotFoundException('Role not found.');
    return { success: true, data: { role: this.serializeRole(role) } };
  }

  async create(input: CreateAdminRoleDto) {
    const name = slugifyRoleName(input.name);
    if (!name) throw new BadRequestException('Role name is required.');

    const permissionIds = await this.resolvePermissionIds(input.permission_keys ?? []);

    try {
      const role = await this.prisma.role.create({
        data: {
          name,
          description: input.description?.trim() || null,
          isThirdPartyShareholder: Boolean(input.is_third_party_shareholder),
          permissions: {
            create: permissionIds.map((permissionId) => ({ permissionId })),
          },
        },
        include: {
          permissions: { include: { permission: true } },
          _count: { select: { admins: true } },
        },
      });
      return { success: true, data: { role: this.serializeRole(role) } };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A role with that name already exists.');
      }
      throw error;
    }
  }

  async update(id: string, input: UpdateAdminRoleDto) {
    const existing = await this.prisma.role.findUnique({
      where: { id },
      include: { permissions: true },
    });
    if (!existing) throw new NotFoundException('Role not found.');

    const nextName =
      input.name !== undefined ? slugifyRoleName(input.name) : existing.name;
    if (!nextName) throw new BadRequestException('Role name is required.');

    if (PROTECTED_ROLE_NAMES.has(existing.name) && nextName !== existing.name) {
      throw new BadRequestException('The admin role name cannot be changed.');
    }

    const permissionIds =
      input.permission_keys !== undefined
        ? await this.resolvePermissionIds(input.permission_keys)
        : null;

    if (
      PROTECTED_ROLE_NAMES.has(existing.name) &&
      permissionIds &&
      (!input.permission_keys?.includes('panel.access') ||
        !input.permission_keys?.includes('admin.access'))
    ) {
      throw new BadRequestException(
        'admin must keep the panel.access and admin.access permissions.',
      );
    }

    try {
      const role = await this.prisma.$transaction(async (tx) => {
        if (permissionIds) {
          await tx.rolePermission.deleteMany({ where: { roleId: id } });
          if (permissionIds.length) {
            await tx.rolePermission.createMany({
              data: permissionIds.map((permissionId) => ({
                roleId: id,
                permissionId,
              })),
            });
          }
        }

        return tx.role.update({
          where: { id },
          data: {
            name: nextName,
            description:
              input.description !== undefined
                ? input.description.trim() || null
                : undefined,
            ...(input.is_third_party_shareholder !== undefined
              ? { isThirdPartyShareholder: Boolean(input.is_third_party_shareholder) }
              : {}),
          },
          include: {
            permissions: { include: { permission: true } },
            _count: { select: { admins: true } },
          },
        });
      });

      return { success: true, data: { role: this.serializeRole(role) } };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A role with that name already exists.');
      }
      throw error;
    }
  }

  async remove(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { admins: true } } },
    });
    if (!role) throw new NotFoundException('Role not found.');
    if (PROTECTED_ROLE_NAMES.has(role.name)) {
      throw new BadRequestException('The admin role cannot be deleted.');
    }
    if (role._count.admins > 0) {
      throw new BadRequestException(
        'This role is assigned to admin users. Reassign them before deleting.',
      );
    }

    await this.prisma.role.delete({ where: { id } });
    return { success: true, data: { deleted: true } };
  }

  private async resolvePermissionIds(keys: string[]) {
    if (!keys.length) return [];
    const permissions = await this.prisma.permission.findMany({
      where: { key: { in: keys } },
    });
    if (permissions.length !== keys.length) {
      const found = new Set(permissions.map((permission) => permission.key));
      const missing = keys.filter((key) => !found.has(key));
      throw new BadRequestException(`Unknown permission keys: ${missing.join(', ')}`);
    }
    return permissions.map((permission) => permission.id);
  }

  private serializeRole(role: {
    id: string;
    name: string;
    description: string | null;
    isThirdPartyShareholder: boolean;
    createdAt: Date;
    permissions: Array<{ permission: { id: string; key: string; description: string | null } }>;
    _count: { admins: number };
  }) {
    const permissionKeys = role.permissions
      .map((item) => item.permission.key)
      .sort((a, b) => a.localeCompare(b));

    return {
      id: role.id,
      name: role.name,
      display_name: displayRoleName(role.name),
      description: role.description,
      is_third_party_shareholder: Boolean(role.isThirdPartyShareholder),
      protected: PROTECTED_ROLE_NAMES.has(role.name),
      admins_count: role._count.admins,
      permission_keys: permissionKeys,
      permissions: role.permissions
        .map((item) => ({
          id: item.permission.id,
          key: item.permission.key,
          description: item.permission.description,
          group: permissionGroup(item.permission.key),
        }))
        .sort((a, b) => a.key.localeCompare(b.key)),
      created_at: role.createdAt.toISOString(),
    };
  }
}
