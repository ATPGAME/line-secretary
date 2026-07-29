import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function Dashboard({ searchParams }) {
  const { key } = await searchParams;
  // ponytail: key เส้นเดียวพอสำหรับข้อมูลงาน — ถ้าจะเก็บข้อมูลสุขภาพ/การเงิน ต้องเปลี่ยนเป็น login จริง (ดู DESIGN.md)
  if (!process.env.DASHBOARD_KEY || key !== process.env.DASHBOARD_KEY) {
    return <main style={S.page}><p>ใส่ ?key=... ให้ตรงกับ DASHBOARD_KEY ก่อนครับ</p></main>;
  }

  const [{ rows: states }, { rows: groups }, { rows: reports }, { rows: expenses }, { rows: orders }] = await Promise.all([
    q('select source_id, data from state order by updated_at desc'),
    q('select w.*, (select count(*) from messages m where m.source_id = w.source_id) as msgs from watched order by active desc'),
    q(`select r.*, w.title,
              to_char(r.created_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD') as day,
              to_char(r.created_at at time zone 'Asia/Bangkok', 'HH24:MI') as at,
              (select count(*) from messages m
                where m.source_id = r.source_id and m.ts between r.period_start and r.period_end) as msgs
         from reports r left join watched w using (source_id)
        order by r.created_at desc limit 60`),
    q(`select coalesce(category,'อื่น ๆ') as category, sum(amount) as total, count(*) as n
         from expenses where paid_at > date_trunc('month', now()) group by 1 order by total desc`),
    q('select * from orders order by ordered_at desc limit 20'),
  ]);
  const spent = expenses.reduce((s, e) => s + Number(e.total), 0);

  return (
    <main style={S.page}>
      <h1 style={{ fontSize: 24 }}>เลขาส่วนตัว</h1>

      <h2 style={S.h2}>กลุ่มที่เฝ้าอยู่ ({groups.length})</h2>
      {groups.length === 0 && <p style={S.dim}>ยังไม่มี — เชิญ OA เข้ากลุ่มได้เลย</p>}
      {groups.map((g) => (
        <p key={g.source_id}>
          {g.active ? '👀' : '💤'} {g.title || g.source_id.slice(0, 12) + '…'}{' '}
          <span style={S.dim}>{g.msgs} ข้อความ · รายงาน {g.report_hours?.join(', ')} น.</span>
        </p>
      ))}

      <h2 style={S.h2}>โน้ต / งานค้าง</h2>
      {states.map(({ source_id, data }) => {
        const open = (data.todos || []).filter((t) => !t.done);
        if (!open.length && !(data.notes || []).length) return null;
        return (
          <section key={source_id} style={S.card}>
            <p style={S.dim}>{source_id.slice(0, 12)}…</p>
            {open.map((t) => <p key={t.id}>☐ #{t.id} {t.text} {t.due && <span style={S.dim}>— {t.due}</span>}</p>)}
            {(data.notes || []).map((n, i) => <p key={i}>• {n.text}</p>)}
          </section>
        );
      })}

      <h2 style={S.h2}>รายจ่ายเดือนนี้ — {spent.toLocaleString('th-TH')} บาท</h2>
      {expenses.length === 0 && <p style={S.dim}>ยังไม่มี — ส่งสลิปเข้า LINE ได้เลย</p>}
      {expenses.map((e) => (
        <p key={e.category}>{e.category} <b>{Number(e.total).toLocaleString('th-TH')}</b> <span style={S.dim}>({e.n} รายการ)</span></p>
      ))}

      {orders.length > 0 && (
        <>
          <h2 style={S.h2}>ออเดอร์ล่าสุด</h2>
          {orders.map((o) => (
            <p key={o.id}>
              {o.customer || 'ไม่ระบุชื่อ'} — {(o.items || []).join(', ')}{' '}
              {o.amount && <b>{Number(o.amount).toLocaleString('th-TH')} บาท</b>}
            </p>
          ))}
        </>
      )}

      <h2 style={S.h2}>สรุปบทสนทนารายวัน</h2>
      {reports.length === 0 && <p style={S.dim}>ยังไม่มี — รอรอบรายงาน หรือพิมพ์ "เลขา สรุปให้หน่อย" ในกลุ่ม</p>}
      {Object.entries(Object.groupBy(reports, (r) => r.day)).map(([day, items]) => (
        <div key={day}>
          <h3 style={S.day}>
            {new Date(day).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long' })}
            <span style={S.dim}> · {items.reduce((s, r) => s + Number(r.msgs), 0)} ข้อความ</span>
          </h3>
          {items.map((r) => (
            <section key={r.id} style={S.card}>
              <p style={S.dim}>
                {r.at} น. · {r.title || r.source_id.slice(0, 12) + '…'} · {r.msgs} ข้อความ
              </p>
              <p style={{ whiteSpace: 'pre-wrap' }}>{r.summary}</p>
            </section>
          ))}
        </div>
      ))}
    </main>
  );
}

const S = {
  page: { maxWidth: 720, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif', lineHeight: 1.7 },
  card: { border: '1px solid #e5e5e5', borderRadius: 12, padding: 16, marginTop: 12 },
  h2: { fontSize: 16, marginTop: 28, color: '#444' },
  day: { fontSize: 14, marginTop: 20, marginBottom: 0, color: '#111', borderBottom: '2px solid #111', paddingBottom: 4 },
  dim: { color: '#888', fontSize: 13 },
};
