import { IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import type { Language } from '../../../database/generated/client';
export class SaveDraftDto {
  @IsString() @MaxLength(65536) sourceCode!: string;
  @IsInt() @Min(0) @Max(2147483646) expectedRevision!: number;
}
export class SelectLanguageDto {
  @IsIn(['PYTHON', 'JAVA', 'CPP']) language!: Language;
  @IsInt() @Min(1) expectedStateVersion!: number;
}
export class FinalizeAttemptDto {
  @IsInt() @Min(1) expectedStateVersion!: number;
}
