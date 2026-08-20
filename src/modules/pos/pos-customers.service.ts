import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../database/prisma.service';
import {
  PosCustomerSearchQueryDto,
  ResolvePosCustomerDto,
} from './dto/pos-customer.dto';
import { AuthenticatedPosAgent } from './strategies/pos-jwt.strategy';

const INTERNAL_EMAIL_DOMAIN = '@bookingqube.local';

@Injectable()
export class PosCustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async search(agent: AuthenticatedPosAgent, query: PosCustomerSearchQueryDto) {
    await this.assertActiveAgent(agent);

    const rawQuery = query.q.trim();
    const normalizedEmail = rawQuery.toLowerCase();
    const normalizedPhone = this.tryNormalizePhone(rawQuery);
    const organizationScope: Prisma.UserWhereInput = {
      orders: { some: { organizationId: agent.organizationId } },
    };

    const scopedIdentityFilters: Prisma.UserWhereInput[] = [
      { name: { contains: rawQuery, mode: 'insensitive' } },
      { email: { contains: normalizedEmail, mode: 'insensitive' } },
    ];
    const globalExactFilters: Prisma.UserWhereInput[] = [];
    if (normalizedPhone) {
      globalExactFilters.push({ phone: normalizedPhone });
    }
    if (rawQuery.includes('@')) {
      globalExactFilters.push({ email: normalizedEmail });
    }
    const phoneDigits = rawQuery.replace(/\D/g, '');
    if (phoneDigits.length >= 3) {
      scopedIdentityFilters.push({ phone: { contains: phoneDigits } });
    }

    const customers = await this.prisma.user.findMany({
      where: {
        status: 'active',
        OR: [
          { AND: [organizationScope, { OR: scopedIdentityFilters }] },
          ...globalExactFilters,
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        customerProfile: true,
        orders: {
          where: { organizationId: agent.organizationId },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
        _count: {
          select: {
            orders: { where: { organizationId: agent.organizationId } },
          },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
      take: query.limit,
    });

    const rows = await Promise.all(
      customers.map(async (customer) => ({
        ...this.toPublicCustomer(customer),
        total_orders: customer._count.orders,
        event_orders: await this.prisma.order.count({
          where: { customerId: customer.id, eventId: agent.eventId },
        }),
        last_order_at: customer.orders[0]?.createdAt?.toISOString() ?? null,
      })),
    );

    return { success: true, data: { customers: rows } };
  }

  async resolve(agent: AuthenticatedPosAgent, body: ResolvePosCustomerDto) {
    await this.assertActiveAgent(agent);

    const name = body.name.trim();
    if (!name) throw new BadRequestException('Customer name is required.');

    const phone = this.normalizePhone(body.phone);
    const email = body.email?.trim().toLowerCase() || null;
    const ageGroup = body.age_group?.trim() || null;
    const nationality = body.nationality?.trim() || null;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const [phoneUser, emailUser] = await Promise.all([
          tx.user.findUnique({ where: { phone } }),
          email ? tx.user.findUnique({ where: { email } }) : Promise.resolve(null),
        ]);

        if (phoneUser && emailUser && phoneUser.id !== emailUser.id) {
          throw this.identityConflict();
        }

        const existing = phoneUser ?? emailUser;
        if (existing) {
          const mayReplaceInternalEmail = existing.email.endsWith(INTERNAL_EMAIL_DOMAIN);
          const customer = await tx.user.update({
            where: { id: existing.id },
            data: {
              // Resolving an identity must not silently overwrite a returning customer's
              // profile with potentially mistyped details from the create form.
              phone: existing.phone ?? phone,
              ...(email && mayReplaceInternalEmail ? { email } : {}),
              customerProfile: {
                upsert: {
                  create: {
                    ageGroup: ageGroup ?? undefined,
                    nationality: nationality ?? undefined,
                  } as Prisma.CustomerProfileCreateWithoutUserInput,
                  update: {
                    ...(ageGroup ? { ageGroup } : {}),
                    ...(nationality ? { nationality } : {}),
                  } as Prisma.CustomerProfileUpdateWithoutUserInput,
                },
              },
            },
            include: { customerProfile: true },
          });
          return {
            customer,
            created: false,
            matchedBy: phoneUser ? 'phone' : 'email',
          };
        }

        const customer = await tx.user.create({
          data: {
            name,
            phone,
            email: email ?? `pos-${randomUUID()}${INTERNAL_EMAIL_DOMAIN}`,
            customerProfile: {
              create: {
                ageGroup: ageGroup ?? undefined,
                nationality: nationality ?? undefined,
              } as Prisma.CustomerProfileCreateWithoutUserInput,
            },
          },
          include: { customerProfile: true },
        });
        return { customer, created: true, matchedBy: null };
      });

      return {
        success: true,
        data: {
          customer: this.toPublicCustomer(result.customer),
          created: result.created,
          matched_by: result.matchedBy,
        },
      };
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          code: 'CUSTOMER_ALREADY_EXISTS',
          message: 'A customer with this phone number or email already exists. Search again.',
        });
      }
      throw error;
    }
  }

  private async assertActiveAgent(agent: AuthenticatedPosAgent) {
    const assignment = await this.prisma.staffAssignment.findFirst({
      where: {
        id: agent.assignmentId,
        userId: agent.id,
        eventId: agent.eventId,
        status: 'active',
        role: { name: 'pos' },
      },
      select: { id: true },
    });
    if (!assignment) throw new UnauthorizedException('Invalid or expired POS session.');
  }

  private normalizePhone(value: string) {
    const phone = this.tryNormalizePhone(value);
    if (!phone) {
      throw new BadRequestException(
        'Enter a valid mobile number, including the country code when outside Qatar.',
      );
    }
    return phone;
  }

  private tryNormalizePhone(value: string) {
    let compact = value.trim().replace(/[\s().-]/g, '');
    if (!compact) return null;
    if (compact.startsWith('00')) compact = `+${compact.slice(2)}`;
    if (/^\d{8}$/.test(compact)) compact = `+974${compact}`;
    if (/^974\d{8}$/.test(compact)) compact = `+${compact}`;
    return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
  }

  private identityConflict() {
    return new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      code: 'CUSTOMER_IDENTITY_CONFLICT',
      message: 'This phone number and email belong to different customer accounts.',
    });
  }

  private toPublicCustomer(
    customer: Pick<User, 'id' | 'name' | 'email' | 'phone'> & {
      customerProfile?: { ageGroup: string | null; nationality: string | null } | null;
    },
  ) {
    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email.endsWith(INTERNAL_EMAIL_DOMAIN) ? null : customer.email,
      age_group: customer.customerProfile?.ageGroup ?? null,
      nationality: customer.customerProfile?.nationality ?? null,
    };
  }
}
