import { z } from 'zod';
export const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, 'Enter your student ID.')
    .max(128, 'Student ID must be 128 characters or fewer.'),
  password: z.string().min(1, 'Enter your password.').max(1024, 'Password is too long.'),
  remember: z.boolean(),
});
export type LoginValues = z.infer<typeof loginSchema>;
