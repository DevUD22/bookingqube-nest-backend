import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class CafePosAuthGuard extends AuthGuard('cafe-pos-jwt') {}
