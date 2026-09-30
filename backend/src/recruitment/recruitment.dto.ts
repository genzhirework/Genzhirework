import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min,
} from 'class-validator';

export class RequirementDto {
  @IsString() @Length(2, 120) roleTitle: string;
  @IsInt() @Min(1) @Max(500) openings: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(15) @IsInt({ each: true }) skillIds: number[];
  @IsOptional() @IsString() @MaxLength(200) qualification?: string;
  @IsOptional() @IsIn(['SECONDARY', 'HIGHER_SECONDARY', 'DIPLOMA', 'UG', 'PG', 'DOCTORATE']) minEducationLevel?: string;
  @IsInt() @Min(0) @Max(360) experienceMinMonths: number;
  @IsOptional() @IsInt() @Min(0) @Max(360) experienceMaxMonths?: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @IsString({ each: true }) locations: string[];
  @IsIn(['ONSITE', 'HYBRID', 'REMOTE']) workMode: string;
  @IsOptional() @IsInt() @Min(0) ctcMinPaise?: number;
  @IsOptional() @IsInt() @Min(0) ctcMaxPaise?: number;
  @IsIn(['IMMEDIATE', 'WITHIN_15_DAYS', 'WITHIN_30_DAYS', 'WITHIN_60_DAYS', 'FLEXIBLE']) joiningTimeline: string;
  @IsIn(['DATABASE', 'CONSULTANT', 'BOTH']) fulfilmentMode: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class DecisionDto {
  @IsIn(['ACCEPTED', 'REJECTED']) decision: string;
  @IsOptional() @IsString() @MaxLength(1000) feedback?: string;
}

export class LeftDto {
  @IsDateString() leftOn: string;
  @IsString() @Length(2, 500) reason: string;
}

export class AddCandidateDto {
  @IsUUID() candidateId: string;
  @IsIn(['DATABASE', 'APPLICATION', 'REFERRAL', 'EXTERNAL']) source: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class MoveDto {
  @IsInt() toStageId: number;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class InterviewDto {
  @IsString() @Length(2, 80) roundName: string;
  @IsIn(['IN_PERSON', 'VIDEO', 'PHONE']) mode: string;
  @IsDateString() scheduledStart: string;
  @IsDateString() scheduledEnd: string;
  @IsOptional() @IsString() @MaxLength(300) locationOrLink?: string;
  @IsOptional() @IsString() @MaxLength(200) interviewerNames?: string;
}

export class InterviewUpdateDto {
  @IsOptional() @IsIn(['SCHEDULED', 'RESCHEDULED', 'COMPLETED', 'NO_SHOW', 'CANCELLED']) status?: string;
  @IsOptional() @IsIn(['PENDING', 'PASSED', 'FAILED', 'ON_HOLD']) outcome?: string;
  @IsOptional() @IsString() @MaxLength(2000) feedback?: string;
}

export class OfferDto {
  @IsString() @Length(2, 100) designation: string;
  @IsInt() @Min(1) annualCtcPaise: number;
  @IsDateString() offerDate: string;
  @IsDateString() expectedJoiningDate: string;
}

export class OfferStatusDto {
  @IsIn(['ACCEPTED', 'DECLINED', 'REVOKED']) status: string;
}

export class JoiningDto {
  @IsDateString() joiningDate: string;
}
