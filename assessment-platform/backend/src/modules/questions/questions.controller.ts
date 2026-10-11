import type { OperationHandler } from '../../common/contracts/operation-handler';
// Contract only: no route decorators, registration or success responses in Step 1.
export interface QuestionsControllerContract {
  readonly handle: OperationHandler;
}
