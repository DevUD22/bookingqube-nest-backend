import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class PosAuthGuard extends AuthGuard('pos-jwt') {}
