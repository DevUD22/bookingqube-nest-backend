import { Matches } from 'class-validator';

export interface UpdateCustomerProfileDto {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  current_password?: string;
}

export interface UpdateCustomerPasswordDto {
  current?: string;
  password?: string;
  password_confirmation?: string;
}

export class ConfirmEmailChangeDto {
  @Matches(/^\d{6}$/, { message: 'otp must be exactly 6 digits' })
  otp!: string;
}
