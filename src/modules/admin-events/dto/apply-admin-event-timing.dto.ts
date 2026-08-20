import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class TimingSlotDto {
  @Matches(TIME_RE) start_time!: string;
  @Matches(TIME_RE) end_time!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) capacity?: number;
  @IsOptional() @IsIn(['weekdays', 'weekends', 'all']) visible_on?: 'weekdays' | 'weekends' | 'all';
}

/** One repeating weekly block: selected ISO weekdays (Mon=1…Sun=7) share these slots. */
export class DayGroupTimingDto {
  @IsArray() @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true }) days!: number[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => TimingSlotDto) @ArrayMaxSize(24) slots!: TimingSlotDto[];
}

export class DailyTimingDto {
  /** basic = same hours; advance = weekday vs weekend buckets; individual = per-day(group) slots */
  @IsIn(['basic', 'advance', 'individual']) style!: 'basic' | 'advance' | 'individual';
  @IsOptional() @IsArray() @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true }) weekdays?: number[];
  @IsOptional() @IsArray() @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true }) weekends?: number[];
  @IsOptional() @IsIn(['weekdays', 'weekends', 'all']) basic_visible_on?: 'weekdays' | 'weekends' | 'all';
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TimingSlotDto) @ArrayMaxSize(24) slots?: TimingSlotDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TimingSlotDto) @ArrayMaxSize(24) weekday_slots?: TimingSlotDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TimingSlotDto) @ArrayMaxSize(24) weekend_slots?: TimingSlotDto[];
  /** Per weekday-group slots (legacy Individual timing). Repeats every week in the date range. */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => DayGroupTimingDto) @ArrayMaxSize(14) day_groups?: DayGroupTimingDto[];
  @IsOptional() @IsArray() @Matches(DATE_RE, { each: true }) @ArrayMaxSize(60) custom_dates?: string[];
}

export class MonthlyTimingDto {
  @IsIn(['EVERY_WEEK', 'FIRST_WEEK', 'SECOND_WEEK', 'THIRD_WEEK', 'LAST_WEEK'])
  visible_in_weeks!: 'EVERY_WEEK' | 'FIRST_WEEK' | 'SECOND_WEEK' | 'THIRD_WEEK' | 'LAST_WEEK';
  @IsArray() @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true }) days!: number[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => TimingSlotDto) @ArrayMaxSize(24) slots!: TimingSlotDto[];
}

export class CustomTimingDto {
  @IsArray() @Matches(DATE_RE, { each: true }) @ArrayMaxSize(90) dates!: string[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => TimingSlotDto) @ArrayMaxSize(24) slots!: TimingSlotDto[];
}

export class ApplyAdminEventTimingDto {
  @IsIn(['preferred', 'daily', 'monthly', 'custom'])
  mode!: 'preferred' | 'daily' | 'monthly' | 'custom';

  @Matches(DATE_RE) start_date!: string;
  @Matches(DATE_RE) end_date!: string;
  @IsOptional() @Matches(TIME_RE) start_time?: string;
  @IsOptional() @Matches(TIME_RE) end_time?: string;

  @IsOptional() @ValidateNested() @Type(() => DailyTimingDto) daily?: DailyTimingDto;
  @IsOptional() @ValidateNested() @Type(() => MonthlyTimingDto) monthly?: MonthlyTimingDto;
  @IsOptional() @ValidateNested() @Type(() => CustomTimingDto) custom?: CustomTimingDto;

  /**
   * When true, sessions get a capacity cap and inventory enforces stock
   * (holds / sold-out). When false, sessions are unlimited.
   */
  @IsOptional() @IsBoolean() track_inventory?: boolean;
  /** Required when track_inventory is true. Ignored when unlimited. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) default_capacity?: number;
  /** When true, delete existing sessions that have no orders before regenerating */
  @IsOptional() @IsBoolean() replace_existing?: boolean;
}
