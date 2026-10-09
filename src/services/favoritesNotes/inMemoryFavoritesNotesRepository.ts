/*
 * In-memory favorites and notes. Tests use them, and the app uses them until the Data Access
 * Layer (Chuan) provides the real repositories. Data is lost when the server stops.
 */
import type {
  FavoritesRepository,
  NotePersonSummary,
  NotesRepository,
  StoredFavorite,
  StoredNote,
} from "./favoritesNotesRepository";

const NOTE_ID_PREFIX = "not_";
const NOTE_ID_DIGITS = 6;

/**
 * Create an empty in-memory favorites repository.
 * @param initial - favorites to start with, by user ID (oldest first), for tests
 * @returns the repository
 */
export function createInMemoryFavoritesRepository(
  initial: { userId: string; favoriteUserId: string; createdAt: Date }[] = [],
): FavoritesRepository {
  const favorites = new Map<string, StoredFavorite>();
  const key = (userId: string, favoriteUserId: string) => `${userId}:${favoriteUserId}`;
  for (const favorite of initial) {
    favorites.set(key(favorite.userId, favorite.favoriteUserId), { ...favorite });
  }

  function listFor(userId: string): StoredFavorite[] {
    // Map keeps insertion order, so reversing gives newest first even for equal times.
    return [...favorites.values()]
      .filter((favorite) => favorite.userId === userId)
      .reverse()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  return {
    async addFavorite(userId, favoriteUserId, createdAt) {
      const existing = favorites.get(key(userId, favoriteUserId));
      if (existing !== undefined) {
        return { ...existing };
      }
      const favorite = { userId, favoriteUserId, createdAt };
      favorites.set(key(userId, favoriteUserId), favorite);
      return { ...favorite };
    },

    async removeFavorite(userId, favoriteUserId) {
      favorites.delete(key(userId, favoriteUserId));
    },

    async listFavorites(userId) {
      return listFor(userId).map((favorite) => ({ ...favorite }));
    },

    async listFavoriteUserIds(userId) {
      return listFor(userId).map((favorite) => favorite.favoriteUserId);
    },
  };
}

/**
 * Create an empty in-memory notes repository.
 * @param initial - notes to start with (oldest first); IDs are created for them
 * @returns the repository
 */
export function createInMemoryNotesRepository(
  initial: { authorId: string; subjectUserId: string; text: string; createdAt: Date }[] = [],
): NotesRepository {
  const notes: StoredNote[] = [];
  // A counter, not `notes.length`, so a deleted note's ID is never used again.
  let lastNumber = 0;

  function store(note: Omit<StoredNote, "noteId" | "updatedAt">): StoredNote {
    lastNumber += 1;
    const noteId = `${NOTE_ID_PREFIX}${String(lastNumber).padStart(NOTE_ID_DIGITS, "0")}`;
    const stored = { noteId, ...note, updatedAt: note.createdAt };
    notes.push(stored);
    return stored;
  }
  for (const note of initial) {
    store(note);
  }

  function newestFirst(list: StoredNote[]): StoredNote[] {
    // Later notes were stored later, so reversing keeps the order stable for equal times.
    return [...list].reverse().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  return {
    async insertNote(note) {
      return { ...store(note) };
    },

    async listNotesAbout(authorId, subjectUserId) {
      const mine = notes.filter(
        (note) => note.authorId === authorId && note.subjectUserId === subjectUserId,
      );
      return newestFirst(mine).map((note) => ({ ...note }));
    },

    async listNotePeople(authorId) {
      const mine = newestFirst(notes.filter((note) => note.authorId === authorId));
      const people = new Map<string, NotePersonSummary>();
      for (const note of mine) {
        const person = people.get(note.subjectUserId);
        if (person === undefined) {
          people.set(note.subjectUserId, {
            subjectUserId: note.subjectUserId,
            noteCount: 1,
            lastNote: { ...note },
          });
        } else {
          person.noteCount += 1;
        }
      }
      return [...people.values()];
    },

    async updateNoteText(noteId, authorId, text, updatedAt) {
      const note = notes.find((item) => item.noteId === noteId && item.authorId === authorId);
      if (note === undefined) {
        return null;
      }
      note.text = text;
      note.updatedAt = updatedAt;
      return { ...note };
    },

    async deleteNote(noteId, authorId) {
      const index = notes.findIndex((item) => item.noteId === noteId && item.authorId === authorId);
      if (index < 0) {
        return false;
      }
      notes.splice(index, 1);
      return true;
    },
  };
}
