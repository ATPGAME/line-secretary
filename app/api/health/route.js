import { checkHealth } from '@/lib/jobs';

export const dynamic = 'force-dynamic';

// เช็คว่าเลขายังไม่ตาย: ฐานข้อมูล · token LINE · โควตา push · เครดิต AI · cron ยังเดินอยู่ไหม
// เอาไปเสียบ uptime monitor ได้เลย — ปกติ 200, มีปัญหา 503
// (ไม่ push เตือนจากทางนี้ ปล่อยให้ cron เป็นคนเตือน จะได้ไม่โดนยิงรัว)
export async function GET() {
  try {
    const health = await checkHealth({ notify: false });
    return Response.json(health, { status: health.ok ? 200 : 503 });
  } catch (err) {
    return Response.json({ ok: false, problems: [err.message] }, { status: 503 });
  }
}
