import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://zpilbjbvepwurrquwolb.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpwaWxiamJ2ZXB3dXJycXV3b2xiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjU4MDAwOCwiZXhwIjoyMDk4MTU2MDA4fQ.hSgInSden9Pu0efS0yhKLdpNaVmMvNfssB6cZtVTg9M"
);

function emptyMessages(extra = {}) {
  return {
    messages: [],
    chats: [],
    users: [],
    topics: [],
    count: 0,
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

function chatIdFrom(payload = {}) {
  return String(
    payload?.chat?.id
    ?? payload?.peer?.id
    ?? payload?.chatId
    ?? "1"
  );
}

async function loadMessagesByChat(payload = {}) {
  const chatId = chatIdFrom(payload);

  const { data: messageRows, error: msgError } = await supabase
    .from("tg_messages")
    .select("*")
    .eq("chat_id", chatId)
    .eq("is_deleted", false)
    .order("date", { ascending: true });

  if (msgError) throw msgError;

  const senderIds = [
    ...new Set(
      (messageRows ?? [])
        .map((m) => m.sender_id)
        .filter(Boolean)
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

  const messages = (messageRows ?? []).map((m) => ({
    id: m.id,
    chatId: m.chat_id,
    senderId: m.sender_id,
    date: m.date,
    content: m.content,
    replyInfo: m.reply_info,
    forwardInfo: m.forward_info,
    reactions: m.reactions,
    groupedId: m.grouped_id,
    sendingState: m.sending_state,
    editDate: m.edit_date,
    isOutgoing: m.is_outgoing,
    isPinned: m.is_pinned,
  }));

  const users = (userRows ?? []).map((u) => ({
    id: u.id,
    firstName: u.first_name ?? "",
    lastName: u.last_name ?? "",
    username: u.username ?? undefined,
    isSelf: false,
    type: "user",
  }));

  const chats = (chatRows ?? []).map((c) => ({
    id: c.id,
    title: c.title ?? "Chat",
    type: c.type ?? "group",
  }));

  return {
    messages,
    chats,
    users,
    topics: [],
    count: messages.length,
  };
}

async function loadOneMessage(payload = {}) {
  const { messageId } = payload;
  const chatId = chatIdFrom(payload);

  const { data, error } = await supabase
    .from("tg_messages")
    .select("*")
    .eq("chat_id", chatId)
    .eq("id", messageId)
    .maybeSingle();

  if (error) throw error;

  return emptyMessages({
    messages: data ? [data] : [],
    count: data ? 1 : 0,
  });
}

async function loadMessagesByIds(payload = {}) {
  const { messageIds = [] } = payload;
  const chatId = chatIdFrom(payload);

  if (!messageIds.length) {
    return emptyMessages();
  }

  const { data, error } = await supabase
    .from("tg_messages")
    .select("*")
    .eq("chat_id", chatId)
    .in("id", messageIds)
    .order("date", { ascending: true });

  if (error) throw error;

  return emptyMessages({
    messages: data ?? [],
    count: data?.length ?? 0,
  });
}

async function markMessagesDeleted(payload = {}) {
  const { messageIds = [] } = payload;

  if (messageIds.length) {
    const { error } = await supabase
      .from("tg_messages")
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq("chat_id", chatIdFrom(payload))
      .in("id", messageIds);

    if (error) throw error;
  }

  return affected({ affectedMessages: messageIds });
}

export const messageRoutes = {
  async "messages.fetchMessages"(payload, options) {
    return loadMessagesByChat(payload);
  },

  async "messages.fetchMessage"(payload, options) {
    return loadOneMessage(payload);
  },

  async "messages.fetchRichMessage"(payload, options) {
    return loadOneMessage(payload);
  },

  async "messages.fetchMessagesByIds"(payload, options) {
    return loadMessagesByIds(payload);
  },

  async "messages.sendMedia"(payload, options) {
    console.log("messages.sendMedia", payload);
    return ok({ updates: [], message: null });
  },

  async "messages.sendMessage"(payload) {
  const chatId = payload.chat.id;

  // Temporary until auth/bot is connected
  const senderId = "user-1";

  const now = Math.floor(Date.now() / 1000);
  const id = Date.now();

  const row = {
    id,
    chat_id: chatId,
    sender_id: senderId,
    telegram_message_id: id,
    date: now,

    content: {
      type: "text",
      text: payload.text,
    },

    reply_info: null,
    forward_info: null,
    reactions: null,

    grouped_id: null,
    sending_state: null,
    edit_date: null,

    is_outgoing: true,
    is_pinned: false,
    is_deleted: false,
  };

  const { error } = await supabase
    .from("tg_messages")
    .insert(row);

  if (error) throw error;

  return {
    updates: [],
    message: {
      id,
      chatId,
      senderId,
      date: now,
      content: row.content,
      isOutgoing: true,
    },
  };
},

  async "messages.sendMultiMedia"(payload, options) {
    console.log("messages.sendMultiMedia", payload);
    return ok({ updates: [], message: null });
  },

  async "messages.uploadMedia"(payload, options) {
    console.log("messages.uploadMedia", payload);
    return {};
  },

  async "messages.editMessage"(payload) {
  console.log("messages.editMessage", payload);

  const chatId = chatIdFrom(payload);
  const messageId = payload.messageId ?? payload.id;

  const now = Math.floor(Date.now() / 1000);

  const content = {
    type: "text",
    text: payload.text ?? payload.message ?? "",
  };

  const { error } = await supabase
    .from("tg_messages")
    .update({
      content,
      edit_date: now,
      updated_at: new Date().toISOString(),
    })
    .eq("chat_id", chatId)
    .eq("id", messageId);

  if (error) throw error;

  return ok({
    updates: [],
    message: {
      id: messageId,
      chatId,
      content,
      editDate: now,
    },
  });
},

  async "messages.editMessageMedia"(payload, options) {
    console.log("messages.editMessageMedia", payload);
    return ok();
  },

  async "messages.appendTodoList"(payload, options) {
    console.log("messages.appendTodoList", payload);
    return ok();
  },

  async "messages.editScheduledMessage"(payload, options) {
    console.log("messages.editScheduledMessage", payload);
    return ok();
  },

  async "messages.updatePinnedMessage"(payload, options) {
    console.log("messages.updatePinnedMessage", payload);
    return ok();
  },

  async "messages.unpinAllMessages"(payload, options) {
    console.log("messages.unpinAllMessages", payload);
    return affected();
  },

  async "messages.deleteMessages"(payload, options) {
    console.log("messages.deleteMessages", payload);
    return markMessagesDeleted(payload);
  },

  async "channels.deleteParticipantHistory"(payload, options) {
    console.log("channels.deleteParticipantHistory", payload);
    return affected();
  },

  async "messages.editChatParticipantRank"(payload, options) {
    console.log("messages.editChatParticipantRank", payload);
    return true;
  },

  async "messages.deleteScheduledMessages"(payload, options) {
    console.log("messages.deleteScheduledMessages", payload);
    return ok();
  },

  async "channels.deleteHistory"(payload, options) {
    console.log("channels.deleteHistory", payload);
    return affected();
  },

  async "messages.deleteHistory"(payload, options) {
    console.log("messages.deleteHistory", payload);
    return affected();
  },

  async "messages.deleteSavedHistory"(payload, options) {
    console.log("messages.deleteSavedHistory", payload);
    return affected();
  },

  async "messages.toggleSuggestedPostApproval"(payload, options) {
    console.log("messages.toggleSuggestedPostApproval", payload);
    return ok();
  },

  async "messages.report"(payload, options) {
    console.log("messages.report", payload);
    return {};
  },

  async "channels.reportSpam"(payload, options) {
    console.log("channels.reportSpam", payload);
    return ok();
  },

  async "messages.setTyping"(payload, options) {
    console.log("messages.setTyping", payload);
    return true;
  },

  async "channels.readHistory"(payload, options) {
    console.log("channels.readHistory", payload);
    return affected();
  },

  async "messages.readDiscussion"(payload, options) {
    console.log("messages.readDiscussion", payload);
    return affected();
  },

  async "messages.readHistory"(payload, options) {
    console.log("messages.readHistory", payload);
    return affected();
  },

  async "channels.readMessageContents"(payload, options) {
    console.log("channels.readMessageContents", payload);
    return affected();
  },

  async "messages.readMessageContents"(payload, options) {
    console.log("messages.readMessageContents", payload);
    return affected();
  },

  async "messages.getMessagesViews"(payload, options) {
    const ids = payload?.messageIds ?? payload?.ids ?? [];

    return {
      views: ids.map(() => ({
        views: 0,
        forwards: 0,
        replies: undefined,
      })),
    };
  },

  async "messages.getFactCheck"(payload, options) {
    console.log("messages.getFactCheck", payload);
    return [];
  },

  async "messages.getPaidReactionPrivacy"(payload, options) {
    return true;
  },

  async "messages.reportMessagesDelivery"(payload, options) {
    console.log("messages.reportMessagesDelivery", payload);
    return ok();
  },

  async "messages.getDiscussionMessage"(payload, options) {
    console.log("messages.getDiscussionMessage", payload);
    return emptyMessages({ maxId: 0 });
  },

  async "messages.search"(payload, options) {
    console.log("messages.search", payload);
    return emptyMessages();
  },

  async "messages.searchGlobal"(payload, options) {
    console.log("messages.searchGlobal", payload);
    return emptyMessages({ nextRate: 0 });
  },

  async "channels.searchPosts"(payload, options) {
    console.log("channels.searchPosts", payload);
    return emptyMessages({ nextRate: 0 });
  },

  async "channels.checkSearchPostsFlood"(payload, options) {
    console.log("channels.checkSearchPostsFlood", payload);
    return {
      starsAmount: 0,
      floodWait: 0,
    };
  },

  async "messages.getWebPagePreview"(payload, options) {
    console.log("messages.getWebPagePreview", payload);
    return null;
  },

  async "messages.getWebPage"(payload, options) {
    console.log("messages.getWebPage", payload);
    return {
      webpage: undefined,
    };
  },

  async "messages.sendVote"(payload, options) {
    console.log("messages.sendVote", payload);
    return ok({ updates: [] });
  },

  async "messages.addPollAnswer"(payload, options) {
    console.log("messages.addPollAnswer", payload);
    return ok({ updates: [] });
  },

  async "messages.toggleTodoCompleted"(payload, options) {
    console.log("messages.toggleTodoCompleted", payload);
    return ok({ updates: [] });
  },

  async "messages.editPoll"(payload, options) {
    console.log("messages.editPoll", payload);
    return ok({ updates: [] });
  },

  async "messages.getPollVotes"(payload, options) {
    console.log("messages.getPollVotes", payload);
    return {
      count: 0,
      votes: [],
      nextOffset: undefined,
    };
  },

  async "messages.getExtendedMedia"(payload, options) {
    console.log("messages.getExtendedMedia", payload);
    return ok({ media: [], users: [], chats: [] });
  },

  async "messages.forwardMessages"(payload, options) {
    console.log("messages.forwardMessages", payload);
    return ok({ updates: [], message: null });
  },

  async "messages.getHistory"(payload, options) {
    return loadMessagesByChat(payload);
  },

  async "messages.getScheduledHistory"(payload, options) {
    console.log("messages.getScheduledHistory", payload);
    return emptyMessages();
  },

  async "messages.sendScheduledMessages"(payload, options) {
    console.log("messages.sendScheduledMessages", payload);
    return ok({ updates: [] });
  },

  async "messages.searchPinned"(payload, options) {
    console.log("messages.searchPinned", payload);
    return emptyMessages();
  },

  async "messages.getMessageReadParticipants"(payload, options) {
    console.log("messages.getMessageReadParticipants", payload);
    return [];
  },

  async "channels.getSendAs"(payload, options) {
    console.log("channels.getSendAs", payload);
    return {
      peers: [],
      chats: [],
      users: [],
    };
  },

  async "messages.saveDefaultSendAs"(payload, options) {
    console.log("messages.saveDefaultSendAs", payload);
    return ok();
  },

  async "messages.getSponsoredMessages"(payload, options) {
    console.log("messages.getSponsoredMessages", payload);
    return {
      messages: [],
      chats: [],
      users: [],
    };
  },

  async "messages.viewSponsoredMessage"(payload, options) {
    console.log("messages.viewSponsoredMessage", payload);
    return ok();
  },

  async "messages.clickSponsoredMessage"(payload, options) {
    console.log("messages.clickSponsoredMessage", payload);
    return ok();
  },

  async "messages.reportSponsoredMessage"(payload, options) {
    console.log("messages.reportSponsoredMessage", payload);
    return {};
  },

  async "messages.readMentions"(payload, options) {
    console.log("messages.readMentions", payload);
    return affected();
  },

  async "messages.readReactions"(payload, options) {
    console.log("messages.readReactions", payload);
    return affected();
  },

  async "messages.readPollVotes"(payload, options) {
    console.log("messages.readPollVotes", payload);
    return affected();
  },

  async "messages.getUnreadMentions"(payload, options) {
    console.log("messages.getUnreadMentions", payload);
    return emptyMessages();
  },

  async "messages.getUnreadReactions"(payload, options) {
    console.log("messages.getUnreadReactions", payload);
    return emptyMessages();
  },

  async "messages.getUnreadPollVotes"(payload, options) {
    console.log("messages.getUnreadPollVotes", payload);
    return emptyMessages();
  },

  async "messages.transcribeAudio"(payload, options) {
    console.log("messages.transcribeAudio", payload);
    return {
      pending: false,
      transcriptionId: "0",
      text: "",
    };
  },

  async "messages.translateText"(payload, options) {
    console.log("messages.translateText", payload);
    return {
      result: [],
    };
  },

  async "messages.summarizeText"(payload, options) {
    console.log("messages.summarizeText", payload);
    return {
      text: "",
      entities: [],
    };
  },

  async "messages.getOutboxReadDate"(payload, options) {
    console.log("messages.getOutboxReadDate", payload);
    return {
      date: 0,
    };
  },

  async "messages.getQuickReplies"(payload, options) {
    return {
      quickReplies: [],
      messages: [],
      chats: [],
      users: [],
    };
  },

  async "messages.getQuickReplyMessages"(payload, options) {
    console.log("messages.getQuickReplyMessages", payload);
    return emptyMessages();
  },

  async "messages.sendQuickReplyMessages"(payload, options) {
    console.log("messages.sendQuickReplyMessages", payload);
    return ok({ updates: [], message: null });
  },

  async "channels.exportMessageLink"(payload, options) {
    console.log("channels.exportMessageLink", payload);
    return {
      link: "",
      html: "",
    };
  },

  async "messages.getPreparedInlineMessage"(payload, options) {
    console.log("messages.getPreparedInlineMessage", payload);
    return {
      message: null,
      users: [],
      chats: [],
    };
  },

  async "messages.composeMessageWithAI"(payload, options) {
    console.log("messages.composeMessageWithAI", payload);
    return {
      text: "",
      entities: [],
    };
  },

  async "aicompose.getTones"(payload, options) {
    console.log("aicompose.getTones", payload);
    return {
      hash: 0,
      tones: [],
    };
  },

  async "aicompose.createTone"(payload, options) {
    console.log("aicompose.createTone", payload);
    return {
      tone: payload,
    };
  },

  async "aicompose.deleteTone"(payload, options) {
    console.log("aicompose.deleteTone", payload);
    return ok();
  },

  async "aicompose.updateTone"(payload, options) {
    console.log("aicompose.updateTone", payload);
    return {
      tone: payload,
    };
  },

  async "aicompose.getTone"(payload, options) {
    console.log("aicompose.getTone", payload);
    return {
      tone: null,
    };
  },

  async "aicompose.getToneExample"(payload, options) {
    console.log("aicompose.getToneExample", payload);
    return {
      text: "",
      entities: [],
    };
  },

  async "aicompose.saveTone"(payload, options) {
    console.log("aicompose.saveTone", payload);
    return ok();
  },
};
