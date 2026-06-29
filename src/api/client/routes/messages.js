import { supabase } from "../../../../server/lib/supabase.js";
import { telegram } from "../../../../server/lib/telegram.js";

const BOT_SENDER_ID = "bot";

function makeMessageId(chatId, messageId) {
  return Number(`${Math.abs(Number(chatId))}${messageId}`);
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function nowIso() {
  return new Date().toISOString();
}

function chatIdFrom(payload = {}) {
  const value =
    payload?.chatId ??
    payload?.toChatId ??
    payload?.fromChatId ??
    payload?.chat?.id ??
    payload?.peerId ??
    payload?.peer?.id ??
    payload?.messageList?.chatId ??
    "1";

  return String(value);
}

function senderIdFrom(payload = {}, chatId) {
  return String(
    payload?.senderId ??
    payload?.localMessage?.senderId ??
    payload?.message?.senderId ??
    payload?.fromId ??
    BOT_SENDER_ID ??
    chatId,
  );
}

function makeMessageId(chatId, telegramMessageId) {
  if (telegramMessageId) {
    const safeChat = String(chatId).replace(/[^0-9]/g, "") || "1";
    return Number(`${safeChat}${telegramMessageId}`);
  }

  return Date.now();
}

function emptyMessages(extra = {}) {
  return {
    messages: [],
    chats: [],
    users: [],
    topics: [],
    count: 0,
    totalCount: 0,
    ...extra,
  };
}

function affected(extra = {}) {
  return {
    pts: 0,
    ptsCount: 0,
    offset: 0,
    ...extra,
  };
}

function ok(extra = {}) {
  return {
    ok: true,
    ...extra,
  };
}

function normalizeContent(rowOrPayload = {}) {
  if (rowOrPayload?.content) return rowOrPayload.content;

  const text =
    rowOrPayload?.text?.text ??
    rowOrPayload?.text ??
    rowOrPayload?.message?.content?.text?.text ??
    rowOrPayload?.localMessage?.content?.text?.text ??
    rowOrPayload?.caption?.text ??
    rowOrPayload?.caption ??
    "";

  return {
    text: {
      text: String(text ?? ""),
      entities: rowOrPayload?.entities ?? [],
    },
  };
}

function normalizeMessageRow(m) {
  if (!m) return undefined;

  return {
    id: Number(m.id),
    chatId: String(m.chat_id ?? m.chatId),
    senderId: String(m.sender_id ?? m.senderId ?? BOT_SENDER_ID),
    date: Number(m.date ?? nowSec()),
    content: m.content ?? normalizeContent(m),
    replyInfo: m.reply_info ?? m.replyInfo ?? undefined,
    forwardInfo: m.forward_info ?? m.forwardInfo ?? undefined,
    reactions: m.reactions ?? undefined,
    groupedId: m.grouped_id ?? m.groupedId ?? undefined,
    sendingState: m.sending_state ?? m.sendingState ?? undefined,
    editDate: m.edit_date ?? m.editDate ?? undefined,
    isOutgoing: Boolean(m.is_outgoing ?? m.isOutgoing),
    isPinned: Boolean(m.is_pinned ?? m.isPinned),
  };
}

function normalizeUserRow(u) {
  if (!u) return undefined;

  return {
    id: String(u.id),
    type: "user",
    firstName: u.first_name ?? u.firstName ?? "",
    lastName: u.last_name ?? u.lastName ?? "",
    username: u.username ?? undefined,
    isSelf: Boolean(u.is_self ?? u.isSelf),
  };
}

function normalizeChatRow(c) {
  if (!c) return undefined;

  return {
    id: String(c.id),
    title: c.title ?? "Chat",
    type: c.type ?? "chatTypePrivate",
    accessHash: c.access_hash ?? c.accessHash ?? "0",
    isListed: true,
    isPinned: Boolean(c.is_pinned ?? c.isPinned),
    isMuted: Boolean(c.is_muted ?? c.isMuted),
    isArchived: Boolean(c.is_archived ?? c.isArchived),
    isForum: Boolean(c.is_forum ?? c.isForum),
    withForumTabs: Boolean(c.with_forum_tabs ?? c.withForumTabs),
  };
}

async function getTelegramMessageId(chatId, messageId) {
  const { data, error } = await supabase
    .from("tg_messages")
    .select("telegram_message_id")
    .eq("chat_id", String(chatId))
    .eq("id", Number(messageId))
    .maybeSingle();

  if (error) throw error;

  return data?.telegram_message_id ?? messageId;
}

async function loadMessagesByChat(payload = {}) {
  const chatId = chatIdFrom(payload);
  const limit = Number(payload.limit ?? 50);
  const offsetId = payload.offsetId ? Number(payload.offsetId) : undefined;

  let query = supabase
    .from("tg_messages")
    .select("*")
    .eq("chat_id", chatId)
    .eq("is_deleted", false)
    .order("date", { ascending: true })
    .order("id", { ascending: true });

  if (offsetId) query = query.lt("id", offsetId);
  if (limit) query = query.limit(limit);

  const { data: messageRows, error: msgError } = await query;
  if (msgError) throw msgError;

  const senderIds = [
    ...new Set(
      (messageRows ?? [])
        .map((m) => m.sender_id)
        .filter(Boolean)
        .map(String),
    ),
  ];

  const { data: userRows, error: userError } = senderIds.length
    ? await supabase.from("tg_users").select("*").in("id", senderIds)
    : { data: [], error: null };

  if (userError) throw userError;

  const { data: chatRows, error: chatError } = await supabase
    .from("tg_chats")
    .select("*")
    .eq("id", chatId);

  if (chatError) throw chatError;

  const messages = (messageRows ?? []).map(normalizeMessageRow).filter(Boolean);
  const users = (userRows ?? []).map(normalizeUserRow).filter(Boolean);
  const chats = (chatRows ?? []).map(normalizeChatRow).filter(Boolean);

  return {
    messages,
    chats,
    users,
    topics: [],
    count: messages.length,
    totalCount: messages.length,
  };
}

async function loadOneMessage(payload = {}) {
  const messageId = payload.messageId ?? payload.id;
  const chatId = chatIdFrom(payload);

  if (!messageId) return { message: undefined, ...emptyMessages() };

  const { data, error } = await supabase
    .from("tg_messages")
    .select("*")
    .eq("chat_id", chatId)
    .eq("id", Number(messageId))
    .eq("is_deleted", false)
    .maybeSingle();

  if (error) throw error;

  const message = data ? normalizeMessageRow(data) : undefined;

  return {
    message,
    messages: message ? [message] : [],
    chats: [],
    users: [],
    topics: [],
    count: message ? 1 : 0,
    totalCount: message ? 1 : 0,
  };
}

async function loadMessagesByIds(payload = {}) {
  const messageIds = payload.messageIds ?? payload.ids ?? [];
  const chatId = chatIdFrom(payload);

  if (!messageIds.length) return emptyMessages();

  const { data, error } = await supabase
    .from("tg_messages")
    .select("*")
    .eq("chat_id", chatId)
    .eq("is_deleted", false)
    .in("id", messageIds.map(Number))
    .order("date", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw error;

  const messages = (data ?? []).map(normalizeMessageRow).filter(Boolean);

  return emptyMessages({
    messages,
    count: messages.length,
    totalCount: messages.length,
  });
}

async function upsertMessageRow(row) {
  const { error } = await supabase.from("tg_messages").upsert(row);
  if (error) throw error;
}

async function touchChat(chatId, lastMessageId) {
  await supabase
    .from("tg_chats")
    .update({
      last_message_id: lastMessageId,
      updated_at: nowIso(),
    })
    .eq("id", String(chatId));
}

async function markMessagesDeleted(payload = {}) {
  const chatId = chatIdFrom(payload);
  const messageIds = payload.messageIds ?? payload.ids ?? [];

  if (messageIds.length) {
    const { error } = await supabase
      .from("tg_messages")
      .update({ is_deleted: true, updated_at: nowIso() })
      .eq("chat_id", chatId)
      .in("id", messageIds.map(Number));

    if (error) throw error;
  }

  return affected({ affectedMessages: messageIds });
}

async function sendBotText(payload = {}) {
  const chatId = chatIdFrom(payload);
  const text = String(
    payload?.text ??
    payload?.localMessage?.content?.text?.text ??
    payload?.message?.content?.text?.text ??
    "",
  );

  if (!chatId || chatId === "undefined") {
    throw new Error("Missing chatId in messages.sendMessage");
  }

  let tg = null;
  if (chatId !== "1") {
    tg = await telegram.sendMessage({ chat_id: chatId, text });
  }

  const telegramMessageId = tg?.message_id ?? tg?.result?.message_id ?? null;
  const id = makeMessageId(chatId, telegramMessageId);
  const date = nowSec();
  const senderId = senderIdFrom(payload, chatId);
  const content = normalizeContent({ text, entities: payload.entities ?? [] });

  const row = {
    id,
    chat_id: chatId,
    sender_id: senderId,
    telegram_message_id: telegramMessageId ?? id,
    date,
    content,
    reply_info: payload?.replyInfo ?? null,
    forward_info: null,
    reactions: null,
    grouped_id: null,
    sending_state: null,
    edit_date: null,
    is_outgoing: true,
    is_pinned: false,
    is_deleted: false,
    raw: tg?.result ?? tg ?? null,
    updated_at: nowIso(),
  };

  await upsertMessageRow(row);
  await touchChat(chatId, id);

  return ok({
    updates: [],
    message: normalizeMessageRow(row),
  });
}

async function sendBotMedia(payload = {}) {
  const chatId = chatIdFrom(payload);
  const media = payload.media || payload.file || payload;
  const caption = payload.caption?.text ?? payload.caption ?? payload.text ?? "";

  let tg = null;

  if (chatId !== "1") {
    if (media?.photo) tg = await telegram.sendPhoto({ chat_id: chatId, photo: media.photo, caption });
    else if (media?.video) tg = await telegram.sendVideo({ chat_id: chatId, video: media.video, caption });
    else if (media?.document) tg = await telegram.sendDocument({ chat_id: chatId, document: media.document, caption });
    else if (media?.audio) tg = await telegram.sendAudio({ chat_id: chatId, audio: media.audio, caption });
    else if (media?.voice) tg = await telegram.sendVoice({ chat_id: chatId, voice: media.voice, caption });
    else if (media?.animation) tg = await telegram.sendAnimation({ chat_id: chatId, animation: media.animation, caption });
    else if (media?.sticker) tg = await telegram.sendSticker({ chat_id: chatId, sticker: media.sticker });
  }

  const telegramMessageId = tg?.message_id ?? tg?.result?.message_id ?? null;
  const id = makeMessageId(chatId, telegramMessageId);
  const date = nowSec();
  const senderId = senderIdFrom(payload, chatId);
  const content = normalizeContent({ text: caption, entities: payload.entities ?? [] });

  const row = {
    id,
    chat_id: chatId,
    sender_id: senderId,
    telegram_message_id: telegramMessageId ?? id,
    date,
    content,
    reply_info: payload?.replyInfo ?? null,
    forward_info: null,
    reactions: null,
    grouped_id: null,
    sending_state: null,
    edit_date: null,
    is_outgoing: true,
    is_pinned: false,
    is_deleted: false,
    raw: tg?.result ?? tg ?? null,
    updated_at: nowIso(),
  };

  await upsertMessageRow(row);
  await touchChat(chatId, id);

  return ok({ updates: [], message: normalizeMessageRow(row), raw: tg });
}

export const messageRoutes = {
  
  async "messages.fetchMessages"(payload) {
    return loadMessagesByChat(payload);
  },

  async "messages.fetchMessage"(payload) {
    return loadOneMessage(payload);
  },

  async "messages.fetchRichMessage"(payload) {
    return loadOneMessage(payload);
  },

  async "messages.fetchMessagesByIds"(payload) {
    return loadMessagesByIds(payload);
  },

  async "messages.getHistory"(payload) {
    return loadMessagesByChat(payload);
  },

  async "messages.sendMessage"(payload) {
  const chatId = String(payload.chat?.id || payload.chatId);
  const text = payload.text || payload.message || "";

  const sent = await telegram.sendMessage({
    chat_id: chatId,
    text,
  });

  const senderId = String(sent.from?.id || process.env.BOT_ID || "bot");

  await supabase.from("tg_users").upsert({
    id: senderId,
    first_name: sent.from?.first_name || "Acarthub",
    username: sent.from?.username || "acarthub_bot",
    is_bot: true,
  }, { onConflict: "id" });

  const apiContent = {
  text: {
    text,
    entities: [],
  },
};

const { data: inserted, error } = await supabase
  .from("tg_messages")
  .insert({
    id: makeMessageId(chatId, sent.message_id),
    chat_id: chatId,
    sender_id: senderId,
    telegram_message_id: sent.message_id,
    date: sent.date || Math.floor(Date.now() / 1000),
    is_outgoing: true,
    content: apiContent,
    raw: sent,
  })
  .select()
  .single();

if (error) throw error;

await touchChat(chatId, inserted.id);

return {
  message: {
    id: inserted.id,
    chatId,
    senderId,
    date: inserted.date,
    content: inserted.content,
    isOutgoing: true,
  },
};
  },
  

  async "messages.sendMedia"(payload) {
    return sendBotMedia(payload);
  },

  async "messages.sendMultiMedia"(payload) {
    const chatId = chatIdFrom(payload);
    const mediaItems = Object.values(payload.singleMediaByIndex ?? payload.multiMedia ?? payload.media ?? []);

    if (chatId !== "1" && mediaItems.length) {
      const media = mediaItems.map((item) => ({
        type: item.type || "photo",
        media: item.fileId || item.media || item.photo || item.video,
        caption: item.caption?.text ?? item.caption ?? item.message ?? "",
      }));

      await telegram.sendMediaGroup({ chat_id: chatId, media });
    }

    return ok({ updates: [], messages: [], message: null });
  },

  async "messages.uploadMedia"(payload) {
    console.log("messages.uploadMedia", payload);
    return {};
  },

  async "messages.editMessage"(payload) {
    const chatId = chatIdFrom(payload);
    const messageId = payload.messageId ?? payload.id ?? payload.message?.id;
    const text = String(payload.text ?? payload.message?.content?.text?.text ?? "");
    const content = normalizeContent({ text, entities: payload.entities ?? [] });
    const editDate = nowSec();
    const telegramMessageId = await getTelegramMessageId(chatId, messageId);

    if (chatId !== "1") {
      await telegram.editMessageText({
        chat_id: chatId,
        message_id: telegramMessageId,
        text,
      });
    }

    const { error } = await supabase
      .from("tg_messages")
      .update({ content, edit_date: editDate, updated_at: nowIso() })
      .eq("chat_id", chatId)
      .eq("id", Number(messageId));

    if (error) throw error;

    return ok({
      updates: [],
      message: {
        id: Number(messageId),
        chatId,
        content,
        editDate,
      },
    });
  },

  async "messages.editMessageMedia"(payload) {
    const chatId = chatIdFrom(payload);
    const messageId = payload.messageId ?? payload.id ?? payload.message?.id;
    const telegramMessageId = await getTelegramMessageId(chatId, messageId);

    if (chatId !== "1") {
      await telegram.call("editMessageMedia", {
        chat_id: chatId,
        message_id: telegramMessageId,
        media: payload.media,
      });
    }

    return ok();
  },

  async "messages.updatePinnedMessage"(payload) {
    const chatId = chatIdFrom(payload);
    const messageId = payload.messageId ?? payload.id;
    const telegramMessageId = await getTelegramMessageId(chatId, messageId);

    if (chatId !== "1") {
      if (payload.isUnpin || payload.isPinned === false || payload.shouldUnpin) {
        await telegram.unpinChatMessage({ chat_id: chatId, message_id: telegramMessageId });
      } else {
        await telegram.pinChatMessage({
          chat_id: chatId,
          message_id: telegramMessageId,
          disable_notification: Boolean(payload.isSilent),
        });
      }
    }

    return ok();
  },

  async "messages.unpinAllMessages"(payload) {
    const chatId = chatIdFrom(payload);
    if (chatId !== "1") await telegram.unpinAllChatMessages({ chat_id: chatId });
    return affected();
  },

  async "messages.deleteMessages"(payload) {
    const chatId = chatIdFrom(payload);
    const messageIds = payload.messageIds ?? payload.ids ?? [];

    if (chatId !== "1") {
      for (const id of messageIds) {
        const telegramMessageId = await getTelegramMessageId(chatId, id);
        await telegram.deleteMessage({ chat_id: chatId, message_id: telegramMessageId });
      }
    }

    return markMessagesDeleted({ ...payload, messageIds });
  },

  async "messages.setTyping"(payload) {
    const chatId = chatIdFrom(payload);
    if (chatId !== "1") {
      await telegram.call("sendChatAction", {
        chat_id: chatId,
        action: payload.action || "typing",
      });
    }
    return true;
  },

  async "messages.forwardMessages"(payload) {
    const toChatId = String(payload.toChatId ?? payload.chatId ?? payload.toChat?.id ?? "");
    const fromChatId = String(payload.fromChatId ?? payload.fromChat?.id ?? chatIdFrom(payload));
    const messageIds = payload.messageIds ?? payload.ids ?? [];

    if (toChatId && fromChatId && messageIds.length) {
      for (const id of messageIds) {
        const telegramMessageId = await getTelegramMessageId(fromChatId, id);
        await telegram.forwardMessage({
          chat_id: toChatId,
          from_chat_id: fromChatId,
          message_id: telegramMessageId,
        });
      }
    }

    return ok({ updates: [], messages: [], message: null });
  },

  async "messages.getMessagesViews"(payload) {
    const ids = payload.messageIds ?? payload.ids ?? [];
    return {
      views: ids.map(() => ({ views: 0, forwards: 0, replies: undefined })),
    };
  },

  async "messages.getPollVotes"() {
    return { count: 0, votes: [], nextOffset: undefined };
  },

  async "channels.getSendAs"() {
    return { peers: [], chats: [], users: [] };
  },

  async "messages.getQuickReplies"() {
    return { quickReplies: [], messages: [], chats: [], users: [] };
  },

  async "messages.getQuickReplyMessages"() {
    return emptyMessages();
  },

  async "messages.getUnreadMentions"() {
    return emptyMessages();
  },

  async "messages.getUnreadReactions"() {
    return emptyMessages();
  },

  async "messages.getUnreadPollVotes"() {
    return emptyMessages();
  },

  async "messages.getDiscussionMessage"() {
    return emptyMessages({ maxId: 0 });
  },

  async "messages.search"() {
    return emptyMessages();
  },

  async "messages.searchGlobal"() {
    return emptyMessages({ nextRate: 0 });
  },

  async "channels.searchPosts"() {
    return emptyMessages({ nextRate: 0 });
  },

  async "channels.checkSearchPostsFlood"() {
    return { starsAmount: 0, floodWait: 0 };
  },

  async "messages.getWebPagePreview"() {
    return undefined;
  },

  async "messages.getWebPage"() {
    return { webpage: undefined };
  },

  async "messages.transcribeAudio"() {
    return { pending: false, transcriptionId: "0", text: "" };
  },

  async "messages.translateText"() {
    return { result: [], translations: [] };
  },

  async "messages.summarizeText"() {
    return { text: "", entities: [] };
  },

  async "messages.getOutboxReadDate"() {
    return { date: 0 };
  },

  async "messages.getMessageReadParticipants"() {
    return [];
  },

  async "messages.getSponsoredMessages"() {
    return { messages: [], chats: [], users: [] };
  },

  async "channels.exportMessageLink"() {
    return { link: "", html: "" };
  },

  async "messages.getPreparedInlineMessage"() {
    return { message: null, users: [], chats: [] };
  },

  async "messages.composeMessageWithAI"() {
    return { text: "", entities: [] };
  },

  async "aicompose.getTones"() {
    return { hash: 0, tones: [] };
  },

  async "aicompose.createTone"(payload) {
    return { tone: payload };
  },

  async "aicompose.updateTone"(payload) {
    return { tone: payload };
  },

  async "aicompose.getTone"() {
    return { tones: [] };
  },

  async "aicompose.getToneExample"() {
    return { text: "", entities: [] };
  },

  async "aicompose.deleteTone"() {
    return ok();
  },

  async "aicompose.saveTone"() {
    return ok();
  },

  async "messages.appendTodoList"() { return ok(); },
  async "messages.editScheduledMessage"() { return ok(); },
  async "messages.deleteScheduledMessages"() { return ok(); },
  async "channels.deleteParticipantHistory"() { return affected(); },
  async "messages.editChatParticipantRank"() { return true; },
  async "channels.deleteHistory"() { return affected(); },
  async "messages.deleteHistory"() { return affected(); },
  async "messages.deleteSavedHistory"() { return affected(); },
  async "messages.toggleSuggestedPostApproval"() { return ok(); },
  async "messages.report"() { return {}; },
  async "channels.reportSpam"() { return ok(); },
  async "channels.readHistory"() { return affected(); },
  async "messages.readDiscussion"() { return affected(); },
  async "messages.readHistory"() { return affected(); },
  async "channels.readMessageContents"() { return affected(); },
  async "messages.readMessageContents"() { return affected(); },
  async "messages.getFactCheck"() { return []; },
  async "messages.getPaidReactionPrivacy"() { return true; },
  async "messages.reportMessagesDelivery"() { return ok(); },
  async "messages.sendVote"() { return ok({ updates: [] }); },
  async "messages.addPollAnswer"() { return ok({ updates: [] }); },
  async "messages.toggleTodoCompleted"() { return ok({ updates: [] }); },
  async "messages.editPoll"(payload) {
    const chatId = chatIdFrom(payload);
    const messageId = payload.messageId ?? payload.id;
    const telegramMessageId = await getTelegramMessageId(chatId, messageId);
    if (chatId !== "1") {
      await telegram.call("stopPoll", { chat_id: chatId, message_id: telegramMessageId });
    }
    return ok({ updates: [] });
  },
  async "messages.getExtendedMedia"() { return ok({ media: [], users: [], chats: [] }); },
  async "messages.getScheduledHistory"() { return emptyMessages(); },
  async "messages.sendScheduledMessages"() { return ok({ updates: [] }); },
  async "messages.searchPinned"() { return emptyMessages(); },
  async "messages.saveDefaultSendAs"() { return ok(); },
  async "messages.viewSponsoredMessage"() { return ok(); },
  async "messages.clickSponsoredMessage"() { return ok(); },
  async "messages.reportSponsoredMessage"() { return {}; },
  async "messages.readMentions"() { return affected(); },
  async "messages.readReactions"() { return affected(); },
  async "messages.readPollVotes"() { return affected(); },
  async "messages.sendQuickReplyMessages"() { return ok({ updates: [], message: null }); },
};
