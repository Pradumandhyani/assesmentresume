export interface RequestContext {
  readonly requestId: string;
  readonly userId: string;
  readonly role: 'STUDENT' | 'ADMIN';
  readonly sessionId: string;
}
