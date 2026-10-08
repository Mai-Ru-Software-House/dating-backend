# Mai Ru Coding Standards

**Project:** Online Dating System (SEN-201)
**Last update:** 1 October 2026

The compilers and interpreters decide what is a legal TypeScript or Python program. This document adds rules for **style**: how we name things, format code, write comments, and structure the project. Every file committed to the team repository must follow these rules. Pull requests that break them should be fixed before merging.

The rules follow the normal conventions of each language (the TypeScript/React community style and PEP 8 for Python), so code we write looks like code anyone else in those ecosystems would write.

## Languages and Tools

| Part of the system                   | Language                   | Framework / runtime     | Formatter and linter             |
| ------------------------------------ | -------------------------- | ----------------------- | -------------------------------- |
| Mobile app (frontend)                | TypeScript (`.ts`, `.tsx`) | React Native on Node.js | Prettier, ESLint                 |
| Backend services and REST API        | TypeScript (`.ts`)         | Elysia on Bun           | Prettier, ESLint                 |
| Match Engine (Batch Processing Unit) | Python 3.12+ (`.py`)       | FastAPI                 | Ruff (lint and format)           |
| Database schema                      | SQL                        | PostgreSQL              | none (follow naming rules below) |
| File storage                         | none                       | RustFS (S3-compatible)  | none                             |

Formatting is enforced by tools, not by memory. Run the formatter before every commit.

```jsonc
// .prettierrc (repository root)
{
  "printWidth": 100,
  "tabWidth": 2,
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
}
```

```toml
# match-engine/pyproject.toml
[tool.ruff]
line-length = 88

[tool.ruff.lint]
select = ["E", "F", "I", "N", "UP", "B"]
```

## Comment Rules

**1.** Every source file must begin with a header comment explaining its high-level purpose and what it contains. Use `/* */` in TypeScript and a module docstring in Python. Do not include the file name, author, or creation date, as version control systems automatically track this information.

```ts
/*
 * Messaging Service: sends and replies to messages, tracks read
 * state, and builds the chat list (favorites first).
 */
```

```python
"""
Match Engine: computes the match score between two profiles
and ranks candidates for the recommendations list.
"""
```

**2.** Every exported function, class, and React component must have a doc comment that explains a) its purpose, b) each argument, c) what it returns (if anything), and d) any error it can throw. Use JSDoc (`/** */`) in TypeScript and Google-style docstrings in Python. Small private helpers whose name says everything may skip this.

```ts
/**
 * Compute the great-circle distance between two points.
 * @param from - first point, latitude/longitude in degrees
 * @param to - second point, latitude/longitude in degrees
 * @returns distance in kilometres
 */
export function distanceKm(from: Coordinates, to: Coordinates): number {
  ...
}
```

```python
def rank_candidates(user: Profile, candidates: list[Profile]) -> list[ScoredMatch]:
    """Score every candidate against the user and sort best first.

    Args:
        user: the profile we are finding matches for.
        candidates: profiles that passed the search filter.

    Returns:
        Candidates with their scores, highest score first.
    """
```

**3.** Declare a variable where it is first used and give it a name that makes a comment unnecessary. Add a short comment only when the name cannot carry the meaning (units, magic values, assumptions).

```ts
const maxDistanceKm = 50; // default search radius when the user sets none
```

**4.** Use comments inside a function only when the code is not self-explanatory. Explain _why_, not _what_.

_Poor style_

```ts
count = count + 1; // add one to count
```

_Better style_

```ts
// Nominatim allows at most 1 request per second, so wait before retrying.
await sleep(1000);
```

**5.** Use `//` for comments inside functions in TypeScript and `#` in Python. Do not leave commented-out code in a commit; Git keeps the history.

## Naming Rules

**1.** Names must be meaningful. A reader should know what a variable holds without reading the code that fills it.

**2.** Follow each language's casing convention.

| Kind of name                                   | TypeScript                                  | Python             | SQL                                               |
| ---------------------------------------------- | ------------------------------------------- | ------------------ | ------------------------------------------------- |
| Variables, functions, parameters               | `camelCase`                                 | `snake_case`       | none                                              |
| Classes, types, interfaces, enums              | `PascalCase`                                | `PascalCase`       | none                                              |
| React components                               | `PascalCase`                                | none               | none                                              |
| Constants (fixed values known before run time) | `UPPER_SNAKE_CASE`                          | `UPPER_SNAKE_CASE` | none                                              |
| Tables, columns                                | none                                        | none               | `snake_case`, tables plural (`users`, `messages`) |
| Files                                          | `camelCase.ts`; components `PascalCase.tsx` | `snake_case.py`    | `NNN_description.sql`                             |

```ts
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
interface UserProfile { ... }
function ChatListScreen() { ... }
let unreadCount = 0;
```

```python
MAX_CANDIDATES = 200
class MatchRequest(BaseModel): ...
def compute_score(user, candidate): ...
```

**3.** Do not prefix interfaces with `I` (`UserProfile`, not `IUserProfile`).

**4.** Booleans read as yes/no questions: `isRead`, `hasPhoto`, `canMessage` (`is_read` in Python).

**5.** Avoid single-letter names except loop indices, short lambdas, and formula variables (for example `lat`, `lon`, `r` in the haversine formula).

**6.** Avoid very long names and uncommon abbreviations.

_Allowed:_ `id`, `url`, `api`, `db`, `km`, `lat`, `lon`
_Poor style:_ `usrPrf`, `msgTmstmp`, `numberOfUnreadMessagesForCurrentUser`

**7.** Functions are named with a verb: `sendMessage`, `getChatList`, `rank_candidates`.

## Code Format Rules

**1.** Run Prettier and Ruff before every commit. Do not argue with the formatter; it is the final authority on indentation, line length, braces, and parenthesis spacing.

**2.** Function length: if a function is longer than about 50 lines, split it into helpers. A React component longer than about 150 lines (including JSX) should be split into smaller components.

**3.** One exported React component per `.tsx` file, except tightly coupled private helpers used only in that file.

**4.** Imports go at the top of the file, grouped: external packages first, then project modules, separated by a blank line. Ruff sorts Python imports automatically.

## Coding Considerations

### All languages

**1.** Make the meaning of mixed expressions clear. Always parenthesize `&&` inside `||` (`and` inside `or` in Python) and `%` mixed with other arithmetic. If an expression still needs thought, split it into named intermediate variables instead of adding more parentheses.

_Poor style_

```ts
if (age >= 18 || isVerified && hasPhoto) ...
```

_Better style_

```ts
if (age >= 18 || (isVerified && hasPhoto)) ...
```

Prettier adds the parentheses in these two cases automatically and removes ones it considers redundant (for example around `bonus / count` in `base + (bonus / count)`). Accept the formatter's output; do not fight it. Ruff keeps any parentheses you write in Python.

**2.** Think carefully before using `continue` and `break`. Never use more than one `break` in a loop.

**3.** No magic numbers. Give limits and thresholds a named constant.

**4.** Never commit secrets. Read them from environment variables; commit a `.env.example` with dummy values only.

**5.** All timestamps are created **on the server**, stored in UTC, and sent as ISO 8601 strings (`2026-10-03T14:05:00Z`). The app converts to local time only for display.

### TypeScript (mobile and backend)

**6.** Turn on `"strict": true` in `tsconfig.json`. Do not use `any`; use a real type or `unknown` and narrow it.

**7.** Use `const` by default, `let` only when the variable is reassigned, and never `var`.

**8.** Use `===` and `!==`, never `==` or `!=`.

**9.** Use `async`/`await`, not `.then()` chains. Every `await` that can fail must be inside code that handles the error (a `try`/`catch` here or in the caller).

### Python (Match Engine)

**10.** Follow PEP 8. Add type hints to every function signature. Use Pydantic models for request and response bodies.

### Database and SQL

**11.** Never build SQL by joining strings with user input. Use parameterized queries only.

_Poor style_

```ts
db.query(`SELECT * FROM users WHERE username = '${username}'`);
```

_Better style_

```ts
db.query("SELECT * FROM users WHERE username = $1", [username]);
```

## API Conventions

**1.** REST paths are lowercase, plural nouns, versioned: `/api/v1/users`, `/api/v1/messages/{id}`. Use HTTP verbs for the action (`GET`, `POST`, `PATCH`, `DELETE`), not verbs in the path.

**2.** JSON field names are `camelCase` everywhere on the wire, including the Match Engine.

**3.** Every error response uses one shape:

```json
{ "error": { "code": "USERNAME_TAKEN", "message": "That username is already in use." } }
```

**4.** Use the right status code: `400` invalid input, `401` not logged in, `403` not allowed, `404` not found, `409` conflict, `500` server error. Never return `200` with an error body.

## Git and Review

**1.** `main` always builds. Work on a branch named `<type>/<short-description>`, for example `feat/chat-list`, `fix/photo-upload-timeout`.

**2.** Commit messages start with a type and a short imperative summary: `feat: add unread count to home page`, `fix: reject photos over 5 MB`. Use the following standard types for both branch names and commits:

| Type       | Description                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| `feat`     | A new feature or functionality                                                                            |
| `fix`      | A bug fix                                                                                                 |
| `docs`     | Documentation-only changes (like updating this standards file)                                            |
| `style`    | Formatting changes that do not affect the code's meaning (handled mostly by Prettier/Ruff)                |
| `refactor` | A code change that neither fixes a bug nor adds a feature (e.g., renaming variables, splitting functions) |
| `test`     | Adding missing tests or correcting existing ones                                                          |
| `chore`    | Changes to the build process, package manager configs, or auxiliary tools                                 |

**3.** New service logic comes with unit tests (Bun's test runner for TypeScript, `pytest` for Python).
