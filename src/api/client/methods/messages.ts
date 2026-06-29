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

export async function fetchMessagesById({ chat, messageIds }: { chat: ApiChat; messageIds: number[] }) {
  const isChannel = getEntityTypeById(chat.id) === 'channel';

const result = await request(
  "messages.fetchMessagesByIds",
  {
    chat,
    messageIds,
    isChannel,
  },
  {
    shouldThrow: true,
  },
);

  if (!result || result instanceof GramJs.messages.MessagesNotModified) {
    return undefined;
  }

  return result.messages.map(buildApiMessage).filter(Boolean);
}

let mediaQueue = Promise.resolve();

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
      messagePriceInStars,
    }, randomId, localMessage, onProgress, cancelSendingStatusTimeout);
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
      "messages.sendMedia",
      {
        args,
        media,
      },
      {
        shouldThrow: true,
        shouldIgnoreUpdates: true,
      },
    );
  } else {
    update = await request(
      "messages.sendMessage",
      {
        args,
        noWebPage,
      },
      {
        shouldThrow: true,
        shouldIgnoreUpdates: true,
      },
    );
  }

      cancelSendingStatusTimeout();
      if (update) handleLocalMessageUpdate(localMessage, update);
    } catch (error: any) {
      cancelSendingStatusTimeout();

      if (error.errorMessage === 'PRIVACY_PREMIUM_REQUIRED') {
        sendApiUpdate({ '@type': 'updateRequestUserUpdate', id: chat.id });
      }

      sendApiUpdate({
        '@type': localMessage.isScheduled ? 'updateScheduledMessageSendFailed' : 'updateMessageSendFailed',
        chatId: chat.id,
        localId: localMessage.id,
        error: error.errorMessage,
      });
    }
  })();

  return messagePromise;
}

export async function sendMessage(
  params: SendMessageParams,
  onProgress?: ApiOnProgress,
) {
  const localMessage = params.localMessage || await sendMessageLocal(params);
  return localMessage ? sendApiMessage(params, localMessage, onProgress) : undefined;
}

const groupedUploads: Record<string, {
  counter: number;
  singleMediaByIndex: Record<number, GramJs.InputSingleMedia>;
  localMessages: Record<string, ApiMessage>;
  cancelSendingStatusTimeouts: Record<string, NoneToVoidFunction>;
}> = {};

function sendGroupedMedia(
  {
    chat,
    text = DEFAULT_PRIMITIVES.STRING,
    entities,
    replyInfo,
    suggestedPostInfo,
    attachment,
    groupedId,
    isSilent,
    scheduledAt,
    scheduleRepeatPeriod,
    sendAs,
    messagePriceInStars,
  }: {
    chat: ApiChat;
    text?: string;
    entities?: ApiMessageEntity[];
    replyInfo?: ApiInputReplyInfo;
    suggestedPostInfo?: ApiInputSuggestedPostInfo;
    attachment: ApiAttachment;
    groupedId: string;
    isSilent?: boolean;
    scheduledAt?: number;
    scheduleRepeatPeriod?: number;
    sendAs?: ApiPeer;
    messagePriceInStars?: number;
  },
  randomId: GramJs.long,
  localMessage: ApiMessage,
  onProgress: ApiOnProgress | undefined,
  cancelSendingStatusTimeout: NoneToVoidFunction,
) {
  let groupIndex = -1;
  if (!groupedUploads[groupedId]) {
    groupedUploads[groupedId] = {
      counter: 0,
      singleMediaByIndex: {},
      localMessages: {},
      cancelSendingStatusTimeouts: {},
    };
  }

  groupIndex = groupedUploads[groupedId].counter++;

  const prevMediaQueue = mediaQueue;
  mediaQueue = (async () => {
    let inputMedia: GramJs.TypeInputMedia | undefined;

    if (attachment.gif) {
      inputMedia = buildInputMediaDocument(attachment.gif, attachment.shouldSendAsSpoiler);
    } else {
      let media;
      try {
        media = await uploadMedia(localMessage, attachment, onProgress!);
      } catch (err) {
        if (DEBUG) {
          // eslint-disable-next-line no-console
          console.warn(err);
        }

        groupedUploads[groupedId].counter--;

        await prevMediaQueue;

        return;
      }

      inputMedia = await fetchInputMedia(
        buildInputPeer(chat.id, chat.accessHash),
        media,
      );
    }

    await prevMediaQueue;

    if (!inputMedia) {
      groupedUploads[groupedId].counter--;

      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.warn('Failed to upload grouped media');
      }

      return;
    }

    groupedUploads[groupedId].singleMediaByIndex[groupIndex] = new GramJs.InputSingleMedia({
      media: inputMedia,
      randomId,
      message: text,
      entities: entities ? entities.map(buildMtpMessageEntity) : undefined,
    });
    groupedUploads[groupedId].localMessages[randomId.toString()] = localMessage;
    groupedUploads[groupedId].cancelSendingStatusTimeouts[randomId.toString()] = cancelSendingStatusTimeout;

    if (Object.keys(groupedUploads[groupedId].singleMediaByIndex).length < groupedUploads[groupedId].counter) {
      return;
    }

    const { singleMediaByIndex, localMessages, cancelSendingStatusTimeouts } = groupedUploads[groupedId];
    delete groupedUploads[groupedId];
    const count = Object.values(singleMediaByIndex).length;
const update = await request(
  "messages.sendMultiMedia",
  {
    chat,
    singleMediaByIndex,
    replyInfo,
    isSilent,
    scheduledAt,
    scheduleRepeatPeriod,
    sendAs,
    messagePriceInStars,
    suggestedPostInfo,
    count,
  },
  {
    shouldIgnoreUpdates: true,
  },
);

    if (!update) return;

    Object.values(cancelSendingStatusTimeouts).forEach((cancel) => cancel());
    handleMultipleLocalMessagesUpdate(localMessages, update);
  })();

  return mediaQueue;
}

async function fetchInputMedia(
  peer: GramJs.TypeInputPeer,
  uploadedMedia: GramJs.InputMediaUploadedPhoto | GramJs.InputMediaUploadedDocument,
) {
  const messageMedia = await request(
  "messages.uploadMedia",
  {
    peer,
    uploadedMedia,
  },
);
  const isSpoiler = uploadedMedia.spoiler;

  if ((
    messageMedia instanceof GramJs.MessageMediaPhoto
    && messageMedia.photo
    && messageMedia.photo instanceof GramJs.Photo)
  ) {
    const { photo: { id, accessHash, fileReference } } = messageMedia;

    return new GramJs.InputMediaPhoto({
      id: new GramJs.InputPhoto({ id, accessHash, fileReference }),
      spoiler: isSpoiler,
    });
  }

  if ((
    messageMedia instanceof GramJs.MessageMediaDocument
    && messageMedia.document
    && messageMedia.document instanceof GramJs.Document)
  ) {
    const { document: { id, accessHash, fileReference } } = messageMedia;

    return new GramJs.InputMediaDocument({
      id: new GramJs.InputDocument({ id, accessHash, fileReference }),
      spoiler: isSpoiler,
    });
  }

  return undefined;
}

export async function editMessage({
  chat,
  message,
  text,
  entities,
  attachment,
  noWebPage,
}: {
  chat: ApiChat;
  message: ApiMessage;
  text: string;
  entities?: ApiMessageEntity[];
  attachment?: ApiAttachment;
  noWebPage?: boolean;
}, onProgress?: ApiOnProgress) {
  const isScheduled = message.date * 1000 > getServerTime() * 1000;

  const media = attachment && buildUploadingMedia(attachment);

  const isInvertedMedia = text && !attachment?.shouldSendAsFile ? message.isInvertedMedia : undefined;

  const newContent = {
    ...(media || message.content),
    ...(text && {
      text: {
        text,
        entities,
      },
    }),
  };

  const messageUpdate: ApiMessage = {
    ...message,
    content: newContent,
    isInvertedMedia,
  };

  sendApiUpdate({
    '@type': isScheduled ? 'updateScheduledMessage' : 'updateMessage',
    id: message.id,
    chatId: chat.id,
    message: messageUpdate,
    isFull: true,
  });

  try {
    let mediaUpdate: GramJs.TypeInputMedia | undefined;
    if (attachment) {
      mediaUpdate = await uploadMedia(message, attachment, onProgress!);
    }

    const mtpEntities = entities && entities.map(buildMtpMessageEntity);
await request(
  "messages.editMessage",
  {
    chat,
    message,
    text,
    mtpEntities,
    mediaUpdate,
    isScheduled,
    noWebPage,
    isInvertedMedia,
  },
  {
    shouldThrow: true,
  },
);
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

    // Rollback changes
    sendApiUpdate({
      '@type': isScheduled ? 'updateScheduledMessage' : 'updateMessage',
      id: message.id,
      chatId: chat.id,
      message,
      isFull: true,
    });
  }
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
  await request(
    "messages.editMessageMedia",
    {
      chat,
      message,
      media,
    },
    {
      shouldThrow: true,
    },
  );
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

    // Rollback changes
    sendApiUpdate({
      '@type': 'updateMessage',
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
  await request(
    "messages.appendTodoList",
    {
      chat,
      message,
      todoItems,
    },
    {
      shouldThrow: true,
    },
  );
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
  "messages.editScheduledMessage",
  {
    chat,
    message,
    scheduledAt,
    scheduleRepeatPeriod,
  },
);
}

async function uploadMedia(message: ApiMessage, attachment: ApiAttachment, onProgress: ApiOnProgress) {
  const {
    filename, blobUrl, mimeType, quick, voice, audio, previewBlobUrl, shouldSendAsFile, shouldSendAsSpoiler, ttlSeconds,
  } = attachment;

  const patchedOnProgress: ApiOnProgress = (progress) => {
    if (onProgress.isCanceled) {
      patchedOnProgress.isCanceled = true;
    } else {
      onProgress(progress, getMessageKey(message));
    }
  };

  const fetchAndUpload = async (url: string, progressCallback?: (progress: number) => void) => {
    const file = await fetchFile(url, filename);
    return uploadFile(file, progressCallback);
  };

  const isVideo = SUPPORTED_VIDEO_CONTENT_TYPES.has(mimeType);
  const shouldUploadThumb = audio || isVideo || shouldSendAsFile;

  const [inputFile, thumb] = await Promise.all(compact([
    fetchAndUpload(blobUrl, patchedOnProgress),
    shouldUploadThumb && previewBlobUrl && fetchAndUpload(previewBlobUrl),
  ]));

  const attributes: GramJs.TypeDocumentAttribute[] = [new GramJs.DocumentAttributeFilename({ fileName: filename })];
  if (!shouldSendAsFile) {
    if (quick) {
      if (SUPPORTED_PHOTO_CONTENT_TYPES.has(mimeType) && mimeType !== GIF_MIME_TYPE) {
        return new GramJs.InputMediaUploadedPhoto({
          file: inputFile,
          spoiler: shouldSendAsSpoiler,
        });
      }

      if (isVideo) {
        const { width, height, duration } = quick;
        if (duration !== undefined) {
          attributes.push(new GramJs.DocumentAttributeVideo({
            duration,
            w: width,
            h: height,
            supportsStreaming: true,
          }));
        }
      }
    }

    if (audio) {
      const { duration, title, performer } = audio;
      attributes.push(new GramJs.DocumentAttributeAudio({
        duration,
        title,
        performer,
      }));
    }

    if (voice) {
      const { duration, waveform } = voice;
      const { data: inputWaveform } = interpolateArray(waveform, INPUT_WAVEFORM_LENGTH);
      attributes.push(new GramJs.DocumentAttributeAudio({
        voice: true,
        duration,
        waveform: Uint8Array.from(inputWaveform),
      }));
    }
  }

  return new GramJs.InputMediaUploadedDocument({
    file: inputFile,
    mimeType,
    attributes,
    thumb,
    forceFile: shouldSendAsFile,
    spoiler: shouldSendAsSpoiler,
    ttlSeconds,
  });
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
    "messages.updatePinnedMessage",
    {
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
    "messages.unpinAllMessages",
    {
      chat,
      threadId,
    },
  );

  if (!result) return;

  processAffectedHistory(chat, result);

  if (result.offset) {
    await unpinAllMessages({ chat, threadId });
  }
}
 
export async function deleteMessages({
  chat, messageIds, shouldDeleteForAll,
}: {
  chat: ApiChat; messageIds: number[]; shouldDeleteForAll?: boolean;
}) {
  const isChannel = getEntityTypeById(chat.id) === 'channel';

 const result = await request(
  "messages.deleteMessages",
  {
    chat,
    messageIds,
    isChannel,
    shouldDeleteForAll,
  },
);

  if (!result) {
    return;
  }

  processAffectedHistory(chat, result);

  sendApiUpdate({
    '@type': 'deleteMessages',
    ids: messageIds,
    ...(isChannel && { chatId: chat.id }),
  });
}

export async function deleteParticipantHistory({
  chat, peer, isRepeat = false,
}: {
  chat: ApiChat; peer: ApiPeer; isRepeat?: boolean;
}) {
 const result = await request(
  "channels.deleteParticipantHistory",
  {
    chat,
    peer,
  },
);
  if (!result) {
    return;
  }

  processAffectedHistory(chat, result);

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
  chat, peer, rank,
}: {
  chat: ApiChat;
  peer: ApiPeer;
  rank: string;
}) {
  const participant = buildInputPeer(peer.id, peer.accessHash);

 return request(
  "messages.editChatParticipantRank",
  {
    chat,
    participant: peer,
    rank,
  },
  {
    shouldReturnTrue: true,
  },
);
}

export async function deleteScheduledMessages({
  chat, messageIds,
}: {
  chat: ApiChat; messageIds: number[];
}) {

  await request(
  "messages.deleteScheduledMessages",
  {
    chat,
    messageIds,
  },
);
}

export async function deleteHistory({
  chat, shouldDeleteForAll, maxId,
}: {
  chat: ApiChat; shouldDeleteForAll?: boolean; maxId?: number;
}) {
  const isChannel = getEntityTypeById(chat.id) === 'channel';
  const result = await request(
  isChannel
    ? "channels.deleteHistory"
    : "messages.deleteHistory",
  {
    chat,
    maxId,
    shouldDeleteForAll,
  },
);

  if (!result) {
    return;
  }

  if ('offset' in result) {
    processAffectedHistory(chat, result);

    if (result.offset) {
      await deleteHistory({ chat, shouldDeleteForAll });
      return;
    }
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
  "messages.deleteSavedHistory",
  {
    chat,
  },
);

  if (!result) {
    return;
  }

  processAffectedHistory(chat, result);

  if (result.offset) {
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
  const result = await request(
  "messages.toggleSuggestedPostApproval",
  {
    chat,
    messageId,
    reject,
    scheduleDate,
    rejectComment,
  },
);

  return result;
}

export async function reportMessages({
  peer, messageIds, description, option,
}: {
  peer: ApiPeer; messageIds: number[]; description: string; option: string;
}) {
  try {
   const result = await request(
  "messages.report",
  {
    peer,
    messageIds,
    option,
    description,
  },
  {
    shouldThrow: true,
  },
);
    if (!result) return undefined;

    return { result: buildApiReportResult(result), error: undefined };
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
  peer, chat, messageIds,
}: {
  peer: ApiPeer; chat: ApiChat; messageIds: number[];
}) {
  return request(
  "channels.reportSpam",
  {
    peer,
    chat,
    messageIds,
  },
);
}

export async function sendMessageAction({
  peer, threadId, action,
}: {
  peer: ApiPeer; threadId?: ThreadId; action: ApiSendMessageAction;
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
    const result = await request(
  "messages.setTyping",
  {
    peer,
    threadId,
    action: mtpAction,
  },
  {
    shouldThrow: true,
    abortControllerChatId: peer.id,
    abortControllerThreadId: threadId,
  },
);
    return result;
  } catch (error) {
    // Prevent error from being displayed in UI
  }
  return undefined;
}

export async function markMessageListRead({
  chat, threadId, maxId = 0,
}: {
  chat: ApiChat; threadId: ThreadId; maxId?: number;
}) {
  const isChannel = getEntityTypeById(chat.id) === 'channel';

  if (isChannel && threadId === MAIN_THREAD_ID) {
    if (isChannel && threadId === MAIN_THREAD_ID) {
  await request(
    "channels.readHistory",
    {
      chat,
      maxId,
    },
  );
}
} else if (threadId !== MAIN_THREAD_ID) {
  await request(
    "messages.readDiscussion",
    {
      chat,
      threadId,
      maxId,
    },
  );
} else {
  const result = await request(
    "messages.readHistory",
    {
      chat,
      maxId,
    },
  );

  if (result) {
    processAffectedHistory(chat, result);
  }
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
  chat, messageIds,
}: {
  chat: ApiChat; messageIds: number[];
}) {
  const isChannel = getEntityTypeById(chat.id) === 'channel';

 const result = await request(
  isChannel
    ? "channels.readMessageContents"
    : "messages.readMessageContents",
  {
    chat,
    messageIds,
  },
);
  if (!result) {
    return;
  }

  if (result !== true) {
    processAffectedHistory(chat, result);
  }

  sendApiUpdate({
    ...(isChannel ? {
      '@type': 'updateChannelMessages',
      channelId: chat.id,
    } : {
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
  chat, ids, shouldIncrement,
}: {
  chat: ApiChat;
  ids: number[];
  shouldIncrement?: boolean;
}) {
  const chunks = split(ids, API_GENERAL_ID_LIMIT);
 const results = await Promise.all(
  chunks.map((chunkIds) =>
    request(
      "messages.getMessagesViews",
      {
        chat,
        messageIds: chunkIds,
        shouldIncrement,
      },
    ),
  ),
);

  if (!results || results.some((result) => !result)) return undefined;

  const viewsList = results.flatMap((result) => result!.views);

  const viewsInfo = ids.map((id, index) => {
    const { views, forwards, replies } = viewsList[index];
    return {
      id,
      views,
      forwards,
      threadInfo: replies ? buildApiThreadInfo(chat.id, id, replies) : undefined,
    };
  });

  return {
    viewsInfo,
  };
}

export async function fetchFactChecks({
  chat, ids,
}: {
  chat: ApiChat;
  ids: number[];
}) {
  const chunks = split(ids, API_GENERAL_ID_LIMIT);
 const results = await Promise.all(chunks.map((chunkIds) => (
  request(
    "messages.getFactCheck",
    {
      chat,
      messageIds: chunkIds,
    },
  )
)));

  if (!results || results.some((result) => !result)) return undefined;

  return results.flatMap((result) => result!).map(buildApiFactCheck);
}

export function fetchPaidReactionPrivacy() {
  return request(
    "messages.getPaidReactionPrivacy",
    undefined,
    {
      shouldReturnTrue: true,
    },
  );
}

export function reportMessagesDelivery({
  chat, messageIds,
}: {
  chat: ApiChat;
  messageIds: number[];
}) {
 return request(
  "messages.reportMessagesDelivery",
  {
    chat,
    messageIds,
  },
);
}

export async function fetchDiscussionMessage({
  chat, messageId,
}: {
  chat: ApiChat;
  messageId: number;
}) {
 const [result, replies] = await Promise.all([
  request(
    "messages.getDiscussionMessage",
    {
      chat,
      messageId,
    },
    {
      abortControllerChatId: chat.id,
      abortControllerThreadId: messageId,
    },
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

  const topMessages = result.messages.map(buildApiMessage).filter(Boolean);
  const messages = topMessages.concat(replies.messages);
  const threadId = result.messages[result.messages.length - 1]?.id;

  const chatId = topMessages[0]?.chatId;
  if (!chatId || !threadId) return undefined;

  const { maxId } = result;
  const threadReadState = buildThreadReadState(result);

  const topMessageWithReplies = result.messages.find((message): message is GramJs.Message => (
    message instanceof GramJs.Message && Boolean(message.replies)
  ))!;
  const threadInfo = buildApiThreadInfoFromMessage(topMessageWithReplies);

  return {
    messages,
    topMessages,
    threadId,
    threadReadState,
    threadInfo,
    lastMessageId: maxId,
    chatId: topMessages[0]?.chatId,
    firstMessageId: replies.messages[0]?.id,
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
  let filter;
  switch (type) {
    case 'media':
      filter = new GramJs.InputMessagesFilterPhotoVideo();
      break;
    case 'documents':
      filter = new GramJs.InputMessagesFilterDocument();
      break;
    case 'links':
      filter = new GramJs.InputMessagesFilterUrl();
      break;
    case 'audio':
      filter = new GramJs.InputMessagesFilterMusic();
      break;
    case 'voice':
      filter = new GramJs.InputMessagesFilterRoundVoice();
      break;
    case 'profilePhoto':
      filter = new GramJs.InputMessagesFilterChatPhotos();
      break;
    case 'gif':
      filter = new GramJs.InputMessagesFilterGif();
      break;
    case 'text':
    default: {
      filter = new GramJs.InputMessagesFilterEmpty();
    }
  }

  const inputPeer = buildInputPeer(peer.id, peer.accessHash);
  const inputFromPeer = fromPeer ? buildInputPeer(fromPeer.id, fromPeer.accessHash) : undefined;
const result = await request(
  "messages.search",
  {
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
    fromPeer,
  },
  {
    abortControllerChatId: peer.id,
    abortControllerThreadId: threadId,
  },
);

  if (
    !result
    || result instanceof GramJs.messages.MessagesNotModified
    || !result.messages
  ) {
    return undefined;
  }

  const userStatusesById = buildApiUserStatuses(result.users);
  const messages = result.messages.map(buildApiMessage).filter(Boolean);
  const topics = result.topics.map(buildApiTopicWithState).filter(Boolean);

  let totalCount = messages.length;
  let nextOffsetId: number | undefined;
  if (result instanceof GramJs.messages.MessagesSlice || result instanceof GramJs.messages.ChannelMessages) {
    totalCount = result.count;

    if (messages.length) {
      nextOffsetId = messages[messages.length - 1].id;
    }
  }

  return {
    userStatusesById,
    messages,
    topics,
    totalCount,
    nextOffsetId,
  };
}

export async function searchMessagesGlobal({
  query, offsetRate = 0, offsetPeer, offsetId, limit, type = 'text', minDate, maxDate, context = 'all',
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

  let filter;
  switch (type) {
    case 'media':
      filter = new GramJs.InputMessagesFilterPhotoVideo();
      break;
    case 'documents':
      filter = new GramJs.InputMessagesFilterDocument();
      break;
    case 'links':
      filter = new GramJs.InputMessagesFilterUrl();
      break;
    case 'audio':
      filter = new GramJs.InputMessagesFilterMusic();
      break;
    case 'voice':
      filter = new GramJs.InputMessagesFilterRoundVoice();
      break;
    case 'text':
    default: {
      if (!query && !(maxDate && minDate)) {
        return undefined;
      }

      filter = new GramJs.InputMessagesFilterEmpty();
    }
  }

  const peer = (offsetPeer && buildInputPeer(offsetPeer.id, offsetPeer.accessHash)) || new GramJs.InputPeerEmpty();

  const result = await request(
  "messages.searchGlobal",
  {
    query,
    offsetRate,
    offsetPeer,
    offsetId,
    limit,
    type,
    minDate,
    maxDate,
    context,
  },
);

  if (
    !result
    || result instanceof GramJs.messages.MessagesNotModified
    || !result.messages
  ) {
    return undefined;
  }

  const userStatusesById = buildApiUserStatuses(result.users);
  const messages = result.messages.map(buildApiMessage).filter(Boolean);
  const topics = result.topics.map(buildApiTopicWithState).filter(Boolean);

  let totalCount;
  if (result instanceof GramJs.messages.MessagesSlice || result instanceof GramJs.messages.ChannelMessages) {
    totalCount = result.count;
  } else {
    totalCount = result.messages.length;
  }

  const lastMessage = result.messages[result.messages.length - 1];
  const nextOffsetPeerId = resolveMessageApiChatId(lastMessage);
  const nextOffsetRate = 'nextRate' in result && result.nextRate ? result.nextRate : undefined;
  const nextOffsetId = lastMessage?.id;

  return {
    messages,
    topics,
    userStatusesById,
    totalCount,
    nextOffsetRate,
    nextOffsetPeerId,
    nextOffsetId,
  };
}

export async function searchPublicPosts({
  hashtag, query, offsetRate, offsetPeer, offsetId, limit,
}: {
  hashtag?: string;
  query?: string;
  offsetRate?: number;
  offsetPeer?: ApiPeer;
  offsetId?: number;
  limit?: number;
}): Promise<SearchResults | undefined> {
  const peer = (offsetPeer && buildInputPeer(offsetPeer.id, offsetPeer.accessHash)) || new GramJs.InputPeerEmpty();

  const resultFlood = await checkSearchPostsFlood(query);

  if (!resultFlood) {
    return undefined;
  }

  const result = await request(
  "channels.searchPosts",
  {
    hashtag,
    query,
    offsetRate,
    offsetPeer,
    offsetId,
    limit,
    starsAmount: resultFlood.starsAmount,
  },
);

  if (!result || result instanceof GramJs.messages.MessagesNotModified) {
    return undefined;
  }

  const userStatusesById = buildApiUserStatuses(result.users);
  const messages = result.messages.map(buildApiMessage).filter(Boolean);
  const topics = result.topics.map(buildApiTopicWithState).filter(Boolean);

  let totalCount;
  if (result instanceof GramJs.messages.MessagesSlice || result instanceof GramJs.messages.ChannelMessages) {
    totalCount = result.count;
  } else {
    totalCount = result.messages.length;
  }

  const lastMessage = result.messages[result.messages.length - 1];
  const nextOffsetPeerId = resolveMessageApiChatId(lastMessage);
  const nextOffsetRate = 'nextRate' in result && result.nextRate ? result.nextRate : undefined;
  const nextOffsetId = lastMessage?.id;

  const searchFlood = result instanceof GramJs.messages.MessagesSlice && result.searchFlood
    ? buildApiSearchPostsFlood(result.searchFlood, query)
    : undefined;

  return {
    messages,
    topics,
    userStatusesById,
    totalCount,
    nextOffsetRate,
    nextOffsetPeerId,
    nextOffsetId,
    searchFlood,
  };
}

export async function checkSearchPostsFlood(query?: string) {
  const result = await request(
    "channels.checkSearchPostsFlood",
    {
      query,
    },
  );

  if (!result) {
    return undefined;
  }

  return buildApiSearchPostsFlood(result, query);
}

export async function fetchWebPagePreview({
  text,
}: {
  text: ApiFormattedText;
}) {
  const textWithEntities = buildInputTextWithEntities(text);
 const preview = await request(
  "messages.getWebPagePreview",
  {
    text: textWithEntities.text,
    entities: textWithEntities.entities,
  },
);

  if (!preview) return undefined;

  return buildWebPageFromMedia(preview.media);
}

export async function fetchWebPage({
  url,
  hash = DEFAULT_PRIMITIVES.INT,
}: {
  url: string;
  hash?: number;
}) {
 const result = await request(
  "messages.getWebPage",
  {
    url,
    hash,
  },
  {
    shouldIgnoreErrors: true,
  },
);

if (!result?.webpage) {
  return undefined;
}

return buildWebPage(result.webpage);
}

export async function sendPollVote({
  chat, messageId, options,
}: {
  chat: ApiChat;
  messageId: number;
  options: string[];
}) {
  const { id, accessHash } = chat;

 await request(
  "messages.sendVote",
  {
    chatId: id,
    accessHash,
    messageId,
    options: options.map(deserializeBytes),
  },
);
}

export async function appendPollAnswer({
  chat, messageId, text,
}: {
  chat: ApiChat;
  messageId: number;
  text: string;
}) {
  const { id, accessHash } = chat;

 await request(
  "messages.addPollAnswer",
  {
    peer: {
      id,
      accessHash,
    },
    messageId,
    text,
  },
);
}

export async function toggleTodoCompleted({
  chat, messageId, completedIds, incompletedIds,
}: {
  chat: ApiChat;
  messageId: number;
  completedIds: number[];
  incompletedIds: number[];
}) {
  const { id, accessHash } = chat;

 await request(
  "messages.toggleTodoCompleted",
  {
    peer: {
      id,
      accessHash,
    },
    messageId,
    completedIds,
    incompletedIds,
  },
);
}

export async function closePoll({
  chat, messageId, poll,
}: {
  chat: ApiChat;
  messageId: number;
  poll: ApiMessagePoll;
}) {
  const { id, accessHash } = chat;

  await request(
  "messages.editPoll",
  {
    peer: {
      id,
      accessHash,
    },
    messageId,
    poll,
  },
);
}

export async function loadPollOptionResults({
  chat, messageId, option, offset, limit, shouldResetVoters,
}: {
  chat: ApiChat;
  messageId: number;
  option?: string;
  offset?: string;
  limit?: number;
  shouldResetVoters?: boolean;
}) {
  const { id, accessHash } = chat;

  const result = await request(
  "messages.getPollVotes",
  {
    peer: {
      id,
      accessHash,
    },
    messageId,
    limit,
    option,
    offset,
  },
);

  if (!result) {
    return undefined;
  }

  const votes = result.votes.map((vote) => ({
    peerId: getApiChatIdFromMtpPeer(vote.peer),
    date: vote.date,
  }));

  return {
    count: result.count,
    votes,
    nextOffset: result.nextOffset,
    shouldResetVoters,
  };
}

export async function fetchExtendedMedia({
  chat, ids,
}: {
  chat: ApiChat;
  ids: number[];
}) {
 await request(
  "messages.getExtendedMedia",
  {
    chat,
    ids,
  },
);
}

export function forwardMessagesLocal(params: ForwardMessagesParams) {
  const {
    toChat, toThreadId, messages,
    scheduledAt, scheduleRepeatPeriod, sendAs, noAuthors, noCaptions,
    isCurrentUserPremium, wasDrafted, lastMessageId, effectId,
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
    fromChat, toChat, toThreadId, isSilent,
    scheduledAt, scheduleRepeatPeriod, sendAs, withMyScore, noAuthors, noCaptions,
    forwardedLocalMessagesSlice, messagePriceInStars, effectId,
  } = params;

  if (!forwardedLocalMessagesSlice) return;

  const {
    messageIds, localMessages,
  } = forwardedLocalMessagesSlice;

  const priceInStars = messagePriceInStars ? messagePriceInStars * messageIds.length : undefined;

  const randomIds = messageIds.map(() => generateRandomBigInt());
  try {
    const update = await request(
  "messages.forwardMessages",
  {
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
  },
);
    const messagesForUpdate: Record<string, ApiMessage> = {};
    localMessages.forEach((message, index) => {
      messagesForUpdate[randomIds[index].toString()] = message;
    });
    if (update) handleMultipleLocalMessagesUpdate(messagesForUpdate, update);
  } catch (error: any) {
    Object.values(localMessages).forEach((localMessage) => {
      sendApiUpdate({
        '@type': localMessage.isScheduled ? 'updateScheduledMessageSendFailed' : 'updateMessageSendFailed',
        chatId: toChat.id,
        localId: localMessage.id,
        error: error.errorMessage,
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
  "messages.getHistory",
  {
    chat,
    timestamp,
    addOffset: -1,
    limit: 1,
  },
);

  if (
    !result
    || result instanceof GramJs.messages.MessagesNotModified
    || !result.messages || !result.messages.length
  ) {
    return undefined;
  }

  return result.messages[0].id;
}

export async function fetchScheduledHistory({ chat }: { chat: ApiChat }) {
  const { id, accessHash } = chat;

  const result = await request(
  "messages.getScheduledHistory",
  {
    peer: {
      id,
      accessHash,
    },
  },
  {
    abortControllerChatId: id,
  },
);
  if (
    !result
    || result instanceof GramJs.messages.MessagesNotModified
    || !result.messages
  ) {
    return undefined;
  }

  const messages = result.messages.map(buildApiMessage).filter(Boolean);

  return {
    messages,
  };
}

export async function sendScheduledMessages({ chat, ids }: { chat: ApiChat; ids: number[] }) {
  const { id, accessHash } = chat;

  await request(
  "messages.sendScheduledMessages",
  {
    peer: {
      id,
      accessHash,
    },
    ids,
  },
);
}

export async function fetchPinnedMessages({ chat, threadId }: { chat: ApiChat; threadId: ThreadId }) {
 const result = await request(
  "messages.searchPinned",
  {
    chat,
    threadId,
    limit: PINNED_MESSAGES_LIMIT,
  },
  {
    abortControllerChatId: chat.id,
    abortControllerThreadId: threadId,
  },
);
  if (
    !result
    || result instanceof GramJs.messages.MessagesNotModified
    || !result.messages
  ) {
    return undefined;
  }

  const messages = result.messages.map(buildApiMessage).filter(Boolean);

  return {
    messages,
  };
}

export async function fetchSeenBy({ chat, messageId }: { chat: ApiChat; messageId: number }) {
  const result = await request(
  "messages.getMessageReadParticipants",
  {
    chat,
    messageId,
  },
);

  return result
    ? result.reduce((acc, readDate) => {
      acc[readDate.userId.toString()] = readDate.date;

      return acc;
    }, {} as Record<string, number>)
    : undefined;
}

export async function fetchSendAs({
  chat,
  isForPaidReactions,
}: {
  isForPaidReactions?: true;
  chat: ApiChat;
}) {
  const result = await request(
  "channels.getSendAs",
  {
    chat,
    isForPaidReactions,
  },
  {
    shouldIgnoreErrors: true,
    abortControllerChatId: chat.id,
  },
);

  if (!result) {
    return undefined;
  }

  return result.peers.map(buildApiSendAsPeerId);
}

export function saveDefaultSendAs({
  sendAs, chat,
}: {
  sendAs: ApiPeer; chat: ApiChat;
}) {
 return request(
  "messages.saveDefaultSendAs",
  {
    chat,
    sendAs,
  },
);
}

export async function fetchSponsoredMessages({ peer }: { peer: ApiPeer }) {
  const result = await request(
  "messages.getSponsoredMessages",
  {
    peer,
  },
);

  if (!result || result instanceof GramJs.messages.SponsoredMessagesEmpty || !result.messages.length) {
    return undefined;
  }

  const messages = result.messages
    .map((message) => buildApiSponsoredMessage(message, peer.id))
    .filter(Boolean);

  return {
    messages,
  };
}

export async function viewSponsoredMessage({ random }: { random: string }) {
 await request(
  "messages.viewSponsoredMessage",
  {
    random: deserializeBytes(random),
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
  "messages.clickSponsoredMessage",
  {
    random: deserializeBytes(random),
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
  "messages.reportSponsoredMessage",
  {
    randomId: deserializeBytes(randomId),
    option: deserializeBytes(option),
  },
  {
    shouldThrow: true,
  },
);

    if (!result) {
      return undefined;
    }

    return buildApiSponsoredMessageReportResult(result);
  } catch (err: unknown) {
    if (err instanceof RPCError && err.errorMessage === 'PREMIUM_ACCOUNT_REQUIRED') {
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
  "messages.readMentions",
  {
    chat,
    threadId,
  },
);

  if (!result) return;

  processAffectedHistory(chat, result);

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
  "messages.readReactions",
  {
    chat,
    threadId,
  },
);

  if (!result) return;

  processAffectedHistory(chat, result);

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
  "messages.readPollVotes",
  {
    chat,
    threadId,
  },
);

  if (!result) return;

  processAffectedHistory(chat, result);

  if (result.offset) {
    await readAllPollVotes({ chat, threadId });
  }
}

export async function fetchUnreadMentions({
  chat, threadId, offsetId, addOffset, maxId, minId,
}: {
  chat: ApiChat;
  threadId?: ThreadId;
  offsetId?: number;
  addOffset?: number;
  maxId?: number;
  minId?: number;
}) {
  const result = await request(
  "messages.getUnreadMentions",
  {
    chat,
    threadId,
    limit: MENTION_UNREAD_SLICE,
    offsetId,
    addOffset,
    maxId,
    minId,
  },
);

  if (
    !result
    || result instanceof GramJs.messages.MessagesNotModified
    || !result.messages
  ) {
    return undefined;
  }

  const totalCount = 'count' in result ? result.count : result.messages.length;
  const messages = result.messages.map(buildApiMessage).filter(Boolean);
  const topics = result.topics.map(buildApiTopicWithState).filter(Boolean);

  return {
    totalCount,
    messages,
    topics,
  };
}

export async function fetchUnreadReactions({
  chat, threadId, offsetId, addOffset, maxId, minId,
}: {
  chat: ApiChat;
  threadId?: ThreadId;
  offsetId?: number;
  addOffset?: number;
  maxId?: number;
  minId?: number;
}) {
 const result = await request(
  "messages.getUnreadReactions",
  {
    chat,
    threadId,
    limit: REACTION_UNREAD_SLICE,
    offsetId,
    addOffset,
    maxId,
    minId,
  },
);
  if (
    !result
    || result instanceof GramJs.messages.MessagesNotModified
    || !result.messages
  ) {
    return undefined;
  }

  const totalCount = 'count' in result ? result.count : result.messages.length;
  const messages = result.messages.map(buildApiMessage).filter(Boolean);
  const topics = result.topics.map(buildApiTopicWithState).filter(Boolean);

  return {
    totalCount,
    messages,
    topics,
  };
}

export async function fetchUnreadPollVotes({
  chat, threadId, offsetId, addOffset, maxId, minId,
}: {
  chat: ApiChat;
  threadId?: ThreadId;
  offsetId?: number;
  addOffset?: number;
  maxId?: number;
  minId?: number;
}) {
  const result = await request(
  "messages.getUnreadPollVotes",
  {
    chat,
    threadId,
    limit: POLL_UNREAD_SLICE,
    offsetId,
    addOffset,
    maxId,
    minId,
  },
);

  if (
    !result
    || result instanceof GramJs.messages.MessagesNotModified
    || !result.messages
  ) {
    return undefined;
  }

  const totalCount = 'count' in result ? result.count : result.messages.length;
  const messages = result.messages.map(buildApiMessage).filter(Boolean);
  const topics = result.topics.map(buildApiTopicWithState).filter(Boolean);

  return {
    totalCount,
    messages,
    topics,
  };
}

export async function transcribeAudio({
  chat, messageId,
}: {
  chat: ApiChat; messageId: number;
}) {
  const result = await request(
  "messages.transcribeAudio",
  {
    chat,
    messageId,
  },
);

  if (!result) return undefined;

  sendApiUpdate({
    '@type': 'updateTranscribedAudio',
    isPending: result.pending,
    transcriptionId: result.transcriptionId.toString(),
    text: result.text,
  });

  return result.transcriptionId.toString();
}

export async function translateText(params: TranslateTextParams) {
  let result;
  const isMessageTranslation = 'chat' in params;
  const { toLanguageCode, tone } = params;
  const apiTone = tone === 'neutral' ? undefined : tone;

  if (isMessageTranslation) {
    const { chat, messageIds } = params;

   result = await request(
  "messages.translateText",
  {
    chat,
    messageIds,
    toLanguageCode,
    apiTone,
  },
);
  } else {
   const { text } = params;

result = await request(
  "messages.translateText",
  {
    text,
    toLanguageCode,
    apiTone,
  },
);
  }

  if (!result) {
    if (isMessageTranslation) {
      sendApiUpdate({
        '@type': 'failedMessageTranslations',
        chatId: params.chat.id,
        messageIds: params.messageIds,
        toLanguageCode: params.toLanguageCode,
        tone,
      });
    }
    return undefined;
  }

  const formattedText = result.result.map((r) => buildApiFormattedText(r));

  if (isMessageTranslation) {
    sendApiUpdate({
      '@type': 'updateMessageTranslations',
      chatId: params.chat.id,
      messageIds: params.messageIds,
      translations: formattedText,
      toLanguageCode: params.toLanguageCode,
      tone,
    });
  }

  return formattedText;
}

export async function fetchMessageSummary({
  chat, id, toLanguageCode, tone,
}: {
  chat: ApiChat; id: number; toLanguageCode?: string; tone?: string;
}) {
 const result = await request(
  "messages.summarizeText",
  {
    chat,
    id,
    toLanguageCode,
    tone,
  },
);
  if (!result) return undefined;

  return buildApiFormattedText(result);
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

export async function fetchOutboxReadDate({ chat, messageId }: { chat: ApiChat; messageId: number }) {
  const { id, accessHash } = chat;
  const peer = buildInputPeer(id, accessHash);

 const result = await request(
  "messages.getOutboxReadDate",
  {
    peer,
    messageId,
  },
  {
    shouldThrow: true,
  },
);
  if (!result) return undefined;

  return { date: result.date };
}

export async function fetchQuickReplies() {
 const result = await request(
  "messages.getQuickReplies",
  {},
);
  if (!result || result instanceof GramJs.messages.QuickRepliesNotModified) return undefined;

  const messages = result.messages.map(buildApiMessage).filter(Boolean);

  const quickReplies = result.quickReplies.map(buildApiQuickReply);

  return {
    messages,
    quickReplies,
  };
}

export async function sendQuickReply({
  chat,
  shortcutId,
}: {
  chat: ApiChat;
  shortcutId: number;
}) {
  // Remove this request when the client fully supports quick replies and caches them
 const messages = await request(
  "messages.getQuickReplyMessages",
  {
    shortcutId,
  },
);
  if (!messages || messages instanceof GramJs.messages.MessagesNotModified) return;

  const ids = messages.messages.map((m) => m.id);
  const randomIds = ids.map(() => generateRandomBigInt());

 const result = await request(
  "messages.sendQuickReplyMessages",
  {
    chat,
    shortcutId,
    ids,
    randomIds,
  },
  {
    shouldIgnoreUpdates: true,
  },
);

  if (!result) return;

  // Hack to prevent client from thinking that those messages were local
  if ('updates' in result) {
    const filteredUpdates = result.updates
      .filter((u): u is GramJs.UpdateMessageID => !(u instanceof GramJs.UpdateMessageID));
    result.updates = filteredUpdates;
  }

  handleGramJsUpdate(result);
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
