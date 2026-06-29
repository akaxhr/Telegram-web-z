import { supabase } from "../../../../server/lib/supabase.js";
import {  botSendMessage,
  botEditMessage,
  botDeleteMessage,
  botPinMessage,
  botUnpinMessage,
  botSetChatTitle,
  botSetChatPhoto,
  botLeaveChat,
  botGetChat,
  botGetChatMember, } from "../../../../server/lib/telegram.js";



function mapChat(c) {
  return {
    id: String(c.id),
    title: c.title ?? "Chat",
    type: c.type ?? "chatTypePrivate",
    username: c.username ?? undefined,
    photo: c.photo ?? undefined,
    lastMessageId: c.last_message_id ?? undefined,

    isListed: true,
    isPinned: Boolean(c.is_pinned),
    isMuted: Boolean(c.is_muted),
    isArchived: Boolean(c.folder_id),
    isForum: Boolean(c.is_forum),
    withForumTabs: Boolean(c.with_forum_tabs),

    accessHash: c.access_hash ?? undefined,
  };
}

function mapUser(u) {
  return {
    id: String(u.id),
    type: "user",
    firstName: u.first_name ?? "",
    lastName: u.last_name ?? "",
    username: u.username ?? undefined,
    phoneNumber: u.phone ?? undefined,
    isBot: Boolean(u.is_bot),
    isSelf: u.id === "user-1",
  };
}

function mapMessage(m) {
  return {
    id: Number(m.id),
    chatId: String(m.chat_id),
    senderId: m.sender_id ? String(m.sender_id) : undefined,
    date: m.date,
    content: m.content,
    replyInfo: m.reply_info ?? undefined,
    forwardInfo: m.forward_info ?? undefined,
    reactions: m.reactions ?? undefined,
    groupedId: m.grouped_id ?? undefined,
    sendingState: m.sending_state ?? undefined,
    editDate: m.edit_date ?? undefined,
    isOutgoing: Boolean(m.is_outgoing),
    isPinned: Boolean(m.is_pinned),
  };
}

async function getLastMessages(chatIds) {
  if (!chatIds.length) return [];

  const { data, error } = await supabase
    .from("tg_messages")
    .select("*")
    .in("chat_id", chatIds)
    .eq("is_deleted", false)
    .order("date", { ascending: false });

  if (error) throw error;

  const seen = new Set();
  const last = [];

  for (const row of data ?? []) {
    if (seen.has(row.chat_id)) continue;
    seen.add(row.chat_id);
    last.push(row);
  }

  return last;
}

export const chatRoutes = {
  async "chats.fetchChats"({ limit = 50, archived } = {}) {
    let query = supabase
      .from("tg_chats")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (archived) query = query.not("folder_id", "is", null);
    else query = query.is("folder_id", null);

    const { data: chatRows, error } = await query;
    if (error) throw error;

    const chats = (chatRows ?? []).map(mapChat);
    const chatIds = chats.map((c) => c.id);

    const lastRows = await getLastMessages(chatIds);
    const messages = lastRows.map(mapMessage);

    const lastMessageByChatId = {};
    for (const msg of messages) {
      lastMessageByChatId[msg.chatId] = msg.id;
    }

    return {
      chatIds,
      chats,
      users: [],
      userStatusesById: {},
      draftsById: {},
      orderedPinnedIds: chats.filter((c) => c.isPinned).map((c) => c.id),
      totalChatCount: chats.length,
      lastMessageByChatId,
      messages,
      notifyExceptionById: {},
      threadReadStatesById: {},
      threadInfos: [],
    };
  },

  async "chats.fetchSavedChats"() {
    return {
      chatIds: [],
      chats: [],
      users: [],
      userStatusesById: {},
      draftsById: {},
      orderedPinnedIds: [],
      totalChatCount: 0,
      lastMessageByChatId: {},
      messages: [],
      notifyExceptionById: {},
      threadInfos: [],
    };
  },

  async "chats.fetchPeerSettings"() {
    return {
      settings: {
        canReportSpam: false,
        canAddContact: false,
        canBlockContact: false,
        canShareContact: false,
        canNeedContactsException: false,
        canReportGeo: false,
        autoArchived: false,
      },
    };
  },

  async "chats.searchChats"({ query }) {
    const { data, error } = await supabase
      .from("tg_chats")
      .select("*")
      .ilike("title", `%${query}%`)
      .limit(30);

    if (error) throw error;

    const ids = (data ?? []).map((c) => String(c.id));

    return {
      accountResultIds: ids,
      globalResultIds: [],
    };
  },

  async "chats.fetchChat"({ userId }) {
  const chatId = userId;
  const tgChat = await telegram.getChat({ chat_id: chatId });

  const chat = {
    id: String(tgChat.id),
    title: tgChat.title ?? tgChat.first_name ?? tgChat.username ?? "Chat",
    username: tgChat.username ?? undefined,
    type: tgChat.type === "private" ? "chatTypePrivate" :
          tgChat.type === "group" ? "chatTypeBasicGroup" :
          tgChat.type === "supergroup" ? "chatTypeSuperGroup" :
          "chatTypeChannel",
    isListed: true,
  };

  return { chat, chatId: chat.id };
},

  async "chats.requestChatUpdate"({ chatId }) {
    const { data: chatRow } = await supabase
      .from("tg_chats")
      .select("*")
      .eq("id", chatId)
      .maybeSingle();

    if (!chatRow) return {};

    const { data: messageRow } = await supabase
      .from("tg_messages")
      .select("*")
      .eq("chat_id", chatId)
      .eq("is_deleted", false)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      chat: mapChat(chatRow),
      lastMessage: messageRow ? mapMessage(messageRow) : undefined,
      readState: {
        lastReadInboxMessageId: chatRow.last_read_inbox_message_id ?? 0,
        lastReadOutboxMessageId: chatRow.last_read_outbox_message_id ?? 0,
        unreadCount: chatRow.unread_count ?? 0,
        hasUnreadMark: Boolean(chatRow.has_unread_mark),
      },
    };
  },

  async "chats.saveDraft"({ chatId, draft }) {
    const { error } = await supabase
      .from("tg_chats")
      .update({ draft: draft ?? null, updated_at: new Date().toISOString() })
      .eq("id", chatId);

    if (error) throw error;
    return true;
  },

  async "chats.getFullChatInfo"({ chatId }) {
    const { data, error } = await supabase
      .from("tg_chats")
      .select("*")
      .eq("id", chatId)
      .maybeSingle();

    if (error || !data) return undefined;

    return {
      fullInfo: {
        about: data.about ?? "",
        members: [],
        canViewMembers: true,
        inviteLink: data.invite_link ?? undefined,
        isPreHistoryHidden: Boolean(data.is_pre_history_hidden),
        hasScheduledMessages: false,
      },
      chats: [mapChat(data)],
      userStatusesById: {},
      membersCount: 0,
    };
  },

  async "chats.getFullChannelInfo"({ chatId }) {
    return chatRoutes["chats.getFullChatInfo"]({ chatId });
  },

  async "chats.updateChatNotifySettings"({ chatId, settings }) {
    const { error } = await supabase
      .from("tg_chats")
      .update({ notify_settings: settings ?? {}, updated_at: new Date().toISOString() })
      .eq("id", chatId);

    if (error) throw error;
    return true;
  },

  async "chats.updateTopicMutedState"() {
    return true;
  },

  async "chats.createChannel"({ title, about, users = [], isBroadcast }) {
    const id = `local-${Date.now()}`;
    const type = isBroadcast ? "chatTypeChannel" : "chatTypeSuperGroup";

    const { error } = await supabase.from("tg_chats").insert({
      id,
      title,
      type,
      about: about ?? "",
      raw: { users, isBroadcast },
      updated_at: new Date().toISOString(),
    });

    if (error) throw error;

    return {
      channel: { id, title, type, about, isListed: true },
      missingUsers: [],
    };
  },

  async "chats.joinChannel"({ channelId }) {
    const { error } = await supabase
      .from("tg_chats")
      .update({ is_joined: true, updated_at: new Date().toISOString() })
      .eq("id", channelId);

    if (error) throw error;
    return { type: "ok" };
  },

  async "chats.deleteChatUser"() {
    return true;
  },

  async "chats.deleteChat"({ chatId }) {
    const { error } = await supabase.from("tg_chats").delete().eq("id", chatId);
    if (error) throw error;
    return true;
  },

  async "chats.leaveChannel"({ chatId }) {
  await telegram.leaveChat({ chat_id: chatId });

  const { error } = await supabase
    .from("tg_chats")
    .update({ is_joined: false, updated_at: new Date().toISOString() })
    .eq("id", chatId);

  if (error) throw error;
  return true;
},

  async "chats.fetchFutureCreatorAfterLeave"() {
    return { user: undefined };
  },

  async "chats.verifyTransferOwnership"() {
    return { canTransfer: true };
  },

  async "chats.editChatCreator"() {
    return true;
  },

  async "chats.deleteChannel"({ channelId }) {
    const { error } = await supabase.from("tg_chats").delete().eq("id", channelId);
    if (error) throw error;
    return true;
  },

  async "chats.createGroupChat"({ title, users = [] }) {
    const id = `group-${Date.now()}`;

    const { error } = await supabase.from("tg_chats").insert({
      id,
      title,
      type: "chatTypeBasicGroup",
      raw: { users },
      updated_at: new Date().toISOString(),
    });

    if (error) throw error;

    return {
      chat: { id, title, type: "chatTypeBasicGroup", isListed: true },
      missingUsers: [],
    };
  },

  async "chats.editChatPhoto"() {
    return true;
  },

  async "chats.toggleChatPinned"({ chatId, shouldBePinned }) {
    const { error } = await supabase
      .from("tg_chats")
      .update({ is_pinned: shouldBePinned, updated_at: new Date().toISOString() })
      .eq("id", chatId);

    if (error) throw error;
    return true;
  },

  async "chats.toggleSavedDialogPinned"() {
    return true;
  },

  async "chats.toggleChatArchived"({ chatId, folderId }) {
    const { error } = await supabase
      .from("tg_chats")
      .update({ folder_id: folderId, updated_at: new Date().toISOString() })
      .eq("id", chatId);

    if (error) throw error;
    return true;
  },

  async "chats.fetchChatFolders"() {
    return { byId: {}, orderedIds: [], areTagsEnabled: false };
  },

  async "chats.fetchPinnedDialogs"() {
    const { data, error } = await supabase
      .from("tg_chats")
      .select("*")
      .eq("is_pinned", true)
      .order("updated_at", { ascending: false });

    if (error) throw error;

    const chats = (data ?? []).map(mapChat);

    return {
      dialogIds: chats.map((c) => c.id),
      messages: [],
      chats,
      users: [],
    };
  },

  async "chats.fetchRecommendedChatFolders"() {
    return [];
  },

  async "chats.editChatFolder"() {
    return true;
  },

  async "chats.deleteChatFolder"() {
    return true;
  },

  async "chats.sortChatFolders"() {
    return true;
  },

  async "chats.toggleDialogFilterTags"() {
    return true;
  },

  async "chats.toggleDialogUnread"({ chatId, hasUnreadMark }) {
    const { error } = await supabase
      .from("tg_chats")
      .update({ has_unread_mark: Boolean(hasUnreadMark), updated_at: new Date().toISOString() })
      .eq("id", chatId);

    if (error) throw error;
    return true;
  },

  async "chats.getChatByPhoneNumber"() {
    return undefined;
  },

  async "chats.getChatByUsername"({ username }) {
    const { data } = await supabase
      .from("tg_chats")
      .select("*")
      .eq("username", username)
      .maybeSingle();

    if (!data) return undefined;

    return {
      chat: mapChat(data),
      user: undefined,
    };
  },

  async "chats.togglePreHistoryHidden"({ chatId, isEnabled }) {
    const { error } = await supabase
      .from("tg_chats")
      .update({ is_pre_history_hidden: isEnabled, updated_at: new Date().toISOString() })
      .eq("id", chatId);

    if (error) throw error;
    return true;
  },

  async "chats.updateChatDefaultBannedRights"({ chatId, bannedRights }) {
    const { error } = await supabase
      .from("tg_chats")
      .update({ default_banned_rights: bannedRights, updated_at: new Date().toISOString() })
      .eq("id", chatId);

    if (error) throw error;
    return true;
  },

  async "chats.updateChatMemberBannedRights"({ chatId, userId, bannedRights, untilDate }) {
  await telegram.restrictChatMember({
    chat_id: chatId,
    user_id: userId,
    until_date: untilDate,
    permissions: {
      can_send_messages: !bannedRights?.sendMessages,
      can_send_audios: !bannedRights?.sendMedia,
      can_send_documents: !bannedRights?.sendMedia,
      can_send_photos: !bannedRights?.sendMedia,
      can_send_videos: !bannedRights?.sendMedia,
      can_send_video_notes: !bannedRights?.sendMedia,
      can_send_voice_notes: !bannedRights?.sendMedia,
      can_send_polls: !bannedRights?.sendPolls,
      can_send_other_messages: !bannedRights?.sendStickers,
      can_add_web_page_previews: !bannedRights?.embedLinks,
      can_change_info: !bannedRights?.changeInfo,
      can_invite_users: !bannedRights?.inviteUsers,
      can_pin_messages: !bannedRights?.pinMessages,
    },
  });

  return true;
},

  async "chats.updateChatAdmin"({ chatId, userId, adminRights }) {
  await telegram.promoteChatMember({
    chat_id: chatId,
    user_id: userId,
    can_delete_messages: Boolean(adminRights?.canDeleteMessages),
    can_invite_users: Boolean(adminRights?.canInviteUsers),
    can_restrict_members: Boolean(adminRights?.canBanUsers),
    can_pin_messages: Boolean(adminRights?.canPinMessages),
    can_promote_members: Boolean(adminRights?.canAddAdmins),
    can_manage_chat: true,
  });

  return true;
},

  async "chats.updateChatTitle"({ chatId, title }) {
  await telegram.setChatTitle({ chat_id: chatId, title });

  const { error } = await supabase
    .from("tg_chats")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", chatId);

  if (error) throw error;
  return true;
},

  async "chats.updateChatAbout"({ chatId, about }) {
  await telegram.setChatDescription({ chat_id: chatId, description: about });

  const { error } = await supabase
    .from("tg_chats")
    .update({ about, updated_at: new Date().toISOString() })
    .eq("id", chatId);

  if (error) throw error;
  return true;
},

  async "chats.toggleSignatures"() {
    return true;
  },

  async "chats.fetchMembers"() {
    return { members: [], userStatusesById: {} };
  },

  async "chats.fetchMember"({ chatId, peerId }) {
  if (!peerId) return undefined;

  const member = await telegram.getChatMember({
    chat_id: chatId,
    user_id: peerId,
  });

  return {
    member: {
      userId: String(member.user.id),
      isAdmin: ["administrator", "creator"].includes(member.status),
      isOwner: member.status === "creator",
    },
    userStatusesById: {},
  };
},

  async "chats.fetchGroupsForDiscussion"() {
    return [];
  },

  async "chats.setDiscussionGroup"() {
    return true;
  },

  async "chats.migrateChat"() {
    return undefined;
  },

  async "chats.checkChatInvite"() {
    return undefined;
  },

  async "chats.addChatMembers"() {
    return [];
  },

  async "chats.deleteChatMember"({ chatId, userId }) {
  await telegram.banChatMember({ chat_id: chatId, user_id: userId });
  await telegram.unbanChatMember({ chat_id: chatId, user_id: userId });

  return true;
},

  async "chats.toggleJoinToSend"({ chatId, isEnabled }) {
  await telegram.setChatPermissions({
    chat_id: chatId,
    permissions: {
      can_send_messages: !isEnabled,
    },
  });

  const { error } = await supabase
    .from("tg_chats")
    .update({ join_to_send: isEnabled, updated_at: new Date().toISOString() })
    .eq("id", chatId);

  if (error) throw error;
  return true;
},

  async "chats.toggleJoinRequest"({ chatId, isEnabled, guardBotId, shouldClearGuardBot, shouldApplyToInvites }) {
    const { error } = await supabase
      .from("tg_chats")
      .update({
        join_request: isEnabled,
        guard_bot_id: shouldClearGuardBot ? null : guardBotId,
        apply_to_invites: shouldApplyToInvites ?? false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", chatId);

    if (error) throw error;
    return true;
  },

  async "chats.importChatInvite"() {
    return undefined;
  },

  async "chats.setChatEnabledReactions"({ chatId, enabledReactions, reactionsLimit }) {
    const { error } = await supabase
      .from("tg_chats")
      .update({
        enabled_reactions: enabledReactions ?? null,
        reactions_limit: reactionsLimit ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", chatId);

    if (error) throw error;
    return true;
  },

  async "chats.toggleIsProtected"({ chatId, isProtected }) {
    const { error } = await supabase
      .from("tg_chats")
      .update({ is_protected: isProtected, updated_at: new Date().toISOString() })
      .eq("id", chatId);

    if (error) throw error;
    return true;
  },

  async "chats.toggleParticipantsHidden"({ chatId, isEnabled }) {
    const { error } = await supabase
      .from("tg_chats")
      .update({ participants_hidden: isEnabled, updated_at: new Date().toISOString() })
      .eq("id", chatId);

    if (error) throw error;
    return true;
  },

  async "chats.toggleForum"({ chatId, isEnabled, withForumTabs }) {
    const { error } = await supabase
      .from("tg_chats")
      .update({
        is_forum: isEnabled,
        with_forum_tabs: withForumTabs,
        updated_at: new Date().toISOString(),
      })
      .eq("id", chatId);

    if (error) throw error;
    return true;
  },

  async "chats.checkChatlistInvite"() {
    return undefined;
  },

  async "chats.joinChatlistInvite"() {
    return true;
  },

  async "chats.fetchLeaveChatlistSuggestions"() {
    return [];
  },

  async "chats.leaveChatlist"() {
    return true;
  },

  async "chats.createChalistInvite"() {
    return undefined;
  },

  async "chats.deleteChatlistInvite"() {
    return true;
  },

  async "chats.editChatlistInvite"() {
    return undefined;
  },

  async "chats.fetchChatlistInvites"() {
    return { invites: [] };
  },

  async "chats.togglePeerTranslations"({ chatId, isEnabled }) {
    const { error } = await supabase
      .from("tg_chats")
      .update({ translations_enabled: isEnabled, updated_at: new Date().toISOString() })
      .eq("id", chatId);

    if (error) throw error;
    return true;
  },

  async "chats.setViewForumAsMessages"({ chatId, isEnabled }) {
    const { error } = await supabase
      .from("tg_chats")
      .update({ view_forum_as_messages: isEnabled, updated_at: new Date().toISOString() })
      .eq("id", chatId);

    if (error) throw error;
    return true;
  },

  async "chats.fetchChannelRecommendations"() {
    return { similarChannels: [], count: 0 };
  },

  async "chats.updatePaidMessagesPrice"({ chatId, paidMessagesStars }) {
    const { error } = await supabase
      .from("tg_chats")
      .update({ paid_messages_stars: paidMessagesStars, updated_at: new Date().toISOString() })
      .eq("id", chatId);

    if (error) throw error;
    return true;
  },

  async "chats.fetchSponsoredPeer"() {
    return undefined;
  },

  async "chats.toggleAutoTranslation"({ chatId, isEnabled }) {
    const { error } = await supabase
      .from("tg_chats")
      .update({ auto_translation: isEnabled, updated_at: new Date().toISOString() })
      .eq("id", chatId);

    if (error) throw error;
    return true;
  },

  async "chats.setChannelMainProfileTab"({ chatId, tab }) {
    const { error } = await supabase
      .from("tg_chats")
      .update({ main_profile_tab: tab, updated_at: new Date().toISOString() })
      .eq("id", chatId);

    if (error) throw error;
    return true;
  },
};