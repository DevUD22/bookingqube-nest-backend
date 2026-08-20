import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpsertEventReviewDto {
  @IsString()
  order_reference!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class UpsertBookingFeedbackDto {
  @IsString()
  order_reference!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class ReviewStatusDto {
  @IsIn(['pending', 'published', 'rejected', 'flagged', 'archived'])
  status!: 'pending' | 'published' | 'rejected' | 'flagged' | 'archived';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  moderator_note?: string;
}
