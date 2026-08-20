import { ArrayMaxSize, IsArray, IsOptional, IsString, Length } from 'class-validator';

export class PosOnlineTicketSearchDto {
  @IsString()
  @Length(3, 160)
  q!: string;
}

export class UsePosOnlineTicketDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  rfids?: string[];
}
