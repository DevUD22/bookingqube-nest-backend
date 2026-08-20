import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Kept so Nest incremental compile does not stall after the POS-only guard switch. */
@Injectable()
export class PosOrAdminAuthGuard extends AuthGuard('pos-jwt') {}
