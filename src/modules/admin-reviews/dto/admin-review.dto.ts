import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class AdminReviewsQueryDto {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsIn(['all', 'pending', 'published', 'rejected', 'flagged', 'archived']) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) per_page?: number;
}

export class UpdateReviewStatusDto {
  @IsIn(['pending', 'published', 'rejected', 'flagged', 'archived']) status!: 'pending' | 'published' | 'rejected' | 'flagged' | 'archived';
  @IsOptional() @IsString() @MaxLength(1000) moderator_note?: string;
}

export class UpdateReviewSettingsDto {
  @IsBoolean() reviews_enabled!: boolean;
  @IsBoolean() booking_feedback_enabled!: boolean;
  @IsBoolean() require_checked_in!: boolean;
  @IsBoolean() auto_publish!: boolean;
  @IsBoolean() allow_comments!: boolean;
  @IsBoolean() show_on_event_pages!: boolean;
  @IsBoolean() show_on_homepage_cards!: boolean;
  @IsInt() @Min(1) @Max(100) minimum_review_count!: number;
  @IsInt() @Min(0) @Max(10080) default_opens_after_minutes!: number;
  @IsInt() @Min(1) @Max(365) default_closes_after_days!: number;
}

export class UpdateEventReviewSettingsDto {
  @IsOptional() @IsBoolean() reviews_enabled?: boolean | null;
  @IsOptional() @IsInt() @Min(0) @Max(10080) review_opens_after_minutes?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(365) review_closes_after_days?: number | null;
}
