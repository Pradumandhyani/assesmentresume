import { createRequire } from 'node:module';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  monacoBundle,
  purifierAsset,
  purifierVersion,
  replaceBundledSanitizer,
} from './monaco-security.mjs';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const source = dirname(require.resolve('monaco-editor'));
const destination = fileURLToPath(new URL('../frontend/public/monaco/vs', import.meta.url));
mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });
for (const name of ['LICENSE', 'ThirdPartyNotices.txt'])
  cpSync(join(source, '..', '..', name), join(destination, '..', name));
// Use the resolved patched sanitizer in browser assets as well as in the lockfile.
const monacoRequire = createRequire(require.resolve('monaco-editor'));
const sanitizerDirectory = dirname(monacoRequire.resolve('dompurify'));
const sanitizerPackage = JSON.parse(
  readFileSync(join(sanitizerDirectory, '..', 'package.json'), 'utf8'),
);
if (sanitizerPackage.version !== purifierVersion)
  throw new Error('The reviewed patched DOMPurify version is required for Monaco browser assets.');
cpSync(join(sanitizerDirectory, 'purify.min.js'), join(destination, purifierAsset));
// Observe only the Safari clipboard workaround's deferred cancellation. Keep the original
// promise handed to ClipboardItem and report real failures. See microsoft/monaco-editor#5458.
// The exact pinned artifact/fragment guard makes dependency upgrades require review.
const clipboardBundle = join(destination, monacoBundle);
const before = 'const i=new l.DeferredPromise;this.webKitPendingClipboardWritePromise';
const after =
  'const i=new l.DeferredPromise;i.p.catch(error=>{if(error?.name!=="Canceled")this.logService.error(error)});this.webKitPendingClipboardWritePromise';
const bundle = replaceBundledSanitizer(readFileSync(clipboardBundle, 'utf8'));
if (bundle.split(before).length !== 2)
  throw new Error('Review the Monaco Safari clipboard patch for this dependency version.');
writeFileSync(clipboardBundle, bundle.replace(before, after));
console.log('Prepared same-origin Monaco assets.');
