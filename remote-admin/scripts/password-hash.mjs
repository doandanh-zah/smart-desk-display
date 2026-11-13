import { spawnSync } from 'node:child_process';
import { passwordHash } from '../lib/auth.js';

if (!process.stdin.isTTY || !process.stderr.isTTY || process.argv.length > 3 ||
    (process.argv[2] !== undefined && process.argv[2] !== '--copy')) {
  console.error('Run interactively on macOS with optional --copy.');
  process.exit(1);
}

const readPassword = (prompt) => {
  const result = spawnSync('/bin/zsh', ['-fc', 'IFS= read -rs "secret?$1" && printf "%s" "$secret"', 'password-input', prompt],
    { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });
  process.stderr.write('\n');
  if (result.status !== 0) throw new Error('Password input cancelled.');
  return result.stdout;
};
try {
  const password = readPassword('PIN hoặc mật khẩu quản trị (ẩn): ');
  const isPin = password.length === 6 && /^[0-9]+$/.test(password);
  if (!isPin && (password.length < 14 || Buffer.byteLength(password) > 256)) {
    throw new Error('Dùng PIN đúng 6 chữ số (0–9) hoặc mật khẩu ít nhất 14 ký tự, tối đa 256 byte.');
  }
  if (password !== readPassword('Nhập lại PIN hoặc mật khẩu (ẩn): ')) {
    throw new Error('Thông tin nhập lại không khớp.');
  }
  const hash = await passwordHash(password);
  if (process.argv[2] === '--copy') {
    if (spawnSync('/usr/bin/pbcopy', { input: hash, stdio: ['pipe', 'ignore', 'ignore'] }).status !== 0) {
      throw new Error('Không thể ghi clipboard.');
    }
    console.error('Đã sao chép hash vào clipboard. Dán vào ADMIN_PASSWORD_HASH trong Vercel.');
  } else {
    process.stdout.write(hash + '\n');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
