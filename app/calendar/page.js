import { listEvents } from '@/lib/events';
import Calendar from './Calendar';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Season Map' };

export default async function CalendarPage({ searchParams }) {
  const { key, m } = await searchParams;
  const open = process.env.DASHBOARD_PUBLIC === '1' || key === process.env.DASHBOARD_KEY;
  if (!open) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0b0d17', color: '#e8ecff', fontFamily: 'Noto Sans Thai, sans-serif' }}>
        <p>🔒 ต้องมีกุญแจก่อนครับ — เติม <code>?key=...</code> ท้าย URL</p>
      </main>
    );
  }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  // ?m=2026-10 เปิดที่เดือนนั้น · ไม่ใส่ = เดือนนี้
  const month = /^\d{4}-\d{2}$/.test(m || '') ? m : today.slice(0, 7);
  const year = Number(month.slice(0, 4));
  return (
    <>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&display=swap" />
      <Calendar
        initial={await listEvents(`${year}-01-01`, `${year}-12-31`)}
        startMonth={month}
        today={today}
        apiKey={key || ''}
        botName={process.env.BOT_NAME || 'เลขาของเกม'}
      />
    </>
  );
}
