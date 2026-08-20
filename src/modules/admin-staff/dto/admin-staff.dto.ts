import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateStaffUserDto {
  @IsString()
  @Length(2, 160)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  role!: string;

  @ValidateIf((body: CreateStaffUserDto) =>
    body.role === 'pos' || body.role === 'cafe_pos',
  )
  @IsString()
  @Length(3, 60)
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'username may only contain letters, numbers, dots, underscores, and hyphens',
  })
  username?: string;

  @ValidateIf((body: CreateStaffUserDto) => body.role !== 'admin')
  @IsUUID()
  organization_id?: string;

  @ValidateIf((body: CreateStaffUserDto) =>
    ['pos', 'scanner', 'event_manager'].includes(body.role),
  )
  @IsUUID()
  event_id?: string;

  @IsOptional()
  @IsUUID()
  third_party_vendor_id?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  third_party_vendor_ids?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  ticket_type_ids?: string[];

  @IsOptional()
  @IsBoolean()
  is_cafe_agent?: boolean;

  @IsOptional()
  @IsUUID()
  managed_by_user_id?: string;
}

export class UpdateStaffUserDto {
  @IsOptional()
  @IsString()
  @Length(2, 160)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== undefined && value !== null && value !== '')
  @IsString()
  @MinLength(8)
  password?: string;

  @IsOptional()
  @IsString()
  @Length(3, 60)
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'username may only contain letters, numbers, dots, underscores, and hyphens',
  })
  username?: string | null;

  @IsOptional()
  @IsEnum(['active', 'suspended'] as const)
  status?: 'active' | 'suspended';

  /** When set, also updates this staff assignment (ThirdPartyVendor / tickets / cafe). */
  @IsOptional()
  @IsUUID()
  assignment_id?: string;

  @IsOptional()
  @IsUUID()
  third_party_vendor_id?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  third_party_vendor_ids?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  ticket_type_ids?: string[];

  @IsOptional()
  @IsBoolean()
  is_cafe_agent?: boolean;

  @IsOptional()
  @IsEnum(['active', 'suspended'] as const)
  assignment_status?: 'active' | 'suspended';
}

export class UpdateStaffAssignmentDto {
  @IsOptional()
  @IsUUID()
  organization_id?: string;

  @IsOptional()
  @IsUUID()
  event_id?: string | null;

  @IsOptional()
  @IsUUID()
  third_party_vendor_id?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  third_party_vendor_ids?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  ticket_type_ids?: string[];

  @IsOptional()
  @IsBoolean()
  is_cafe_agent?: boolean;

  @IsOptional()
  @IsUUID()
  managed_by_user_id?: string | null;

  @IsOptional()
  @IsEnum(['active', 'suspended'] as const)
  status?: 'active' | 'suspended';
}

export class CreateStaffAssignmentDto {
  @IsUUID()
  user_id!: string;

  @IsString()
  role!: string;

  @IsUUID()
  organization_id!: string;

  @ValidateIf((body: CreateStaffAssignmentDto) =>
    ['pos', 'scanner', 'event_manager'].includes(body.role),
  )
  @IsUUID()
  event_id?: string;

  @IsOptional()
  @IsUUID()
  third_party_vendor_id?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  third_party_vendor_ids?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  ticket_type_ids?: string[];

  @IsOptional()
  @IsBoolean()
  is_cafe_agent?: boolean;

  @IsOptional()
  @IsUUID()
  managed_by_user_id?: string;
}
