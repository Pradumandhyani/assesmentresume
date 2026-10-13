import { Injectable } from '@nestjs/common';
import { AttemptsService } from './attempts.service';

@Injectable()
export class AttemptHeartbeatService {
  constructor(private readonly attempts: AttemptsService) {}
  heartbeat(studentId: string, attemptId: string) {
    return this.attempts.withActive(studentId, attemptId, async (tx, row, now) => {
      // The database clock and ownership-locked lifecycle govern all heartbeats.
      // Coalesce rapid requests; this observation is never a cheating verdict.
      const lastHeartbeatAt =
        row.lastHeartbeatAt && now.getTime() - row.lastHeartbeatAt.getTime() < 15000
          ? row.lastHeartbeatAt
          : now;
      if (lastHeartbeatAt === now)
        await tx.assessmentAttempt.update({
          where: { id: row.id },
          data: { lastHeartbeatAt },
        });
      return {
        attemptId: row.id,
        status: 'IN_PROGRESS' as const,
        lastHeartbeatAt: lastHeartbeatAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      };
    });
  }
}
