import { IsEmail, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsEmail()
  email!: string;

  @Matches(/^\d{6}$/, { message: 'otp must be exactly 6 digits' })
  otp!: string;
}
