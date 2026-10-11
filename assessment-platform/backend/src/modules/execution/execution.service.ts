import type { RequestContext } from '../../common/auth/request-context';
// Use-case boundary; concrete methods will follow the OpenAPI operation definitions.
export interface ExecutionServiceContract {
  readonly context: RequestContext;
}
