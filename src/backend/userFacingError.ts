import { flow } from "../utils/flowLog";

export const MM3_CRM_URL = "https://crm.mm3ai.com";
export const MM3_SUPPORT_EMAIL = "support@mm3ai.com";

export type UserFacingErrorKind = "auth" | "api" | "unexpected";

export interface UserFacingErrorHelp {
  kind: UserFacingErrorKind;
  crmUrl: string;
  supportEmail: string;
}

export function isAuthFailureMessage(message: string): boolean {
  flow("isAuthFailureMessage", 1, "enter");
  return /401|403|unauthoriz|expired|authentication required|access token|sign-in failed/i.test(
    message
  );
}

export function formatUserFacingError(
  kind: UserFacingErrorKind,
  detail?: string
): string {
  flow("formatUserFacingError", 1, "enter", { kind });

  if (kind === "auth") {
    return [
      detail?.trim() || "Sign-in failed or your access token expired.",
      `Reset your token at ${MM3_CRM_URL}, then paste it with the key button in MM3.`,
      `If something else is wrong, email ${MM3_SUPPORT_EMAIL}.`
    ].join("\n\n");
  }

  const headline =
    detail?.trim() ||
    (kind === "api"
      ? "The MM3 API could not complete this request."
      : "Something unexpected went wrong.");

  return [
    headline,
    `If your token expired, reset it at ${MM3_CRM_URL}.`,
    `For other unexpected errors, email ${MM3_SUPPORT_EMAIL}.`
  ].join("\n\n");
}

export function classifyErrorMessage(message: string): UserFacingErrorKind {
  flow("classifyErrorMessage", 1, "enter");
  if (isAuthFailureMessage(message)) {
    return "auth";
  }
  if (
    /unable to connect|unable to reach|backend error|api could not|did not respond|network|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|i\/o timeout|dial tcp|lookup |no such host|connection refused/i.test(
      message
    )
  ) {
    return "api";
  }
  return "unexpected";
}

export function formatConnectError(_error: unknown): Error {
  flow("formatConnectError", 1, "enter");
  return new Error(
    formatUserFacingError(
      "api",
      "Unable to reach MM3 AI. Check your connection and try again."
    )
  );
}

export function userFacingErrorHelp(kind: UserFacingErrorKind): UserFacingErrorHelp {
  return {
    kind,
    crmUrl: MM3_CRM_URL,
    supportEmail: MM3_SUPPORT_EMAIL
  };
}
