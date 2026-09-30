import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min,
} from 'class-validator';

export class CandidateSearchDto {
  @IsOptional() @IsString() @MaxLength(120) q?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(15) @IsInt({ each: true }) skillsAll?: number[];
  @IsOptional() @IsArray() @ArrayMaxSize(15) @IsInt({ each: true }) skillsAny?: number[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) cities?: string[];
  @IsOptional() @IsArray() @IsIn(['SECONDARY', 'HIGHER_SECONDARY', 'DIPLOMA', 'UG', 'PG', 'DOCTORATE', 'CERTIFICATE_PROGRAM'], { each: true }) educationLevels?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) degrees?: string[];
  @IsOptional() @IsInt() @Min(1970) @Max(2040) graduationYearMin?: number;
  @IsOptional() @IsInt() @Min(1970) @Max(2040) graduationYearMax?: number;
  @IsOptional() @IsInt() @Min(0) experienceMonthsMin?: number;
  @IsOptional() @IsInt() @Min(0) experienceMonthsMax?: number;
  @IsOptional() @IsInt() @Min(0) expectedCtcMaxPaise?: number;
  @IsOptional() @IsArray() @IsIn(['IMMEDIATE', 'WITHIN_15_DAYS', 'WITHIN_30_DAYS', 'WITHIN_60_DAYS', 'AFTER_GRADUATION'], { each: true }) availability?: string[];
  @IsOptional() @IsArray() @IsIn(['STUDENT', 'FRESHER', 'EMPLOYED', 'INTERNING', 'BETWEEN_JOBS'], { each: true }) employmentStatus?: string[];
  @IsOptional() @IsArray() @IsIn(['ONSITE', 'HYBRID', 'REMOTE'], { each: true }) workModes?: string[];
  @IsOptional() @IsString() @MaxLength(80) certification?: string;
  @IsOptional() @IsBoolean() excludeUnlocked?: boolean;
  @IsOptional() @IsIn(['relevance', 'recently_active', 'graduation_year']) sort?: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) limit?: number;
  @IsOptional() @IsString() @MaxLength(500) cursor?: string;
}

export class ContactRequestDto {
  @IsString() @Length(20, 1000) message: string;
  @IsOptional() @IsUUID() jobId?: string;
}

export class FolderDto {
  @IsString() @Length(1, 60) name: string;
}

export class SaveDto {
  @IsOptional() @IsUUID() folderId?: string;
}

export class NoteDto {
  @IsString() @Length(1, 4000) body: string;
}

export class CompareDto {
  @IsArray() @ArrayMaxSize(3) @IsUUID('all', { each: true }) ids: string[];
}
