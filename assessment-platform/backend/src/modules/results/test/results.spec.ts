import { terminalVerdict } from '../../../workers/judge/judge-service';
import type { BrokerResult } from '../../../workers/sandbox/protocol';
describe('verdict classification', () => {
  it.each([
    ['CPU_LIMIT', 'TIME_LIMIT_EXCEEDED'],
    ['WALL_LIMIT', 'TIME_LIMIT_EXCEEDED'],
    ['MEMORY_LIMIT', 'MEMORY_LIMIT_EXCEEDED'],
    ['OUTPUT_LIMIT', 'OUTPUT_LIMIT_EXCEEDED'],
    ['SANDBOX_ERROR', 'INTERNAL_ERROR'],
  ] as const)('maps %s to %s', (termination, verdict) => {
    const result: BrokerResult = {
      termination,
      exitCode: null,
      stdout: '',
      stderr: '',
      cpuTimeMs: null,
      wallTimeMs: 1,
      memoryKiB: null,
    };
    expect(terminalVerdict(result)).toBe(verdict);
  });
  it('distinguishes a successful exit from a runtime failure', () => {
    const result: BrokerResult = {
      termination: 'EXITED',
      exitCode: 0,
      stdout: '',
      stderr: '',
      cpuTimeMs: 1,
      wallTimeMs: 1,
      memoryKiB: 1,
    };
    expect(terminalVerdict(result)).toBe('ACCEPTED');
    expect(terminalVerdict({ ...result, exitCode: 1 })).toBe('RUNTIME_ERROR');
  });
});
