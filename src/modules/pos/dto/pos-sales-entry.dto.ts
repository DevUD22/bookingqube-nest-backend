import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

export class PosSalesEntryQueryDto {
  @IsOptional()
  @IsString()
  date?: string;
}

export class SavePosSalesEntryDto {
  @IsString()
  date!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  cash_sales!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  card_sales!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  total_transactions!: number;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  note?: string;
}
