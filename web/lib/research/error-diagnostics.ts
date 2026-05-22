export interface ErrorDiagnostic {
  requestId?: string | null;
  traceId?: string | null;
  runId?: string | null;
}

export function getRequestIdFromError(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const requestId = (error as { requestId?: unknown }).requestId;
  return typeof requestId === 'string' && requestId.trim() ? requestId : null;
}

export function hasErrorDiagnostic(diagnostic: ErrorDiagnostic): boolean {
  return Boolean(diagnostic.requestId || diagnostic.traceId || diagnostic.runId);
}
