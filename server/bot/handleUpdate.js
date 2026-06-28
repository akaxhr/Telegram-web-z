import { supabase } from "../lib/supabase.js";

function msgFromUpdate(update) {
  return (
    update.message ||
    update.edited_message ||
    update.channel_post ||
    update.edited_channel_post ||
    null
  );
}

function makeMessageId(chatId, messageId) {
  return Number(`${Math.abs(Number(chatId))}${messageId}`);
}

function contentFromMessage(msg) {
  return {
    text: {
      text: msg.text || msg.caption || "",
      entities: msg.entities || msg.caption_entities || [],
    },
  };
}

export async function handleTelegramUpdate(update) {
  const msg = msgFromUpdate(update);

  if (!msg) {
    console.log("[UNHANDLED UPDATE]", Object.keys(update));
    return;
  }

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
    id: makeMessageId(chatId, msg.message_id),
    chat_id: chatId,
    sender_id: senderId,
    telegram_message_id: msg.message_id,
    date: msg.date,
    content: contentFromMessage(msg),
    reply_info: msg.reply_to_message || null,
    forward_info: null,
    reactions: null,
    grouped_id: msg.media_group_id || null,
    sending_state: null,
    edit_date: msg.edit_date || null,
    is_outgoing: false,
    is_pinned: Boolean(msg.pinned_message),
    is_deleted: false,
    raw: msg,
    updated_at: new Date().toISOString(),
  });

  await supabase
    .from("tg_chats")
    .update({
      last_message_id: makeMessageId(chatId, msg.message_id),
      updated_at: new Date().toISOString(),
    })
    .eq("id", chatId);
}