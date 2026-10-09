/*
 * Favorites & Notes Service: pin or unpin users, and keep private notes about them. Favorites
 * and notes belong to the logged in user; no one else can read them (docs/api-contract.md,
 * Favorites and Notes sections). Handlers pass the logged in user's ID, and the service checks
 * the rules.
 */
import { ApiError, ERROR_CODES } from "../../plugins/errors";
import type { UserReader } from "../messaging/messageRepository";
import type { UserSummary } from "../messaging/messagingTypes";
import type {
  FavoritesRepository,
  NotePersonSummary,
  NotesRepository,
  StoredNote,
} from "./favoritesNotesRepository";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;

/** Longest note, counted in Unicode code points after trimming (test plan A7, team 6 Oct). */
export const MAX_NOTE_LENGTH = 500;

/** One favorite as sent to the app. */
export interface FavoriteItem {
  user: UserSummary;
  createdAt: string;
}

/** The answer to adding a favorite. */
export interface AddedFavorite {
  userId: string;
  createdAt: string;
}

/** One note as sent to the app (`Note` in the contract). */
export interface NoteItem {
  noteId: string;
  aboutUserId: string;
  text: string;
  createdAt: string;
  /** The time of the last edit, or null while the note was never edited. */
  updatedAt: string | null;
}

/** One row of the Notes tab. */
export interface NotePersonItem {
  user: UserSummary;
  noteCount: number;
  lastNote: { noteId: string; text: string; createdAt: string; updatedAt: string | null };
}

/** Parts the service needs. `now` is replaceable in tests. */
export interface FavoritesNotesServiceOptions {
  favorites: FavoritesRepository;
  notes: NotesRepository;
  users: UserReader;
  now?: () => Date;
}

/** What the routes call. Every method takes the logged in user's ID first. */
export interface FavoritesNotesService {
  /**
   * @param userId - the logged in user
   * @returns their favorites, newest first; users that no longer exist are left out
   */
  listFavorites(userId: string): Promise<{ favorites: FavoriteItem[] }>;

  /**
   * Add a favorite. Safe to repeat: the first `createdAt` stays.
   * @param userId - the logged in user
   * @param favoriteUserId - the user to pin
   * @returns the user ID and when it was first pinned
   * @throws ApiError 400 INVALID_INPUT (field `userId`) when the user pins themselves
   * @throws ApiError 404 USER_NOT_FOUND when the user does not exist
   */
  addFavorite(userId: string, favoriteUserId: string): Promise<AddedFavorite>;

  /**
   * Remove a favorite. Works also when the user was not a favorite.
   * @param userId - the logged in user
   * @param favoriteUserId - the user to unpin
   */
  removeFavorite(userId: string, favoriteUserId: string): Promise<void>;

  /**
   * @param userId - the logged in user
   * @param aboutUserId - the user the notes are about
   * @returns the notes the logged in user wrote about that user, newest first
   * @throws ApiError 404 USER_NOT_FOUND when `aboutUserId` does not exist
   */
  listNotes(userId: string, aboutUserId: string): Promise<{ notes: NoteItem[] }>;

  /**
   * Record a note.
   * @param userId - the logged in user, the author
   * @param aboutUserId - the user the note is about
   * @param text - the note, 1 to 500 characters after trimming
   * @returns the stored note, with the server time
   * @throws ApiError 400 INVALID_INPUT (field `text`) when it is empty or too long
   * @throws ApiError 400 INVALID_INPUT (field `aboutUserId`) when the user writes about themselves
   * @throws ApiError 404 USER_NOT_FOUND when `aboutUserId` does not exist
   */
  createNote(userId: string, aboutUserId: string, text: string): Promise<NoteItem>;

  /**
   * @param userId - the logged in user
   * @returns one row for each person the user wrote notes about, newest note first
   */
  listNotePeople(userId: string): Promise<{ people: NotePersonItem[] }>;

  /**
   * Change the text of one of the user's own notes.
   * @param userId - the logged in user
   * @param noteId - the note to change
   * @param text - the new text, 1 to 500 characters after trimming
   * @returns the changed note, with `updatedAt` set to the server time
   * @throws ApiError 400 INVALID_INPUT (field `text`) when it is empty or too long
   * @throws ApiError 404 NOTE_NOT_FOUND when the note does not exist or is not the user's
   */
  updateNote(userId: string, noteId: string, text: string): Promise<NoteItem>;

  /**
   * Delete one of the user's own notes.
   * @param userId - the logged in user
   * @param noteId - the note to delete
   * @throws ApiError 404 NOTE_NOT_FOUND when the note does not exist or is not the user's
   */
  deleteNote(userId: string, noteId: string): Promise<void>;
}

function invalidInput(field: string, message: string): ApiError {
  return new ApiError(HTTP_BAD_REQUEST, ERROR_CODES.invalidInput, message, field);
}

function userNotFound(): ApiError {
  return new ApiError(HTTP_NOT_FOUND, ERROR_CODES.userNotFound, "That user does not exist.");
}

/**
 * Trim a note and check its length.
 * @param text - the text the app sent
 * @returns the trimmed text
 * @throws ApiError 400 INVALID_INPUT (field `text`) when it is empty or too long
 */
export function validateNoteText(text: string): string {
  const trimmed = text.trim();
  if (trimmed === "") {
    throw invalidInput("text", "The note cannot be empty.");
  }
  if ([...trimmed].length > MAX_NOTE_LENGTH) {
    throw invalidInput("text", `The note can have at most ${MAX_NOTE_LENGTH} characters.`);
  }
  return trimmed;
}

function noteNotFound(): ApiError {
  return new ApiError(HTTP_NOT_FOUND, ERROR_CODES.noteNotFound, "That note does not exist.");
}

/** A note that was never edited has `updatedAt` equal to `createdAt`; the app sees null. */
function editedAt(note: StoredNote): string | null {
  return note.updatedAt.getTime() === note.createdAt.getTime()
    ? null
    : note.updatedAt.toISOString();
}

function toNoteItem(note: StoredNote): NoteItem {
  return {
    noteId: note.noteId,
    aboutUserId: note.subjectUserId,
    text: note.text,
    createdAt: note.createdAt.toISOString(),
    updatedAt: editedAt(note),
  };
}

/**
 * Create the Favorites & Notes Service.
 * @param options - repositories, user reader and an optional clock
 * @returns the service
 */
export function createFavoritesNotesService(
  options: FavoritesNotesServiceOptions,
): FavoritesNotesService {
  const { favorites, notes, users } = options;
  const now = options.now ?? (() => new Date());

  async function assertUserExists(userId: string): Promise<void> {
    const found = await users.findUserSummaries([userId]);
    if (found.length === 0) {
      throw userNotFound();
    }
  }

  async function summariesById(userIds: string[]): Promise<Map<string, UserSummary>> {
    const found = await users.findUserSummaries([...new Set(userIds)]);
    return new Map(found.map((user) => [user.userId, user]));
  }

  return {
    async listFavorites(userId) {
      const stored = await favorites.listFavorites(userId);
      const byId = await summariesById(stored.map((favorite) => favorite.favoriteUserId));
      const items: FavoriteItem[] = [];
      for (const favorite of stored) {
        const user = byId.get(favorite.favoriteUserId);
        if (user !== undefined) {
          items.push({ user, createdAt: favorite.createdAt.toISOString() });
        }
      }
      return { favorites: items };
    },

    async addFavorite(userId, favoriteUserId) {
      if (favoriteUserId === userId) {
        throw invalidInput("userId", "You cannot add yourself as a favorite.");
      }
      await assertUserExists(favoriteUserId);
      const favorite = await favorites.addFavorite(userId, favoriteUserId, now());
      return { userId: favorite.favoriteUserId, createdAt: favorite.createdAt.toISOString() };
    },

    async removeFavorite(userId, favoriteUserId) {
      await favorites.removeFavorite(userId, favoriteUserId);
    },

    async listNotes(userId, aboutUserId) {
      await assertUserExists(aboutUserId);
      const stored = await notes.listNotesAbout(userId, aboutUserId);
      return { notes: stored.map(toNoteItem) };
    },

    async createNote(userId, aboutUserId, text) {
      const trimmed = validateNoteText(text);
      if (aboutUserId === userId) {
        throw invalidInput("aboutUserId", "You cannot write a note about yourself.");
      }
      await assertUserExists(aboutUserId);
      const stored = await notes.insertNote({
        authorId: userId,
        subjectUserId: aboutUserId,
        text: trimmed,
        createdAt: now(),
      });
      return toNoteItem(stored);
    },

    async listNotePeople(userId) {
      const summaries: NotePersonSummary[] = await notes.listNotePeople(userId);
      const byId = await summariesById(summaries.map((summary) => summary.subjectUserId));
      const people: NotePersonItem[] = [];
      for (const summary of summaries) {
        const user = byId.get(summary.subjectUserId);
        if (user !== undefined) {
          people.push({
            user,
            noteCount: summary.noteCount,
            lastNote: {
              noteId: summary.lastNote.noteId,
              text: summary.lastNote.text,
              createdAt: summary.lastNote.createdAt.toISOString(),
              updatedAt: editedAt(summary.lastNote),
            },
          });
        }
      }
      return { people };
    },

    async updateNote(userId, noteId, text) {
      const trimmed = validateNoteText(text);
      const stored = await notes.updateNoteText(noteId, userId, trimmed, now());
      if (stored === null) {
        throw noteNotFound();
      }
      return toNoteItem(stored);
    },

    async deleteNote(userId, noteId) {
      if (!(await notes.deleteNote(noteId, userId))) {
        throw noteNotFound();
      }
    },
  };
}
