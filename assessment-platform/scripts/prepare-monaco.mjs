import { createRequire } from 'node:module';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const source = dirname(require.resolve('monaco-editor'));
const destination = fileURLToPath(new URL('../frontend/public/monaco/vs', import.meta.url));
mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });
for (const name of ['LICENSE', 'ThirdPartyNotices.txt'])
  cpSync(join(source, '..', '..', name), join(destination, '..', name));
// Observe only the Safari clipboard workaround's deferred cancellation. Keep the original
// promise handed to ClipboardItem and report real failures. See microsoft/monaco-editor#5458.
// The exact pinned artifact/fragment guard makes dependency upgrades require review.
const clipboardBundle = join(destination, 'editor-BdtEMBbM.js');
const before = 'const i=new l.DeferredPromise;this.webKitPendingClipboardWritePromise';
const after =
  'const i=new l.DeferredPromise;i.p.catch(error=>{if(error?.name!=="Canceled")this.logService.error(error)});this.webKitPendingClipboardWritePromise';
const bundle = readFileSync(clipboardBundle, 'utf8');
if (bundle.split(before).length !== 2)
  throw new Error('Review the Monaco Safari clipboard patch for this dependency version.');
writeFileSync(clipboardBundle, bundle.replace(before, after));
console.log('Prepared same-origin Monaco assets.');
