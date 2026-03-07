export interface ErrorFixContext {
  errorMessage: string;
  stackTrace: string | null;
  sourceFile: string | null;
  sourceLine: number | null;
  endpoint: string | null;
  sentryEventId: string | null;
  timestamp: string;
}

export interface ErrorFixInput {
  err: unknown;
  method: string;
  path: string;
  status: number;
  sentryEventId: string | null;
}

export function extractSourceLocation(
  stack: string | undefined,
): { file: string; line: number } | null {
  if (!stack) return null;
  // Match project files (not node_modules, not node: internals)
  const match = stack.match(
    /at .+\((?:\/[^)]*\/)?((?:server|client)\/src\/[^:]+):(\d+):\d+\)/,
  );
  if (!match) return null;
  return { file: match[1], line: Number(match[2]) };
}

export function buildErrorFixContext(input: ErrorFixInput): ErrorFixContext {
  const errMessage =
    input.err instanceof Error ? input.err.message : String(input.err);
  const stack =
    input.err instanceof Error ? input.err.stack ?? null : null;
  const loc = extractSourceLocation(stack ?? undefined);

  return {
    errorMessage: errMessage,
    stackTrace: stack,
    sourceFile: loc?.file ?? null,
    sourceLine: loc?.line ?? null,
    endpoint: `${input.method} ${input.path}`,
    sentryEventId: input.sentryEventId,
    timestamp: new Date().toISOString(),
  };
}
