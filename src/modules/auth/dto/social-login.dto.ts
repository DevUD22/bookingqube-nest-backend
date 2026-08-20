import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class SocialLoginDto {
  @IsIn(['google', 'apple'])
  provider!: 'google' | 'apple';

  @IsString()
  @IsNotEmpty()
  access_token!: string;

  @IsString()
  other_data!: string;
}
