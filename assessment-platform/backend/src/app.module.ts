import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
import { SessionGuard } from './common/guards/session.guard';
import { ApiExceptionFilter, ApiResponseInterceptor } from './common/http/api-response';
import { validateEnvironment } from './config/environment';
import { AuthModule } from './modules/auth/auth.module';
import { StudentsModule } from './modules/students/students.module';
import { AssessmentsModule } from './modules/assessments/assessments.module';
import { QuestionsModule } from './modules/questions/questions.module';
import { AttemptsModule } from './modules/attempts/attempts.module';
import { SubmissionsModule } from './modules/submissions/submissions.module';
import { ExecutionModule } from './modules/execution/execution.module';
import { ResultsModule } from './modules/results/results.module';
import { AdminModule } from './modules/admin/admin.module';
import { HealthModule } from './modules/health/health.module';
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnvironment }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        genReqId: () => randomUUID(),
        redact: {
          paths: [
            'req.headers.cookie',
            'req.headers.authorization',
            'req.headers["x-csrf-token"]',
            'req.body.password',
            'req.body.passwordHash',
            'req.body.sourceCode',
            'req.body.testCases',
            'req.body.hiddenTestCases',
            'req.body.input',
            'req.body.expectedOutput',
            'res.headers["set-cookie"]',
            'password',
            'passwordHash',
            'sourceCode',
            'input',
            'expectedOutput',
          ],
          censor: '[REDACTED]',
        },
      },
    }),
    DatabaseModule,
    AuthModule,
    StudentsModule,
    AssessmentsModule,
    QuestionsModule,
    AttemptsModule,
    SubmissionsModule,
    ExecutionModule,
    ResultsModule,
    AdminModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor },
  ],
})
export class AppModule {}
