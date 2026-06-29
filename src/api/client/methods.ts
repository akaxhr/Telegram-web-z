export const METHODS = {
  // Language
  fetchLangStrings: true,
  fetchLanguage: true,
  fetchLangPack: true,
  oldFetchLangPack: true,

  // Chats
  loadAllChats: true,
  fetchChats: true,
  fetchChat: true,
  fetchFullChat: true,

  // Messages
  fetchMessages: true,
  fetchMessage: true,
  fetchMessagesById: true,
  sendMessage: true,
  editMessage: true,
  deleteMessages: true,
  forwardMessages: true,

  // Drafts
  saveDraft: true,

  // Read state
  markMessageListRead: true,
  markMessagesRead: true,

  // Typing
  sendMessageAction: true,

  // Media
  uploadMedia: true,
  fetchCustomEmoji: true,

  // Webpages
  fetchWebPage: true,
  fetchWebPagePreview: true,

  // Polls
  sendPollVote: true,

  // Stories
  fetchStories: true,

  // Calls
  startCall: true,

  // Misc
  fetchPinnedMessages: true,
  fetchSeenBy: true,
  fetchScheduledHistory: true,
} as const;