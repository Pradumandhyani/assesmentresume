// Local compiled start. Deployment images set their own PORT/HOSTNAME explicitly.
process.env.PORT ??= '3001';
process.env.HOSTNAME ??= '127.0.0.1';
await import(new URL('../admin/.next/standalone/admin/server.js', import.meta.url).href);
