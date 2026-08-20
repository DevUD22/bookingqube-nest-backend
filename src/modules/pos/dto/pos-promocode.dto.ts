import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class PosPromoCustomizationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  id!: string;

  @IsInt()
  @Min(1)
  qty!: number;
}

export class PosPromoTicketDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  ticket_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  variant_id?: string | null;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PosPromoCustomizationDto)
  customization_options?: PosPromoCustomizationDto[];
}

export class ApplyPosPromocodeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  code!: string;

  @IsUUID()
  customer_id!: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PosPromoTicketDto)
  tickets!: PosPromoTicketDto[];
}
