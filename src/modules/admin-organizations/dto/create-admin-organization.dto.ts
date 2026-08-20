import { IsEmail, IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateAdminOrganizationDto {
  @IsString() @Length(2, 160) name!: string;
  @IsOptional() @IsString() @Length(2, 180) @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) slug?: string;
  @IsString() @Length(2, 160) owner_name!: string;
  @IsEmail() owner_email!: string;
  @IsString() @Length(8, 128) owner_password!: string;
}
