/*
 * What the Favorites & Notes Service needs from the Data Access Layer (Chuan). Proposed, Chuan
 * to confirm: the real repositories read and write the `favorites` and `notes` tables. Until
 * then the in-memory versions in inMemoryFavoritesNotesRepository.ts are used.
 */
import type { FavoritesReader } from "../messaging/messageRepository";

/** One favorite as stored. `userId` pinned `favoriteUserId`. */
export interface StoredFavorite {
  userId: string;
  favoriteUserId: string;
  createdAt: Date;
}

/** One private note as stored. */
export interface StoredNote {
  noteId: string;
  authorId: string;
  subjectUserId: string;
  text: string;
  createdAt: Date;
}

/** The data needed to store a new note. The repository creates the ID. */
export interface NewNote {
  authorId: string;
  subjectUserId: string;
  text: string;
  createdAt: Date;
}

/** What the Notes tab shows for one person: how many notes, and the newest one. */
export interface NotePersonSummary {
  subjectUserId: string;
  noteCount: number;
  lastNote: StoredNote;
}

/**
 * Reads and writes favorites. It also reads favorite IDs for the Messaging Service, which puts
 * favorites first in the chat list.
 */
export interface FavoritesRepository extends FavoritesReader {
  /**
   * Add a favorite. Safe to repeat: when the pair exists, nothing changes.
   * @param userId - the user who pins
   * @param favoriteUserId - the user who is pinned
   * @param createdAt - the time to store when the favorite is new
   * @returns the favorite, with the time of the first call
   */
  addFavorite(userId: string, favoriteUserId: string, createdAt: Date): Promise<StoredFavorite>;

  /**
   * Remove a favorite. Does nothing when the pair does not exist.
   * @param userId - the user who pinned
   * @param favoriteUserId - the user to unpin
   */
  removeFavorite(userId: string, favoriteUserId: string): Promise<void>;

  /**
   * @param userId - the user whose favorites to list
   * @returns their favorites, newest first
   */
  listFavorites(userId: string): Promise<StoredFavorite[]>;
}

/** Reads and writes private notes. Notes are only ever read by their author. */
export interface NotesRepository {
  /**
   * Store a new note.
   * @param note - the note data; the repository creates the ID
   * @returns the stored note
   */
  insertNote(note: NewNote): Promise<StoredNote>;

  /**
   * @param authorId - the user who wrote the notes
   * @param subjectUserId - the user the notes are about
   * @returns the notes `authorId` wrote about `subjectUserId`, newest first
   */
  listNotesAbout(authorId: string, subjectUserId: string): Promise<StoredNote[]>;

  /**
   * @param authorId - the user who wrote the notes
   * @returns one summary for each person `authorId` wrote about, the person with the newest
   *   note first
   */
  listNotePeople(authorId: string): Promise<NotePersonSummary[]>;
}
