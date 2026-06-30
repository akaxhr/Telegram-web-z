import { supabase } from "../lib/supabase.js";
import { telegram } from "../lib/telegram.js";

const AVATAR_BUCKET = "telegram-avatars";

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

async function saveTelegramAvatar(senderId) {
  try {
    if (!senderId) return;

    const photos = await telegram.call("getUserProfilePhotos", {
      user_id: Number(senderId),
      limit: 1,
    });

    const fileId = photos.photos?.[0]?.[0]?.file_id;
    if (!fileId) return;

    const file = await telegram.call("getFile", {
      file_id: fileId,
    });

    if (!file?.file_path) return;

    const tgUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
    const imgRes = await fetch(tgUrl);

    if (!imgRes.ok) {
      console.error("[AVATAR] download failed", imgRes.status);
      return;
    }

    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png") ? "png" : "jpg";
    const storagePath = `${senderId}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(storagePath, buffer, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      console.error("[AVATAR] upload failed", uploadError);
      return;
    }
    
    console.log("[AVATAR] fileId", fileId);
console.log("[AVATAR] file", file);

console.log("[AVATAR] download", imgRes.status, imgRes.headers.get("content-type"));

console.log("[AVATAR] uploading to", storagePath);

console.log("[AVATAR] uploadError", uploadError);

    const { data: publicUrlData } = supabase.storage
      .from(AVATAR_BUCKET)
      .getPublicUrl(storagePath);

    await supabase
      .from("tg_users")
      .update({
        avatar_file_id: fileId,
        avatar_path: publicUrlData.publicUrl,
        avatar_updated_at: new Date().toISOString(),
      })
      .eq("id", String(senderId));

    console.log("[AVATAR] saved", senderId, publicUrlData.publicUrl);
  } catch (e) {
    console.error("[AVATAR] failed", e);
  }
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
      is_bot: Boolean(from.is_bot),
      raw: from,
      updated_at: new Date().toISOString(),
    });

    await saveTelegramAvatar(senderId);
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