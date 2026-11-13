import { waitUntil } from '@vercel/functions';
import { readFile } from 'node:fs/promises';
import { createGateway } from '../lib/gateway.js';

const assets = (file) => readFile(new URL(`../assets/${file}`, import.meta.url));
export default { fetch: createGateway({ assets, waitUntil }) };
