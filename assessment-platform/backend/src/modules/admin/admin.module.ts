import { Module } from '@nestjs/common';
import { AdminPrismaService } from '../../database/admin-prisma.service';
import { AdminController } from './admin.controller';
import { ManagementRepository } from './repositories/management.repository';
import { AssessmentManagementService } from './assessment-management.service';
import {
  QuestionManagementService,
  QuestionAuthoringSecurity,
} from './question-management.service';
import { AdminReportingService } from './admin-reporting.service';
import { AuthModule } from '../auth/auth.module';
import { InstitutionManagementService } from './institution-management.service';
@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [
    AdminPrismaService,
    ManagementRepository,
    AssessmentManagementService,
    QuestionManagementService,
    QuestionAuthoringSecurity,
    AdminReportingService,
    InstitutionManagementService,
  ],
})
export class AdminModule {}
