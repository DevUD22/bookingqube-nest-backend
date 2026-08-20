import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class PosLoginDto {
  /** Email or username of the POS agent. */
  @IsString()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  /** Optional when the agent has multiple event assignments. */
  @IsOptional()
  @IsUUID()
  event_id?: string;
}
