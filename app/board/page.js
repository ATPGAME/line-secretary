import { listTasks, archivedXp } from '@/lib/tasks';
import Board from './Board';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Quest Board' };

export default async function BoardPage({ searchParams }) {
  const { key } = await searchParams;
  const open = process.env.DASHBOARD_PUBLIC === '1' || key === process.env.DASHBOARD_KEY;
  if (!open) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0b0d17', color: '#e8ecff', fontFamily: 'Noto Sans Thai, sans-serif' }}>
        <p>🔒 ต้องมีกุญแจก่อนครับ — เติม <code>?key=...</code> ท้าย URL</p>
      </main>
    );
  }
  const [tasks, xpBase] = await Promise.all([listTasks(), archivedXp()]);
  return (
    <>
      {/* Chakra Petch = ฟอนต์ไทยสายเกม/เทค ใช้กับหัวข้อและตัวเลข */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&display=swap" />
      <Board initial={tasks} xpBase={xpBase} apiKey={key || ''} botName={process.env.BOT_NAME || 'เลขาของเกม'} />
    </>
  );
}
