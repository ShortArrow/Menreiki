import type { MessageKey, Translate } from "./i18n";
import type { ErrorCode } from "./types";

/// Adding an `ErrorCode` without a key here fails the type check.
const ERROR_KEYS: Record<ErrorCode, MessageKey> = {
  "audit.noTerms": "error.audit.noTerms",
  "inference.modelMissing": "error.inference.modelMissing",
  "inference.invalidUrl": "error.inference.invalidUrl",
  "inference.notLocal": "error.inference.notLocal",
  "inference.request": "error.inference.request",
};

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ERROR_KEYS, value);
}

/// Turns whatever a command rejected with into text for the status bar:
/// coded errors read in the UI language, uncoded ones show the backend's
/// detail, and nothing ever renders as `[object Object]`.
export function describeError(failure: unknown, t: Translate): string {
  if (typeof failure === "string") return failure;
  if (failure !== null && typeof failure === "object" && "detail" in failure) {
    const { code, detail } = failure as { code?: unknown; detail?: unknown };
    const detailText = String(detail);
    if (isErrorCode(code)) {
      return t(ERROR_KEYS[code], {
        detail: detailText,
        settings: t("settings.title"),
        llm: t("settings.llm"),
      });
    }
    if (code === null || code === undefined) return detailText;
  }
  if (failure instanceof Error) return failure.message;
  return String(failure);
}
