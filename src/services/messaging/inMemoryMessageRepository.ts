/*
 * In-memory versions of the Messaging Service dependencies. Tests use them, and the app uses
 * them until the Data Access Layer (Chuan) provides the real repositories. Data is lost when
 * the server stops.
 */
import type {
  ConversationPage,
  ConversationSummary,
  FavoritesReader,
  MessageNotifier,
  MessageRepository,
  UnreadPage,
  UserReader,
} from "./messageRepository";
import {
  compareMessageKeys,
  type NewMessage,
  type StoredMessage,
  type UserSummary,
} from "./messagingTypes";

const MESSAGE_ID_PREFIX = "msg_";
const MESSAGE_ID_DIGITS = 6;

function copyMessage(message: StoredMessage): StoredMessage {
  return { ...message };
}

function newestFirst(a: StoredMessage, b: StoredMessage): number {
  return compareMessageKeys(b, a);
}

function isBetween(message: StoredMessage, userA: string, userB: string): boolean {
  const isAToB = message.senderId === userA && message.receiverId === userB;
  const isBToA = message.senderId === userB && message.receiverId === userA;
  return isAToB || isBToA;
}

function isUnreadFor(message: StoredMessage, receiverId: string): boolean {
  return message.receiverId === receiverId && message.readAt === null;
}

function selectConversationPage(
  messages: StoredMessage[],
  page: ConversationPage,
): StoredMessage[] {
  const { before, after, limit } = page;
  if (after !== undefined) {
    const newer = messages
      .filter((message) => compareMessageKeys(message, after) > 0)
      .sort(compareMessageKeys)
      .slice(0, limit);
    return newer.sort(newestFirst);
  }
  return messages
    .filter((message) => before === undefined || compareMessageKeys(message, before) < 0)
    .sort(newestFirst)
    .slice(0, limit);
}

/**
 * Create an empty in-memory message store. IDs are `msg_000001`, `msg_000002` and so on, so
 * their text order is the order they were stored in.
 * @returns a MessageRepository that keeps everything in memory
 */
export function createInMemoryMessageRepository(): MessageRepository {
  const messages: StoredMessage[] = [];
  let lastNumber = 0;

  function countUnreadFrom(senderId: string, receiverId: string): number {
    return messages.filter(
      (message) => message.senderId === senderId && isUnreadFor(message, receiverId),
    ).length;
  }

  return {
    async insertMessage(message: NewMessage) {
      lastNumber += 1;
      const messageId = `${MESSAGE_ID_PREFIX}${String(lastNumber).padStart(MESSAGE_ID_DIGITS, "0")}`;
      const stored: StoredMessage = { ...message, messageId, readAt: null };
      messages.push(stored);
      return copyMessage(stored);
    },

    async findMessageById(messageId) {
      const found = messages.find((message) => message.messageId === messageId);
      return found === undefined ? null : copyMessage(found);
    },

    async findMessagesByIds(messageIds) {
      const wanted = new Set(messageIds);
      return messages.filter((message) => wanted.has(message.messageId)).map(copyMessage);
    },

    async listConversationMessages(userA, userB, page) {
      const conversation = messages.filter((message) => isBetween(message, userA, userB));
      return selectConversationPage(conversation, page).map(copyMessage);
    },

    async listUnreadForReceiver(receiverId, page: UnreadPage) {
      const { before, limit } = page;
      return messages
        .filter((message) => isUnreadFor(message, receiverId))
        .filter((message) => before === undefined || compareMessageKeys(message, before) < 0)
        .sort(newestFirst)
        .slice(0, limit)
        .map(copyMessage);
    },

    async listConversationSummaries(userId) {
      const lastByPartner = new Map<string, StoredMessage>();
      for (const message of messages) {
        const isMine = message.senderId === userId || message.receiverId === userId;
        if (!isMine) {
          continue;
        }
        const partner = message.senderId === userId ? message.receiverId : message.senderId;
        const current = lastByPartner.get(partner);
        if (current === undefined || compareMessageKeys(message, current) > 0) {
          lastByPartner.set(partner, message);
        }
      }
      const summaries: ConversationSummary[] = [];
      for (const [otherUserId, lastMessage] of lastByPartner) {
        summaries.push({
          otherUserId,
          lastMessage: copyMessage(lastMessage),
          unreadCount: countUnreadFrom(otherUserId, userId),
        });
      }
      return summaries;
    },

    async markConversationRead(readerId, otherUserId, readAt) {
      for (const message of messages) {
        const isFromOther = message.senderId === otherUserId && message.receiverId === readerId;
        if (isFromOther && message.readAt === null) {
          message.readAt = readAt;
        }
      }
      return countUnreadFrom(otherUserId, readerId);
    },
  };
}

/**
 * Create a favorites reader from a fixed map.
 * @param favoritesByUser - for each user ID, the IDs of their favorites
 * @returns a FavoritesReader that reads the map
 */
export function createInMemoryFavoritesReader(
  favoritesByUser: Record<string, string[]> = {},
): FavoritesReader {
  return {
    async listFavoriteUserIds(userId) {
      return [...(favoritesByUser[userId] ?? [])];
    },
  };
}

/**
 * Create a user reader from a fixed list.
 * @param users - the users that exist
 * @returns a UserReader that leaves out unknown IDs
 */
export function createInMemoryUserReader(users: UserSummary[] = []): UserReader {
  const byId = new Map(users.map((user) => [user.userId, user]));
  return {
    async findUserSummaries(userIds) {
      return userIds.flatMap((userId) => {
        const user = byId.get(userId);
        return user === undefined ? [] : [{ ...user }];
      });
    },
  };
}

/** A notifier that does nothing, used until real time messages exist. */
export const noopMessageNotifier: MessageNotifier = {
  async messageSent() {},
};
