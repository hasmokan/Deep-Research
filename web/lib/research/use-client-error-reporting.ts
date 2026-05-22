'use client';

import { useEffect, type RefObject } from 'react';
import { apiClient } from '@/lib/api';

interface UseClientErrorReportingOptions {
  activeSessionIdRef: RefObject<string | null>;
}

export function useClientErrorReporting({
  activeSessionIdRef,
}: UseClientErrorReportingOptions) {
  useEffect(() => {
    const reportClientError = (
      message: string,
      source: string,
      context: Record<string, unknown> = {},
    ) => {
      void apiClient.reportClientError({
        message,
        source,
        level: 'error',
        context: {
          active_session_id: activeSessionIdRef.current,
          ...context,
        },
      });
    };

    const handleWindowError = (event: ErrorEvent) => {
      reportClientError(
        event.error instanceof Error ? event.error.message : event.message || 'Unhandled browser error',
        'window.onerror',
        {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      );
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      reportClientError(
        reason instanceof Error ? reason.message : String(reason || 'Unhandled promise rejection'),
        'unhandledrejection',
      );
    };

    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [activeSessionIdRef]);
}
