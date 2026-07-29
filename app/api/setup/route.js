import { q } from '@/lib/db';
import { SCHEMA } from '@/lib/schema';

// สร้างตารางให้ครั้งเดียว — กดจากหน้าแรก จะได้ไม่ต้องเปิดโปรแกรม SQL เป็น
export async function GET(req) {
  const key = new URL(req.url).searchParams.get('key');
  if (!process.env.DASHBOARD_KEY || key !== process.env.DASHBOARD_KEY) {
    return new Response('key ไม่ถูกต้อง', { status: 401 });
  }
  try {
    await q(SCHEMA); // ทุกคำสั่งเป็น "if not exists" กดซ้ำได้ไม่พัง
    return Response.redirect(new URL('/', req.url), 303);
  } catch (err) {
    return new Response(`สร้างตารางไม่สำเร็จ: ${err.message}`, { status: 500 });
  }
}
