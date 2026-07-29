import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';

// หน้าตรวจสุขภาพ — เปิดดูแล้วรู้ทันทีว่าติดตรงไหน ไม่ต้องไปงมใน log
export default async function Home() {
  const env = {
    LINE_CHANNEL_ACCESS_TOKEN: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
    LINE_CHANNEL_SECRET: !!process.env.LINE_CHANNEL_SECRET,
    OPENROUTER_API_KEY: !!process.env.OPENROUTER_API_KEY,
    DATABASE_URL: !!(process.env.DATABASE_URL || process.env.POSTGRES_URL),
    OWNER_USER_ID: !!process.env.OWNER_USER_ID,
    DASHBOARD_KEY: !!process.env.DASHBOARD_KEY,
  };

  let db = 'ยังต่อไม่ได้';
  let tables = false;
  let counts = null;
  try {
    const { rows } = await q(
      `select (select count(*) from information_schema.tables
                where table_schema='public' and table_name in
                ('messages','state','watched','reports','expenses','orders','alerts')) as t`
    );
    db = 'ต่อได้';
    tables = Number(rows[0].t) === 7;
    if (tables) {
      const { rows: c } = await q(
        `select (select count(*) from messages) as msgs,
                (select count(*) from watched where active) as groups`
      );
      counts = c[0];
    }
  } catch (err) {
    db = err.message.slice(0, 80);
  }

  const missing = Object.entries(env).filter(([, ok]) => !ok).map(([k]) => k);
  const ready = missing.length === 0 && tables;

  return (
    <main style={S.page}>
      <h1 style={{ fontSize: 22 }}>{ready ? '✅ เลขาพร้อมทำงาน' : '⚙️ ยังตั้งค่าไม่ครบ'}</h1>

      <h2 style={S.h2}>1. ค่าที่ต้องใส่ (Environment Variables)</h2>
      {Object.entries(env).map(([k, ok]) => (
        <p key={k}>{ok ? '✅' : '❌'} {k}</p>
      ))}
      {missing.length > 0 && (
        <p style={S.hint}>ใส่ที่ Vercel → Settings → Environment Variables แล้วกด Redeploy 1 ครั้ง</p>
      )}

      <h2 style={S.h2}>2. ฐานข้อมูล</h2>
      <p>{db === 'ต่อได้' ? '✅' : '❌'} เชื่อมต่อ: {db}</p>
      <p>{tables ? '✅ สร้างตารางครบแล้ว' : '❌ ยังไม่ได้สร้างตาราง'}</p>
      {db === 'ต่อได้' && !tables && (
        <p style={S.hint}>
          เปิด <code>/api/setup?key=รหัสที่ตั้งใน DASHBOARD_KEY</code> แล้วตารางจะถูกสร้างให้ทันที
        </p>
      )}

      <h2 style={S.h2}>3. ต่อ webhook กับ LINE</h2>
      <p style={S.hint}>
        เอา URL นี้ไปวางที่ LINE Developers → Messaging API → Webhook URL แล้วกด Verify
      </p>
      <p><code style={S.code}>{'https://<โดเมนของคุณ>/api/line'}</code></p>

      {counts && (
        <>
          <h2 style={S.h2}>4. สถานะตอนนี้</h2>
          <p>💬 เก็บข้อความแล้ว {counts.msgs} ข้อความ · 👀 เฝ้ากลุ่มอยู่ {counts.groups} กลุ่ม</p>
          <p style={S.hint}>ยังไม่รู้ LINE userId ของตัวเอง? ทักบอทว่า <b>ไอดี</b> แล้วบอทจะตอบกลับมาให้</p>
        </>
      )}

      <p style={{ marginTop: 32 }}>
        <a href="/dashboard">→ ไปหน้า dashboard</a> (ต้องมี ?key=)
      </p>
    </main>
  );
}

const S = {
  page: { maxWidth: 640, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif', lineHeight: 1.9 },
  h2: { fontSize: 15, marginTop: 28, color: '#444' },
  hint: { color: '#666', fontSize: 14, background: '#f6f6f6', padding: 12, borderRadius: 8 },
  code: { background: '#f0f0f0', padding: '4px 8px', borderRadius: 6, fontSize: 13 },
};
