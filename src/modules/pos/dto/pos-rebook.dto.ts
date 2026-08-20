import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class PosRebookCustomizationDto {
  @IsUUID()
  option_id!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreatePosRebookDto {
  @IsUUID()
  ticket_item_id!: string;

  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  extension_ids!: string[];

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PosRebookCustomizationDto)
  customizations!: PosRebookCustomizationDto[];

  @IsIn(['cash', 'card'])
  payment_method!: 'cash' | 'card';

  @IsUUID()
  idempotency_key!: string;
}
