import {
  IsEmail,
  IsNotEmpty,
  Matches,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class AdminLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'TOTP code must be a 6-digit number.' })
  totp_code?: string;
}

export class AdminRefreshDto {
  @IsString()
  @IsNotEmpty()
  refresh_token!: string;
}

export class AdminLogoutDto extends AdminRefreshDto {}

export class AdminMfaEnrollDto {
  @IsString()
  @IsNotEmpty()
  challenge_token!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'TOTP code must be a 6-digit number.' })
  totp_code!: string;
}

export class UpdateAdminProfileDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  current_password?: string;

  @IsOptional()
  @IsString()
  @ValidateIf((body: UpdateAdminProfileDto) => Boolean(body.new_password?.trim()))
  @MinLength(8)
  new_password?: string;

  @IsOptional()
  @IsString()
  new_password_confirmation?: string;
}

export class UploadAdminAvatarDto {
  @IsString()
  @IsNotEmpty()
  data_url!: string;

  @IsOptional()
  @IsString()
  file_name?: string;
}
