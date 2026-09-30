import { listTasks } from '@/lib/tasks';
import Board from './Board';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'บอร์ดงาน' };

export default async function BoardPage({ searchParams }) {
  const { key } = await searchParams;
  const open = process.env.DASHBOARD_PUBLIC === '1' || key === process.env.DASHBOARD_KEY;
  if (!open) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'Noto Sans Thai, sans-serif' }}>
        <p>ต้องมีกุญแจก่อนครับ — เติม <code>?key=...</code> ท้าย URL</p>
      </main>
    );
  }
  return <Board initial={await listTasks()} apiKey={key || ''} botName={process.env.BOT_NAME || 'เลขาของเกม'} />;
}
