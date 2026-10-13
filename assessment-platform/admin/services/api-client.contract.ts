import type { paths } from '@/types/api';
export interface ApiClient {
  // Historical shared OpenAPI boundary. The concrete admin adapter is api-client.ts.
  request<Path extends keyof paths>(path: Path, options: RequestInit): Promise<unknown>;
}
