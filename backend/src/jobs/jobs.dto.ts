import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Length, Max,
  MaxLength, Min, ValidateNested,
} from 'class-validator';

class LocationDto {
  @IsString() @Length(2, 80) city: string;
  @IsString() @Length(2, 80) state: string;
}

export class JobDto {
  @IsString() @Length(3, 120) title: string;
  @IsOptional() @IsString() @MaxLength(80) department?: string;
  @IsString() @Length(50, 10000) description: string;
  @IsOptional() @IsString() @MaxLength(5000) responsibilities?: string;
  @IsOptional() @IsString() @MaxLength(5000) requirements?: string;
  @IsOptional() @IsIn(['SECONDARY', 'HIGHER_SECONDARY', 'DIPLOMA', 'UG', 'PG', 'DOCTORATE']) minEducationLevel?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) qualifications?: string[];
  @IsInt() @Min(0) @Max(360) experienceMinMonths: number;
  @IsOptional() @IsInt() @Min(0) @Max(360) experienceMaxMonths?: number;
  @IsOptional() @IsInt() @Min(0) salaryMinPaise?: number;
  @IsOptional() @IsInt() @Min(0) salaryMaxPaise?: number;
  @IsOptional() @IsIn(['ANNUAL', 'MONTHLY']) salaryPeriod?: string;
  @IsOptional() @IsBoolean() salaryVisible?: boolean;
  @IsIn(['ONSITE', 'HYBRID', 'REMOTE']) workMode: string;
  @IsIn(['FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT', 'APPRENTICESHIP']) employmentType: string;
  @IsInt() @Min(1) @Max(1000) openings: number;
  @IsOptional() @IsDateString() applicationDeadline?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => LocationDto) locations: LocationDto[];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(15) @IsInt({ each: true }) skillIds: number[];
}

export class ReportDto {
  @IsIn(['FAKE_JOB', 'SCAM_PAYMENT_REQUEST', 'SPAM', 'HARASSMENT', 'DISCRIMINATION', 'MISLEADING', 'OTHER']) reason: string;
  @IsOptional() @IsString() @MaxLength(1000) details?: string;
}
