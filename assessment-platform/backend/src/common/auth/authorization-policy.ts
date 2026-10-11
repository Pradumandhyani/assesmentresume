import type { RequestContext } from './request-context';
export interface AuthorizationPolicy {
  assertAuthorized(
    context: RequestContext,
    resource: Readonly<Record<string, unknown>>,
  ): Promise<void>;
}
