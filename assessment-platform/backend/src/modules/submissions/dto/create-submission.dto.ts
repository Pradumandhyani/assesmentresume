import { IsIn, IsString, IsUUID, MaxLength } from 'class-validator';
import type { Language } from '../../../database/generated/client';
export class CreateSubmissionDto {
  @IsUUID() attemptQuestionId!: string;
  @IsIn(['PYTHON', 'JAVA', 'CPP']) language!: Language;
  @IsString() @MaxLength(65536) sourceCode!: string;
}
export class QuestionSubmissionDto {
  @IsIn(['PYTHON', 'JAVA', 'CPP']) language!: Language;
  @IsString() @MaxLength(65536) sourceCode!: string;
}
