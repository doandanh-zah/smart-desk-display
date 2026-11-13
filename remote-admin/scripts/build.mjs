import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';

const project = new URL('../', import.meta.url);
const packaged = new URL('dashboard/', project);
const shared = await access(packaged).then(() => packaged, () => new URL('../web/public/', project));
await mkdir(new URL('public/', project), { recursive: true });
await mkdir(new URL('assets/', project), { recursive: true });
await writeFile(new URL('public/robots.txt', project), 'User-agent: *\nDisallow: /\n');
for (const file of ['index.html', 'styles.css', 'app.js', 'preview.js', 'transport.js', 'zah-avatar.webp', 'solana-devnet.png']) {
  await copyFile(new URL(file, shared), new URL('assets/' + file, project));
}
for (const file of ['login.html', 'remote-login.js']) {
  await copyFile(new URL('lib/' + file, project), new URL('assets/' + file, project));
}
