import { access, cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist');
const files = ['index.html', 'manifest.webmanifest', 'sw.js'];
const directories = ['assets', 'css', 'docs', 'icons', 'js', 'vendor'];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const file of files) {
  const source = join(root, file);
  await access(source);
  await cp(source, join(output, file));
}

for (const directory of directories) {
  const source = join(root, directory);
  await access(source);
  await cp(source, join(output, directory), { recursive: true });
}

console.log(`Prepared Capacitor web assets in ${output}`);
