import type { operations } from '../../../../contracts/generated/api';
import type { RequestContext } from '../auth/request-context';
export interface OperationHandler {
  <Operation extends keyof operations>(
    operation: Operation,
    context: RequestContext,
    input: unknown,
  ): Promise<unknown>;
}
