// ส่งค่าจาก .env.local ขึ้น Vercel หรือ Railway ทีเดียวทั้งชุด
//   node scripts/push-env.mjs vercel
//   node scripts/push-env.mjs railway
// ค่าถูกส่งผ่าน stdin ไม่โผล่ในบรรทัดคำสั่ง (ปลอดภัยตอนแชร์จอ/อัดคลิป)
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const target = process.argv[2];
if (!['vercel', 'railway'].includes(target)) {
  console.log('ใช้: node scripts/push-env.mjs vercel|railway');
  process.exit(1);
}
if (!fs.existsSync('.env.local')) {
  console.log('❌ ไม่มีไฟล์ .env.local');
  process.exit(1);
}

const KEYS = [
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_CHANNEL_SECRET',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
  'DATABASE_URL',
  'DASHBOARD_KEY',
  'OWNER_USER_ID',
  'ELEVENLABS_API_KEY',
];

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

let done = 0;
for (const key of KEYS) {
  const value = env[key];
  if (!value) continue; // ตัวที่ไม่ได้ใส่ก็ข้าม (เช่น ELEVENLABS_API_KEY)

  const [cmd, args] =
    target === 'vercel'
      ? ['npx', ['vercel@latest', 'env', 'add', key, 'production', '--force', '--sensitive', '-y']]
      : ['npx', ['@railway/cli@latest', 'variable', 'set', key, '--stdin', '--skip-deploys']];

  const r = spawnSync(cmd, args, { input: value, encoding: 'utf8' });
  if (r.status === 0) {
    console.log(`✅ ${key}`);
    done++;
  } else {
    // ตัดค่าที่อาจหลุดมากับ error ออกก่อนแสดง
    const msg = (r.stderr || r.stdout || '').split('\n').filter((l) => l.trim() && !l.includes(value))[0] || 'ไม่ทราบสาเหตุ';
    console.log(`❌ ${key} — ${msg.slice(0, 120)}`);
  }
}

console.log(`\nส่งขึ้น ${target} แล้ว ${done} ค่า`);
if (target === 'vercel') console.log('อย่าลืม deploy ซ้ำให้ค่ามีผล:  npx vercel@latest --prod --yes');
