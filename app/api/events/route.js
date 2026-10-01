import { listEvents, addEvent, updateEvent, deleteEvent } from '@/lib/events';

export const dynamic = 'force-dynamic';

// กุญแจเดียวกับ /dashboard — ส่งมาทาง header x-key (หน้า /calendar ใส่ให้เอง)
const allowed = (req) =>
  process.env.DASHBOARD_PUBLIC === '1' ||
  (process.env.DASHBOARD_KEY && req.headers.get('x-key') === process.env.DASHBOARD_KEY);

const handle = (fn) => async (req) => {
  if (!allowed(req)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    return Response.json(await fn(req));
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
};

// ?year=2026 → ทั้งปี
export const GET = handle(async (req) => {
  const year = Number(new URL(req.url).searchParams.get('year')) || new Date().getFullYear();
  return { events: await listEvents(`${year}-01-01`, `${year}-12-31`) };
});
export const POST = handle(async (req) => ({ event: await addEvent(await req.json(), 'web') }));
export const PATCH = handle(async (req) => {
  const { id, ...patch } = await req.json();
  return { event: await updateEvent(id, patch) };
});
export const DELETE = handle(async (req) => {
  await deleteEvent(new URL(req.url).searchParams.get('id'));
  return { ok: true };
});
