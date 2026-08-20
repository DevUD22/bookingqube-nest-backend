import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { PrismaService } from '../../../database/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  typ?: string;
  tv?: number;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const typ = String(payload.typ || '').trim();
    if (typ !== 'customer_access') {
      throw new UnauthorizedException('Invalid or expired session.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });

    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Invalid or expired session.');
    }

    const tokenVersion = Number(payload.tv ?? 0);
    if (tokenVersion !== user.tokenVersion) {
      throw new UnauthorizedException('Invalid or expired session.');
    }

    return { id: user.id, email: user.email, name: user.name };
  }
}
