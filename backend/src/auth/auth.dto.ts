import { Equals, IsBoolean, IsEmail, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @Length(1, 128) password: string;
}

class RegisterBase {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @Length(10, 128) password: string;
  @IsString() @Length(1, 60) firstName: string;
  @IsString() @Length(1, 60) lastName: string;
}

export class RegisterCandidateDto extends RegisterBase {
  @IsBoolean() @Equals(true, { message: 'ageConfirmed must be true (18+ only)' }) ageConfirmed: boolean;
  @IsBoolean() discoverable: boolean;
}

export class RegisterEmployerDto extends RegisterBase {
  @IsString() @Length(2, 120) companyName: string;
  @IsOptional() @IsString() @MaxLength(80) designation?: string;
}

export class VerifyEmailDto {
  @IsString() @Length(20, 200) token: string;
}

export class ForgotPasswordDto {
  @IsEmail() email: string;
}

export class ResetPasswordDto {
  @IsString() @Length(20, 200) token: string;
  @IsString() @Length(10, 128) password: string;
}

export class ChangePasswordDto {
  @IsString() @Length(1, 128) currentPassword: string;
  @IsString() @Length(10, 128) newPassword: string;
}

export const APP_PARAM = /^(jobseeker|employer|recruiter|admin)$/;
export class AppParam {
  @Matches(APP_PARAM) app: string;
}
