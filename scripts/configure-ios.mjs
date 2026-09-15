import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const plistPath = resolve('ios/App/App/Info.plist');
let plist = await readFile(plistPath, 'utf8');

const entries = [
  ['NSCameraUsageDescription', 'Frame uses the camera to provide live composition guidance and take photos.'],
];

for (const [key, value] of entries) {
  if (plist.includes(`<key>${key}</key>`)) continue;
  const entry = `\n\t<key>${key}</key>\n\t<string>${value}</string>\n`;
  plist = plist.replace('\n</dict>', `${entry}</dict>`);
}

await writeFile(plistPath, plist);
console.log('Configured iOS camera permission text.');
