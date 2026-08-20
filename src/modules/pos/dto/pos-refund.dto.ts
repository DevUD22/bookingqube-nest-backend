import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreatePosRefundDto {
  @IsUUID()
  order_id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
