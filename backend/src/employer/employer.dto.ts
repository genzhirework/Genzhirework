import {
  ArrayMaxSize, IsArray, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUrl, IsUUID, Length, Matches, Max, MaxLength, Min,
} from 'class-validator';

export class CompanyDto {
  @IsOptional() @IsString() @Length(2, 120) displayName?: string;
  @IsOptional() @IsString() @Length(2, 160) legalName?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(200) website?: string;
  @IsOptional() @IsString() @MaxLength(80) industry?: string;
  @IsOptional() @IsIn(['1_10', '11_50', '51_200', '201_500', '501_1000', '1001_5000', '5000_PLUS']) sizeBand?: string;
  @IsOptional() @IsInt() @Min(1800) @Max(2100) foundedYear?: number;
  @IsOptional() @IsString() @MaxLength(3000) description?: string;
  @IsOptional() @IsString() @MaxLength(80) hqCity?: string;
  @IsOptional() @IsString() @MaxLength(80) hqState?: string;
  @IsOptional() @IsUUID() logoFileId?: string;
}

export class VerificationDto {
  @IsOptional() @IsEmail() officialEmail?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) website?: string;
  @IsOptional() @IsIn(['GSTIN', 'CIN', 'LLPIN', 'UDYAM', 'SHOP_ESTABLISHMENT', 'OTHER']) registrationType?: string;
  @IsOptional() @IsString() @MaxLength(40) registrationNumber?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsUUID('all', { each: true }) documentFileIds?: string[];
  @IsString() @Length(2, 80) contactName: string;
  @Matches(/^\+?[1-9]\d{9,14}$/, { message: 'contactPhone must be a valid number' }) contactPhone: string;
}
