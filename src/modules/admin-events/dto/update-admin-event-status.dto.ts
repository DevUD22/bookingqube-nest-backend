import { IsIn } from 'class-validator';

export class UpdateAdminEventStatusDto {
  @IsIn(['archived', 'draft'])
  status!: 'archived' | 'draft';
}
