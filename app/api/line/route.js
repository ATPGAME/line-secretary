import { verifySignature, reply, push, getContent } from '@/lib/line';
import { load, save, ingest, q } from '@/lib/db';
import { think, readSlip, transcribe } from '@/lib/brain';

// หู: เขียนลงฐานข้อมูลแล้วตอบ 200 ให้เร็วที่สุด — งานหนักอยู่ที่ worker บน Railway
export async function POST(req) {
  const raw = await req.text();

  if (!verifySignature(raw, req.headers.get('x-line-signature'), process.env.LINE_CHANNEL_SECRET)) {
    return new Response('bad signature', { status: 401 });
  }

  const { events = [] } = JSON.parse(raw);

  for (const ev of events) {
    try {
      await handle(ev);
    } catch (err) {
      // ห้าม log ข้อความดิบ (ขึ้น log ของ Vercel) — เอาแค่ error
      console.error('event failed:', ev.type, err.message);
    }
  }

  // ต้องตอบ 200 เสมอ ไม่งั้น LINE จะปิด webhook ให้เอง
  return Response.json({ ok: true });
}

async function handle(ev) {
  const src = ev.source || {};
  const sourceId = src.groupId || src.roomId || src.userId;
  const ctx = { sourceId, userId: src.userId, sourceType: src.type };

  if (ev.type === 'join') {
    await q(
      `insert into watched (source_id, report_to) values ($1, $2)
       on conflict (source_id) do update set active = true`,
      [sourceId, process.env.OWNER_USER_ID]
    );
    return reply(ev.replyToken, 'สวัสดีครับ ผมเป็นเลขาอัตโนมัติ จะอ่านข้อความในกลุ่มเพื่อสรุปให้เจ้าของบัญชี พิมพ์ "เลขา" ตามด้วยคำถามได้เลยครับ');
  }

  if (ev.type === 'leave') {
    return q('update watched set active = false where source_id = $1', [sourceId]);
  }

  if (ev.type === 'follow') {
    return reply(ev.replyToken, 'สวัสดีครับ ผมเป็นเลขาส่วนตัว สั่งได้เลย เช่น "จดไว้ รหัส wifi 12345678", "เตือนส่งงานพรุ่งนี้ 10 โมง" หรือส่งสลิปมาให้บันทึกรายจ่ายก็ได้');
  }

  if (ev.type !== 'message') return;
  const isDirect = src.type === 'user';

  // ── รูป: อ่านสลิปให้ (เฉพาะแชทส่วนตัว — ในกลุ่มรูปเยอะเกินกว่าจะอ่านทุกใบ)
  if (ev.message.type === 'image') {
    if (!isDirect) return;
    const msgId = await ingest({ ...base(ev, src, sourceId), kind: 'image', text: null });
    if (!msgId) return;
    return handleSlip(ev, ctx, msgId);
  }

  // ── เสียง: ถอดเป็นข้อความแล้วทำงานต่อเหมือนพิมพ์เอง
  let text = ev.message.text;
  if (ev.message.type === 'audio') {
    if (!isDirect) return;
    text = await transcribe(await getContent(ev.message.id));
    if (!text) return reply(ev.replyToken, 'ฟังไม่ออกครับ ลองพูดใหม่หรือพิมพ์มาก็ได้');
  } else if (ev.message.type !== 'text') {
    return;
  }

  // ตอนตั้งค่าต้องรู้ LINE userId ของตัวเอง — ถามบอทเอาง่ายกว่าไปงมใน log
  if (isDirect && /^\s*(ไอดี|id)\s*$/i.test(text)) {
    return reply(ev.replyToken, `LINE userId ของคุณคือ\n${src.userId}\n\nเอาไปใส่ในช่อง OWNER_USER_ID`);
  }

  const msgId = await ingest({ ...base(ev, src, sourceId), kind: 'text', text });
  if (!msgId) return; // LINE ส่งซ้ำ

  // คำต้องห้ามโผล่ในกลุ่ม → เตือนเจ้าของทันที (regex ถูก ๆ ไม่ต้องเรียก AI)
  if (!isDirect) await checkAlertWords(sourceId, ev.message.id, text);

  const calledMe = ev.message.mention?.mentionees?.some((m) => m.isSelf) || /^\s*เลขา/.test(text);
  if (!isDirect && !calledMe) return; // ในกลุ่ม ไม่เรียกก็ไม่ตอบ (และไม่เผาเครดิต)

  const state = await load(sourceId);
  const answer = await think(state, text, ctx);
  await save(sourceId, state);
  await q('update messages set processed_at = now() where id = $1', [msgId]);
  await reply(ev.replyToken, ev.message.type === 'audio' ? `🎙 "${text}"\n\n${answer}` : answer);
}

const base = (ev, src, sourceId) => ({
  lineMessageId: ev.message.id,
  sourceType: src.type,
  sourceId,
  userId: src.userId,
  ts: new Date(ev.timestamp),
});

async function handleSlip(ev, ctx, msgId) {
  const slip = await readSlip(await getContent(ev.message.id));
  if (!slip.is_slip || !slip.amount) {
    return reply(ev.replyToken, 'ดูไม่ออกว่าเป็นสลิปครับ ถ้าเป็นรายจ่ายพิมพ์บอกได้เลย เช่น "จ่ายค่ากาแฟ 120"');
  }

  const { rows } = await q(
    `insert into expenses (user_id, amount, category, bank, ref, paid_at, confidence, source_message_id)
     values ($1,$2,$3,$4,$5,coalesce($6::timestamptz, now()),$7,$8)
     on conflict do nothing returning id`,
    [ctx.userId, slip.amount, slip.category, slip.bank, slip.ref, slip.paid_at, slip.confidence, msgId]
  );
  if (!rows.length) return reply(ev.replyToken, `สลิปใบนี้บันทึกไปแล้วครับ (${slip.amount} บาท)`);

  const { rows: [sum] } = await q(
    `select coalesce(sum(amount),0) as total from expenses
      where user_id = $1 and paid_at > date_trunc('month', now())`,
    [ctx.userId]
  );

  const warn = (slip.confidence ?? 1) < 0.7 ? '\n⚠️ อ่านได้ไม่ชัด ช่วยตรวจยอดอีกที' : '';
  return reply(
    ev.replyToken,
    `บันทึกแล้ว ${Number(slip.amount).toLocaleString('th-TH')} บาท${slip.bank ? ` · ${slip.bank}` : ''}${slip.category ? ` · ${slip.category}` : ''}\n` +
      `เดือนนี้ใช้ไป ${Number(sum.total).toLocaleString('th-TH')} บาท${warn}`
  );
}

async function checkAlertWords(sourceId, lineMessageId, text) {
  const { rows: [g] } = await q('select * from watched where source_id = $1 and active', [sourceId]);
  if (!g?.alert_words?.length) return;

  const hit = g.alert_words.find((w) => text.includes(w));
  if (!hit) return;

  // กันเตือนซ้ำข้อความเดิม
  const { rowCount } = await q(
    `insert into alerts (source_id, kind, ref) values ($1,'keyword',$2) on conflict do nothing`,
    [sourceId, lineMessageId]
  );
  if (!rowCount) return;

  await push(g.report_to, `🚨 เจอคำว่า "${hit}" ในกลุ่ม ${g.title || sourceId.slice(0, 8)}\n\n"${text.slice(0, 300)}"`);
}
