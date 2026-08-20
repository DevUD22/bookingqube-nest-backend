export type RegistrationFieldTypeDto =
  | 'text'
  | 'email'
  | 'phone'
  | 'textarea'
  | 'radio'
  | 'checkbox'
  | 'dropdown'
  | 'file'
  | 'hidden';

export interface RegistrationFormFieldDto {
  id: number;
  label: string;
  field_name: string;
  field_type: RegistrationFieldTypeDto;
  field_options: string[];
  is_required: boolean;
  is_unique: boolean;
  sort_order: number;
  is_hidden: boolean;
  default_value?: string;
  file_size?: string | null;
  file_type?: string | null;
}

export interface RegistrationFormEventDto {
  id: string;
  slug: string;
  title: string;
  description: string;
  date_label: string;
  start_date: string | null;
  end_date: string | null;
  venue: string;
  location: string;
  banner_image_url: string;
  event_type: string;
  is_registration_only: boolean;
  booking_mode: 'registration' | 'ticketed';
  private_registration: boolean;
  enable_registration_mail: boolean;
}

export interface RegistrationFormDataDto {
  event: RegistrationFormEventDto;
  registration_form_fields: RegistrationFormFieldDto[];
  file_fields: string[];
}

export interface RegistrationFormApiResponseDto {
  success: true;
  data: RegistrationFormDataDto;
}

export interface RegistrationSubmitSuccessDto {
  success: true;
  message: string;
  data: {
    event_id: number;
    registration_no: string;
    qrcode_url: string | null;
    email_sent: boolean;
    created_count: number;
    failed_count: number;
    registrations: Array<{
      registration_no: string;
      qrcode_url: string | null;
      email_sent: boolean;
    }>;
    errors: unknown[];
  };
}

export interface RegistrationSubmitFailureDto {
  success: false;
  message: string;
  errors?: Record<string, string>;
}
