export type ScheduleStatus = 'available' | 'fully_booked';
export type TimeSlotStatus = 'available' | 'booked';
export type TimingMode = 'preferred' | 'daily' | 'custom' | 'monthly' | string;

export interface ScheduleTimeSlotDto {
  time: string;
  status: TimeSlotStatus;
}

export interface ScheduleDateDto {
  date: string;
  day_label: string;
  month_label: string;
  status: ScheduleStatus;
  time_slots: ScheduleTimeSlotDto[];
}

export interface SchedulePaginationDto {
  current_page: number;
  last_page: number;
  months_per_page: number;
  from_date: string;
  to_date: string;
  total_dates: number;
  has_more: boolean;
}

export interface EventScheduleDto {
  /** preferred = single booking window (no time-slot picker). daily/custom/monthly = stepped slots. */
  timing_mode: TimingMode | null;
  /** False for preferred / single-window events — customer app should hide "Select a time". */
  requires_time_selection: boolean;
  schedule: ScheduleDateDto[];
  pagination: SchedulePaginationDto;
}

export interface EventScheduleApiResponseDto {
  success: true;
  data: EventScheduleDto;
}
