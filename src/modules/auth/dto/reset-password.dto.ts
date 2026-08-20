import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsEmail()
  email!: string;

  @Matches(/^\d{6}$/, { message: 'otp must be exactly 6 digits' })
  otp!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  password_confirmation!: string;
}
