export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ProviderError extends AppError {
  constructor(message: string, code: string, status = 502, details?: unknown) {
    super(message, code, status, details);
    this.name = "ProviderError";
  }
}

export function errorPayload(error: unknown): { error: string; code: string; details?: unknown } {
  if (error instanceof AppError) {
    return { error: error.message, code: error.code, details: error.details };
  }
  if (error instanceof Error) {
    return { error: error.message, code: "internal_error" };
  }
  return { error: "Unknown error", code: "internal_error" };
}

export function errorStatus(error: unknown): number {
  return error instanceof AppError ? error.status : 500;
}
