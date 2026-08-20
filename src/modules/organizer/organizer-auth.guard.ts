import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class OrganizerAuthGuard extends AuthGuard('organizer-jwt') {}
