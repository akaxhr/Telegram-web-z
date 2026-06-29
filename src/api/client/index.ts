const methodMap: Record<string, string> = {
  // ==========================
  // Messages
  // ==========================
  fetchMessages: "messages.fetchMessages",
  fetchMessage: "messages.fetchMessage",
  fetchRichMessage: "messages.fetchRichMessage",
  fetchMessagesById: "messages.fetchMessagesByIds",

  sendMessage: "messages.sendMessage",
  editMessage: "messages.editMessage",
  deleteMessages: "messages.deleteMessages",
  fetchMessageViews: "messages.getMessagesViews",

  // ==========================
  // Users
  // ==========================
  getFullUser: "users.getFullUser",
  getCommonChats: "users.getCommonChats",
  getRequirementsToContact: "users.getRequirementsToContact",
  getNearestDc: "users.getNearestDc",
  getContacts: "users.getContacts",
  getUsers: "users.getUsers",
  importContacts: "users.importContacts",
  addContact: "users.addContact",
  deleteContact: "users.deleteContact",
  toggleNoPaidMessagesException: "users.toggleNoPaidMessagesException",
  getPaidMessagesRevenue: "users.getPaidMessagesRevenue",
  getUserPhotos: "users.getUserPhotos",
  reportSpam: "users.reportSpam",
  updateEmojiStatus: "users.updateEmojiStatus",
  editCloseFriends: "users.editCloseFriends",
  updateContactNote: "users.updateContactNote",
  toggleNoForwards: "users.toggleNoForwards",

  //chats//

  fetchChats: "chats.fetchChats",
fetchSavedChats: "chats.fetchSavedChats",
fetchPeerSettings: "chats.fetchPeerSettings",
searchChats: "chats.searchChats",
fetchChat: "chats.fetchChat",
requestChatUpdate: "chats.requestChatUpdate",
saveDraft: "chats.saveDraft",

createChannel: "chats.createChannel",
joinChannel: "chats.joinChannel",
deleteChatUser: "chats.deleteChatUser",
deleteChat: "chats.deleteChat",
leaveChannel: "chats.leaveChannel",
createGroupChat: "chats.createGroupChat",
editChatPhoto: "chats.editChatPhoto",

toggleChatPinned: "chats.toggleChatPinned",
toggleSavedDialogPinned: "chats.toggleSavedDialogPinned",
toggleChatArchived: "chats.toggleChatArchived",

fetchChatFolders: "chats.fetchChatFolders",
fetchPinnedDialogs: "chats.fetchPinnedDialogs",
fetchRecommendedChatFolders: "chats.fetchRecommendedChatFolders",
editChatFolder: "chats.editChatFolder",
deleteChatFolder: "chats.deleteChatFolder",
sortChatFolders: "chats.sortChatFolders",
toggleDialogFilterTags: "chats.toggleDialogFilterTags",
toggleDialogUnread: "chats.toggleDialogUnread",

getChatByPhoneNumber: "chats.getChatByPhoneNumber",
getChatByUsername: "chats.getChatByUsername",

updateChatNotifySettings: "chats.updateChatNotifySettings",
updateTopicMutedState: "chats.updateTopicMutedState",
updateChatTitle: "chats.updateChatTitle",
updateChatAbout: "chats.updateChatAbout",
toggleSignatures: "chats.toggleSignatures",

fetchMembers: "chats.fetchMembers",
fetchMember: "chats.fetchMember",
addChatMembers: "chats.addChatMembers",
deleteChatMember: "chats.deleteChatMember",

importChatInvite: "chats.importChatInvite",
checkChatInvite: "chats.checkChatInvite",

setChatEnabledReactions: "chats.setChatEnabledReactions",
toggleIsProtected: "chats.toggleIsProtected",
toggleParticipantsHidden: "chats.toggleParticipantsHidden",
toggleForum: "chats.toggleForum",

togglePreHistoryHidden: "chats.togglePreHistoryHidden",
updateChatDefaultBannedRights: "chats.updateChatDefaultBannedRights",
updateChatMemberBannedRights: "chats.updateChatMemberBannedRights",
updateChatAdmin: "chats.updateChatAdmin",

fetchGroupsForDiscussion: "chats.fetchGroupsForDiscussion",
setDiscussionGroup: "chats.setDiscussionGroup",
migrateChat: "chats.migrateChat",

joinChatlistInvite: "chats.joinChatlistInvite",
fetchLeaveChatlistSuggestions: "chats.fetchLeaveChatlistSuggestions",
leaveChatlist: "chats.leaveChatlist",
createChalistInvite: "chats.createChalistInvite",
deleteChatlistInvite: "chats.deleteChatlistInvite",
editChatlistInvite: "chats.editChatlistInvite",
fetchChatlistInvites: "chats.fetchChatlistInvites",

toggleJoinToSend: "chats.toggleJoinToSend",
toggleJoinRequest: "chats.toggleJoinRequest",

togglePeerTranslations: "chats.togglePeerTranslations",
setViewForumAsMessages: "chats.setViewForumAsMessages",
fetchChannelRecommendations: "chats.fetchChannelRecommendations",
updatePaidMessagesPrice: "chats.updatePaidMessagesPrice",
fetchSponsoredPeer: "chats.fetchSponsoredPeer",
toggleAutoTranslation: "chats.toggleAutoTranslation",
setChannelMainProfileTab: "chats.setChannelMainProfileTab",
getFullChatInfo: "chats.getFullChatInfo",
getFullChannelInfo: "chats.getFullChannelInfo",
fetchFutureCreatorAfterLeave: "chats.fetchFutureCreatorAfterLeave",
verifyTransferOwnership: "chats.verifyTransferOwnership",
editChatCreator: "chats.editChatCreator",
deleteChannel: "chats.deleteChannel",
};

export async function callApiClient(method: string, payload?: any) {
  const backendMethod = methodMap[method] ?? method;

  console.warn('[CLIENT API]', method, payload);
  console.warn('[BACKEND METHOD]', backendMethod);

  try {
    const response = await fetch('/api/client/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: backendMethod,
        payload: Array.isArray(payload) ? payload[0] : payload,
      }),
    });

    const result = await response.json();
    console.warn('[CLIENT API RESULT]', backendMethod, result);

    if (!response.ok) return undefined;

    return result;
  } catch (err) {
    console.warn('[CLIENT API FAILED]', backendMethod, err);
    return undefined;
  }
}