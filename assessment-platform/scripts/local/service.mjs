// IPC shutdown also works on Windows, where process.kill(SIGTERM) is not graceful.
import { pathToFileURL } from 'node:url';
const [entry, ...args] = process.argv.slice(2);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  setTimeout(() => process.exit(0), 15000).unref();
  // Nest, Next and the maintenance worker install their own shutdown handlers.
  process.emit('SIGTERM', 'SIGTERM');
  if (process.connected) process.disconnect();
}
process.on('message', (message) => {
  if (message?.type === 'stop' && message.token === process.env.LOCAL_SUPERVISOR_TOKEN) stop();
});
process.once('disconnect', stop);
process.argv = [process.execPath, entry, ...args];
await import(pathToFileURL(entry).href);
