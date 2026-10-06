/*
 * Messaging Service: send, reply, chat list, conversation, unread list and mark as read. It
 * follows the team functional test plan and docs/api-contract.md (Messaging section), and reads
 * and writes data only through the interfaces in messageRepository.ts. Messages are text only.
 * Opening a conversation and the mark as read call both mark every message from the other user
 * as read.
 */
import { ApiError, ERROR_CODES } from "../../plugins/errors";
import type {
  FavoritesReader,
  MessageNotifier,
  MessageRepository,
  UserReader,
} from "./messageRepository";
import { noopMessageNotifier } from "./inMemoryMessageRepository";
import {
  compareMessageKeys,
  type ConversationRow,
  type Message,
  type StoredMessage,
  type UnreadMessage,
  type UserSummary,
} from "./messagingTypes";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;

/** Longest message text, counted in Unicode code points after trimming (docs/decisions.md). */
export const MAX_MESSAGE_LENGTH = 1000;
/** Smallest and largest `limit` for the message lists. */
export const MIN_LIMIT = 1;
export const MAX_LIMIT = 100;
/** Default page sizes from the contract. */
export const DEFAULT_CONVERSATION_LIMIT = 30;
export const DEFAULT_UNREAD_LIMIT = 50;
/** One extra message is read to know if there is another page. */
const LOOKAHEAD = 1;

/** What the app sent to Send Message. */
export interface SendMessageInput {
  text: string;
  /** The message this one answers. It must be a message between the two users. */
  replyToMessageId?: string;
}

/** Paging for one conversation. */
export interface ConversationQuery {
  before?: string;
  after?: string;
  limit?: number;
}

/** Paging for the unread list. */
export interface UnreadQuery {
  before?: string;
  limit?: number;
}

/** What the Messaging routes call. Every method throws ApiError for a broken rule. */
export interface MessagingService {
  sendMessage(senderId: string, receiverId: string, input: SendMessageInput): Promise<Message>;
  replyToMessage(userId: string, messageId: string, text: string): Promise<Message>;
  getChatList(userId: string): Promise<{ conversations: ConversationRow[] }>;
  getConversation(
    userId: string,
    otherUserId: string,
    query: ConversationQuery,
  ): Promise<{ messages: Message[]; hasMore: boolean }>;
  getUnreadMessages(
    userId: string,
    query: UnreadQuery,
  ): Promise<{ messages: UnreadMessage[]; hasMore: boolean }>;
  markConversationRead(
    userId: string,
    otherUserId: string,
  ): Promise<{ userId: string; unreadCount: number }>;
}

/** Parts the Messaging Service needs. `notifier` and `now` are replaceable in tests. */
export interface MessagingServiceOptions {
  messages: MessageRepository;
  favorites: FavoritesReader;
  users: UserReader;
  notifier?: MessageNotifier;
  now?: () => Date;
}

function invalidInput(field: string, message: string): ApiError {
  return new ApiError(HTTP_BAD_REQUEST, ERROR_CODES.invalidInput, message, field);
}

function messageNotFound(): ApiError {
  return new ApiError(HTTP_NOT_FOUND, ERROR_CODES.messageNotFound, "That message does not exist.");
}

/**
 * Trim the text and check its length.
 * @param text - the text the app sent
 * @returns the trimmed text
 * @throws ApiError 400 INVALID_INPUT (field `text`) when it is empty or too long
 */
export function validateMessageText(text: string): string {
  const trimmed = text.trim();
  if (trimmed === "") {
    throw invalidInput("text", "The message text cannot be empty.");
  }
  if ([...trimmed].length > MAX_MESSAGE_LENGTH) {
    throw invalidInput(
      "text",
      `The message text can have at most ${MAX_MESSAGE_LENGTH} characters.`,
    );
  }
  return trimmed;
}

/**
 * Check a page size and apply the default.
 * @param limit - the value the app sent, or undefined
 * @param defaultLimit - the value to use when the app sent none
 * @returns the page size to use
 * @throws ApiError 400 INVALID_INPUT (field `limit`) when it is not a whole number from 1 to 100
 */
export function resolveLimit(limit: number | undefined, defaultLimit: number): number {
  if (limit === undefined) {
    return defaultLimit;
  }
  if (!Number.isInteger(limit) || limit < MIN_LIMIT || limit > MAX_LIMIT) {
    throw invalidInput("limit", `limit must be a whole number from ${MIN_LIMIT} to ${MAX_LIMIT}.`);
  }
  return limit;
}

function isParticipant(message: StoredMessage, userId: string): boolean {
  return message.senderId === userId || message.receiverId === userId;
}

function isBetween(message: StoredMessage, userA: string, userB: string): boolean {
  return isParticipant(message, userA) && isParticipant(message, userB);
}

function assertNotSelf(userId: string, otherUserId: string, action: string): void {
  if (userId === otherUserId) {
    throw invalidInput("userId", `You cannot ${action} yourself.`);
  }
}

/**
 * Build the public message.
 * @param message - the stored message
 * @param original - the message it replies to, if it is a reply and that message exists
 * @returns the message as the app receives it, with `sentAt` as a UTC ISO 8601 string
 */
export function toPublicMessage(message: StoredMessage, original?: StoredMessage): Message {
  return {
    messageId: message.messageId,
    senderId: message.senderId,
    receiverId: message.receiverId,
    text: message.text,
    sentAt: message.sentAt.toISOString(),
    isRead: message.readAt !== null,
    replyTo:
      original === undefined
        ? null
        : { messageId: original.messageId, senderId: original.senderId, text: original.text },
  };
}

/**
 * Create the Messaging Service.
 * @param options - the repository, the readers, and optional notifier and clock
 * @returns the service
 */
export function createMessagingService(options: MessagingServiceOptions): MessagingService {
  const { messages, favorites, users } = options;
  const notifier = options.notifier ?? noopMessageNotifier;
  const now = options.now ?? (() => new Date());

  async function findUser(userId: string): Promise<UserSummary> {
    const [user] = await users.findUserSummaries([userId]);
    if (user === undefined) {
      throw new ApiError(HTTP_NOT_FOUND, ERROR_CODES.userNotFound, "That user does not exist.");
    }
    return user;
  }

  async function findOwnMessage(userId: string, messageId: string): Promise<StoredMessage> {
    const message = await messages.findMessageById(messageId);
    if (message === null || !isParticipant(message, userId)) {
      throw messageNotFound();
    }
    return message;
  }

  async function findReplyTarget(
    senderId: string,
    receiverId: string,
    replyToMessageId: string,
  ): Promise<StoredMessage> {
    const original = await findOwnMessage(senderId, replyToMessageId);
    if (!isBetween(original, senderId, receiverId)) {
      throw invalidInput(
        "replyToMessageId",
        "replyToMessageId must be a message in this conversation.",
      );
    }
    return original;
  }

  async function findCursor(
    field: string,
    messageId: string | undefined,
    belongs: (message: StoredMessage) => boolean,
  ): Promise<StoredMessage | undefined> {
    if (messageId === undefined) {
      return undefined;
    }
    const message = await messages.findMessageById(messageId);
    if (message === null || !belongs(message)) {
      throw invalidInput(field, `${field} must be the ID of a message in this list.`);
    }
    return message;
  }

  async function withReplies(stored: StoredMessage[]): Promise<Message[]> {
    const originalIds = stored.flatMap((message) =>
      message.replyToMessageId === null ? [] : [message.replyToMessageId],
    );
    const originals = originalIds.length === 0 ? [] : await messages.findMessagesByIds(originalIds);
    const byId = new Map(originals.map((message) => [message.messageId, message]));
    return stored.map((message) =>
      toPublicMessage(
        message,
        message.replyToMessageId === null ? undefined : byId.get(message.replyToMessageId),
      ),
    );
  }

  async function storeAndNotify(
    senderId: string,
    receiverId: string,
    text: string,
    original: StoredMessage | undefined,
  ): Promise<Message> {
    const stored = await messages.insertMessage({
      senderId,
      receiverId,
      text,
      sentAt: now(),
      replyToMessageId: original === undefined ? null : original.messageId,
    });
    await notifier.messageSent(stored);
    return toPublicMessage(stored, original);
  }

  return {
    async sendMessage(senderId, receiverId, input) {
      const text = validateMessageText(input.text);
      assertNotSelf(senderId, receiverId, "send a message to");
      await findUser(receiverId);
      const original =
        input.replyToMessageId === undefined
          ? undefined
          : await findReplyTarget(senderId, receiverId, input.replyToMessageId);
      return storeAndNotify(senderId, receiverId, text, original);
    },

    async replyToMessage(userId, messageId, rawText) {
      const original = await findOwnMessage(userId, messageId);
      const text = validateMessageText(rawText);
      const receiverId = original.senderId === userId ? original.receiverId : original.senderId;
      return storeAndNotify(userId, receiverId, text, original);
    },

    async getChatList(userId) {
      const summaries = await messages.listConversationSummaries(userId);
      const favoriteIds = new Set(await favorites.listFavoriteUserIds(userId));
      const partners = await users.findUserSummaries(summaries.map((row) => row.otherUserId));
      const partnerById = new Map(partners.map((user) => [user.userId, user]));

      const conversations = summaries.flatMap((summary): ConversationRow[] => {
        const user = partnerById.get(summary.otherUserId);
        if (user === undefined) {
          return [];
        }
        const last = summary.lastMessage;
        return [
          {
            user,
            isFavorite: favoriteIds.has(summary.otherUserId),
            lastMessage: {
              messageId: last.messageId,
              senderId: last.senderId,
              text: last.text,
              sentAt: last.sentAt.toISOString(),
            },
            unreadCount: summary.unreadCount,
          },
        ];
      });
      return { conversations: conversations.sort(compareChatRows) };
    },

    async getConversation(userId, otherUserId, query) {
      const limit = resolveLimit(query.limit, DEFAULT_CONVERSATION_LIMIT);
      assertNotSelf(userId, otherUserId, "open a conversation with");
      if (query.before !== undefined && query.after !== undefined) {
        throw invalidInput("after", "Send before or after, not both.");
      }
      await findUser(otherUserId);
      const inThisConversation = (message: StoredMessage) =>
        isBetween(message, userId, otherUserId);
      const before = await findCursor("before", query.before, inThisConversation);
      const after = await findCursor("after", query.after, inThisConversation);

      // Opening a conversation reads it. This runs only after every check passed, and before
      // the page is read, so the answer already shows the messages as read.
      await messages.markConversationRead(userId, otherUserId, now());
      const page = await messages.listConversationMessages(userId, otherUserId, {
        before,
        after,
        limit: limit + LOOKAHEAD,
      });
      const hasMore = page.length > limit;
      const kept = dropLookahead(page, limit, after !== undefined);
      return { messages: await withReplies(kept), hasMore };
    },

    async getUnreadMessages(userId, query) {
      const limit = resolveLimit(query.limit, DEFAULT_UNREAD_LIMIT);
      const before = await findCursor(
        "before",
        query.before,
        (message) => message.receiverId === userId,
      );
      const page = await messages.listUnreadForReceiver(userId, {
        before,
        limit: limit + LOOKAHEAD,
      });
      const hasMore = page.length > limit;
      const kept = page.slice(0, limit);
      const senders = await users.findUserSummaries([...new Set(kept.map((m) => m.senderId))]);
      const senderById = new Map(senders.map((user) => [user.userId, user]));
      const unread = kept.flatMap((message): UnreadMessage[] => {
        const sender = senderById.get(message.senderId);
        return sender === undefined
          ? []
          : [
              {
                messageId: message.messageId,
                sender,
                text: message.text,
                sentAt: message.sentAt.toISOString(),
              },
            ];
      });
      return { messages: unread, hasMore };
    },

    async markConversationRead(userId, otherUserId) {
      assertNotSelf(userId, otherUserId, "mark a conversation with");
      await findUser(otherUserId);
      const unreadCount = await messages.markConversationRead(userId, otherUserId, now());
      return { userId: otherUserId, unreadCount };
    },
  };
}

/**
 * Remove the extra message that was read only to know if there is another page. The page is
 * newest first. With `after` the extra message is the newest one, otherwise the oldest one.
 */
function dropLookahead(
  page: StoredMessage[],
  limit: number,
  isAfterPage: boolean,
): StoredMessage[] {
  if (page.length <= limit) {
    return page;
  }
  return isAfterPage ? page.slice(page.length - limit) : page.slice(0, limit);
}

/**
 * Chat list order: favorites first, then the newest last message first. Two rows with the same
 * time are ordered by the larger message ID first, so the order is always the same.
 */
function compareChatRows(a: ConversationRow, b: ConversationRow): number {
  if (a.isFavorite !== b.isFavorite) {
    return a.isFavorite ? -1 : 1;
  }
  const keyA = { sentAt: new Date(a.lastMessage.sentAt), messageId: a.lastMessage.messageId };
  const keyB = { sentAt: new Date(b.lastMessage.sentAt), messageId: b.lastMessage.messageId };
  return compareMessageKeys(keyB, keyA);
}
