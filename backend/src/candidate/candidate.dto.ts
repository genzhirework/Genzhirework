import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUrl, IsUUID,
  Length, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

const WORK_MODES = ['ONSITE', 'HYBRID', 'REMOTE'];
const EMP_TYPES = ['FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT', 'APPRENTICESHIP'];

class LinkDto {
  @IsIn(['LINKEDIN', 'GITHUB', 'PORTFOLIO', 'OTHER']) type: string;
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true }) @MaxLength(300) url: string;
}

export class UpdateProfileDto {
  @IsOptional() @IsString() @Length(1, 60) firstName?: string;
  @IsOptional() @IsString() @Length(1, 60) lastName?: string;
  @IsOptional() @Matches(/^\+?[1-9]\d{9,14}$/, { message: 'phone must be a valid number, e.g. +919876543210' }) phone?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(80) state?: string;
  @IsOptional() @IsString() @MaxLength(140) headline?: string;
  @IsOptional() @IsString() @MaxLength(2000) summary?: string;
  @IsOptional() @IsString() @MaxLength(100) targetRole?: string;
  @IsOptional() @IsString() @MaxLength(100) currentJobTitle?: string;
  @IsOptional() @IsIn(['STUDENT', 'FRESHER', 'EMPLOYED', 'INTERNING', 'BETWEEN_JOBS']) employmentStatus?: string;
  @IsOptional() @IsInt() @Min(0) @Max(600) totalExperienceMonths?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) expectedCtcMinPaise?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) expectedCtcMaxPaise?: number;
  @IsOptional() @IsIn(['IMMEDIATE', 'WITHIN_15_DAYS', 'WITHIN_30_DAYS', 'WITHIN_60_DAYS', 'AFTER_GRADUATION']) availability?: string;
  @IsOptional() @IsArray() @IsIn(WORK_MODES, { each: true }) preferredWorkModes?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(80, { each: true }) preferredCities?: string[];
  @IsOptional() @IsArray() @IsIn(EMP_TYPES, { each: true }) preferredEmploymentTypes?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(6) @ValidateNested({ each: true }) @Type(() => LinkDto) links?: LinkDto[];
}

export class EducationDto {
  @IsIn(['SECONDARY', 'HIGHER_SECONDARY', 'DIPLOMA', 'UG', 'PG', 'DOCTORATE', 'CERTIFICATE_PROGRAM']) level: string;
  @IsOptional() @IsString() @MaxLength(80) degree?: string;
  @IsOptional() @IsString() @MaxLength(120) specialization?: string;
  @IsString() @Length(2, 160) institution: string;
  @IsOptional() @IsString() @MaxLength(160) universityBoard?: string;
  @IsOptional() @IsInt() @Min(1970) @Max(2040) startYear?: number;
  @IsOptional() @IsInt() @Min(1970) @Max(2040) graduationYear?: number;
  @IsOptional() @IsBoolean() isPursuing?: boolean;
  @IsOptional() @IsIn(['CGPA_10', 'CGPA_4', 'PERCENTAGE']) scoreType?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) score?: number;
}

export class ExperienceDto {
  @IsString() @Length(1, 120) companyName: string;
  @IsString() @Length(1, 120) title: string;
  @IsIn(['FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'APPRENTICESHIP', 'FREELANCE', 'CONTRACT']) employmentType: string;
  @IsOptional() @IsString() @MaxLength(80) location?: string;
  @IsDateString() startDate: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsBoolean() isCurrent?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
}

export class ProjectDto {
  @IsString() @Length(1, 120) title: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(80) role?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(300) projectUrl?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(300) repoUrl?: string;
}

export class CertificationDto {
  @IsString() @Length(1, 160) name: string;
  @IsString() @Length(1, 120) issuer: string;
  @IsOptional() @IsDateString() issueDate?: string;
  @IsOptional() @IsString() @MaxLength(80) credentialId?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(300) credentialUrl?: string;
}

class SkillItem {
  @IsInt() skillId: number;
  @IsOptional() @IsIn(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']) proficiency?: string;
}
export class SkillsDto {
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => SkillItem) skills: SkillItem[];
}

export class ResumeDto {
  @IsUUID() fileId: string;
  @IsOptional() @IsString() @MaxLength(60) label?: string;
}
export class ResumePatchDto {
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsString() @MaxLength(60) label?: string;
}

export class VisibilityDto {
  @IsIn(['PUBLIC', 'EMPLOYER_VISIBLE', 'APPLICATION_ONLY', 'HIDDEN']) level: string;
  @IsOptional() @IsBoolean() openToWork?: boolean;
}

export class ConsentDto {
  @IsIn(['DATABASE_DISCOVERY', 'RECRUITER_OUTREACH', 'MARKETING_EMAIL', 'MARKETING_SMS', 'WHATSAPP']) purpose: string;
  @IsBoolean() granted: boolean;
}

export class BlockEmployerDto {
  @IsUUID() employerId: string;
}

export class ApplyDto {
  @IsUUID() resumeId: string;
  @IsOptional() @IsString() @MaxLength(1000) coverNote?: string;
}
