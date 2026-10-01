import { listTasks, addTask, updateTask, deleteTask } from '@/lib/tasks';

export const dynamic = 'force-dynamic';

// กุญแจเดียวกับ /dashboard — ส่งมาทาง header x-key (หน้า /board ใส่ให้เอง)
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

export const GET = handle(async () => ({ tasks: await listTasks() }));
export const POST = handle(async (req) => ({ task: await addTask(await req.json(), 'board') }));
export const PATCH = handle(async (req) => {
  const { id, ...patch } = await req.json();
  return { task: await updateTask(id, patch) };
});
export const DELETE = handle(async (req) => {
  await deleteTask(new URL(req.url).searchParams.get('id'));
  return { ok: true };
});
