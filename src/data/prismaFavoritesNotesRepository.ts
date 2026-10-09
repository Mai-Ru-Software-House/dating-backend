/*
 * Prisma versions of the Favorites and Notes repositories (Data Access Layer, owner: Chuan;
 * written by Vic as a proposal). Favorites are rows of `favorites`; notes are rows of `notes`
 * (the column is `body`; the service calls it `text`). Notes are only ever read by their author.
 */
import type { PrismaClient } from "../generated/prisma/client";
import type {
  FavoritesRepository,
  NotePersonSummary,
  NotesRepository,
  StoredNote,
} from "../services/favoritesNotes/favoritesNotesRepository";
import { isUuid, parseNoteId } from "./ids";

interface NoteRow {
  id: number;
  authorId: string;
  subjectUserId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

function toStoredNote(row: NoteRow): StoredNote {
  return {
    noteId: String(row.id),
    authorId: row.authorId,
    subjectUserId: row.subjectUserId,
    text: row.body,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const NOTES_NEWEST_FIRST = [{ createdAt: "desc" as const }, { id: "desc" as const }];
const FAVORITES_NEWEST_FIRST = [
  { createdAt: "desc" as const },
  { favoriteUserId: "desc" as const },
];

/**
 * Create the favorites repository on PostgreSQL.
 * @param prisma - the Prisma client from `createPrismaClient`
 * @returns the repository (it also reads the favorite IDs for the chat list)
 */
export function createPrismaFavoritesRepository(prisma: PrismaClient): FavoritesRepository {
  return {
    async addFavorite(userId, favoriteUserId, createdAt) {
      // An empty update keeps the first row, so the first `createdAt` stays.
      const row = await prisma.favorite.upsert({
        where: { userId_favoriteUserId: { userId, favoriteUserId } },
        create: { userId, favoriteUserId, createdAt },
        update: {},
      });
      return { userId: row.userId, favoriteUserId: row.favoriteUserId, createdAt: row.createdAt };
    },

    async removeFavorite(userId, favoriteUserId) {
      if (!isUuid(userId) || !isUuid(favoriteUserId)) {
        return;
      }
      await prisma.favorite.deleteMany({ where: { userId, favoriteUserId } });
    },

    async listFavorites(userId) {
      if (!isUuid(userId)) {
        return [];
      }
      const rows = await prisma.favorite.findMany({
        where: { userId },
        orderBy: FAVORITES_NEWEST_FIRST,
      });
      return rows.map((row) => ({
        userId: row.userId,
        favoriteUserId: row.favoriteUserId,
        createdAt: row.createdAt,
      }));
    },

    async listFavoriteUserIds(userId) {
      if (!isUuid(userId)) {
        return [];
      }
      const rows = await prisma.favorite.findMany({
        where: { userId },
        orderBy: FAVORITES_NEWEST_FIRST,
        select: { favoriteUserId: true },
      });
      return rows.map((row) => row.favoriteUserId);
    },
  };
}

/**
 * Create the notes repository on PostgreSQL.
 * @param prisma - the Prisma client from `createPrismaClient`
 * @returns the repository
 */
export function createPrismaNotesRepository(prisma: PrismaClient): NotesRepository {
  return {
    async insertNote(note) {
      const row = await prisma.note.create({
        data: {
          authorId: note.authorId,
          subjectUserId: note.subjectUserId,
          body: note.text,
          createdAt: note.createdAt,
          updatedAt: note.createdAt,
        },
      });
      return toStoredNote(row);
    },

    async listNotesAbout(authorId, subjectUserId) {
      if (!isUuid(authorId) || !isUuid(subjectUserId)) {
        return [];
      }
      const rows = await prisma.note.findMany({
        where: { authorId, subjectUserId },
        orderBy: NOTES_NEWEST_FIRST,
      });
      return rows.map(toStoredNote);
    },

    async listNotePeople(authorId) {
      if (!isUuid(authorId)) {
        return [];
      }
      const counts = await prisma.note.groupBy({
        by: ["subjectUserId"],
        where: { authorId },
        _count: { _all: true },
      });
      const countBySubject = new Map(counts.map((row) => [row.subjectUserId, row._count._all]));
      // Newest note first, one row per person: that row is the person's newest note.
      const newestPerPerson = await prisma.note.findMany({
        where: { authorId },
        orderBy: NOTES_NEWEST_FIRST,
        distinct: ["subjectUserId"],
      });
      return newestPerPerson.map((row): NotePersonSummary => ({
        subjectUserId: row.subjectUserId,
        noteCount: countBySubject.get(row.subjectUserId) ?? 1,
        lastNote: toStoredNote(row),
      }));
    },

    async updateNoteText(noteId, authorId, text, updatedAt) {
      const id = parseNoteId(noteId);
      if (id === null || !isUuid(authorId)) {
        return null;
      }
      // The author is part of the condition, so someone else's note is "not found".
      const result = await prisma.note.updateMany({
        where: { id, authorId },
        data: { body: text, updatedAt },
      });
      if (result.count === 0) {
        return null;
      }
      const row = await prisma.note.findUnique({ where: { id } });
      return row === null ? null : toStoredNote(row);
    },

    async deleteNote(noteId, authorId) {
      const id = parseNoteId(noteId);
      if (id === null || !isUuid(authorId)) {
        return false;
      }
      const result = await prisma.note.deleteMany({ where: { id, authorId } });
      return result.count > 0;
    },
  };
}
