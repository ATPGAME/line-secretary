// ตารางทั้งหมด — หน้าแรกมีปุ่มกดสร้างให้ (idempotent รันซ้ำได้ไม่พัง)
export const SCHEMA = `
-- รันครั้งเดียวตอนติดตั้ง: psql "$DATABASE_URL" -f schema.sql

create table if not exists messages (
  id bigserial primary key,
  line_message_id text unique,          -- LINE ยิงซ้ำได้ตอน retry — กันด้วย unique
  source_type text not null,            -- user | group | room
  source_id text not null,
  user_id text,
  kind text not null default 'text',    -- text | image
  text text,
  ts timestamptz not null default now(),
  processed_at timestamptz              -- null = worker ยังไม่สรุป
);
create index if not exists messages_todo on messages (processed_at, ts);
create index if not exists messages_source on messages (source_id, ts desc);

-- ความจำของเลขา (แทน Redis ของ v1) — 1 แถวต่อ 1 คน/กลุ่ม
create table if not exists state (
  source_id text primary key,
  data jsonb not null default '{"chat":[],"notes":[],"todos":[]}'::jsonb,
  updated_at timestamptz default now()
);

-- กลุ่มที่ให้เฝ้า + ตั้งเวลารายงาน
create table if not exists watched (
  source_id text primary key,
  title text,
  report_to text,                       -- userId ที่จะรับรายงาน (ว่างได้ = ยังไม่ได้ตั้ง OWNER_USER_ID)
  report_hours int[] default '{8,18}',  -- ชั่วโมงที่ส่งรายงาน (เวลาไทย)
  last_report_at timestamptz,
  active boolean default true,
  -- คำที่โผล่เมื่อไหร่ให้เตือนทันที
  alert_words text[] default '{ยกเลิก,คืนเงิน,ไม่พอใจ,ด่วน,เคลม,แย่มาก}',
  sla_minutes int default 15,           -- ลูกค้าถามแล้วเงียบเกินกี่นาทีให้เตือน · 0 = ปิด
  track_orders boolean default false    -- สกัดออเดอร์จากกลุ่มนี้ด้วย
);

-- รายจ่ายจากสลิป
create table if not exists expenses (
  id bigserial primary key,
  user_id text not null,
  amount numeric not null,
  category text,
  note text,
  bank text,
  ref text,                             -- เลขอ้างอิงในสลิป
  paid_at timestamptz,
  confidence numeric,                   -- ต่ำ = ให้คนยืนยันก่อน
  source_message_id bigint references messages(id),
  created_at timestamptz default now()
);
-- สลิปใบเดิมส่งซ้ำ = ไม่บันทึกซ้ำ (เว้นใบที่ไม่มีเลขอ้างอิง)
create unique index if not exists expenses_dedupe on expenses (user_id, ref, amount) where ref is not null;

create table if not exists orders (
  id bigserial primary key,
  source_id text not null,
  customer text,
  items jsonb,
  amount numeric,
  ordered_at timestamptz,
  source_message_id bigint references messages(id) unique
);

-- กันเตือนซ้ำเรื่องเดิม
create table if not exists alerts (
  id bigserial primary key,
  source_id text not null,
  kind text not null,                   -- keyword | sla
  ref text,                             -- line_message_id ที่เป็นต้นเหตุ
  created_at timestamptz default now(),
  unique (kind, ref)
);

-- ชื่อคนในกลุ่ม — ถามจาก LINE ครั้งเดียวแล้วจำไว้ (สรุปจะได้บอกได้ว่าใครพูด)
-- name = null แปลว่าถามแล้วไม่ได้ชื่อ (ออกจากกลุ่มไปแล้ว/ปิดโปรไฟล์) จะได้ไม่ถามซ้ำทุกรอบ
create table if not exists people (
  user_id text primary key,
  name text,
  updated_at timestamptz default now()
);

create table if not exists reports (
  id bigserial primary key,
  source_id text not null,
  period_start timestamptz,
  period_end timestamptz,
  summary text,
  created_at timestamptz default now()
);

-- เพิ่มทีหลัง (v1.1) — คนที่ติดตั้งไว้ก่อนหน้าก็ได้คอลัมน์นี้ตอนกด setup ซ้ำ
alter table alerts add column if not exists detail text;   -- ข้อความเตือนที่ไม่ได้มาจากข้อความใน LINE เช่น ระบบมีปัญหา
`;
