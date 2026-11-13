import { copyFile, cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const project = new URL('../', import.meta.url);
const target = process.argv[2];
if (!target) throw new Error('Supply an SSD staging directory as the only argument.');
const stage = pathToFileURL(resolve(target) + '/');
await mkdir(stage, { recursive: true });
for (const name of ['api', 'lib', 'scripts']) {
  await cp(new URL(name + '/', project), new URL(name + '/', stage), { recursive: true });
}
for (const name of ['package.json', 'package-lock.json', 'vercel.json', '.vercelignore']) {
  await copyFile(new URL(name, project), new URL(name, stage));
}
await mkdir(new URL('dashboard/', stage), { recursive: true });
for (const name of ['index.html', 'styles.css', 'app.js', 'preview.js', 'transport.js', 'zah-avatar.webp', 'solana-devnet.png']) {
  await copyFile(new URL('../web/public/' + name, project), new URL('dashboard/' + name, stage));
}
