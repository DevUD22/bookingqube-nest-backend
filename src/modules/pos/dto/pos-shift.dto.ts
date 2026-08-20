import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class PosShiftQueryDto {
  @IsOptional()
  @Matches(DATE_ONLY)
  date?: string;
}

export class ClosePosShiftDto {
  @Matches(DATE_ONLY)
  date!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  declared_cash!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  declared_card!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
