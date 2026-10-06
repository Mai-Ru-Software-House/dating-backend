/*
 * Shared error handling: the ApiError class and one onError handler that turns every
 * failure into the team error shape { error: { code, message } }.
 */
import { Elysia } from "elysia";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_INTERNAL_ERROR = 500;

/** Error codes the API can return. Add new codes here so the contract stays in one place. */
export const ERROR_CODES = {
  invalidInput: "INVALID_INPUT",
  unauthenticated: "UNAUTHENTICATED",
  notMessageSender: "NOT_MESSAGE_SENDER",
  notFound: "NOT_FOUND",
  userNotFound: "USER_NOT_FOUND",
  messageNotFound: "MESSAGE_NOT_FOUND",
  placeNotFound: "PLACE_NOT_FOUND",
  geocoderUnavailable: "GEOCODER_UNAVAILABLE",
  internalError: "INTERNAL_ERROR",
} as const;

/** Body of every error response. `field` is optional and names the invalid input field. */
export interface ErrorBody {
  error: { code: string; message: string; field?: string };
}

/** An error a route or service throws on purpose, with the status and code to send. */
export class ApiError extends Error {
  /**
   * @param status - HTTP status code to send (400, 401, 403, 404, 409 ...)
   * @param code - machine readable code in UPPER_SNAKE_CASE
   * @param message - human readable text for the user
   * @param field - optional name of the invalid input field
   */
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function buildBody(code: string, message: string, field?: string): ErrorBody {
  return { error: field === undefined ? { code, message } : { code, message, field } };
}

function firstInvalidField(error: unknown): string | undefined {
  const all = (error as { all?: { path?: string }[] }).all;
  const path = all?.[0]?.path;
  return path === undefined || path === "" ? undefined : path.replace(/^\//, "");
}

/**
 * Elysia plugin that registers the shared error handler for the whole app.
 * Unknown errors are logged on the server and sent to the client as a generic 500.
 */
export const errorHandler = new Elysia({ name: "error-handler" }).onError(
  { as: "global" },
  ({ code, error, set }) => {
    if (error instanceof ApiError) {
      set.status = error.status;
      return buildBody(error.code, error.message, error.field);
    }
    if (code === "VALIDATION") {
      set.status = HTTP_BAD_REQUEST;
      return buildBody(
        ERROR_CODES.invalidInput,
        "The request has invalid or missing data.",
        firstInvalidField(error),
      );
    }
    if (code === "PARSE") {
      set.status = HTTP_BAD_REQUEST;
      return buildBody(ERROR_CODES.invalidInput, "The request body could not be read.");
    }
    if (code === "NOT_FOUND") {
      set.status = HTTP_NOT_FOUND;
      return buildBody(ERROR_CODES.notFound, "That resource does not exist.");
    }
    console.error(error);
    set.status = HTTP_INTERNAL_ERROR;
    return buildBody(ERROR_CODES.internalError, "Something went wrong on the server.");
  },
);
