/*
 * What the Messaging Service needs from other components. Proposed, Chuan to confirm: the
 * Data Access Layer (Chuan) will provide the real MessageRepository, FavoritesReader and
 * UserReader. Until then the in-memory versions in inMemoryMessageRepository.ts are used.
 */
import type { MessageKey, NewMessage, StoredMessage, UserSummary } from "./messagingTypes";

/** Paging options for one conversation. Never send `before` and `after` together. */
export interface ConversationPage {
  /** Only messages older than this position. */
  before?: MessageKey;
  /** Only messages newer than this position. The ones closest to it are returned first. */
  after?: MessageKey;
  /** Largest number of messages to return. */
  limit: number;
}

/** Paging options for the unread list. */
export interface UnreadPage {
  /** Only messages older than this position. */
  before?: MessageKey;
  /** Largest number of messages to return. */
  limit: number;
}

/** One chat partner of a user, as the repository groups it. */
export interface ConversationSummary {
  otherUserId: string;
  /** The newest message in either direction. */
  lastMessage: StoredMessage;
  /** Messages from the other user to me that are not read. */
  unreadCount: number;
}

/** Reads and writes messages. Proposed, Chuan to confirm. */
export interface MessageRepository {
  /**
   * Store a new message.
   * @param message - the message data; the repository creates the ID
   * @returns the stored message, not read
   */
  insertMessage(message: NewMessage): Promise<StoredMessage>;

  /**
   * Find one message.
   * @param messageId - the message ID
   * @returns the message, or null if there is none
   */
  findMessageById(messageId: string): Promise<StoredMessage | null>;

  /**
   * Find several messages, for example the originals of replies.
   * @param messageIds - the message IDs
   * @returns the messages that exist, in any order
   */
  findMessagesByIds(messageIds: string[]): Promise<StoredMessage[]>;

  /**
   * List the messages between two users. Only messages sent between these two users appear.
   * @param userA - one user of the conversation
   * @param userB - the other user
   * @param page - cursor and limit
   * @returns up to `limit` messages, newest first. With `after`, they are the messages just
   *   after that position.
   */
  listConversationMessages(
    userA: string,
    userB: string,
    page: ConversationPage,
  ): Promise<StoredMessage[]>;

  /**
   * List messages sent to a user that are not read.
   * @param receiverId - the user the messages were sent to
   * @param page - cursor and limit
   * @returns up to `limit` messages, newest first
   */
  listUnreadForReceiver(receiverId: string, page: UnreadPage): Promise<StoredMessage[]>;

  /**
   * Group a user's messages by chat partner.
   * @param userId - the user whose chat list this is
   * @returns one summary per user with at least one message in either direction, in any order
   */
  listConversationSummaries(userId: string): Promise<ConversationSummary[]>;

  /**
   * Mark as read every unread message from `otherUserId` to `readerId`. Messages the reader
   * sent, and messages of other conversations, are not touched.
   * @param readerId - the user who read the messages
   * @param otherUserId - the sender of the messages
   * @param readAt - the time to store
   * @returns how many messages from `otherUserId` to `readerId` are still unread
   */
  markConversationRead(readerId: string, otherUserId: string, readAt: Date): Promise<number>;
}

/** Reads favorites, for the chat list order. Proposed, Chuan to confirm. */
export interface FavoritesReader {
  /**
   * @param userId - the user whose favorites to read
   * @returns the IDs of the users this user marked as favorite
   */
  listFavoriteUserIds(userId: string): Promise<string[]>;
}

/** Reads public user data. Proposed, Chuan to confirm. */
export interface UserReader {
  /**
   * @param userIds - the users to look up
   * @returns a summary for each user that exists, in any order; unknown IDs are left out
   */
  findUserSummaries(userIds: string[]): Promise<UserSummary[]>;
}

/**
 * Called after a message is stored. It does nothing for now; a WebSocket push can use it in a
 * later sprint (docs/decisions.md, "Real time messages").
 */
export interface MessageNotifier {
  /**
   * @param message - the message that was just stored
   */
  messageSent(message: StoredMessage): Promise<void>;
}
