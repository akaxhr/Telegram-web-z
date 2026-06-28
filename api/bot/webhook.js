import { supabase } from "../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false });
  }

  try {
    const update = req.body;

    const msg =
      update.message ??
      update.edited_message ??
      update.channel_post ??
      update.edited_channel_post;

    if (!msg) {
      return res.json({ ok: true });
    }

    const chatId = String(msg.chat.id);
    const senderId = String(msg.from?.id ?? "0");

    // ---------- USER ----------
    if (msg.from) {
      await supabase
        .from("tg_users")
        .upsert({
          id: senderId,
          first_name: msg.from.first_name,
          last_name: msg.from.last_name,
          username: msg.from.username,
          is_bot: msg.from.is_bot,
        });
    }

    // ---------- CHAT ----------
    await supabase
      .from("tg_chats")
      .upsert({
        id: chatId,
        title:
          msg.chat.title ??
          `${msg.chat.first_name ?? ""} ${msg.chat.last_name ?? ""}`.trim(),
        type: msg.chat.type,
        last_message_id: msg.message_id,
      });

    // ---------- MESSAGE ----------
    await supabase
      .from("tg_messages")
      .upsert({
        id: msg.message_id,
        telegram_message_id: msg.message_id,

        chat_id: chatId,
        sender_id: senderId,

        date: msg.date,

        content: {
          text: {
            text: msg.text ?? "",
            entities: msg.entities ?? [],
          },
        },

        reply_info: msg.reply_to_message ?? null,

        forward_info: null,
        reactions: null,

        grouped_id: msg.media_group_id ?? null,

        sending_state: null,

        edit_date: msg.edit_date ?? null,

        is_outgoing: false,
        is_pinned: false,
        is_deleted: false,
      });

    await supabase
      .from("tg_chats")
      .update({
        last_message_id: msg.message_id,
      })
      .eq("id", chatId);

    return res.json({
      ok: true,
    });
  } catch (e) {
    console.error(e);

    return res.status(500).json({
      ok: false,
      error: e.message,
    });
  }
}