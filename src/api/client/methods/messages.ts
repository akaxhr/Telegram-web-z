import { Api as GramJs } from '../../../lib/gramjs';
import { RPCError } from '../../../lib/gramjs/errors';
import { generateRandomBigInt } from '../../../lib/gramjs/Helpers';
import { request } from '../transport/request';
import type {
  ForwardMessagesParams,
  SendMessageParams,
  ThreadId,
  TranslationTone,
} from '../../../types';
import type {
  ApiAttachment,
  ApiChat,
  ApiComposedMessageWithAI,
  ApiError,
  ApiFormattedText,
  ApiGlobalMessageSearchType,
  ApiInputAiComposeTone,
  ApiInputReplyInfo,
  ApiInputSuggestedPostInfo,
  ApiMessage,
  ApiMessageEntity,
  ApiMessagePoll,
  ApiMessageSearchContext,
  ApiMessageSearchType,
  ApiNewMediaTodo,
  ApiOnProgress,
  ApiPeer,
  ApiReaction,
  ApiSearchPostsFlood,
  ApiSendMessageAction,
  ApiTodoItem,
  ApiTopicWithState,
  ApiUser,
  ApiUserStatus,
  ApiWebPage,
  MediaContent,
} from '../../types';
import {
  MAIN_THREAD_ID,
  MESSAGE_DELETED,
} from '../../types';

import {
  DEBUG,
  GIF_MIME_TYPE,
  MAX_INT_32,
  MENTION_UNREAD_SLICE,
  MESSAGE_ID_REQUIRED_ERROR,
  POLL_UNREAD_SLICE,
  REACTION_UNREAD_SLICE,
  SUPPORTED_PHOTO_CONTENT_TYPES,
  SUPPORTED_VIDEO_CONTENT_TYPES,
} from '../../../config';
import { fetchFile } from '../../../util/files';
import { compact, split } from '../../../util/iteratees';
import { getMessageKey } from '../../../util/keys/messageKey';
import { getServerTime } from '../../../util/serverTime';
import { interpolateArray } from '../../../util/waveform';
import { API_GENERAL_ID_LIMIT, PINNED_MESSAGES_LIMIT } from '../../../limits';
import {
  buildApiChatFromPreview,
  buildApiSendAsPeerId,
  buildApiSponsoredMessageReportResult,
  buildThreadReadState,
} from '../apiBuilders/chats';
import {
  buildApiAiComposeTone, buildApiAiComposeToneExample, buildApiComposedMessageWithAI, buildApiFormattedText,
} from '../apiBuilders/common';
import { buildApiTopicWithState } from '../apiBuilders/forums';
import {
  buildMessageMediaContent, buildMessagePollFromMedia, buildMessageTextContent,
  buildWebPage,
  buildWebPageFromMedia,
} from '../apiBuilders/messageContent';
import {
  buildApiFactCheck,
  buildApiMessage,
  buildApiQuickReply,
  buildApiReportResult,
  buildApiSearchPostsFlood,
  buildApiSponsoredMessage,
  buildApiThreadInfo,
  buildApiThreadInfoFromMessage,
  buildLocalForwardedMessage,
  buildLocalMessage,
  buildPreparedInlineMessage,
  buildUploadingMedia,
  incrementLocalMessageCounter,
} from '../apiBuilders/messages';
import { getApiChatIdFromMtpPeer } from '../apiBuilders/peers';
import { buildApiUser, buildApiUserStatuses } from '../apiBuilders/users';
import {
  buildInputAiComposeTone,
  buildInputChannel,
  buildInputDocument,
  buildInputMediaDocument,
  buildInputPeer,
  buildInputPhoto,
  buildInputPoll,
  buildInputPollFromExisting,
  buildInputReaction,
  buildInputReplyTo,
  buildInputStory,
  buildInputSuggestedPost,
  buildInputTextWithEntities,
  buildInputTodo,
  buildInputUser,
  buildMessageFromUpdate,
  buildMtpMessageEntity,
  buildPeer,
  buildSendMessageAction,
  DEFAULT_PRIMITIVES,
  getEntityTypeById,
} from '../gramjsBuilders';
import {
  buildApiError,
  deserializeBytes,
  resolveMessageApiChatId,
} from '../helpers/misc';
import localDb from '../localDb';
import { sendApiUpdate } from '../updates/apiUpdateEmitter';
import { processMessageAndUpdateThreadInfo } from '../updates/entityProcessor';
import { processAffectedHistory, updateChannelState } from '../updates/updateManager';
import { requestChatUpdate } from './chats';
import { handleGramJsUpdate, invokeRequest, uploadFile } from './client';

const FAST_SEND_TIMEOUT = 1000;
const INPUT_WAVEFORM_LENGTH = 63;

type TranslateTextParams = ({
  text: ApiFormattedText[];
} | {
  chat: ApiChat;
  messageIds: number[];
}) & {
  toLanguageCode: string;
  tone?: TranslationTone;
};

type SearchResults = {
  messages: ApiMessage[];
  topics: ApiTopicWithState[];
  userStatusesById: Record<number, ApiUserStatus>;
  totalCount: number;
  nextOffsetRate?: number;
  nextOffsetPeerId?: string;
  nextOffsetId?: number;
  searchFlood?: ApiSearchPostsFlood;
};

export async function fetchMessages({
  chat,
  threadId,
  offsetId,
  isSavedDialog,
  addOffset,
  limit,
}: {
  chat: ApiChat;
  threadId?: ThreadId;
  offsetId?: number;
  isSavedDialog?: boolean;
  addOffset?: number;
  limit: number;
}) {
  try {
    const result = await request('messages.fetchMessages', {
      chatId: chat.id,
      chat,
      threadId,
      offsetId,
      isSavedDialog,
      addOffset,
      limit,
    }, {
      shouldThrow: true,
      abortControllerChatId: chat.id,
      abortControllerThreadId: threadId,
    } as any);

    if (!result) {
      return undefined;
    }

    return {
      messages: result.messages ?? [],
      users: result.users ?? [],
      chats: result.chats ?? [],
      count: result.count ?? result.messages?.length ?? 0,
      topics: result.topics ?? [],
    };
  } catch (err: any) {
    console.error('[fetchMessages failed]', err);

    return undefined;
  }
}

export async function fetchMessage({
  chat,
  messageId,
}: {
  chat: ApiChat;
  messageId: number;
}) {
  try {
    const result = await request(
      "messages.fetchMessage",
      {
        chatId: chat.id,
        chat,
        messageId,
      },
      {
        shouldThrow: true,
        abortControllerChatId: chat.id,
      } as any,
    );

    if (!result) {
      return undefined;
    }

    if (!result.message) {
      return MESSAGE_DELETED;
    }

    return {
      message: result.message,
    };
  } catch (err: any) {
    const { message, code } = buildApiError(err);

    if (message !== "CHANNEL_PRIVATE") {
      sendApiUpdate({
        "@type": "error",
        error: {
          message,
          code,
          isSlowMode: false,
          hasErrorKey: true,
        },
      });
    }

    return undefined;
  }
}

export async function fetchRichMessage({
  chat,
  messageId,
}: {
  chat: ApiChat;
  messageId: number;
}) {
  try {
    const result = await request(
      "messages.fetchRichMessage",
      {
        chatId: chat.id,
        chat,
        messageId,
      },
      {
        abortControllerChatId: chat.id,
      } as any,
    );

    if (!result?.message) {
      return undefined;
    }

    return {
      message: result.message,
    };
  } catch (err) {
    console.error("[fetchRichMessage failed]", err);
    return undefined;
  }
}

export async function fetchMessagesById({
  chat,
  messageIds,
}: {
  chat: ApiChat;
  messageIds: number[];
}) {
  const result = await request(
    "messages.fetchMessagesByIds",
    {
      chatId: chat.id,
      chat,
      messageIds,
    },
    {
      shouldThrow: true,
    } as any,
  );

  if (!result) {
    return undefined;
  }

  return result.messages ?? [];
}

export function sendMessageLocal(
  params: SendMessageParams,
) {
  const {
    chat, lastMessageId, text, entities, replyInfo, suggestedPostInfo, attachment, sticker, story, gif, poll, todo,
    contact, scheduledAt, scheduleRepeatPeriod, groupedId, sendAs, wasDrafted, isInvertedMedia, effectId, isPending,
    messagePriceInStars, dice,
  } = params;

  if (!chat) return undefined;

  const {
    message: localMessage,
    poll: localPoll,
  } = buildLocalMessage({
    chat,
    lastMessageId,
    text,
    entities,
    replyInfo,
    suggestedPostInfo,
    attachment,
    sticker,
    gif,
    poll,
    todo,
    contact,
    groupedId,
    scheduledAt,
    scheduleRepeatPeriod,
    sendAs,
    story,
    isInvertedMedia,
    effectId,
    isPending,
    messagePriceInStars,
    dice,
  });

  sendApiUpdate({
    '@type': localMessage.isScheduled ? 'newScheduledMessage' : 'newMessage',
    id: localMessage.id,
    chatId: chat.id,
    message: localMessage,
    poll: localPoll,
    wasDrafted,
  });

  return Promise.resolve(localMessage);
}

export function sendApiMessage(
  params: SendMessageParams,
  localMessage: ApiMessage,
  onProgress?: ApiOnProgress,
) {
  const {
    chat, text, entities, replyInfo, suggestedPostInfo, suggestedMedia,
    attachment, sticker, story, gif, poll, todo, contact, dice,
    isSilent, scheduledAt, scheduleRepeatPeriod, groupedId, noWebPage, sendAs, shouldUpdateStickerSetOrder,
    isInvertedMedia, effectId, webPageMediaSize, webPageUrl, messagePriceInStars,
  } = params;

  if (!chat) return undefined;

  let isSendCompleted = false;

  const timeout = setTimeout(() => {
    if (isSendCompleted) return;

    sendApiUpdate({
      '@type': localMessage.isScheduled ? 'updateScheduledMessage' : 'updateMessage',
      id: localMessage.id,
      chatId: chat.id,
      message: {
        sendingState: 'messageSendingStatePending',
      },
      isFull: false,
    });
  }, FAST_SEND_TIMEOUT);

  const cancelSendingStatusTimeout = () => {
    isSendCompleted = true;
    clearTimeout(timeout);
  };

  const randomId = generateRandomBigInt();

  if (groupedId) {
    return sendGroupedMedia({
      chat,
      text,
      entities,
      replyInfo,
      suggestedPostInfo,
      attachment: attachment!,
      groupedId,
      isSilent,
      scheduledAt,
      scheduleRepeatPeriod,
      sendAs,
      messagePriceInStars,
    }, randomId, localMessage, onProgress, cancelSendingStatusTimeout) as ReturnType<typeof sendApiMessage>;
  }

  const messagePromise = (async () => {
    let media: GramJs.TypeInputMedia | undefined;

    if (suggestedPostInfo && suggestedMedia && !attachment) {
      if (suggestedMedia.photo) {
        const inputPhoto = buildInputPhoto(suggestedMedia.photo);
        if (inputPhoto) {
          media = new GramJs.InputMediaPhoto({
            id: inputPhoto,
            spoiler: suggestedMedia.photo.isSpoiler || undefined,
          });
        }
      } else if (suggestedMedia.video) {
        const inputDocument = buildInputDocument(suggestedMedia.video);
        if (inputDocument) {
          media = new GramJs.InputMediaDocument({
            id: inputDocument,
            spoiler: suggestedMedia.video.isSpoiler || undefined,
          });
        }
      } else if (suggestedMedia.document) {
        const document = suggestedMedia.document;
        if (document.id) {
          const localDocument = localDb.documents[document.id];
          if (localDocument) {
            const inputDocument = new GramJs.InputDocument({
              id: localDocument.id,
              accessHash: localDocument.accessHash,
              fileReference: localDocument.fileReference,
            });

            media = new GramJs.InputMediaDocument({
              id: inputDocument,
            });
          }
        }
      }
    }

    if (!media && attachment?.gif) {
      media = buildInputMediaDocument(attachment.gif, attachment.shouldSendAsSpoiler);
    }

    if (!media && attachment) {
      try {
        media = await uploadMedia(localMessage, attachment, onProgress!);
      } catch (err) {
        if (DEBUG) {
          // eslint-disable-next-line no-console
          console.warn(err);
        }

        await mediaQueue;
        return;
      }
    } else if (sticker) {
      media = buildInputMediaDocument(sticker);
    } else if (gif) {
      media = buildInputMediaDocument(gif);
    } else if (poll) {
      try {
        const attachedMedia = poll.attachedMedia
          ? await uploadMedia(localMessage, poll.attachedMedia, onProgress!)
          : undefined;

        const solutionMedia = poll.solutionMedia
          ? await uploadMedia(localMessage, poll.solutionMedia, onProgress!)
          : undefined;

        media = buildInputPoll(poll, randomId, {
          attachedMedia,
          solutionMedia,
        });
      } catch (err) {
        if (DEBUG) {
          // eslint-disable-next-line no-console
          console.warn(err);
        }

        await mediaQueue;
        return;
      }
    } else if (todo) {
      media = buildInputTodo(todo);
    } else if (story) {
      media = buildInputStory(story);
    } else if (webPageUrl && webPageMediaSize) {
      media = new GramJs.InputMediaWebPage({
        url: webPageUrl,
        forceLargeMedia: webPageMediaSize === 'large' ? true : undefined,
        forceSmallMedia: webPageMediaSize === 'small' ? true : undefined,
      });
    } else if (contact) {
      media = new GramJs.InputMediaContact({
        phoneNumber: contact.phoneNumber,
        firstName: contact.firstName,
        lastName: contact.lastName,
        vcard: DEFAULT_PRIMITIVES.STRING,
      });
    } else if (dice) {
      media = new GramJs.InputMediaDice({
        emoticon: dice,
      });
    }

    type SharedKeys<T, U> = {
      [K in keyof T & keyof U]:
      T[K] extends U[K] ? (U[K] extends T[K] ? K : never) : never
    }[keyof T & keyof U];

    type SharedRecord<T, U> = Pick<T, SharedKeys<T, U>>;

    type SendMediaArgs = ConstructorParameters<typeof GramJs.messages.SendMedia>[0];
    type SendMessageArgs = ConstructorParameters<typeof GramJs.messages.SendMessage>[0];

    type SharedArgs = SharedRecord<SendMediaArgs, SendMessageArgs>;

    const args: SharedArgs = {
      clearDraft: true,
      message: text || DEFAULT_PRIMITIVES.STRING,
      entities: entities ? entities.map(buildMtpMessageEntity) : undefined,
      peer: buildInputPeer(chat.id, chat.accessHash),
      randomId,
      replyTo: replyInfo && buildInputReplyTo(replyInfo),
      silent: isSilent || undefined,
      scheduleDate: scheduledAt,
      scheduleRepeatPeriod,
      sendAs: sendAs && buildInputPeer(sendAs.id, sendAs.accessHash),
      updateStickersetsOrder: shouldUpdateStickerSetOrder || undefined,
      invertMedia: isInvertedMedia || undefined,
      effect: effectId ? BigInt(effectId) : undefined,
      allowPaidStars: messagePriceInStars ? BigInt(messagePriceInStars) : undefined,
      suggestedPost: suggestedPostInfo && buildInputSuggestedPost(suggestedPostInfo),
    };

    try {
      let update;

      if (media) {
        update = await request(
          'messages.sendMedia',
          {
            chatId: chat.id,
            localMessage,
            text,
            entities,
            replyInfo,
            isSilent,
            scheduledAt,
            noWebPage,
            media,
            args,
          },
          {
            shouldThrow: true,
            shouldIgnoreUpdates: true,
          } as any,
        );
      } else {
        update = await request(
          'messages.sendMessage',
          {
            chatId: chat.id,
            localMessage,
            text,
            entities,
            replyInfo,
            isSilent,
            scheduledAt,
            noWebPage,
          },
          {
            shouldThrow: true,
            shouldIgnoreUpdates: true,
          } as any,
        );
      }

      cancelSendingStatusTimeout();

      if (update?.message) {
        sendApiUpdate({
          '@type': localMessage.isScheduled ? 'updateScheduledMessage' : 'updateMessage',
          id: localMessage.id,
          chatId: chat.id,
          message: update.message,
          isFull: true,
        });
      } else if (update) {
        handleLocalMessageUpdate(localMessage, update);
      }
    } catch (error: any) {
      cancelSendingStatusTimeout();

      sendApiUpdate({
        '@type': localMessage.isScheduled ? 'updateScheduledMessageSendFailed' : 'updateMessageSendFailed',
        chatId: chat.id,
        localId: localMessage.id,
        error: error.errorMessage || error.message || 'SEND_FAILED',
      });
    }
  })();

  return messagePromise;
}


export async function editTodo({
  chat,
  message,
  todo,
}: {
  chat: ApiChat;
  message: ApiMessage;
  todo: ApiNewMediaTodo;
}) {
  const media = buildInputTodo(todo);
  const isScheduled = message.date * 1000 > getServerTime() * 1000;

  const newContent: MediaContent = {
    ...message.content,
    todo: {
      mediaType: 'todo',
      todo: todo.todo,
    },
  };

  const messageUpdate: ApiMessage = {
    ...message,
    content: newContent,
  };

  sendApiUpdate({
    '@type': isScheduled ? 'updateScheduledMessage' : 'updateMessage',
    id: message.id,
    chatId: chat.id,
    message: messageUpdate,
    isFull: true,
  });

  try {
    const result = await request(
      'messages.editMessageMedia',
      {
        chatId: chat.id,
        chat,
        message,
        messageId: message.id,
        media,
      },
      {
        shouldThrow: true,
      } as any,
    );

    if (result?.message) {
      sendApiUpdate({
        '@type': isScheduled ? 'updateScheduledMessage' : 'updateMessage',
        id: message.id,
        chatId: chat.id,
        message: result.message,
        isFull: true,
      });
    }
  } catch (err) {
    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.warn(err);
    }

    const apiError = buildApiError(err as Error);

    sendApiUpdate({
      '@type': 'error',
      error: {
        ...apiError,
        hasErrorKey: true,
      },
    });

    sendApiUpdate({
      '@type': isScheduled ? 'updateScheduledMessage' : 'updateMessage',
      id: message.id,
      chatId: chat.id,
      message,
      isFull: true,
    });
  }
}

export async function appendTodoList({
  chat,
  message,
  items,
}: {
  chat: ApiChat;
  message: ApiMessage;
  items: ApiTodoItem[];
}) {
  const todoItems = items.map((item) => {
    return new GramJs.TodoItem({
      id: item.id,
      title: buildInputTextWithEntities(item.title),
    });
  });

  try {
    const result = await request(
      'messages.appendTodoList',
      {
        chatId: chat.id,
        chat,
        message,
        messageId: message.id,
        todoItems,
      },
      {
        shouldThrow: true,
      } as any,
    );

    if (result?.message) {
      sendApiUpdate({
        '@type': 'updateMessage',
        id: message.id,
        chatId: chat.id,
        message: result.message,
        isFull: true,
      });
    }
  } catch (err) {
    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.warn(err);
    }

    const apiError = buildApiError(err as Error);

    sendApiUpdate({
      '@type': 'error',
      error: {
        ...apiError,
        hasErrorKey: true,
      },
    });
  }
}
export async function rescheduleMessage({
  chat,
  message,
  scheduledAt,
  scheduleRepeatPeriod,
}: {
  chat: ApiChat;
  message: ApiMessage;
  scheduledAt: number;
  scheduleRepeatPeriod?: number;
}) {
  await request(
    'messages.editScheduledMessage',
    {
      chatId: chat.id,
      chat,
      message,
      messageId: message.id,
      scheduledAt,
      scheduleRepeatPeriod,
    },
    {
      shouldThrow: true,
    } as any,
  );
}

export async function pinMessage({
  chat,
  messageId,
  isUnpin,
  isOneSide,
  isSilent,
}: {
  chat: ApiChat;
  messageId: number;
  isUnpin: boolean;
  isOneSide?: boolean;
  isSilent?: boolean;
}) {
  await request(
    'messages.updatePinnedMessage',
    {
      chatId: chat.id,
      chat,
      messageId,
      isUnpin,
      isOneSide,
      isSilent,
    },
  );
}

export async function unpinAllMessages({
  chat,
  threadId,
}: {
  chat: ApiChat;
  threadId?: ThreadId;
}) {
  const result = await request(
    'messages.unpinAllMessages',
    {
      chatId: chat.id,
      chat,
      threadId,
    },
  );

  if (!result) return;

  if (result.offset) {
    await unpinAllMessages({ chat, threadId });
  }
}

export async function deleteMessages({
  chat,
  messageIds,
  shouldDeleteForAll,
}: {
  chat: ApiChat;
  messageIds: number[];
  shouldDeleteForAll?: boolean;
}) {
  const isChannel = getEntityTypeById(chat.id) === 'channel';

  const result = await request(
    'messages.deleteMessages',
    {
      chatId: chat.id,
      chat,
      messageIds,
      isChannel,
      shouldDeleteForAll,
    },
  );

  if (!result) {
    return;
  }

  sendApiUpdate({
    '@type': 'deleteMessages',
    ids: messageIds,
    ...(isChannel && { chatId: chat.id }),
  });
}

export async function deleteParticipantHistory({
  chat,
  peer,
  isRepeat = false,
}: {
  chat: ApiChat;
  peer: ApiPeer;
  isRepeat?: boolean;
}) {
  const result = await request(
    'channels.deleteParticipantHistory',
    {
      chatId: chat.id,
      peerId: peer.id,
      chat,
      peer,
    },
  );

  if (!result) {
    return;
  }

  if (!isRepeat) {
    sendApiUpdate({
      '@type': 'deleteParticipantHistory',
      chatId: chat.id,
      peerId: peer.id,
    });
  }

  if (result.offset) {
    await deleteParticipantHistory({ chat, peer, isRepeat: true });
  }
}

export function editChatParticipantRank({
  chat,
  peer,
  rank,
}: {
  chat: ApiChat;
  peer: ApiPeer;
  rank: string;
}) {
  return request(
    'messages.editChatParticipantRank',
    {
      chatId: chat.id,
      chat,
      peerId: peer.id,
      participant: peer,
      rank,
    },
    {
      shouldReturnTrue: true,
    } as any,
  );
}

export async function deleteScheduledMessages({
  chat,
  messageIds,
}: {
  chat: ApiChat;
  messageIds: number[];
}) {
  await request(
    'messages.deleteScheduledMessages',
    {
      chatId: chat.id,
      chat,
      messageIds,
    },
  );
}

export async function deleteHistory({
  chat,
  shouldDeleteForAll,
  maxId,
}: {
  chat: ApiChat;
  shouldDeleteForAll?: boolean;
  maxId?: number;
}) {
  const isChannel = getEntityTypeById(chat.id) === 'channel';

  const result = await request(
    isChannel ? 'channels.deleteHistory' : 'messages.deleteHistory',
    {
      chatId: chat.id,
      chat,
      maxId,
      shouldDeleteForAll,
    },
  );

  if (!result) {
    return;
  }

  if ('offset' in result && result.offset) {
    await deleteHistory({ chat, shouldDeleteForAll, maxId });
    return;
  }

  sendApiUpdate({
    '@type': 'deleteHistory',
    chatId: chat.id,
  });
}

export async function deleteSavedHistory({
  chat,
}: {
  chat: ApiChat;
}) {
  const result = await request(
    'messages.deleteSavedHistory',
    {
      chatId: chat.id,
      chat,
    },
  );

  if (!result) {
    return;
  }

  if ('offset' in result && result.offset) {
    await deleteSavedHistory({ chat });
    return;
  }

  sendApiUpdate({
    '@type': 'deleteSavedHistory',
    chatId: chat.id,
  });
}

export async function toggleSuggestedPostApproval({
  chat,
  messageId,
  reject,
  scheduleDate,
  rejectComment,
}: {
  chat: ApiChat;
  messageId: number;
  reject?: boolean;
  scheduleDate?: number;
  rejectComment?: string;
}) {
  return request(
    'messages.toggleSuggestedPostApproval',
    {
      chatId: chat.id,
      chat,
      messageId,
      reject,
      scheduleDate,
      rejectComment,
    },
  );
}

export async function reportMessages({
  peer,
  messageIds,
  description,
  option,
}: {
  peer: ApiPeer;
  messageIds: number[];
  description: string;
  option: string;
}) {
  try {
    const result = await request(
      'messages.report',
      {
        peerId: peer.id,
        peer,
        messageIds,
        option,
        description,
      },
      {
        shouldThrow: true,
      } as any,
    );

    if (!result) return undefined;

    return {
      result: result.result ?? result,
      error: undefined,
    };
  } catch (err: any) {
    const errorMessage = (err as ApiError).message;

    if (errorMessage === MESSAGE_ID_REQUIRED_ERROR) {
      return {
        result: undefined,
        error: errorMessage,
      };
    }

    throw err;
  }
}

export function reportChannelSpam({
  peer,
  chat,
  messageIds,
}: {
  peer: ApiPeer;
  chat: ApiChat;
  messageIds: number[];
}) {
  return request(
    'channels.reportSpam',
    {
      chatId: chat.id,
      peerId: peer.id,
      peer,
      chat,
      messageIds,
    },
  );
}

export async function sendMessageAction({
  peer,
  threadId,
  action,
}: {
  peer: ApiPeer;
  threadId?: ThreadId;
  action: ApiSendMessageAction;
}) {
  const mtpAction = buildSendMessageAction(action);

  if (!mtpAction) {
    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.warn('Unsupported message action', action);
    }

    return undefined;
  }

  try {
    return await request(
      'messages.setTyping',
      {
        peerId: peer.id,
        peer,
        threadId,
        action: mtpAction,
      },
      {
        shouldThrow: true,
        abortControllerChatId: peer.id,
        abortControllerThreadId: threadId,
      } as any,
    );
  } catch {
    return undefined;
  }
}

export async function markMessageListRead({
  chat,
  threadId,
  maxId = 0,
}: {
  chat: ApiChat;
  threadId: ThreadId;
  maxId?: number;
}) {
  const isChannel = getEntityTypeById(chat.id) === 'channel';

  if (isChannel && threadId === MAIN_THREAD_ID) {
    await request(
      'channels.readHistory',
      {
        chatId: chat.id,
        chat,
        maxId,
      },
    );
  } else if (threadId !== MAIN_THREAD_ID) {
    await request(
      'messages.readDiscussion',
      {
        chatId: chat.id,
        chat,
        threadId,
        maxId,
      },
    );
  } else {
    await request(
      'messages.readHistory',
      {
        chatId: chat.id,
        chat,
        maxId,
      },
    );
  }

  if (threadId === MAIN_THREAD_ID) {
    void requestChatUpdate({ chat, noLastMessage: true });
  } else if (chat.isForum) {
    sendApiUpdate({
      '@type': 'updateTopic',
      chatId: chat.id,
      topicId: Number(threadId),
    });
  } else {
    sendApiUpdate({
      '@type': 'updateDiscussion',
      chatId: chat.id,
      threadId: Number(threadId),
    });
  }
}

export async function markMessagesRead({
  chat,
  messageIds,
}: {
  chat: ApiChat;
  messageIds: number[];
}) {
  const isChannel = getEntityTypeById(chat.id) === 'channel';

  const result = await request(
    isChannel
      ? 'channels.readMessageContents'
      : 'messages.readMessageContents',
    {
      chatId: chat.id,
      chat,
      messageIds,
    },
  );

  if (!result) {
    return;
  }

  sendApiUpdate({
    ...(isChannel
      ? {
          '@type': 'updateChannelMessages',
          channelId: chat.id,
        }
      : {
          '@type': 'updateCommonBoxMessages',
        }),
    ids: messageIds,
    messageUpdate: {
      hasUnreadMention: false,
      isMediaUnread: false,
    },
  });
}

export async function fetchMessageViews({
  chat,
  ids,
  shouldIncrement,
}: {
  chat: ApiChat;
  ids: number[];
  shouldIncrement?: boolean;
}) {
  const chunks = split(ids, API_GENERAL_ID_LIMIT);

  const results = await Promise.all(
    chunks.map((chunkIds) =>
      request(
        'messages.getMessagesViews',
        {
          chatId: chat.id,
          chat,
          messageIds: chunkIds,
          shouldIncrement,
        },
      ),
    ),
  );

  if (!results || results.some((result) => !result)) {
    return undefined;
  }

  const viewsList = results.flatMap((result: any) => result.views ?? []);

  const viewsInfo = ids.map((id, index) => {
    const item = viewsList[index] ?? {};

    return {
      id,
      views: item.views,
      forwards: item.forwards,
      threadInfo: item.replies
        ? buildApiThreadInfo(chat.id, id, item.replies)
        : undefined,
    };
  });

  return { viewsInfo };
}

export async function fetchFactChecks({
  chat,
  ids,
}: {
  chat: ApiChat;
  ids: number[];
}) {
  const chunks = split(ids, API_GENERAL_ID_LIMIT);

  const results = await Promise.all(
    chunks.map((chunkIds) =>
      request(
        'messages.getFactCheck',
        {
          chatId: chat.id,
          chat,
          messageIds: chunkIds,
        },
      ),
    ),
  );

  if (!results || results.some((result) => !result)) {
    return undefined;
  }

  return results.flatMap((result: any) => result ?? []);
}

export function fetchPaidReactionPrivacy() {
  return request(
    'messages.getPaidReactionPrivacy',
    undefined,
    {
      shouldReturnTrue: true,
    },
  );
}

export function reportMessagesDelivery({
  chat,
  messageIds,
}: {
  chat: ApiChat;
  messageIds: number[];
}) {
  return request(
    'messages.reportMessagesDelivery',
    {
      chatId: chat.id,
      chat,
      messageIds,
    },
  );
}

export async function fetchDiscussionMessage({
  chat,
  messageId,
}: {
  chat: ApiChat;
  messageId: number;
}) {
  const [result, replies] = await Promise.all([
    request(
      'messages.getDiscussionMessage',
      {
        chatId: chat.id,
        chat,
        messageId,
      },
      {
        abortControllerChatId: chat.id,
        abortControllerThreadId: messageId,
      } as any,
    ),
    fetchMessages({
      chat,
      threadId: messageId,
      offsetId: 1,
      addOffset: -1,
      limit: 1,
    }),
  ]);

  if (!result || !replies) return undefined;

  const topMessages = result.topMessages ?? result.messages ?? [];
  const messages = topMessages.concat(replies.messages ?? []);

  const threadId = result.threadId ?? messageId;
  const chatId = result.chatId ?? topMessages[0]?.chatId ?? chat.id;

  return {
    messages,
    topMessages,
    threadId,
    threadReadState: result.threadReadState,
    threadInfo: result.threadInfo,
    lastMessageId: result.lastMessageId ?? result.maxId,
    chatId,
    firstMessageId: replies.messages?.[0]?.id,
  };
}

export async function searchMessagesInChat({
  peer,
  isSavedDialog,
  savedTag,
  type,
  query = DEFAULT_PRIMITIVES.STRING,
  threadId,
  minDate,
  maxDate,
  offsetId,
  addOffset,
  limit,
  fromPeer,
}: {
  peer: ApiPeer;
  isSavedDialog?: boolean;
  savedTag?: ApiReaction;
  type?: ApiMessageSearchType | ApiGlobalMessageSearchType;
  query?: string;
  threadId?: ThreadId;
  offsetId?: number;
  addOffset?: number;
  limit: number;
  minDate?: number;
  maxDate?: number;
  fromPeer?: ApiPeer;
}): Promise<SearchResults | undefined> {
  const result = await request(
    'messages.search',
    {
      peerId: peer.id,
      peer,
      isSavedDialog,
      savedTag,
      type,
      query,
      threadId,
      minDate,
      maxDate,
      offsetId,
      addOffset,
      limit,
      fromPeerId: fromPeer?.id,
      fromPeer,
    },
    {
      abortControllerChatId: peer.id,
      abortControllerThreadId: threadId,
    } as any,
  );

  if (!result) {
    return undefined;
  }

  return {
    userStatusesById: result.userStatusesById ?? {},
    messages: result.messages ?? [],
    topics: result.topics ?? [],
    totalCount: result.totalCount ?? result.count ?? result.messages?.length ?? 0,
    nextOffsetId: result.nextOffsetId,
  };
}

export async function searchMessagesGlobal({
  query,
  offsetRate = 0,
  offsetPeer,
  offsetId,
  limit,
  type = 'text',
  minDate,
  maxDate,
  context = 'all',
}: {
  query: string;
  offsetRate?: number;
  offsetPeer?: ApiPeer;
  offsetId?: number;
  limit: number;
  type?: ApiGlobalMessageSearchType;
  context?: ApiMessageSearchContext;
  minDate?: number;
  maxDate?: number;
}): Promise<SearchResults | undefined> {
  if (type === 'publicPosts') {
    return searchPublicPosts({
      query,
      offsetRate,
      offsetPeer,
      offsetId,
      limit,
    });
  }

  if (type === 'text' && !query && !(maxDate && minDate)) {
    return undefined;
  }

  const result = await request(
    'messages.searchGlobal',
    {
      query,
      offsetRate,
      offsetPeerId: offsetPeer?.id,
      offsetPeer,
      offsetId,
      limit,
      type,
      minDate,
      maxDate,
      context,
    },
  );

  if (!result) {
    return undefined;
  }

  return {
    messages: result.messages ?? [],
    topics: result.topics ?? [],
    userStatusesById: result.userStatusesById ?? {},
    totalCount: result.totalCount ?? result.count ?? result.messages?.length ?? 0,
    nextOffsetRate: result.nextOffsetRate,
    nextOffsetPeerId: result.nextOffsetPeerId,
    nextOffsetId: result.nextOffsetId,
  };
}

export async function searchPublicPosts({
  hashtag,
  query,
  offsetRate,
  offsetPeer,
  offsetId,
  limit,
}: {
  hashtag?: string;
  query?: string;
  offsetRate?: number;
  offsetPeer?: ApiPeer;
  offsetId?: number;
  limit?: number;
}): Promise<SearchResults | undefined> {
  const resultFlood = await checkSearchPostsFlood(query);

  if (!resultFlood) {
    return undefined;
  }

  const result = await request(
    'channels.searchPosts',
    {
      hashtag,
      query,
      offsetRate,
      offsetPeerId: offsetPeer?.id,
      offsetPeer,
      offsetId,
      limit,
      starsAmount: resultFlood.starsAmount,
    },
  );

  if (!result) {
    return undefined;
  }

  return {
    messages: result.messages ?? [],
    topics: result.topics ?? [],
    userStatusesById: result.userStatusesById ?? {},
    totalCount: result.totalCount ?? result.count ?? result.messages?.length ?? 0,
    nextOffsetRate: result.nextOffsetRate,
    nextOffsetPeerId: result.nextOffsetPeerId,
    nextOffsetId: result.nextOffsetId,
    searchFlood: result.searchFlood,
  };
}

export async function checkSearchPostsFlood(query?: string) {
  const result = await request(
    'channels.checkSearchPostsFlood',
    {
      query,
    },
  );

  if (!result) {
    return undefined;
  }

  return result.searchFlood ?? result;
}

export async function fetchWebPagePreview({
  text,
}: {
  text: ApiFormattedText;
}) {
  const result = await request(
    'messages.getWebPagePreview',
    {
      text: text.text,
      entities: text.entities,
    },
  );

  if (!result) return undefined;

  return result.webPage ?? result.webpage ?? result;
}

export async function fetchWebPage({
  url,
  hash = DEFAULT_PRIMITIVES.INT,
}: {
  url: string;
  hash?: number;
}) {
  const result = await request(
    'messages.getWebPage',
    {
      url,
      hash,
    },
    {
      shouldIgnoreErrors: true,
    },
  );

  if (!result) {
    return undefined;
  }

  return result.webPage ?? result.webpage ?? result;
}
export async function sendPollVote({
  chat,
  messageId,
  options,
}: {
  chat: ApiChat;
  messageId: number;
  options: string[];
}) {
  await request(
    'messages.sendVote',
    {
      chatId: chat.id,
      chat,
      messageId,
      options,
    },
  );
}

export async function appendPollAnswer({
  chat,
  messageId,
  text,
}: {
  chat: ApiChat;
  messageId: number;
  text: string;
}) {
  await request(
    'messages.addPollAnswer',
    {
      chatId: chat.id,
      chat,
      messageId,
      text,
    },
  );
}

export async function toggleTodoCompleted({
  chat,
  messageId,
  completedIds,
  incompletedIds,
}: {
  chat: ApiChat;
  messageId: number;
  completedIds: number[];
  incompletedIds: number[];
}) {
  await request(
    'messages.toggleTodoCompleted',
    {
      chatId: chat.id,
      chat,
      messageId,
      completedIds,
      incompletedIds,
    },
  );
}

export async function closePoll({
  chat,
  messageId,
  poll,
}: {
  chat: ApiChat;
  messageId: number;
  poll: ApiMessagePoll;
}) {
  await request(
    'messages.editPoll',
    {
      chatId: chat.id,
      chat,
      messageId,
      poll,
    },
  );
}

export async function loadPollOptionResults({
  chat,
  messageId,
  option,
  offset,
  limit,
  shouldResetVoters,
}: {
  chat: ApiChat;
  messageId: number;
  option?: string;
  offset?: string;
  limit?: number;
  shouldResetVoters?: boolean;
}) {
  const result = await request(
    'messages.getPollVotes',
    {
      chatId: chat.id,
      chat,
      messageId,
      limit,
      option,
      offset,
    },
  );

  if (!result) {
    return undefined;
  }

  return {
    count: result.count ?? 0,
    votes: result.votes ?? [],
    nextOffset: result.nextOffset,
    shouldResetVoters,
  };
}

export async function fetchExtendedMedia({
  chat,
  ids,
}: {
  chat: ApiChat;
  ids: number[];
}) {
  return request(
    'messages.getExtendedMedia',
    {
      chatId: chat.id,
      chat,
      ids,
    },
  );
}

export function forwardMessagesLocal(params: ForwardMessagesParams) {
  const {
    toChat,
    toThreadId,
    messages,
    scheduledAt,
    scheduleRepeatPeriod,
    sendAs,
    noAuthors,
    noCaptions,
    isCurrentUserPremium,
    wasDrafted,
    lastMessageId,
    effectId,
  } = params;

  const messageIds = messages.map(({ id }) => id);
  const localMessages: ApiMessage[] = [];

  messages.forEach((message, index) => {
    const localMessage = buildLocalForwardedMessage({
      toChat,
      toThreadId: Number(toThreadId),
      message,
      scheduledAt,
      scheduleRepeatPeriod,
      noAuthors,
      noCaptions,
      isCurrentUserPremium,
      lastMessageId,
      sendAs,
      effectId: index === 0 ? effectId : undefined,
    });

    localMessages.push(localMessage);

    sendApiUpdate({
      '@type': localMessage.isScheduled ? 'newScheduledMessage' : 'newMessage',
      id: localMessage.id,
      chatId: toChat.id,
      message: localMessage,
      wasDrafted,
    });
  });

  return Promise.resolve({ messageIds, localMessages });
}

export async function forwardApiMessages(params: ForwardMessagesParams) {
  const {
    fromChat,
    toChat,
    toThreadId,
    isSilent,
    scheduledAt,
    scheduleRepeatPeriod,
    sendAs,
    withMyScore,
    noAuthors,
    noCaptions,
    forwardedLocalMessagesSlice,
    messagePriceInStars,
    effectId,
  } = params;

  if (!forwardedLocalMessagesSlice) return;

  const { messageIds, localMessages } = forwardedLocalMessagesSlice;

  const priceInStars = messagePriceInStars
    ? messagePriceInStars * messageIds.length
    : undefined;

  const randomIds = messageIds.map(() => generateRandomBigInt());

  try {
    const update = await request(
      'messages.forwardMessages',
      {
        fromChatId: fromChat.id,
        toChatId: toChat.id,
        fromChat,
        toChat,
        messageIds,
        withMyScore,
        isSilent,
        noAuthors,
        noCaptions,
        toThreadId,
        scheduledAt,
        scheduleRepeatPeriod,
        sendAs,
        priceInStars,
        effectId,
      },
      {
        shouldThrow: true,
        shouldIgnoreUpdates: true,
      } as any,
    );

    const messagesForUpdate: Record<string, ApiMessage> = {};

    localMessages.forEach((message, index) => {
      messagesForUpdate[randomIds[index].toString()] = message;
    });

    if (update) {
      handleMultipleLocalMessagesUpdate(messagesForUpdate, update);
    }
  } catch (error: any) {
    localMessages.forEach((localMessage) => {
      sendApiUpdate({
        '@type': localMessage.isScheduled
          ? 'updateScheduledMessageSendFailed'
          : 'updateMessageSendFailed',
        chatId: toChat.id,
        localId: localMessage.id,
        error: error.errorMessage || error.message || 'FORWARD_FAILED',
      });
    });
  }
}

export async function forwardMessages(params: ForwardMessagesParams) {
  if (params.forwardedLocalMessagesSlice) {
    await forwardApiMessages(params);
  } else {
    const newParams = {
      ...params,
      forwardedLocalMessagesSlice: await forwardMessagesLocal(params),
    };

    await forwardApiMessages(newParams);
  }
}

export async function findFirstMessageIdAfterDate({
  chat,
  timestamp,
}: {
  chat: ApiChat;
  timestamp: number;
}) {
  const result = await request(
    'messages.getHistory',
    {
      chatId: chat.id,
      chat,
      timestamp,
      addOffset: -1,
      limit: 1,
    },
  );

  if (!result?.messages?.length) {
    return undefined;
  }

  return result.messages[0].id;
}

export async function fetchScheduledHistory({
  chat,
}: {
  chat: ApiChat;
}) {
  const result = await request(
    'messages.getScheduledHistory',
    {
      chatId: chat.id,
      chat,
    },
    {
      abortControllerChatId: chat.id,
    } as any,
  );

  if (!result) {
    return undefined;
  }

  return {
    messages: result.messages ?? [],
  };
}

export async function sendScheduledMessages({
  chat,
  ids,
}: {
  chat: ApiChat;
  ids: number[];
}) {
  await request(
    'messages.sendScheduledMessages',
    {
      chatId: chat.id,
      chat,
      ids,
    },
  );
}

export async function fetchPinnedMessages({
  chat,
  threadId,
}: {
  chat: ApiChat;
  threadId: ThreadId;
}) {
  const result = await request(
    'messages.searchPinned',
    {
      chatId: chat.id,
      chat,
      threadId,
      limit: PINNED_MESSAGES_LIMIT,
    },
    {
      abortControllerChatId: chat.id,
      abortControllerThreadId: threadId,
    } as any,
  );

  if (!result) {
    return undefined;
  }

  return {
    messages: result.messages ?? [],
  };
}

export async function fetchSeenBy({
  chat,
  messageId,
}: {
  chat: ApiChat;
  messageId: number;
}) {
  const result = await request(
    'messages.getMessageReadParticipants',
    {
      chatId: chat.id,
      chat,
      messageId,
    },
  );

  if (!result) {
    return undefined;
  }

  if (result.seenBy) {
    return result.seenBy;
  }

  if (Array.isArray(result)) {
    return result.reduce((acc, readDate) => {
      acc[readDate.userId.toString()] = readDate.date;
      return acc;
    }, {} as Record<string, number>);
  }

  return undefined;
}

export async function fetchSendAs({
  chat,
  isForPaidReactions,
}: {
  isForPaidReactions?: true;
  chat: ApiChat;
}) {
  const result = await request(
    'channels.getSendAs',
    {
      chatId: chat.id,
      chat,
      isForPaidReactions,
    },
    {
      shouldIgnoreErrors: true,
      abortControllerChatId: chat.id,
    } as any,
  );

  if (!result) {
    return undefined;
  }

  return result.peers ?? result.sendAsPeerIds ?? [];
}

export function saveDefaultSendAs({
  sendAs,
  chat,
}: {
  sendAs: ApiPeer;
  chat: ApiChat;
}) {
  return request(
    'messages.saveDefaultSendAs',
    {
      chatId: chat.id,
      sendAsId: sendAs.id,
      chat,
      sendAs,
    },
  );
}

export async function fetchSponsoredMessages({
  peer,
}: {
  peer: ApiPeer;
}) {
  const result = await request(
    'messages.getSponsoredMessages',
    {
      peerId: peer.id,
      peer,
    },
  );

  if (!result) {
    return undefined;
  }

  return {
    messages: result.messages ?? [],
  };
}

export async function viewSponsoredMessage({
  random,
}: {
  random: string;
}) {
  await request(
    'messages.viewSponsoredMessage',
    {
      random,
    },
  );
}

export function clickSponsoredMessage({
  random,
  isMedia,
  isFullscreen,
}: {
  random: string;
  isMedia?: boolean;
  isFullscreen?: boolean;
}) {
  return request(
    'messages.clickSponsoredMessage',
    {
      random,
      isMedia,
      isFullscreen,
    },
  );
}

export async function reportSponsoredMessage({
  randomId,
  option,
}: {
  randomId: string;
  option: string;
}) {
  try {
    const result = await request(
      'messages.reportSponsoredMessage',
      {
        randomId,
        option,
      },
      {
        shouldThrow: true,
      } as any,
    );

    if (!result) {
      return undefined;
    }

    return result;
  } catch (err: any) {
    if (err?.errorMessage === 'PREMIUM_ACCOUNT_REQUIRED') {
      return {
        type: 'premiumRequired' as const,
      };
    }

    return undefined;
  }
}

export async function readAllMentions({
  chat,
  threadId,
}: {
  chat: ApiChat;
  threadId?: ThreadId;
}) {
  const result = await request(
    'messages.readMentions',
    {
      chatId: chat.id,
      chat,
      threadId,
    },
  );

  if (!result) return;

  if (result.offset) {
    await readAllMentions({ chat, threadId });
  }
}

export async function readAllReactions({
  chat,
  threadId,
}: {
  chat: ApiChat;
  threadId?: ThreadId;
}) {
  const result = await request(
    'messages.readReactions',
    {
      chatId: chat.id,
      chat,
      threadId,
    },
  );

  if (!result) return;

  if (result.offset) {
    await readAllReactions({ chat, threadId });
  }
}

export async function readAllPollVotes({
  chat,
  threadId,
}: {
  chat: ApiChat;
  threadId?: ThreadId;
}) {
  const result = await request(
    'messages.readPollVotes',
    {
      chatId: chat.id,
      chat,
      threadId,
    },
  );

  if (!result) return;

  if (result.offset) {
    await readAllPollVotes({ chat, threadId });
  }
}

export async function fetchUnreadMentions({
  chat,
  threadId,
  offsetId,
  addOffset,
  maxId,
  minId,
}: {
  chat: ApiChat;
  threadId?: ThreadId;
  offsetId?: number;
  addOffset?: number;
  maxId?: number;
  minId?: number;
}) {
  const result = await request(
    'messages.getUnreadMentions',
    {
      chatId: chat.id,
      chat,
      threadId,
      limit: MENTION_UNREAD_SLICE,
      offsetId,
      addOffset,
      maxId,
      minId,
    },
  );

  if (!result) {
    return undefined;
  }

  return {
    totalCount: result.totalCount ?? result.count ?? result.messages?.length ?? 0,
    messages: result.messages ?? [],
    topics: result.topics ?? [],
  };
}

export async function fetchUnreadReactions({
  chat,
  threadId,
  offsetId,
  addOffset,
  maxId,
  minId,
}: {
  chat: ApiChat;
  threadId?: ThreadId;
  offsetId?: number;
  addOffset?: number;
  maxId?: number;
  minId?: number;
}) {
  const result = await request(
    'messages.getUnreadReactions',
    {
      chatId: chat.id,
      chat,
      threadId,
      limit: REACTION_UNREAD_SLICE,
      offsetId,
      addOffset,
      maxId,
      minId,
    },
  );

  if (!result) return undefined;

  return {
    totalCount: result.totalCount ?? result.count ?? result.messages?.length ?? 0,
    messages: result.messages ?? [],
    topics: result.topics ?? [],
  };
}

export async function fetchUnreadPollVotes({
  chat,
  threadId,
  offsetId,
  addOffset,
  maxId,
  minId,
}: {
  chat: ApiChat;
  threadId?: ThreadId;
  offsetId?: number;
  addOffset?: number;
  maxId?: number;
  minId?: number;
}) {
  const result = await request(
    'messages.getUnreadPollVotes',
    {
      chatId: chat.id,
      chat,
      threadId,
      limit: POLL_UNREAD_SLICE,
      offsetId,
      addOffset,
      maxId,
      minId,
    },
  );

  if (!result) return undefined;

  return {
    totalCount: result.totalCount ?? result.count ?? result.messages?.length ?? 0,
    messages: result.messages ?? [],
    topics: result.topics ?? [],
  };
}

export async function transcribeAudio({
  chat,
  messageId,
}: {
  chat: ApiChat;
  messageId: number;
}) {
  const result = await request(
    'messages.transcribeAudio',
    {
      chatId: chat.id,
      chat,
      messageId,
    },
  );

  if (!result) return undefined;

  sendApiUpdate({
    '@type': 'updateTranscribedAudio',
    isPending: result.pending,
    transcriptionId: String(result.transcriptionId),
    text: result.text,
  });

  return String(result.transcriptionId);
}

export async function translateText(params: TranslateTextParams) {
  const { toLanguageCode, tone } = params;

  let result;

  if ('chat' in params) {
    result = await request(
      'messages.translateText',
      {
        chatId: params.chat.id,
        chat: params.chat,
        messageIds: params.messageIds,
        toLanguageCode,
        tone,
      },
    );
  } else {
    result = await request(
      'messages.translateText',
      {
        text: params.text,
        toLanguageCode,
        tone,
      },
    );
  }

  if (!result) {
    if ('chat' in params) {
      sendApiUpdate({
        '@type': 'failedMessageTranslations',
        chatId: params.chat.id,
        messageIds: params.messageIds,
        toLanguageCode,
        tone,
      });
    }

    return undefined;
  }

  const translations = result.translations ?? result.result ?? [];

  if ('chat' in params) {
    sendApiUpdate({
      '@type': 'updateMessageTranslations',
      chatId: params.chat.id,
      messageIds: params.messageIds,
      translations,
      toLanguageCode,
      tone,
    });
  }

  return translations;
}

export async function fetchMessageSummary({
  chat,
  id,
  toLanguageCode,
  tone,
}: {
  chat: ApiChat;
  id: number;
  toLanguageCode?: string;
  tone?: string;
}) {
  const result = await request(
    'messages.summarizeText',
    {
      chatId: chat.id,
      chat,
      id,
      toLanguageCode,
      tone,
    },
  );

  if (!result) return undefined;

  return result.summary ?? result;
}

function handleMultipleLocalMessagesUpdate(
  localMessages: Record<string, ApiMessage>, update: GramJs.TypeUpdates,
) {
  if (!('updates' in update)) {
    handleGramJsUpdate(update);
    return;
  }

  const updateMessageIds = update.updates.filter((u): u is GramJs.UpdateMessageID => (
    u instanceof GramJs.UpdateMessageID
  ));

  // Server can return `UpdateNewScheduledMessage` that we currently process as video that requires processing
  updateMessageIds.forEach((updateMessageId) => {
    const updateNewScheduledMessage = update.updates
      .find((scheduledUpdate): scheduledUpdate is GramJs.UpdateNewScheduledMessage => {
        if (!(scheduledUpdate instanceof GramJs.UpdateNewScheduledMessage)) return false;
        return scheduledUpdate.message.id === updateMessageId.id;
      });

    const localMessage = localMessages[updateMessageId.randomId.toString()];
    handleLocalMessageUpdate(localMessage, updateMessageId, updateNewScheduledMessage);
  });

  const otherUpdates = update.updates.filter((u) => {
    if (u instanceof GramJs.UpdateMessageID) return false;
    if (u instanceof GramJs.UpdateNewScheduledMessage) return false;
    return true;
  });

  // Illegal monkey patching. Easier than creating mock update object
  update.updates = otherUpdates;

  handleGramJsUpdate(update);
}

function handleLocalMessageUpdate(
  localMessage: ApiMessage,
  update: GramJs.TypeUpdates | GramJs.UpdateMessageID,
  scheduledMessageUpdate?: GramJs.UpdateNewScheduledMessage,
) {
  let messageUpdate;
  if (update instanceof GramJs.UpdateShortSentMessage || update instanceof GramJs.UpdateMessageID) {
    messageUpdate = update;
  } else if ('updates' in update) {
    messageUpdate = update.updates.find((u): u is GramJs.UpdateMessageID => u instanceof GramJs.UpdateMessageID);
    scheduledMessageUpdate = update.updates.find((u): u is GramJs.UpdateNewScheduledMessage => (
      u instanceof GramJs.UpdateNewScheduledMessage
    ));
  }

  if (!messageUpdate) {
    handleGramJsUpdate(update);
    return;
  }

  let newContent: MediaContent | undefined;
  let poll: ApiMessagePoll | undefined;
  let webPage: ApiWebPage | undefined;
  if (messageUpdate instanceof GramJs.UpdateShortSentMessage) {
    if (localMessage.content.text && messageUpdate.entities) {
      newContent = {
        text: buildMessageTextContent(localMessage.content.text.text, messageUpdate.entities),
      };
    }
    if (messageUpdate.media) {
      newContent = {
        ...newContent,
        ...buildMessageMediaContent(messageUpdate.media, {
          peerId: buildPeer(localMessage.chatId), id: messageUpdate.id,
        }),
      };
      poll = buildMessagePollFromMedia(messageUpdate.media);
      webPage = buildWebPageFromMedia(messageUpdate.media);
    }

    const mtpMessage = buildMessageFromUpdate(messageUpdate.id, localMessage.chatId, messageUpdate);
    processMessageAndUpdateThreadInfo(mtpMessage);
  }

  const newScheduledMessage = scheduledMessageUpdate?.message && buildApiMessage(scheduledMessageUpdate.message);

  // Edge case for "Send When Online"
  const isSentBefore = 'date' in messageUpdate && messageUpdate.date < getServerTime();

  if (newScheduledMessage?.isVideoProcessingPending) {
    sendApiUpdate({
      '@type': 'updateVideoProcessingPending',
      chatId: localMessage.chatId,
      localId: localMessage.id,
      newScheduledMessageId: newScheduledMessage?.id,
    });
  } else {
    const updatedMessage: ApiMessage = {
      ...localMessage,
      ...(newContent && {
        content: {
          ...localMessage.content,
          ...newContent,
        },
      }),
      id: messageUpdate.id,
      sendingState: undefined,
      ...('date' in messageUpdate && { date: messageUpdate.date }),
    };

    sendApiUpdate({
      '@type': localMessage.isScheduled && !isSentBefore
        ? 'updateScheduledMessageSendSucceeded'
        : 'updateMessageSendSucceeded',
      chatId: localMessage.chatId,
      localId: localMessage.id,
      message: updatedMessage,
      poll,
      webPage,
    });
  }

  handleGramJsUpdate(update);
}

export async function exportMessageLink({
  id, chat, shouldIncludeThread, shouldIncludeGrouped,
}: {
  id: number;
  chat: ApiChat;
  shouldIncludeThread?: boolean;
  shouldIncludeGrouped?: boolean;
}) {
  const result = await request(
  "channels.exportMessageLink",
  {
    chat,
    id,
    shouldIncludeThread,
    shouldIncludeGrouped,
  },
);

  return result?.link;
}

export async function fetchPreparedInlineMessage({
  bot, id,
}: {
  bot: ApiUser;
  id: string;
}) {
 const result = await request(
  "messages.getPreparedInlineMessage",
  {
    bot,
    id,
  },
);
  if (!result) return undefined;

  return buildPreparedInlineMessage(result);
}

export function incrementLocalMessagesCounter() {
  incrementLocalMessageCounter();
}

export async function composeMessageWithAI({
  text,
  shouldProofread,
  isEmojify,
  translateToLang,
  tone,
}: {
  text: ApiFormattedText;
  shouldProofread?: boolean;
  isEmojify?: boolean;
  translateToLang?: string;
  tone?: ApiInputAiComposeTone;
}): Promise<{ result?: ApiComposedMessageWithAI; error?: 'floodPremium' | 'aiError' | 'generic' }> {
  try {
    const result = await request(
  "messages.composeMessageWithAI",
  {
    text,
    shouldProofread,
    isEmojify,
    translateToLang,
    tone,
  },
  {
    shouldThrow: true,
  },
);

    if (!result) return { error: 'generic' };

    return { result: buildApiComposedMessageWithAI(result) };
  } catch (err) {
    if (err instanceof RPCError) {
      if (err.errorMessage === 'AICOMPOSE_FLOOD_PREMIUM') {
        return { error: 'floodPremium' };
      }
      if (err.errorMessage === 'AICOMPOSE_ERROR_OCCURED') {
        return { error: 'aiError' };
      }
    }
    return { error: 'generic' };
  }
}

export async function fetchAiComposeTones({
  hash,
}: {
  hash?: string;
}) {
 const result = await request(
  "aicompose.getTones",
  {
    hash,
  },
);

  if (!result || result instanceof GramJs.aicompose.TonesNotModified) {
    return undefined;
  }

  return {
    tones: result.tones.map(buildApiAiComposeTone),
    hash: result.hash.toString(),
  };
}

export async function createAiTone({
  title,
  emojiId,
  prompt,
  shouldDisplayAuthor,
}: {
  title: string;
  emojiId: string;
  prompt: string;
  shouldDisplayAuthor?: boolean;
}) {
  const result = await request(
  "aicompose.createTone",
  {
    title,
    prompt,
    emojiId,
    shouldDisplayAuthor,
  },
);

  if (!result) return undefined;

  return buildApiAiComposeTone(result);
}

export async function deleteAiTone({
  tone,
}: {
  tone: ApiInputAiComposeTone;
}) {
  return request(
  "aicompose.deleteTone",
  {
    tone,
  },
);
}

export async function updateAiTone({
  tone,
  title,
  emojiId,
  prompt,
  shouldDisplayAuthor,
}: {
  tone: ApiInputAiComposeTone;
  title?: string;
  emojiId?: string;
  prompt?: string;
  shouldDisplayAuthor?: boolean;
}) {
 const result = await request(
  "aicompose.updateTone",
  {
    tone,
    title,
    prompt,
    emojiId,
    shouldDisplayAuthor,
  },
);

  if (!result) return undefined;

  return buildApiAiComposeTone(result);
}

export async function fetchAiTone({
  tone,
}: {
  tone: ApiInputAiComposeTone;
}) {
 const result = await request(
  "aicompose.getTone",
  {
    tone,
  },
);
  if (!result || !('tones' in result)) {
    return undefined;
  }

  return {
    tones: result.tones.map(buildApiAiComposeTone),
  };
}

export async function fetchAiToneExample({
  tone,
  num,
}: {
  tone: ApiInputAiComposeTone;
  num: number;
}) {
  const result = await request(
  "aicompose.getToneExample",
  {
    tone,
    num,
  },
);

  if (!result) return undefined;

  return buildApiAiComposeToneExample(result);
}

export async function saveAiTone({
  tone,
  unsave,
}: {
  tone: ApiInputAiComposeTone;
  unsave?: boolean;
}) {
 return request(
  "aicompose.saveTone",
  {
    tone,
    unsave: Boolean(unsave),
  },
);
}

export async function exportMessageLink({
  id,
  chat,
  shouldIncludeThread,
  shouldIncludeGrouped,
}: {
  id: number;
  chat: ApiChat;
  shouldIncludeThread?: boolean;
  shouldIncludeGrouped?: boolean;
}) {
  const result = await request(
    'channels.exportMessageLink',
    {
      chatId: chat.id,
      chat,
      id,
      shouldIncludeThread,
      shouldIncludeGrouped,
    },
  );

  return result?.link;
}

export async function fetchPreparedInlineMessage({
  bot,
  id,
}: {
  bot: ApiUser;
  id: string;
}) {
  const result = await request(
    'messages.getPreparedInlineMessage',
    {
      bot,
      id,
    },
  );

  return result ?? undefined;
}

export function incrementLocalMessagesCounter() {
  incrementLocalMessageCounter();
}

export async function composeMessageWithAI({
  text,
  shouldProofread,
  isEmojify,
  translateToLang,
  tone,
}: {
  text: ApiFormattedText;
  shouldProofread?: boolean;
  isEmojify?: boolean;
  translateToLang?: string;
  tone?: ApiInputAiComposeTone;
}): Promise<{ result?: ApiComposedMessageWithAI; error?: 'floodPremium' | 'aiError' | 'generic' }> {
  try {
    const result = await request(
      'messages.composeMessageWithAI',
      {
        text,
        shouldProofread,
        isEmojify,
        translateToLang,
        tone,
      },
      {
        shouldThrow: true,
      } as any,
    );

    if (!result) return { error: 'generic' };

    return { result: result.result ?? result };
  } catch (err: any) {
    if (err?.errorMessage === 'AICOMPOSE_FLOOD_PREMIUM') {
      return { error: 'floodPremium' };
    }

    if (err?.errorMessage === 'AICOMPOSE_ERROR_OCCURED') {
      return { error: 'aiError' };
    }

    return { error: 'generic' };
  }
}

export async function fetchAiComposeTones({
  hash,
}: {
  hash?: string;
}) {
  const result = await request(
    'aicompose.getTones',
    { hash },
  );

  if (!result) return undefined;

  return {
    tones: result.tones ?? [],
    hash: String(result.hash ?? hash ?? ''),
  };
}

export async function createAiTone({
  title,
  emojiId,
  prompt,
  shouldDisplayAuthor,
}: {
  title: string;
  emojiId: string;
  prompt: string;
  shouldDisplayAuthor?: boolean;
}) {
  return await request(
    'aicompose.createTone',
    {
      title,
      emojiId,
      prompt,
      shouldDisplayAuthor,
    },
  );
}

export async function deleteAiTone({
  tone,
}: {
  tone: ApiInputAiComposeTone;
}) {
  return request(
    'aicompose.deleteTone',
    {
      tone,
    },
  );
}

export async function updateAiTone({
  tone,
  title,
  emojiId,
  prompt,
  shouldDisplayAuthor,
}: {
  tone: ApiInputAiComposeTone;
  title?: string;
  emojiId?: string;
  prompt?: string;
  shouldDisplayAuthor?: boolean;
}) {
  return await request(
    'aicompose.updateTone',
    {
      tone,
      title,
      emojiId,
      prompt,
      shouldDisplayAuthor,
    },
  );
}

export async function fetchAiTone({
  tone,
}: {
  tone: ApiInputAiComposeTone;
}) {
  const result = await request(
    'aicompose.getTone',
    {
      tone,
    },
  );

  if (!result) return undefined;

  return {
    tones: result.tones ?? [],
  };
}

export async function fetchAiToneExample({
  tone,
  num,
}: {
  tone: ApiInputAiComposeTone;
  num: number;
}) {
  return await request(
    'aicompose.getToneExample',
    {
      tone,
      num,
    },
  );
}

export async function saveAiTone({
  tone,
  unsave,
}: {
  tone: ApiInputAiComposeTone;
  unsave?: boolean;
}) {
  return request(
    'aicompose.saveTone',
    {
      tone,
      unsave: Boolean(unsave),
    },
  );
}