import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
export class LoginDto {
  @IsString() @MinLength(1) @MaxLength(128) identifier!: string;
  @IsString() @MinLength(1) @MaxLength(1024) password!: string;
  @IsOptional() @IsBoolean() remember?: boolean;
}
