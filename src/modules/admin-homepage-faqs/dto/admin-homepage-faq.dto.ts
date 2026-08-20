import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

const LOCALES = ['en', 'ar'] as const;
const PUBLISH_STATUSES = ['draft', 'review', 'published', 'archived'] as const;

export class UpsertHomepageFaqDto {
  @IsIn(LOCALES)
  locale!: (typeof LOCALES)[number];

  @IsString()
  @Length(1, 500)
  question!: string;

  @IsString()
  @Length(1, 10_000)
  answer!: string;

  @IsOptional()
  @IsIn(PUBLISH_STATUSES)
  status?: (typeof PUBLISH_STATUSES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  sort_order?: number;
}

export class ReorderHomepageFaqsDto {
  @IsIn(LOCALES)
  locale!: (typeof LOCALES)[number];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  ids!: string[];
}
