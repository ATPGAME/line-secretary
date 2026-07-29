// สมองของเลขา — OpenRouter + tool calling (ไม่ใช้ SDK/framework, fetch อย่างเดียว)
import { q } from './db.js';

const MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
const STT_MODEL = process.env.OPENROUTER_STT_MODEL || 'openai/whisper-1';
const OR = 'https://openrouter.ai/api/v1';
const auth = () => ({
  Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
  'Content-Type': 'application/json',
});

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'save_note',
      description: 'บันทึกข้อมูลที่ผู้ใช้บอกให้จำไว้ เช่น รหัสผ่าน เลขบัญชี ของที่ต้องซื้อ',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: 'สิ่งที่ต้องจำ เขียนให้ครบในตัวเอง' } },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_todo',
      description: 'เพิ่มงานที่ต้องทำ',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          due: { type: 'string', description: 'กำหนดส่งแบบ YYYY-MM-DD HH:mm (ถ้าผู้ใช้บอก)' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'done_todo',
      description: 'ปิดงานที่ทำเสร็จแล้ว ใช้เลข id ที่เห็นในรายการ',
      parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_expense',
      description: 'บันทึกรายจ่าย ใช้เมื่อผู้ใช้บอกว่าจ่ายอะไรไปเท่าไหร่',
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'number' },
          category: { type: 'string', description: 'เช่น อาหาร เดินทาง ของใช้ ค่าบริการ' },
          note: { type: 'string' },
        },
        required: ['amount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'expense_summary',
      description: 'ดูสรุปรายจ่าย ใช้เมื่อผู้ใช้ถามว่าใช้เงินไปเท่าไหร่',
      parameters: {
        type: 'object',
        properties: { days: { type: 'number', description: 'ย้อนหลังกี่วัน (เดือนนี้ = 30)' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'summarize_group',
      description: 'สรุปบทสนทนาในกลุ่มนี้ตอนนี้เลย ใช้เมื่อผู้ใช้สั่งให้สรุปกลุ่ม',
      parameters: {
        type: 'object',
        properties: { hours: { type: 'number', description: 'ย้อนหลังกี่ชั่วโมง (ไม่บอก = 12)' } },
      },
    },
  },
];

// รันเครื่องมือ — ctx = { sourceId, userId, sourceType }
export async function applyTool(state, name, args, ctx = {}) {
  const now = new Date().toISOString();

  if (name === 'save_note') {
    state.notes.push({ text: args.text, at: now });
    return 'บันทึกแล้ว';
  }

  if (name === 'add_todo') {
    const id = (state.todos.at(-1)?.id ?? 0) + 1;
    state.todos.push({ id, text: args.text, due: args.due || null, done: false, at: now });
    return `เพิ่มงาน #${id} แล้ว`;
  }

  if (name === 'done_todo') {
    const todo = state.todos.find((t) => t.id === Number(args.id) && !t.done);
    if (!todo) return `ไม่เจองาน #${args.id} ที่ยังค้างอยู่`;
    todo.done = true;
    return `ปิดงาน #${todo.id} "${todo.text}" แล้ว`;
  }

  if (name === 'add_expense') {
    await q('insert into expenses (user_id, amount, category, note, paid_at) values ($1,$2,$3,$4,now())', [
      ctx.userId, args.amount, args.category || null, args.note || null,
    ]);
    return `บันทึกรายจ่าย ${args.amount} บาทแล้ว`;
  }

  if (name === 'expense_summary') {
    const days = Number(args.days) || 30;
    const { rows } = await q(
      `select coalesce(category,'อื่น ๆ') as category, sum(amount) as total, count(*) as n
         from expenses where user_id = $1 and paid_at > now() - ($2 || ' days')::interval
        group by 1 order by total desc`,
      [ctx.userId, days]
    );
    if (!rows.length) return `ไม่มีรายจ่ายใน ${days} วันที่ผ่านมา`;
    const total = rows.reduce((s, r) => s + Number(r.total), 0);
    return `${days} วันล่าสุด รวม ${total.toLocaleString('th-TH')} บาท\n` +
      rows.map((r) => `${r.category} ${Number(r.total).toLocaleString('th-TH')} (${r.n} รายการ)`).join('\n');
  }

  if (name === 'summarize_group') {
    if (ctx.sourceType === 'user') return 'สรุปกลุ่มได้เฉพาะตอนสั่งในกลุ่มนั้นครับ';
    const hours = Number(args.hours) || 12;
    const { rows } = await q(
      `select text, ts from messages
        where source_id = $1 and text is not null and ts > now() - ($2 || ' hours')::interval
        order by ts limit 500`,
      [ctx.sourceId, hours]
    );
    if (rows.length < 2) return `ไม่มีบทสนทนาใน ${hours} ชั่วโมงที่ผ่านมา`;
    return await summarize('', rows);
  }

  return `ไม่รู้จักเครื่องมือ ${name}`;
}

function systemPrompt(state, ctx) {
  const today = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
  const open = state.todos.filter((t) => !t.done);
  return [
    'คุณคือเลขาส่วนตัวใน LINE พูดไทย สั้น กระชับ เป็นกันเอง ไม่ต้องมีพิธีรีตอง',
    `ตอนนี้ ${today} (เวลาไทย)`,
    ctx.sourceType === 'user' ? 'กำลังคุยแบบส่วนตัว' : 'กำลังอยู่ในกลุ่ม — ตอบสั้นกว่าปกติ',
    'ถ้าผู้ใช้บอกอะไรที่ควรจำ หรือสั่งงาน ให้เรียกเครื่องมือทันทีโดยไม่ต้องถามซ้ำ',
    'ข้อมูลที่ผู้ใช้เคยบอกไว้ (ตอบจากนี่ได้เลย ไม่ต้องเรียกเครื่องมือ):',
    `โน้ต: ${state.notes.map((n) => `- ${n.text}`).join('\n') || '(ยังไม่มี)'}`,
    `งานค้าง: ${open.map((t) => `#${t.id} ${t.text}${t.due ? ` (ครบ ${t.due})` : ''}`).join('\n') || '(ไม่มี)'}`,
  ].join('\n');
}

async function chat(messages, useTools = true) {
  const res = await fetch(`${OR}/chat/completions`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({ model: MODEL, messages, ...(useTools && { tools: TOOLS }) }),
  });
  if (!res.ok) throw new Error(`openrouter ${res.status}: ${await res.text()}`);
  return (await res.json()).choices[0].message;
}

// คุย 1 รอบ: AI คิด → ถ้าขอใช้เครื่องมือก็รันแล้วส่งผลกลับ → ได้คำตอบเป็นภาษาคน
export async function think(state, userText, ctx = {}) {
  const messages = [
    { role: 'system', content: systemPrompt(state, ctx) },
    ...state.chat,
    { role: 'user', content: userText },
  ];

  for (let i = 0; i < 3; i++) {
    const msg = await chat(messages);
    messages.push(msg);
    if (!msg.tool_calls?.length) {
      const answer = msg.content || 'รับทราบครับ';
      state.chat = [...state.chat, { role: 'user', content: userText }, { role: 'assistant', content: answer }].slice(-10);
      return answer;
    }
    for (const call of msg.tool_calls) {
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {}
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: await applyTool(state, call.function.name, args, ctx),
      });
    }
  }
  return 'ทำงานวนไม่จบ ลองพิมพ์ใหม่อีกทีนะครับ';
}

// สรุปบทสนทนาในกลุ่ม
export async function summarize(title, rows) {
  const lines = rows.map(
    (r) => `[${new Date(r.ts).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })}] ${r.text}`
  );
  const msg = await chat(
    [
      {
        role: 'system',
        content: [
          'สรุปบทสนทนาในกลุ่ม LINE ให้เจ้านายที่ไม่ได้อ่านเอง ภาษาไทย',
          'รูปแบบ: 3-5 บรรทัดว่าคุยอะไรกัน แล้วขึ้นบรรทัด "ต้องทำ:" ตามด้วยสิ่งที่ต้องตัดสินใจ/ตอบ/ทำ (ถ้าไม่มีให้เขียนว่า ไม่มี)',
          'ห้ามแต่งเติมสิ่งที่ไม่มีในบทสนทนา ถ้าคุยเล่นล้วน ๆ ก็บอกตรง ๆ ว่าไม่มีสาระที่ต้องทำ',
        ].join('\n'),
      },
      { role: 'user', content: `กลุ่ม "${title || 'ไม่มีชื่อ'}" ${rows.length} ข้อความ:\n${lines.join('\n')}` },
    ],
    false
  );
  return msg.content?.trim() || '(สรุปไม่สำเร็จ)';
}

// อ่านสลิปโอนเงินจากรูป → JSON
export async function readSlip(base64) {
  const msg = await chat(
    [
      {
        role: 'system',
        content:
          'อ่านสลิปโอนเงิน/ใบเสร็จ ตอบเป็น JSON เท่านั้น ไม่ต้องมี markdown: ' +
          '{"is_slip":true/false,"amount":ตัวเลข,"bank":"ธนาคาร/ร้าน","ref":"เลขอ้างอิง","paid_at":"YYYY-MM-DD HH:mm","category":"หมวด","confidence":0-1} ' +
          'paid_at ต้องเป็น ค.ศ. เสมอ — สลิปไทยมักเขียน พ.ศ. (เช่น 2569) ให้ลบ 543 ก่อน ' +
          'อ่านไม่ออกช่องไหนให้ใส่ null · ไม่ใช่สลิปให้ is_slip=false',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'สลิปนี้จ่ายเท่าไหร่' },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
        ],
      },
    ],
    false
  );
  try {
    const slip = JSON.parse(msg.content.replace(/```json?|```/g, '').trim());
    slip.paid_at = toCE(slip.paid_at);
    return slip;
  } catch {
    return { is_slip: false };
  }
}

// สลิปไทยเขียนปี พ.ศ. — บอกใน prompt แล้วแต่โมเดลก็ยังหลุดบ่อย เลยกันอีกชั้น
export function toCE(date) {
  if (!date) return null;
  const m = String(date).match(/^(\d{4})(.*)$/);
  if (!m) return date;
  const year = Number(m[1]);
  // ปีที่มากกว่าปีนี้ 10 ปี = พ.ศ. แน่ ๆ (ไม่มีใครจ่ายเงินล่วงหน้า 10 ปี)
  return year > new Date().getFullYear() + 10 ? `${year - 543}${m[2]}` : date;
}

// ถอดเสียงที่ผู้ใช้ส่งมา (LINE ส่งมาเป็น m4a)
// มี ELEVENLABS_API_KEY = ใช้ Scribe (แม่นภาษาไทยกว่า) · ไม่มี = Whisper ผ่าน OpenRouter key เดิม
export async function transcribe(base64, format = 'm4a') {
  if (process.env.ELEVENLABS_API_KEY) return scribe(base64, format);

  const res = await fetch(`${OR}/audio/transcriptions`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({ model: STT_MODEL, input_audio: { data: base64, format } }),
  });
  if (!res.ok) throw new Error(`stt ${res.status}: ${await res.text()}`);
  return (await res.json()).text?.trim() || '';
}

async function scribe(base64, format) {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from(base64, 'base64')]), `audio.${format}`);
  form.append('model_id', process.env.ELEVENLABS_STT_MODEL || 'scribe_v1');
  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
    body: form,
  });
  if (!res.ok) throw new Error(`scribe ${res.status}: ${await res.text()}`);
  return (await res.json()).text?.trim() || '';
}

// สกัดออเดอร์จากข้อความในกลุ่มสั่งของ
export async function extractOrders(rows) {
  const msg = await chat(
    [
      {
        role: 'system',
        content:
          'ดึงเฉพาะข้อความที่เป็นการสั่งซื้อออกมา ตอบเป็น JSON array เท่านั้น ไม่ต้องมี markdown: ' +
          '[{"i":ลำดับข้อความ,"customer":"ชื่อ/null","items":["รายการ"],"amount":ยอดรวมถ้ามีไม่งั้น null}] ' +
          'ข้อความที่ไม่ใช่การสั่งของ ไม่ต้องใส่ · ไม่มีเลยตอบ []',
      },
      { role: 'user', content: rows.map((r, i) => `${i}. ${r.text}`).join('\n') },
    ],
    false
  );
  try {
    return JSON.parse(msg.content.replace(/```json?|```/g, '').trim());
  } catch {
    return [];
  }
}
