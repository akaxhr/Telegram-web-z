import { Api as GramJs } from '../../../lib/gramjs';
import { PasswordFreshError, RPCError, SessionFreshError } from '../../../lib/gramjs/errors';
import { request } from '../transport/request';
import type { ChatListType, ThreadReadState } from '../../../types';
import {
  type ApiChat,
  type ApiChatAdminRights,
  type ApiChatBannedRights,
  type ApiChatFolder,
  type ApiChatFullInfo,
  type ApiChatInviteJoinWebView,
  type ApiChatReactions,
  type ApiDraft,
  type ApiGroupCall,
  type ApiMessage,
  type ApiMissingInvitedUser,
  type ApiPeer,
  type ApiPeerNotifySettings,
  type ApiPhoto,
  type ApiProfileTab,
  type ApiThreadInfo,
  type ApiUser,
  type ApiUserStatus,
  MAIN_THREAD_ID,
} from '../../types';

import {
  ALL_FOLDER_ID,
  ARCHIVED_FOLDER_ID,
  DEBUG,
  MEMBERS_LOAD_SLICE,
  SERVICE_NOTIFICATIONS_USER_ID,
} from '../../../config';
import { buildCollectionByKey, omitUndefined } from '../../../util/iteratees';
import { GLOBAL_SEARCH_CONTACTS_LIMIT } from '../../../limits';
import {
  buildApiChatBotCommands,
  buildApiChatFolder,
  buildApiChatFolderFromSuggested,
  buildApiChatFromDialog,
  buildApiChatFromPreview,
  buildApiChatFromSavedDialog,
  buildApiChatInviteInfo,
  buildApiChatlistExportedInvite,
  buildApiChatlistInvite,
  buildApiChatReactions,
  buildApiMissingInvitedUser,
  buildApiSponsoredPeer,
  buildApiThreadInfoFromDialog,
  buildChatMember,
  buildChatMembers,
  buildThreadReadState,
  getPeerKey,
} from '../apiBuilders/chats';
import { buildApiPhoto } from '../apiBuilders/common';
import { buildApiMessage, buildMessageDraft } from '../apiBuilders/messages';
import {
  buildApiBotVerification,
  buildApiPeerId,
  buildApiPeerNotifySettings,
  buildApiProfileTab,
  getApiChatIdFromMtpPeer,
} from '../apiBuilders/peers';
import { buildStickerSet } from '../apiBuilders/symbols';
import { buildApiPeerSettings, buildApiUser, buildApiUserStatuses } from '../apiBuilders/users';
import {
  buildChatAdminRights,
  buildChatBannedRights,
  buildFilterFromApiFolder,
  buildInputChannel,
  buildInputChat,
  buildInputChatReactions,
  buildInputPeer,
  buildInputPhoto,
  buildInputProfileTab,
  buildInputReplyTo,
  buildInputSuggestedPost,
  buildInputUser,
  buildMtpMessageEntity,
  DEFAULT_PRIMITIVES,
  getEntityTypeById,
} from '../gramjsBuilders';
import {
  addPhotoToLocalDb,
} from '../helpers/localDb';
import {
  buildApiError, checkErrorType, isChatFolder, wrapError,
} from '../helpers/misc';
import { scheduleMutedChatUpdate } from '../scheduleUnmute';
import { sendApiUpdate } from '../updates/apiUpdateEmitter';
import {
  applyState, updateChannelState,
} from '../updates/updateManager';
import { handleGramJsUpdate, invokeRequest, uploadFile } from './client';
import { getPassword } from './twoFaSettings';

type FullChatData = {
  fullInfo: ApiChatFullInfo;
  chats: ApiChat[];
  userStatusesById: Record<string, ApiUserStatus>;
  groupCall?: Partial<ApiGroupCall>;
  membersCount?: number;
  isForumAsMessages?: true;
};

type ChatListData = {
  chatIds: string[];
  chats: ApiChat[];
  users: ApiUser[];
  userStatusesById: Record<string, ApiUserStatus>;
  draftsById: Record<string, ApiDraft>;
  threadReadStatesById?: Record<string, ThreadReadState>;
  threadInfos: ApiThreadInfo[];
  orderedPinnedIds: string[] | undefined;
  totalChatCount: number;
  messages: ApiMessage[];
  notifyExceptionById: Record<string, ApiPeerNotifySettings>;
  lastMessageByChatId: Record<string, number>;
  nextOffsetId?: number;
  nextOffsetPeerId?: string;
  nextOffsetDate?: number;
};

export async function fetchChats({
  limit,
  offsetDate,
  offsetPeer,
  offsetId,
  archived,
  withPinned,
  lastLocalServiceMessageId,
}: {
  limit: number;
  offsetDate?: number;
  offsetPeer?: ApiPeer;
  offsetId?: number;
  archived?: boolean;
  withPinned?: boolean;
  lastLocalServiceMessageId?: number;
}): Promise<ChatListData | undefined> {
  const peer = (offsetPeer && buildInputPeer(offsetPeer.id, offsetPeer.accessHash)) || new GramJs.InputPeerEmpty();
 const result = await request("chats.fetchChats", {
  limit,
  offsetDate,
  offsetPeer,
  offsetId,
  archived,
  withPinned,
});

const resultPinned = undefined;

if (!result) {
  return undefined;
}

  const messages = (resultPinned ? resultPinned.messages : [])
    .concat(result.messages)
    .map(buildApiMessage)
    .filter(Boolean);

  const peersByKey = preparePeers(result);
  if (resultPinned) {
    Object.assign(peersByKey, preparePeers(resultPinned, peersByKey));
  }

  const chats: ApiChat[] = [];
  const draftsById: Record<string, ApiDraft> = {};
  const notifyExceptionById: Record<string, ApiPeerNotifySettings> = {};
  const threadReadStatesById: Record<string, ThreadReadState> = {};
  const threadInfos: ApiThreadInfo[] = [];

  const dialogs = (resultPinned?.dialogs || []).concat(result.dialogs);

const orderedPinnedIds: string[] = [];
const lastMessageByChatId: Record<string, number> = {};

dialogs.forEach((dialog) => {
  if (
    !(dialog instanceof GramJs.Dialog)
    || (!archived && dialog.folderId === ARCHIVED_FOLDER_ID)
    || (archived && dialog.folderId !== ARCHIVED_FOLDER_ID)
  ) {
    return;
  }
  
    const peerEntity = peersByKey[getPeerKey(dialog.peer)];
    const chat = buildApiChatFromDialog(dialog, peerEntity);
    lastMessageByChatId[chat.id] = dialog.topMessage;

    const isChannel = getEntityTypeById(chat.id) === 'channel';
    if (dialog.pts && isChannel) {
      updateChannelState(chat.id, dialog.pts);
    }

    if (
      chat.id === SERVICE_NOTIFICATIONS_USER_ID
      && lastLocalServiceMessageId
      && (lastLocalServiceMessageId > dialog.topMessage)
    ) {
      lastMessageByChatId[chat.id] = lastLocalServiceMessageId;
    }

    chat.isListed = true;

    chats.push(chat);

    const notifySettings = buildApiPeerNotifySettings(dialog.notifySettings);
    if (Object.values(omitUndefined(notifySettings)).length) {
      notifyExceptionById[chat.id] = notifySettings;

      if (notifySettings.mutedUntil) {
        scheduleMutedChatUpdate(chat.id, notifySettings.mutedUntil, sendApiUpdate);
      }
    }

    if (withPinned && dialog.pinned) {
      orderedPinnedIds.push(chat.id);
    }

    if (dialog.draft) {
      const draft = buildMessageDraft(dialog.draft);
      if (draft) {
        draftsById[chat.id] = draft;
      }
    }

    const readState = buildThreadReadState(dialog);
    threadReadStatesById[chat.id] = readState;

    const threadInfo = buildApiThreadInfoFromDialog(chat.id, dialog);
    threadInfos.push(threadInfo);
  });
const chatIds = chats.map((chat) => chat.id);

const users = result.users ?? [];
const userStatusesById = result.userStatusesById ?? {};
const totalChatCount = result.totalChatCount ?? chatIds.length;

const nextOffsetId = result.nextOffsetId;
const nextOffsetPeerId = result.nextOffsetPeerId;
const nextOffsetDate = result.nextOffsetDate;

return {
  chatIds,
  chats,
  users,
  userStatusesById,
  draftsById,
  orderedPinnedIds: withPinned ? orderedPinnedIds : undefined,
  totalChatCount,
  lastMessageByChatId,
  messages,
  notifyExceptionById,
  nextOffsetId,
  nextOffsetPeerId,
  nextOffsetDate,
  threadReadStatesById,
  threadInfos,
};
}

export async function fetchSavedChats({
  parentPeer,
  limit,
  offsetDate,
  offsetPeer,
  offsetId,
  withPinned,
}: {
  parentPeer: ApiPeer;
  limit: number;
  offsetDate?: number;
  offsetPeer?: ApiPeer;
  offsetId?: number;
  withPinned?: boolean;
}): Promise<ChatListData | undefined> {

  const result = await request("chats.fetchSavedChats", {
  parentPeer,
  offsetPeer,
  offsetId,
  offsetDate,
  limit,
  withPinned,
});

const resultPinned = undefined;

if (!result) {
  return undefined;
}

  const chatIds = result.chatIds ?? result.chats?.map((chat: ApiChat) => chat.id) ?? [];
const chats = result.chats ?? [];
const users = result.users ?? [];
const userStatusesById = result.userStatusesById ?? {};
const orderedPinnedIds = result.orderedPinnedIds ?? [];
const totalChatCount = result.totalChatCount ?? chatIds.length;
const lastMessageByChatId = result.lastMessageByChatId ?? {};
const messages = result.messages ?? [];
const threadInfos = result.threadInfos ?? [];

return {
  chatIds,
  chats,
  users,
  userStatusesById,
  orderedPinnedIds: withPinned ? orderedPinnedIds : undefined,
  totalChatCount,
  lastMessageByChatId,
  messages,
  draftsById: result.draftsById ?? {},
  notifyExceptionById: result.notifyExceptionById ?? {},
  nextOffsetId: result.nextOffsetId,
  nextOffsetPeerId: result.nextOffsetPeerId,
  nextOffsetDate: result.nextOffsetDate,
  threadInfos,
};
}

const fullChatRequestDedupe = new Map<string, Promise<FullChatData | undefined>>();
export async function fetchFullChat(chat: ApiChat) {
  const { id } = chat;

  if (fullChatRequestDedupe.has(id)) {
    return fullChatRequestDedupe.get(id);
  }

  const type = getEntityTypeById(chat.id);

  const promise = type === 'channel'
    ? getFullChannelInfo(chat)
    : getFullChatInfo(id);

  fullChatRequestDedupe.set(id, promise);

  promise.finally(() => {
    fullChatRequestDedupe.delete(id);
  });

  return promise;
}

export async function fetchPeerSettings(peer: ApiPeer) {
  const { id, accessHash } = peer;
const result = await request("chats.fetchPeerSettings", {
  peer,
  chatId: id,
});

if (!result) {
  return undefined;
}

  return {
    settings: buildApiPeerSettings(result.settings),
  };
}

export async function searchChats({ query }: { query: string }) {
  const result = await request("chats.searchChats", {
    query,
  });

  if (!result) {
    return undefined;
  }

  return {
    accountResultIds: result.accountResultIds ?? [],
    globalResultIds: result.globalResultIds ?? [],
  };
}

export async function fetchChat({
  type,
  user,
}: {
  type: "user" | "self" | "support";
  user?: ApiUser;
}) {
  const result = await request("chats.fetchChat", {
    type,
    userId: user?.id,
  });

  if (!result) {
    return undefined;
  }

  if (result.chat) {
    sendApiUpdate({
      "@type": "updateChat",
      id: result.chat.id,
      chat: result.chat,
    });
  }

  return {
    chatId: result.chatId,
  };
}

export async function requestChatUpdate({
  chat,
  lastLocalMessage,
  noLastMessage,
}: {
  chat: ApiChat;
  lastLocalMessage?: ApiMessage;
  noLastMessage?: boolean;
}) {
  const result = await request("chats.requestChatUpdate", {
    chatId: chat.id,
    lastLocalMessage,
    noLastMessage,
  });

  if (!result) return;

  if (result.readState) {
    sendApiUpdate({
      "@type": "updateThreadReadState",
      chatId: chat.id,
      threadId: MAIN_THREAD_ID,
      readState: result.readState,
    });
  }

  if (result.threadInfo) {
    sendApiUpdate({
      "@type": "updateThreadInfo",
      threadInfo: result.threadInfo,
    });
  }

  if (result.chat) {
    sendApiUpdate({
      "@type": "updateChat",
      id: chat.id,
      chat: result.chat,
    });
  }

  if (!noLastMessage && result.lastMessage) {
    sendApiUpdate({
      "@type": "updateChatLastMessage",
      id: chat.id,
      lastMessage: result.lastMessage,
    });
  }
}

export function saveDraft({
  chat,
  draft,
}: {
  chat: ApiChat;
  draft?: ApiDraft;
}) {
  return request("chats.saveDraft", {
    chatId: chat.id,
    draft,
  });
}

async function getFullChatInfo(chatId: string): Promise<FullChatData | undefined> {
  const result = await request("chats.getFullChatInfo", {
    chatId,
  });

  if (!result) {
    return undefined;
  }

  return {
    fullInfo: result.fullInfo ?? {
      about: "",
      members: [],
      canViewMembers: true,
      isPreHistoryHidden: true,
    },
    chats: result.chats ?? [],
    userStatusesById: result.userStatusesById ?? {},
    groupCall: result.groupCall,
    membersCount: result.membersCount ?? 0,
  };
}

async function getFullChannelInfo(
  chat: ApiChat,
): Promise<FullChatData | undefined> {
  const result = await request("chats.getFullChannelInfo", {
    chatId: chat.id,
  });

  if (!result) {
    return undefined;
  }

  return {
    fullInfo: result.fullInfo ?? {
      about: "",
      canViewMembers: true,
      isPreHistoryHidden: true,
      hasScheduledMessages: false,
    },
    chats: result.chats ?? [],
    userStatusesById: result.userStatusesById ?? {},
    groupCall: result.groupCall,
    membersCount: result.membersCount ?? 0,
    ...(result.isForumAsMessages && { isForumAsMessages: true }),
  };
}

export function updateChatNotifySettings({
  chat,
  settings,
}: {
  chat: ApiChat;
  settings: Partial<ApiPeerNotifySettings>;
}) {
  request("chats.updateChatNotifySettings", {
    chatId: chat.id,
    settings,
  });

  sendApiUpdate({
    "@type": "updateChatNotifySettings",
    chatId: chat.id,
    settings,
  });

  void requestChatUpdate({
    chat,
    noLastMessage: true,
  });
}
export function updateTopicMutedState({
  chat,
  topicId,
  mutedUntil,
}: {
  chat: ApiChat;
  topicId: number;
  mutedUntil: number;
}) {
  request("chats.updateTopicMutedState", {
    chatId: chat.id,
    topicId,
    mutedUntil,
  });

  sendApiUpdate({
    "@type": "updateTopicNotifySettings",
    chatId: chat.id,
    topicId,
    settings: {
      mutedUntil,
    },
  });
}

export async function createChannel({
  title,
  about = DEFAULT_PRIMITIVES.STRING,
  users,
  isBroadcast,
  isMegagroup,
}: {
  title: string;
  about?: string;
  users?: ApiUser[];
  isBroadcast?: true;
  isMegagroup?: true;
}) {
  const result = await request("chats.createChannel", {
    title,
    about,
    users,
    isBroadcast,
    isMegagroup,
  });

  if (!result) {
    return undefined;
  }

  return {
    channel: result.channel,
    missingUsers: result.missingUsers,
  };
}
export async function joinChannel({
  channelId,
  accessHash,
}: {
  channelId: string;
  accessHash: string;
}): Promise<ApiChatInviteJoinWebView | { type: "ok" } | undefined> {
  const result = await request("chats.joinChannel", {
    channelId,
    accessHash,
  });

  if (!result) {
    return undefined;
  }

  return result;
}

export function deleteChatUser({
  chat,
  user,
  shouldRevokeHistory,
}: {
  chat: ApiChat;
  user: ApiUser;
  shouldRevokeHistory?: boolean;
}) {
  if (chat.type !== "chatTypeBasicGroup") return undefined;

  return request("chats.deleteChatUser", {
    chatId: chat.id,
    userId: user.id,
    shouldRevokeHistory,
  }, {
    shouldReturnTrue: true,
  });
}

export function deleteChat({
  chatId,
}: {
  chatId: string;
}) {
  return request(
    "chats.deleteChat",
    {
      chatId,
    },
    {
      shouldReturnTrue: true,
    },
  );
}

export function leaveChannel({ chat }: { chat: ApiChat }) {
  return request(
    "chats.leaveChannel",
    {
      chatId: chat.id,
    },
    {
      shouldReturnTrue: true,
    },
  );
}
export async function fetchFutureCreatorAfterLeave({ chat }: { chat: ApiChat }) {
  const result = await request("chats.fetchFutureCreatorAfterLeave", {
    chatId: chat.id,
  });

  return result?.user;
}

export async function verifyTransferOwnership({
  chat,
  user,
}: {
  chat: ApiChat;
  user: ApiUser;
}) {
  const result = await request("chats.verifyTransferOwnership", {
    chatId: chat.id,
    userId: user.id,
  });

  return result ?? { canTransfer: true };
}

export async function editChatCreator({
  chat,
  user,
  password,
}: {
  chat: ApiChat;
  user: ApiUser;
  password: string;
}) {
  return request("chats.editChatCreator", {
    chatId: chat.id,
    userId: user.id,
    password,
  }, {
    shouldReturnTrue: true,
  });
}

export function deleteChannel({
  channelId,
  accessHash,
}: {
  channelId: string;
  accessHash: string;
}) {
  return request("chats.deleteChannel", {
    channelId,
  }, {
    shouldReturnTrue: true,
  });
}

export async function createGroupChat({
  title,
  users,
}: {
  title: string;
  users: ApiUser[];
}) {
  return request("chats.createGroupChat", {
    title,
    users,
  });
}

export async function editChatPhoto({
  chatId,
  accessHash,
  photo,
}: {
  chatId: string;
  accessHash?: string;
  photo?: File | ApiPhoto;
}) {
  return request(
    "chats.editChatPhoto",
    {
      chatId,
      photo,
    },
    {
      shouldReturnTrue: true,
    },
  );
}

export async function toggleChatPinned({
  chat,
  shouldBePinned,
}: {
  chat: ApiChat;
  shouldBePinned: boolean;
}) {
  const isActionSuccessful = await request("chats.toggleChatPinned", {
    chatId: chat.id,
    shouldBePinned,
  });

  if (isActionSuccessful) {
    sendApiUpdate({
      "@type": "updateChatPinned",
      id: chat.id,
      isPinned: shouldBePinned,
    });
  }
}

export async function toggleSavedDialogPinned({
  chat,
  shouldBePinned,
}: {
  chat: ApiChat;
  shouldBePinned: boolean;
}) {
  const isActionSuccessful = await request("chats.toggleSavedDialogPinned", {
    chatId: chat.id,
    shouldBePinned,
  });

  if (isActionSuccessful) {
    sendApiUpdate({
      "@type": "updateSavedDialogPinned",
      id: chat.id,
      isPinned: shouldBePinned,
    });
  }
}

export function toggleChatArchived({
  chat,
  folderId,
}: {
  chat: ApiChat;
  folderId: number;
}) {
  return request(
    "chats.toggleChatArchived",
    {
      chatId: chat.id,
      folderId,
    },
    {
      shouldReturnTrue: true,
    },
  );
}
export async function fetchChatFolders() {
  const result = await request("chats.fetchChatFolders");

  if (!result) return undefined;

  return {
    byId: result.byId ?? {},
    orderedIds: result.orderedIds ?? [],
    areTagsEnabled: result.areTagsEnabled ?? false,
  };
}

export async function fetchPinnedDialogs({
  listType,
}: {
  listType: ChatListType;
}) {
  const result = await request("chats.fetchPinnedDialogs", {
    listType,
  });

  if (!result) return undefined;

  return {
    dialogIds: result.dialogIds ?? [],
    messages: result.messages ?? [],
    chats: result.chats ?? [],
    users: result.users ?? [],
  };
}

export async function fetchRecommendedChatFolders() {
  const result = await request("chats.fetchRecommendedChatFolders");

  return result ?? [];
}

export async function editChatFolder({
  id,
  folderUpdate,
}: {
  id: number;
  folderUpdate: ApiChatFolder;
}) {
  folderUpdate.excludedChatIds = folderUpdate.excludedChatIds.filter((chatId) => {
    return !folderUpdate.includedChatIds.includes(chatId);
  });

  const isActionSuccessful = await request("chats.editChatFolder", {
    id,
    folderUpdate,
  });

  if (isActionSuccessful) {
    sendApiUpdate({
      "@type": "updateChatFolder",
      id,
      folder: folderUpdate,
    });
  }
}

export async function deleteChatFolder(id: number) {
  const isActionSuccessful = await request("chats.deleteChatFolder", { id });

  const recommendedChatFolders = await fetchRecommendedChatFolders();

  if (isActionSuccessful) {
    sendApiUpdate({
      "@type": "updateChatFolder",
      id,
      folder: undefined,
    });
  }

  if (recommendedChatFolders) {
    sendApiUpdate({
      "@type": "updateRecommendedChatFolders",
      folders: recommendedChatFolders,
    });
  }
}

export function sortChatFolders(ids: number[]) {
  return request("chats.sortChatFolders", { ids });
}

export function toggleDialogFilterTags(isEnabled: boolean) {
  return request("chats.toggleDialogFilterTags", { isEnabled });
}

export async function toggleDialogUnread({
  chat,
  hasUnreadMark,
}: {
  chat: ApiChat;
  hasUnreadMark?: true;
}) {
  const isActionSuccessful = await request("chats.toggleDialogUnread", {
    chatId: chat.id,
    hasUnreadMark,
  });

  if (isActionSuccessful) {
    sendApiUpdate({
      "@type": "updateThreadReadState",
      chatId: chat.id,
      threadId: MAIN_THREAD_ID,
      readState: {
        hasUnreadMark,
      },
    });
  }
}

export async function getChatByPhoneNumber(phoneNumber: string) {
  return request("chats.getChatByPhoneNumber", { phoneNumber });
}

export async function getChatByUsername(username: string, referrer?: string) {
  return request("chats.getChatByUsername", { username, referrer });
}

export function togglePreHistoryHidden({
  chat,
  isEnabled,
}: { chat: ApiChat; isEnabled: boolean }) {
  return request("chats.togglePreHistoryHidden", {
    chatId: chat.id,
    isEnabled,
  }, {
    shouldReturnTrue: true,
  });
}

export function updateChatDefaultBannedRights({
  chat,
  bannedRights,
}: { chat: ApiChat; bannedRights: ApiChatBannedRights }) {
  return request("chats.updateChatDefaultBannedRights", {
    chatId: chat.id,
    bannedRights,
  }, {
    shouldReturnTrue: true,
  });
}

export function updateChatMemberBannedRights({
  chat,
  user,
  bannedRights,
  untilDate,
}: { chat: ApiChat; user: ApiUser; bannedRights: ApiChatBannedRights; untilDate?: number }) {
  return request("chats.updateChatMemberBannedRights", {
    chatId: chat.id,
    userId: user.id,
    bannedRights,
    untilDate,
  }, {
    shouldReturnTrue: true,
  });
}

export function updateChatAdmin({
  chat,
  user,
  adminRights,
  rank,
}: { chat: ApiChat; user: ApiUser; adminRights: ApiChatAdminRights; rank?: string }) {
  return request("chats.updateChatAdmin", {
    chatId: chat.id,
    userId: user.id,
    adminRights,
    rank,
  }, {
    shouldReturnTrue: true,
  });
}

export async function updateChatTitle(chat: ApiChat, title: string) {
  return request("chats.updateChatTitle", {
    chatId: chat.id,
    title,
  }, {
    shouldReturnTrue: true,
  });
}

export async function updateChatAbout(chat: ApiChat, about: string) {
  const result = await request("chats.updateChatAbout", {
    chatId: chat.id,
    about,
  });

  if (!result) return;

  sendApiUpdate({
    "@type": "updateChatFullInfo",
    id: chat.id,
    fullInfo: { about },
  });
}

export function toggleSignatures({
  chat,
  areSignaturesEnabled,
  areProfilesEnabled,
}: {
  chat: ApiChat;
  areSignaturesEnabled: boolean;
  areProfilesEnabled: boolean;
}) {
  return request("chats.toggleSignatures", {
    chatId: chat.id,
    areSignaturesEnabled,
    areProfilesEnabled,
  }, {
    shouldReturnTrue: true,
  });
}

type ChannelMembersFilter =
  | "kicked"
  | "admin"
  | "recent"
  | "search";

export async function fetchMembers({
  chat,
  memberFilter = "recent",
  offset,
  query = DEFAULT_PRIMITIVES.STRING,
}: {
  chat: ApiChat;
  memberFilter?: ChannelMembersFilter;
  offset?: number;
  query?: string;
}) {
  const result = await request("chats.fetchMembers", {
    chatId: chat.id,
    memberFilter,
    offset,
    query,
  });

  if (!result) return undefined;

  return {
    members: result.members ?? [],
    userStatusesById: result.userStatusesById ?? {},
  };
}

export async function fetchMember({
  chat,
  peer,
}: {
  chat: ApiChat;
  peer?: ApiPeer;
}) {
  const result = await request("chats.fetchMember", {
    chatId: chat.id,
    peerId: peer?.id,
  });

  if (!result?.member) return undefined;

  return {
    member: result.member,
    userStatusesById: result.userStatusesById ?? {},
  };
}

export async function fetchGroupsForDiscussion() {
  const result = await request("chats.fetchGroupsForDiscussion");

  return result ?? [];
}

export function setDiscussionGroup({
  channel,
  chat,
}: {
  channel: ApiChat;
  chat?: ApiChat;
}) {
  return request(
    "chats.setDiscussionGroup",
    {
      channelId: channel.id,
      chatId: chat?.id,
    },
    {
      shouldReturnTrue: true,
    },
  );
}

export async function migrateChat(chat: ApiChat) {
  const result = await request("chats.migrateChat", {
    chatId: chat.id,
  });

  return result?.chat;
}

export async function checkChatInvite(hash: string) {
  const result = await request("chats.checkChatInvite", {
    hash,
  });

  return result;
}

export async function addChatMembers(chat: ApiChat, users: ApiUser[]) {
  try {
    return await request("chats.addChatMembers", {
      chatId: chat.id,
      users,
    });
  } catch (err: unknown) {
    const apiError = buildApiError(err as Error);

    sendApiUpdate({
      "@type": "error",
      error: apiError,
    });

    return undefined;
  }
}

export function deleteChatMember(chat: ApiChat, user: ApiUser) {
  return request(
    "chats.deleteChatMember",
    {
      chatId: chat.id,
      userId: user.id,
    },
    {
      shouldReturnTrue: true,
    },
  );
}

export function toggleJoinToSend(chat: ApiChat, isEnabled: boolean) {
  return request(
    "chats.toggleJoinToSend",
    {
      chatId: chat.id,
      isEnabled,
    },
    {
      shouldReturnTrue: true,
    },
  );
}

export function toggleJoinRequest({
  chat,
  isEnabled,
  guardBot,
  shouldClearGuardBot,
  shouldApplyToInvites,
}: {
  chat: ApiChat;
  isEnabled: boolean;
  guardBot?: ApiUser;
  shouldClearGuardBot?: boolean;
  shouldApplyToInvites?: boolean;
}) {
  return request(
    "chats.toggleJoinRequest",
    {
      chatId: chat.id,
      isEnabled,
      guardBotId: guardBot?.id,
      shouldClearGuardBot,
      shouldApplyToInvites,
    },
    {
      shouldReturnTrue: true,
    },
  );
}
export async function importChatInvite(
  { hash }: { hash: string },
): Promise<ApiChatInviteJoinWebView | { type: "ok"; chat: ApiChat } | undefined> {
  const result = await request("chats.importChatInvite", {
    hash,
  });

  return result;
}

export function setChatEnabledReactions({
  chat,
  enabledReactions,
  reactionsLimit,
}: {
  chat: ApiChat;
  enabledReactions?: ApiChatReactions;
  reactionsLimit?: number;
}) {
  return request(
    "chats.setChatEnabledReactions",
    {
      chatId: chat.id,
      enabledReactions,
      reactionsLimit,
    },
    {
      shouldReturnTrue: true,
    },
  );
}

export function toggleIsProtected({
  chat,
  isProtected,
}: { chat: ApiChat; isProtected: boolean }) {
  return request("chats.toggleIsProtected", {
    chatId: chat.id,
    isProtected,
  }, {
    shouldReturnTrue: true,
  });
}

export function toggleParticipantsHidden({
  chat,
  isEnabled,
}: { chat: ApiChat; isEnabled: boolean }) {
  return request("chats.toggleParticipantsHidden", {
    chatId: chat.id,
    isEnabled,
  }, {
    shouldReturnTrue: true,
  });
}

export function toggleForum({
  chat,
  isEnabled,
}: { chat: ApiChat; isEnabled: boolean }) {
  return request("chats.toggleForum", {
    chatId: chat.id,
    isEnabled,
    withForumTabs: Boolean(chat.withForumTabs),
  }, {
    shouldReturnTrue: true,
    shouldThrow: true,
  });
}

export async function checkChatlistInvite({
  slug,
}: {
  slug: string;
}) {
  const result = await request("chats.checkChatlistInvite", {
    slug,
  });

  return result;
}

export function joinChatlistInvite({
  slug,
  peers,
}: {
  slug: string;
  peers: ApiChat[];
}) {
  return request("chats.joinChatlistInvite", {
    slug,
    peerIds: peers.map((peer) => peer.id),
  }, {
    shouldReturnTrue: true,
    shouldThrow: true,
  });
}

export async function fetchLeaveChatlistSuggestions({
  folderId,
}: {
  folderId: number;
}) {
  const result = await request("chats.fetchLeaveChatlistSuggestions", {
    folderId,
  });

  return result ?? [];
}

export function leaveChatlist({
  folderId,
  peers,
}: {
  folderId: number;
  peers: ApiChat[];
}) {
  return request("chats.leaveChatlist", {
    folderId,
    peerIds: peers.map((peer) => peer.id),
  }, {
    shouldReturnTrue: true,
  });
}

export async function createChalistInvite({
  folderId,
  title = DEFAULT_PRIMITIVES.STRING,
  peers,
}: {
  folderId: number;
  title?: string;
  peers: ApiPeer[];
}) {
  return request("chats.createChalistInvite", {
    folderId,
    title,
    peerIds: peers.map((peer) => peer.id),
  });
}

export function deleteChatlistInvite({
  folderId,
  slug,
}: {
  folderId: number;
  slug: string;
}) {
  return request("chats.deleteChatlistInvite", {
    folderId,
    slug,
  });
}

export async function editChatlistInvite({
  folderId,
  slug,
  title,
  peers,
}: {
  folderId: number;
  slug: string;
  title?: string;
  peers: ApiPeer[];
}) {
  return request("chats.editChatlistInvite", {
    folderId,
    slug,
    title,
    peerIds: peers.map((p) => p.id),
  });
}

export async function fetchChatlistInvites({
  folderId,
}: {
  folderId: number;
}) {
  return request("chats.fetchChatlistInvites", {
    folderId,
  });
}

export function togglePeerTranslations({
  chat,
  isEnabled,
}: {
  chat: ApiChat;
  isEnabled: boolean;
}) {
  return request("chats.togglePeerTranslations", {
    chatId: chat.id,
    isEnabled,
  });
}

export function setViewForumAsMessages({
  chat,
  isEnabled,
}: {
  chat: ApiChat;
  isEnabled: boolean;
}) {
  return request(
    "chats.setViewForumAsMessages",
    {
      chatId: chat.id,
      isEnabled,
    },
    {
      shouldReturnTrue: true,
    },
  );
}

export async function fetchChannelRecommendations({
  chat,
}: {
  chat?: ApiChat;
}) {
  return request("chats.fetchChannelRecommendations", {
    chatId: chat?.id,
  });
}

export function updatePaidMessagesPrice({
  chat,
  paidMessagesStars,
}: {
  chat?: ApiChat;
  paidMessagesStars: number;
}) {
  return request(
    "chats.updatePaidMessagesPrice",
    {
      chatId: chat?.id,
      paidMessagesStars,
    },
    {
      shouldReturnTrue: true,
    },
  );
}

export async function fetchSponsoredPeer({ query }: { query: string }) {
  return request("chats.fetchSponsoredPeer", {
    query,
  });
}

export function toggleAutoTranslation({
  chat,
  isEnabled,
}: {
  chat: ApiChat;
  isEnabled: boolean;
}) {
  return request(
    "chats.toggleAutoTranslation",
    {
      chatId: chat.id,
      isEnabled,
    },
    {
      shouldReturnTrue: true,
    },
  );
}

export function setChannelMainProfileTab({
  chat,
  tab,
}: {
  chat: ApiChat;
  tab: ApiProfileTab;
}) {
  return request(
    "chats.setChannelMainProfileTab",
    {
      chatId: chat.id,
      tab,
    },
    {
      shouldReturnTrue: true,
    },
  );
}