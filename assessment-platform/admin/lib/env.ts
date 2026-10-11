import { z } from 'zod';
const schema = z.object({ NEXT_PUBLIC_API_BASE_URL: z.literal('/api/v1') });
export const readPublicEnvironment = () =>
  schema.parse({ NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL });
