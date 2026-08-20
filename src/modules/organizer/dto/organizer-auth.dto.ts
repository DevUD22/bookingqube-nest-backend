import { IsEmail, IsOptional, IsString, Length, Matches } from 'class-validator';

export class OrganizerLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(8, 128)
  password!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  organization_slug?: string;
}

export class OrganizerRefreshDto {
  @IsString()
  refresh_token!: string;
}

export class OrganizerLogoutDto extends OrganizerRefreshDto {}
