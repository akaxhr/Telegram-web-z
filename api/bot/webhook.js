import { supabase } from "../lib/supabase.js";

function contentFromTelegram(msg) {
  return {
    text: {
      text: msg.text || msg.caption || "",
      entities: msg.entities || msg.caption_entities || [],
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  try {
    const update = req.body;
    const msg = update.message || update.edited_message;

    if (!msg) return res.json({ ok: true });

    const chatId = String(msg.chat.id);
    const from = msg.from;
    const senderId = from ? String(from.id) : null;

    if (from) {
      await supabase.from("tg_users").upsert({
        id: senderId,
        first_name: from.first_name || "",
        last_name: from.last_name || "",
        username: from.username || null,
        raw: from,
        updated_at: new Date().toISOString(),
      });
    }

    await supabase.from("tg_chats").upsert({
      id: chatId,
      title: msg.chat.title || msg.chat.first_name || msg.chat.username || "Chat",
      type: msg.chat.type,
      raw: msg.chat,
      updated_at: new Date().toISOString(),
    });

    await supabase.from("tg_messages").upsert({
      id: Number(`${Math.abs(Number(chatId))}${msg.message_id}`),
      chat_id: chatId,
      sender_id: senderId,
      telegram_message_id: msg.message_id,
      date: msg.date,
      is_outgoing: false,
      content: contentFromTelegram(msg),
      reply_info: msg.reply_to_message || null,
      forward_info: null,
      reactions: null,
      grouped_id: msg.media_group_id || null,
      sending_state: null,
      edit_date: msg.edit_date || null,
      is_pinned: false,
      is_deleted: false,
      raw: msg,
      updated_at: new Date().toISOString(),
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("[BOT WEBHOOK ERROR]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}