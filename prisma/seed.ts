/*
 * Seed script: fills an empty, migrated database with the test data of the functional test plan
 * (sheets "Test Users" and "Seed Data"): 9 users who sign in with a password, messages M1 to M6,
 * alice's favorite and alice's note. Message times are relative to when the script runs.
 * Set SEED_LONG_THREAD=true to also add the 60 message thread between alice and dan (test CH06).
 * It creates no refresh tokens (logging in does) and no mint_01 (test CP01 creates that user).
 * Run with `bun run db:seed`. It refuses to run when NODE_ENV is production, and refuses to add
 * the test users a second time. Everything is written in one transaction: all or nothing.
 */
import { createPrismaClient } from "../src/data/prismaClient";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";

const EXIT_CODE_FAILURE = 1;
const DEFAULT_POSTGRES_PORT = "5432";
const MILLISECONDS_PER_MINUTE = 60_000;
/** Seeded messages that are read were read this many minutes after they were sent. */
const READ_DELAY_MINUTES = 5;
/** Interactive transactions stop after 5 s by default; the remote dev database needs longer. */
const TRANSACTION_TIMEOUT_MS = 30_000;
const PASSWORD_AUTH_TYPE = "password";
/** Placeholder photo keys. These objects do not exist in RustFS. */
const PHOTO_KEY_PREFIX = "profile-photos/seed/";
const LONG_THREAD_PARTICIPANTS = ["alice", "dan"] as const;
const LONG_THREAD_LENGTH = 60;
/** The long thread starts 2 days ago, so it is older than every message from M1 to M6. */
const LONG_THREAD_START_MINUTES_AGO = 2_880;

type GenderCode = "male" | "female" | "non_binary" | "other";

/** One row of the "Test Users" sheet. */
interface SeedUser {
  username: string;
  password: string;
  displayName: string;
  gender: GenderCode;
  /** YYYY-MM-DD */
  dateOfBirth: string;
  latitude: number;
  longitude: number;
  /** The sheet's "Area" column. */
  placeName: string;
  targetGender: GenderCode;
  targetMinAge: number;
  targetMaxAge: number;
  targetRadiusKm: number;
}

/** One message of the "Seed Data" sheet (or of the long thread). */
interface SeedMessage {
  /** The name used in the test plan, for example "M1". Not stored. */
  name: string;
  from: string;
  to: string;
  text: string;
  sentMinutesAgo: number;
  isRead: boolean;
}

const TEST_USERS: SeedUser[] = [
  {
    username: "alice",
    password: "Alice2026",
    displayName: "Alice",
    gender: "female",
    dateOfBirth: "1999-03-10",
    latitude: 13.7466,
    longitude: 100.5393,
    placeName: "Siam, Bangkok",
    targetGender: "male",
    targetMinAge: 24,
    targetMaxAge: 32,
    targetRadiusKm: 50,
  },
  {
    username: "bob",
    password: "Bob2026x",
    displayName: "Bob",
    gender: "male",
    dateOfBirth: "1998-05-20",
    latitude: 13.7279,
    longitude: 100.5241,
    placeName: "Silom, Bangkok",
    targetGender: "female",
    targetMinAge: 22,
    targetMaxAge: 30,
    targetRadiusKm: 30,
  },
  {
    username: "chai",
    password: "Chai2026",
    displayName: "Chai",
    gender: "male",
    dateOfBirth: "2001-02-14",
    latitude: 13.8621,
    longitude: 100.5144,
    placeName: "Nonthaburi",
    targetGender: "female",
    targetMinAge: 22,
    targetMaxAge: 30,
    targetRadiusKm: 20,
  },
  {
    username: "dan",
    password: "Dan2026x",
    displayName: "Dan",
    gender: "male",
    dateOfBirth: "1985-01-05",
    latitude: 13.7563,
    longitude: 100.5018,
    placeName: "Bangkok",
    targetGender: "female",
    targetMinAge: 25,
    targetMaxAge: 45,
    targetRadiusKm: 50,
  },
  {
    username: "ekk",
    password: "Ekk2026x",
    displayName: "Ekk",
    gender: "male",
    dateOfBirth: "1997-04-01",
    latitude: 18.7883,
    longitude: 98.9853,
    placeName: "Chiang Mai",
    targetGender: "female",
    targetMinAge: 22,
    targetMaxAge: 35,
    targetRadiusKm: 1000,
  },
  {
    username: "fah",
    password: "Fah2026x",
    displayName: "Fah",
    gender: "female",
    dateOfBirth: "2000-07-07",
    latitude: 13.765,
    longitude: 100.538,
    placeName: "Bangkok",
    targetGender: "male",
    targetMinAge: 24,
    targetMaxAge: 35,
    targetRadiusKm: 25,
  },
  {
    username: "gun",
    password: "Gun2026x",
    displayName: "Gun",
    gender: "male",
    dateOfBirth: "1996-04-22",
    latitude: 13.5991,
    longitude: 100.5998,
    placeName: "Samut Prakan",
    targetGender: "female",
    targetMinAge: 20,
    targetMaxAge: 26,
    targetRadiusKm: 40,
  },
  {
    username: "hana",
    password: "Hana2026",
    displayName: "Hana",
    gender: "female",
    dateOfBirth: "1995-08-30",
    latitude: 13.74,
    longitude: 100.56,
    placeName: "Bangkok",
    targetGender: "male",
    targetMinAge: 25,
    targetMaxAge: 40,
    targetRadiusKm: 30,
  },
  {
    username: "joe",
    password: "Joe2026x",
    displayName: "Joe",
    gender: "male",
    dateOfBirth: "1950-06-01",
    latitude: 14.3532,
    longitude: 100.5689,
    placeName: "Ayutthaya",
    targetGender: "female",
    targetMinAge: 70,
    targetMaxAge: 80,
    targetRadiusKm: 5,
  },
];

const SEED_MESSAGES: SeedMessage[] = [
  {
    name: "M1",
    from: "chai",
    to: "alice",
    text: "Hello Alice, nice to match with you!",
    sentMinutesAgo: 1_440, // 1 day
    isRead: true,
  },
  { name: "M2", from: "bob", to: "alice", text: "Hi Alice", sentMinutesAgo: 60, isRead: false },
  {
    name: "M3",
    from: "bob",
    to: "alice",
    text: "Are you free this weekend?",
    sentMinutesAgo: 50,
    isRead: false,
  },
  {
    name: "M4",
    from: "bob",
    to: "alice",
    text: "There is a jazz night at Siam on Saturday.",
    sentMinutesAgo: 40,
    isRead: false,
  },
  {
    name: "M5",
    from: "bob",
    to: "chai",
    text: "Hey Chai, see you at football later.",
    sentMinutesAgo: 120, // 2 hours
    isRead: true,
  },
  { name: "M6", from: "alice", to: "hana", text: "Hi Hana", sentMinutesAgo: 180, isRead: true },
];

const SEED_FAVORITES = [{ owner: "alice", favorite: "chai" }];

const SEED_NOTES = [{ author: "alice", about: "chai", text: "Met at a cafe in Ari last month." }];

function minutesBefore(time: Date, minutes: number): Date {
  return new Date(time.getTime() - minutes * MILLISECONDS_PER_MINUTE);
}

function minutesAfter(time: Date, minutes: number): Date {
  return new Date(time.getTime() + minutes * MILLISECONDS_PER_MINUTE);
}

/**
 * Describe the target database without the user name or password.
 * @param databaseUrl - PostgreSQL connection string
 * @returns for example `database "dating_app_test" on localhost:5432`
 * @throws TypeError when the URL cannot be parsed
 */
function describeDatabase(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  const databaseName = url.pathname.replace(/^\//, "");
  return `database "${databaseName}" on ${url.hostname}:${url.port || DEFAULT_POSTGRES_PORT}`;
}

/**
 * Build the long thread for test CH06: alice and dan take turns, one minute apart, all read.
 * @returns the 60 messages, oldest first
 */
function buildLongThread(): SeedMessage[] {
  const [first, second] = LONG_THREAD_PARTICIPANTS;
  return Array.from({ length: LONG_THREAD_LENGTH }, (_, index) => {
    const isFirstSender = index % LONG_THREAD_PARTICIPANTS.length === 0;
    return {
      name: `T${index + 1}`,
      from: isFirstSender ? first : second,
      to: isFirstSender ? second : first,
      text: `Message ${index + 1} of ${LONG_THREAD_LENGTH} in the long thread.`,
      sentMinutesAgo: LONG_THREAD_START_MINUTES_AGO - index,
      isRead: true,
    };
  });
}

/**
 * Hash every test password with Argon2id, one at a time (each hash uses about 64 MiB).
 * @param users - the test users
 * @returns each user with the hash of their password
 */
async function hashPasswords(
  users: SeedUser[],
): Promise<{ user: SeedUser; passwordHash: string }[]> {
  const hashed: { user: SeedUser; passwordHash: string }[] = [];
  for (const user of users) {
    const passwordHash = await Bun.password.hash(user.password, { algorithm: "argon2id" });
    hashed.push({ user, passwordHash });
  }
  return hashed;
}

/**
 * Insert the users with their password sign-in and target gender.
 * @param tx - the open transaction
 * @param hashedUsers - users with their password hashes
 * @returns the new user ID for each username
 */
async function insertUsers(
  tx: Prisma.TransactionClient,
  hashedUsers: { user: SeedUser; passwordHash: string }[],
): Promise<Map<string, string>> {
  const userIds = new Map<string, string>();
  for (const { user, passwordHash } of hashedUsers) {
    const created = await tx.user.create({
      data: {
        username: user.username,
        displayName: user.displayName,
        dateOfBirth: new Date(user.dateOfBirth),
        genderCode: user.gender,
        photoKey: `${PHOTO_KEY_PREFIX}${user.username}.jpg`,
        latitude: user.latitude,
        longitude: user.longitude,
        placeName: user.placeName,
        targetMinAge: user.targetMinAge,
        targetMaxAge: user.targetMaxAge,
        targetRadiusKm: user.targetRadiusKm,
        authMethods: { create: { authType: PASSWORD_AUTH_TYPE, passwordHash } },
        targetGenders: { create: { genderCode: user.targetGender } },
      },
      select: { id: true },
    });
    userIds.set(user.username, created.id);
  }
  return userIds;
}

/**
 * Look up the ID of a seeded user.
 * @param userIds - IDs by username, from insertUsers
 * @param username - the user to find
 * @returns the user ID
 * @throws Error when the seed data names a user that was not inserted
 */
function idOf(userIds: Map<string, string>, username: string): string {
  const userId = userIds.get(username);
  if (userId === undefined) {
    throw new Error(`The seed data names an unknown user: ${username}`);
  }
  return userId;
}

/**
 * Insert the messages, the favorites and the notes.
 * @param tx - the open transaction
 * @param userIds - IDs by username, from insertUsers
 * @param messages - the messages to insert
 * @param now - the time the seed started; message times are counted back from it
 */
async function insertActivity(
  tx: Prisma.TransactionClient,
  userIds: Map<string, string>,
  messages: SeedMessage[],
  now: Date,
): Promise<void> {
  await tx.message.createMany({
    data: messages.map((message) => {
      const sentAt = minutesBefore(now, message.sentMinutesAgo);
      return {
        senderId: idOf(userIds, message.from),
        receiverId: idOf(userIds, message.to),
        body: message.text,
        sentAt,
        readAt: message.isRead ? minutesAfter(sentAt, READ_DELAY_MINUTES) : null,
      };
    }),
  });
  await tx.favorite.createMany({
    data: SEED_FAVORITES.map((favorite) => ({
      userId: idOf(userIds, favorite.owner),
      favoriteUserId: idOf(userIds, favorite.favorite),
    })),
  });
  await tx.note.createMany({
    data: SEED_NOTES.map((note) => ({
      authorId: idOf(userIds, note.author),
      subjectUserId: idOf(userIds, note.about),
      body: note.text,
    })),
  });
}

/**
 * Fill the database with the test data, unless the test users are already there.
 * @param prisma - client for the target database
 * @param includeLongThread - also add the 60 message thread between alice and dan
 * @throws Error when a test user already exists, or when a write fails (nothing is saved)
 */
async function seed(prisma: PrismaClient, includeLongThread: boolean): Promise<void> {
  const usernames = TEST_USERS.map((user) => user.username);
  const existingCount = await prisma.user.count({ where: { username: { in: usernames } } });
  if (existingCount > 0) {
    throw new Error(
      `${existingCount} of the test users already exist. To seed again, drop and recreate ` +
        "the database, run `bun run db:deploy`, then `bun run db:seed`.",
    );
  }

  const hashedUsers = await hashPasswords(TEST_USERS);
  const messages = includeLongThread ? [...SEED_MESSAGES, ...buildLongThread()] : SEED_MESSAGES;
  const now = new Date();
  await prisma.$transaction(
    async (tx) => {
      const userIds = await insertUsers(tx, hashedUsers);
      await insertActivity(tx, userIds, messages, now);
    },
    { timeout: TRANSACTION_TIMEOUT_MS },
  );

  console.log(
    `Added ${TEST_USERS.length} users, ${messages.length} messages, ` +
      `${SEED_FAVORITES.length} favorite and ${SEED_NOTES.length} note.`,
  );
  if (!includeLongThread) {
    console.log("The long alice/dan thread was not added (set SEED_LONG_THREAD=true to add it).");
  }
}

/**
 * Check the environment, say which database will be filled, then seed it.
 * @throws Error when NODE_ENV is production, DATABASE_URL is missing, or seeding fails
 */
async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed: NODE_ENV is production.");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error("DATABASE_URL is not set.");
  }
  const includeLongThread = process.env.SEED_LONG_THREAD === "true";
  console.log(`Seeding ${describeDatabase(databaseUrl)}`);

  const prisma = createPrismaClient(databaseUrl);
  try {
    await seed(prisma, includeLongThread);
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await main();
} catch (error) {
  console.error(`Seed failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = EXIT_CODE_FAILURE;
}
