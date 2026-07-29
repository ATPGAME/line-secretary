// ตรวจทีละอย่างว่าค่าที่เพิ่งใส่ใช้ได้จริงไหม — ใช้ระหว่างติดตั้งแบบ wizard
//   node scripts/check.mjs line | openrouter | db | vercel <url> | all
import fs from 'node:fs';

if (fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const ok = (msg) => (console.log(`✅ ${msg}`), true);
const bad = (msg, fix) => (console.log(`❌ ${msg}\n   → ${fix}`), false);

const CHECKS = {
  async line() {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const secret = process.env.LINE_CHANNEL_SECRET;
    if (!token) return bad('ยังไม่มี LINE_CHANNEL_ACCESS_TOKEN', 'แท็บ Messaging API → Channel access token → กด Issue');
    if (!secret) return bad('ยังไม่มี LINE_CHANNEL_SECRET', 'แท็บ Basic settings → Channel secret');
    if (secret.length < 20) return bad('LINE_CHANNEL_SECRET สั้นผิดปกติ', 'ก๊อปมาไม่ครบหรือเปล่า ลองก๊อปใหม่');

    const res = await fetch('https://api.line.me/v2/bot/info', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return bad(`token ใช้ไม่ได้ (${res.status})`, 'ก๊อปมาไม่ครบ หรือกด Issue ใหม่แล้วอันเก่าหมดอายุ');
    const info = await res.json();
    return ok(`ต่อ LINE OA ได้: "${info.displayName}" (${info.basicId})`);
  },

  async openrouter() {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) return bad('ยังไม่มี OPENROUTER_API_KEY', 'openrouter.ai → Keys → Create key');
    const res = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) return bad(`key ใช้ไม่ได้ (${res.status})`, 'ก๊อปมาไม่ครบ หรือ key ถูกลบไปแล้ว');
    const { data } = await res.json();
    const left = data.limit_remaining ?? data.limit;
    if (left !== null && left <= 0) return bad('เครดิตหมด', 'openrouter.ai → Credits → เติมเงิน');
    return ok(`ต่อ OpenRouter ได้${left != null ? ` · เครดิตเหลือ $${Number(left).toFixed(2)}` : ' · แบบเติมเงินไว้แล้ว'}`);
  },

  async db() {
    if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL)
      return bad('ยังไม่มี DATABASE_URL', 'neon.tech → Connection string → เลือกอันที่เขียนว่า Pooled');
    const { q } = await import('../lib/db.js');
    try {
      const { rows } = await q(
        `select count(*)::int as n from information_schema.tables
          where table_schema='public'
            and table_name in ('messages','state','watched','reports','expenses','orders','alerts')`
      );
      if (rows[0].n === 0) return bad('ต่อฐานข้อมูลได้ แต่ยังไม่มีตาราง', 'รัน: node scripts/setup.mjs');
      if (rows[0].n < 7) return bad(`มีตารางไม่ครบ (${rows[0].n}/7)`, 'รัน: node scripts/setup.mjs');
      return ok('ฐานข้อมูลพร้อม (7 ตาราง)');
    } catch (err) {
      const m = err.message;
      if (/password|auth/i.test(m)) return bad('รหัสผ่านฐานข้อมูลไม่ถูก', 'ก๊อป connection string จาก Neon ใหม่ทั้งเส้น');
      if (/ENOTFOUND|getaddrinfo/i.test(m)) return bad('หาเซิร์ฟเวอร์ฐานข้อมูลไม่เจอ', 'ที่อยู่ผิด ก๊อปใหม่จาก Neon');
      return bad(`ต่อฐานข้อมูลไม่ได้: ${m.slice(0, 60)}`, 'ก๊อป connection string ใหม่ (เลือกอัน Pooled)');
    }
  },

  async vercel(url) {
    if (!url) return bad('ไม่ได้บอก URL', 'node scripts/check.mjs vercel https://xxx.vercel.app');
    const res = await fetch(url.replace(/\/$/, ''), { redirect: 'follow' });
    if (!res.ok) return bad(`เปิดเว็บไม่ได้ (${res.status})`, 'deploy สำเร็จหรือยัง ดูใน Vercel → Deployments');
    const html = await res.text();
    if (html.includes('ยังตั้งค่าไม่ครบ'))
      return bad('เว็บขึ้นแล้ว แต่ค่าบน Vercel ยังไม่ครบ', `เปิด ${url} ดูว่าข้อไหนเป็น ❌ แล้วใส่ค่านั้นใน Vercel → Redeploy`);
    if (!html.includes('เลขาพร้อมทำงาน')) return bad('เว็บตอบกลับมาแปลก ๆ', 'ลองเปิดเว็บดูด้วยตาว่าขึ้นอะไร');
    return ok('เว็บบน Vercel พร้อม (ค่าครบ + ตารางครบ)');
  },
};

const [what, arg] = process.argv.slice(2);
if (what === 'all') {
  const results = [];
  for (const name of ['line', 'openrouter', 'db']) results.push(await CHECKS[name]());
  process.exit(results.every(Boolean) ? 0 : 1);
}
if (!CHECKS[what]) {
  console.log('ใช้: node scripts/check.mjs line | openrouter | db | vercel <url> | all');
  process.exit(1);
}
process.exit((await CHECKS[what](arg)) ? 0 : 1);
