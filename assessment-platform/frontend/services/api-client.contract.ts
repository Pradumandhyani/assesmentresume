import type { paths } from '@/types/api';
export interface ApiClient {
  // Later adapter: credentialed same-origin requests, CSRF, request IDs and typed errors.
  request<Path extends keyof paths>(path: Path, options: RequestInit): Promise<unknown>;
}
