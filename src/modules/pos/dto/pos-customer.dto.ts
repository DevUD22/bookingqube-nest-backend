import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { POS_AGE_GROUPS, POS_NATIONALITY_LABELS } from '../pos-customer-options';

export class PosCustomerSearchQueryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  limit = 8;
}

export class ResolvePosCustomerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  phone!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsIn([...POS_AGE_GROUPS])
  age_group?: string;

  @IsOptional()
  @IsString()
  @IsIn(POS_NATIONALITY_LABELS, {
    message: 'nationality must be selected from the supported nationality list',
  })
  @MaxLength(80)
  nationality?: string;
}
