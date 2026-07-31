// สมองรอบเวลา — รันบน Railway ตลอดเวลา ตื่นทุก 10 นาที
//   1) ถึงรอบรายงานของกลุ่มไหน → สรุป (+ สกัดออเดอร์ถ้าเปิดไว้) → push
//   2) ลูกค้าถามแล้วไม่มีใครตอบเกินเวลา → เตือน
// Railway > Settings > Start Command:  node worker/index.js
//
// ไม่อยากจ่าย $5? ใช้ Vercel cron แทนได้ (วันละครั้ง) — ดู vercel.json + app/api/cron
import { runJobs } from '../lib/jobs.js';

const EVERY = 10 * 60 * 1000;

async function tick() {
  try {
    const { reported, alerted } = await runJobs();
    if (reported || alerted) console.log(`สรุปไป ${reported} กลุ่ม · เตือนไป ${alerted} เรื่อง`);
  } catch (err) {
    console.error('tick failed:', err.message);
  }
}

console.log('worker started · ตื่นทุก 10 นาที');
await tick();
setInterval(tick, EVERY);
