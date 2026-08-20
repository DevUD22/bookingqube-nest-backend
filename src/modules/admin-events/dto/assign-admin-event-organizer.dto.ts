import { IsOptional, IsUUID } from 'class-validator';

export class AssignAdminEventOrganizerDto {
  @IsOptional()
  @IsUUID()
  organizer_user_id?: string | null;
}
