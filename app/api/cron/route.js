import { runJobs } from '@/lib/jobs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // สรุปหลายกลุ่มใช้เวลา — Hobby ให้ 300 วินาที

// โหมดฟรี: Vercel cron ยิงเข้ามาวันละครั้ง (ดู vercel.json)
// ทีม Pro: เปลี่ยน schedule เป็น */10 * * * * แล้วตั้ง env CRON_FREQUENT=1 → ได้สรุปตาม report_hours + เตือนลูกค้าถามค้าง (ไม่ต้องใช้ Railway)
// กดเองก็ได้: /api/cron?key=DASHBOARD_KEY
export async function GET(req) {
  const key = new URL(req.url).searchParams.get('key');
  const fromVercel = req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
  const byHand = process.env.DASHBOARD_KEY && key === process.env.DASHBOARD_KEY;
  if (!fromVercel && !byHand) return new Response('unauthorized', { status: 401 });

  try {
    // วันละครั้ง = force (พลาดรอบไม่ได้) · ยิงถี่ = เคารพ report_hours · กดเอง = สรุปเดี๋ยวนี้
    const result = await runJobs({ force: byHand || process.env.CRON_FREQUENT !== '1' });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error('cron failed:', err.message);
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}
