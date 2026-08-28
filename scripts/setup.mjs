// ติดตั้งอัตโนมัติ — Claude Code รันให้ตอนติดตั้ง (หรือรันเองก็ได้)
//   node scripts/setup.mjs                        → ตรวจค่า + สร้างตาราง
//   node scripts/setup.mjs https://xxx.vercel.app → ตรวจค่า + สร้างตาราง + ตั้ง webhook ให้ LINE เลย
import fs from 'node:fs';
import { SCHEMA } from '../lib/schema.js';

// อ่าน .env.local เองเพื่อไม่ต้องพึ่ง dotenv
if (fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

// db.js สร้าง pool ตอน import — ต้อง import หลังโหลด .env.local ไม่งั้นได้ localhost
const { q } = await import('../lib/db.js');

const REQUIRED = ['LINE_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET', 'OPENROUTER_API_KEY', 'DATABASE_URL', 'DASHBOARD_KEY'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`❌ ยังไม่มีค่าเหล่านี้ใน .env.local:\n   ${missing.join('\n   ')}`);
  process.exit(1);
}
console.log('✅ ค่าครบ');

await q(SCHEMA);
const { rows: [t] } = await q(
  `select count(*)::int as n from information_schema.tables
    where table_schema='public'
      and table_name in ('messages','state','watched','reports','expenses','orders','alerts','people','payments','secrets')`
);
if (t.n !== 10) {
  console.error(`❌ สร้างตารางได้ไม่ครบ (${t.n}/10)`);
  process.exit(1);
}
console.log('✅ ฐานข้อมูลพร้อม (10 ตาราง)');

const url = process.argv[2];
if (!url) {
  console.log('\nℹ️  ยังไม่ได้ตั้ง webhook — deploy ขึ้น Vercel แล้วรันซ้ำ:\n   node scripts/setup.mjs https://ชื่อโปรเจค.vercel.app');
  process.exit(0);
}

const line = (path, method, body) =>
  fetch(`https://api.line.me/v2/bot/channel/webhook/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    ...(body && { body: JSON.stringify(body) }),
  });

const endpoint = `${url.replace(/\/$/, '')}/api/line`;
const set = await line('endpoint', 'PUT', { endpoint });
if (!set.ok) {
  console.error(`❌ ตั้ง webhook ไม่สำเร็จ: ${set.status} ${await set.text()}`);
  process.exit(1);
}
console.log(`✅ ตั้ง webhook แล้ว → ${endpoint}`);

// LINE ยิงทดสอบเข้า endpoint จริง — ได้ 200 แปลว่าเว็บกับ channel secret ตรงกัน
const test = await line('test', 'POST', { endpoint });
const result = await test.json();
if (result.statusCode === 200) {
  console.log('✅ LINE ยิงทดสอบผ่าน — บอทพร้อมคุยแล้ว');
} else {
  console.error(`⚠️  LINE ยิงทดสอบไม่ผ่าน (${result.statusCode ?? test.status}) ${result.reason || ''}`);
  console.error('   เช็ค: ใส่ env บน Vercel ครบไหม · redeploy หลังใส่ค่าหรือยัง · LINE_CHANNEL_SECRET ตรงกับ channel นี้ไหม');
  process.exit(1);
}

console.log('\n⚠️  อย่าลืมเปิดสวิตช์ Webhook — ตอนนี้เพิ่งมี URL แล้ว LINE ถึงจะยอมให้เปิด');
console.log('   manager.line.biz → การตั้งค่า → การตอบกลับ → เปิด Webhook');
console.log('\n🎉 จากนั้นแอดเพื่อน OA แล้วทักว่า "ไอดี" เพื่อเอา userId ไปใส่ OWNER_USER_ID');
process.exit(0);
