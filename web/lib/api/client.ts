/**
 * API client for Deep Research backend
 */

import type {
  AgentSkill,
  AgentSkillUpsertRequest,
  ClientErrorLogRequest,
  Document,
  ResearchPlanStreamHandlers,
  ResearchPlanResponse,
  ResearchRequest,
  ResearchResponse,
  ResearchResult,
  ResearchRun,
  ResearchRunStreamHandlers,
  ResearchStreamHandlers,
  ResearchThread,
  ResearchThreadUpdate,
} from './types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

type ResearchStreamEventResult =
  | { type: 'pending' }
  | { type: 'values'; payload: ResearchResult }
  | { type: 'end' }
  | { type: 'error'; message: string };

type ResearchStreamHandlerKey =
  | 'onMetadata'
  | 'onStatus'
  | 'onTrace'
  | 'onAgentMessage'
  | 'onDocuments'
  | 'onThinking'
  | 'onAnalysis'
  | 'onReport'
  | 'onAnswerDelta'
  | 'onAnswer'
  | 'onTokenUsage';

type HandlerPayload<T extends ResearchStreamHandlerKey> =
  Parameters<NonNullable<ResearchStreamHandlers[T]>>[0];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export class ApiClient {
  private baseUrl: string;
  private accessTokenProvider: (() => string | null | undefined) | null = null;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  setAccessTokenProvider(provider: (() => string | null | undefined) | null) {
    this.accessTokenProvider = provider;
  }

  private newRequestId(): string {
    const randomId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `req-${randomId}`;
  }

  private headers(headers?: HeadersInit, requestId: string = this.newRequestId()): Headers {
    const nextHeaders = new Headers(headers);

    if (!nextHeaders.has('Content-Type')) {
      nextHeaders.set('Content-Type', 'application/json');
    }

    if (!nextHeaders.has('X-Request-ID')) {
      nextHeaders.set('X-Request-ID', requestId);
    }

    const token = this.accessTokenProvider?.();
    if (token && !nextHeaders.has('Authorization')) {
      nextHeaders.set('Authorization', `Bearer ${token}`);
    }

    return nextHeaders;
  }

  private async request<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const requestId = this.newRequestId();

    try {
      const response = await fetch(url, {
        ...options,
        headers: this.headers(options?.headers, requestId),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          detail: 'An unknown error occurred',
        }));
        const message = error.detail || `HTTP ${response.status}`;
        this.reportApiFailure(endpoint, message, requestId, {
          status: response.status,
          method: options?.method ?? 'GET',
        });
        throw this.withRequestId(new Error(message), requestId);
      }

      return response.json();
    } catch (error) {
      if (error instanceof Error && !('requestId' in error)) {
        this.reportApiFailure(endpoint, error.message, requestId, {
          method: options?.method ?? 'GET',
        });
        throw this.withRequestId(error, requestId);
      }
      throw error;
    }
  }

  async reportClientError(request: ClientErrorLogRequest): Promise<void> {
    const requestId = request.request_id ?? this.newRequestId();
    const payload: ClientErrorLogRequest = {
      ...this.defaultClientErrorContext(),
      ...request,
    };

    await fetch(`${this.baseUrl}/api/diagnostics/client-error`, {
      method: 'POST',
      headers: this.headers(undefined, requestId),
      body: JSON.stringify(payload),
    }).catch(() => undefined);
  }

  private reportApiFailure(
    endpoint: string,
    message: string,
    requestId: string,
    context: Record<string, unknown>
  ): void {
    void this.reportClientError({
      message,
      source: 'api-client',
      level: 'error',
      request_id: requestId,
      context: {
        endpoint,
        ...context,
      },
    });
  }

  private withRequestId<T extends Error>(error: T, requestId: string): T & { requestId: string } {
    return Object.assign(error, { requestId });
  }

  private defaultClientErrorContext(): Pick<ClientErrorLogRequest, 'url' | 'user_agent'> {
    return {
      url: typeof window !== 'undefined' ? window.location.href : undefined,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    };
  }

  /**
   * Execute a research query (returns basic info)
   */
  async createResearch(request: ResearchRequest): Promise<ResearchResponse> {
    return this.request<ResearchResponse>('/api/research/', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Generate a query-specific research plan before starting research
   */
  async createResearchPlan(request: ResearchRequest): Promise<ResearchPlanResponse> {
    return this.request<ResearchPlanResponse>('/api/research/plan', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Generate a research plan and stream plan progress with Server-Sent Events
   */
  async streamResearchPlan(
    request: ResearchRequest,
    handlers: ResearchPlanStreamHandlers = {}
  ): Promise<ResearchPlanResponse> {
    const requestId = this.newRequestId();
    const response = await fetch(`${this.baseUrl}/api/research/plan/stream`, {
      method: 'POST',
      headers: this.headers(undefined, requestId),
      body: JSON.stringify(request),
      signal: handlers.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        detail: 'Research plan stream failed',
      }));
      const message = error.detail || `HTTP ${response.status}`;
      this.reportApiFailure('/api/research/plan/stream', message, requestId, { status: response.status, method: 'POST' });
      throw this.withRequestId(new Error(message), requestId);
    }

    if (!response.body) {
      const message = 'Research plan stream response was empty';
      this.reportApiFailure('/api/research/plan/stream', message, requestId, { method: 'POST' });
      throw this.withRequestId(new Error(message), requestId);
    }

    try {
      return await this.readResearchPlanStream(response.body, handlers);
    } catch (error) {
      if (error instanceof Error) {
        this.reportApiFailure('/api/research/plan/stream', error.message, requestId, { method: 'POST', stream: true });
        throw this.withRequestId(error, requestId);
      }
      throw error;
    }
  }

  /**
   * Execute research and get full results including report
   */
  async executeResearch(request: ResearchRequest): Promise<ResearchResult> {
    return this.request<ResearchResult>('/api/research/execute', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async getResearchRun(runId: string): Promise<ResearchRun> {
    return this.request<ResearchRun>(`/api/research/runs/${encodeURIComponent(runId)}`);
  }

  async streamResearchRun(
    runId: string,
    handlers: ResearchRunStreamHandlers = {}
  ): Promise<ResearchResult> {
    const requestId = this.newRequestId();
    const params = new URLSearchParams();
    if (handlers.afterSeq && handlers.afterSeq > 0) {
      params.set('after_seq', String(handlers.afterSeq));
    }
    const queryString = params.toString();
    const response = await fetch(
      `${this.baseUrl}/api/research/runs/${encodeURIComponent(runId)}/stream${queryString ? `?${queryString}` : ''}`,
      {
        method: 'GET',
        headers: this.headers(undefined, requestId),
        signal: handlers.signal,
      },
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        detail: 'Research run stream failed',
      }));
      const message = error.detail || `HTTP ${response.status}`;
      this.reportApiFailure(`/api/research/runs/${runId}/stream`, message, requestId, { status: response.status, method: 'GET' });
      throw this.withRequestId(new Error(message), requestId);
    }

    if (!response.body) {
      const message = 'Research run stream response was empty';
      this.reportApiFailure(`/api/research/runs/${runId}/stream`, message, requestId, { method: 'GET' });
      throw this.withRequestId(new Error(message), requestId);
    }

    try {
      return await this.readResearchStream(response.body, handlers);
    } catch (error) {
      if (error instanceof Error) {
        this.reportApiFailure(`/api/research/runs/${runId}/stream`, error.message, requestId, { method: 'GET', stream: true });
        throw this.withRequestId(error, requestId);
      }
      throw error;
    }
  }

  async listResearchThreads(): Promise<ResearchThread[]> {
    return this.request<ResearchThread[]>('/api/research/threads');
  }

  async getResearchThread(threadId: string): Promise<ResearchThread> {
    return this.request<ResearchThread>(`/api/research/threads/${encodeURIComponent(threadId)}`);
  }

  async saveResearchThread(threadId: string, thread: ResearchThreadUpdate): Promise<ResearchThread> {
    return this.request<ResearchThread>(`/api/research/threads/${encodeURIComponent(threadId)}`, {
      method: 'PUT',
      body: JSON.stringify(thread),
    });
  }

  async listAgentSkills(): Promise<AgentSkill[]> {
    return this.request<AgentSkill[]>('/api/skills');
  }

  async upsertAgentSkill(name: string, skill: AgentSkillUpsertRequest): Promise<AgentSkill> {
    return this.request<AgentSkill>(`/api/skills/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(skill),
    });
  }

  async setAgentSkillEnabled(name: string, enabled: boolean): Promise<AgentSkill> {
    return this.request<AgentSkill>(`/api/skills/${encodeURIComponent(name)}/enabled`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
  }

  async deleteAgentSkill(name: string): Promise<{ deleted: boolean; name: string }> {
    return this.request<{ deleted: boolean; name: string }>(`/api/skills/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  }

  /**
   * Execute research and stream progress with Server-Sent Events
   */
  async streamResearch(
    request: ResearchRequest,
    handlers: ResearchStreamHandlers = {}
  ): Promise<ResearchResult> {
    const requestId = this.newRequestId();
    const response = await fetch(`${this.baseUrl}/api/research/stream`, {
      method: 'POST',
      headers: this.headers(undefined, requestId),
      body: JSON.stringify(request),
      signal: handlers.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        detail: 'Research stream failed',
      }));
      const message = error.detail || `HTTP ${response.status}`;
      this.reportApiFailure('/api/research/stream', message, requestId, { status: response.status, method: 'POST' });
      throw this.withRequestId(new Error(message), requestId);
    }

    if (!response.body) {
      const message = 'Research stream response was empty';
      this.reportApiFailure('/api/research/stream', message, requestId, { method: 'POST' });
      throw this.withRequestId(new Error(message), requestId);
    }

    try {
      return await this.readResearchStream(response.body, handlers);
    } catch (error) {
      if (error instanceof Error) {
        this.reportApiFailure('/api/research/stream', error.message, requestId, { method: 'POST', stream: true });
        throw this.withRequestId(error, requestId);
      }
      throw error;
    }
  }

  private async readResearchStream(
    body: ReadableStream<Uint8Array>,
    handlers: ResearchStreamHandlers
  ): Promise<ResearchResult> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let latestValues: ResearchResult | null = null;

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });

      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';

      for (const block of blocks) {
        const result = this.handleResearchStreamEvent(block, handlers);
        if (result.type === 'values') {
          latestValues = result.payload;
        }
        if (result.type === 'end') {
          reader.releaseLock();
          if (latestValues) {
            return latestValues;
          }
          throw new Error('Research stream ended before final values');
        }
        if (result.type === 'error') {
          reader.releaseLock();
          throw new Error(result.message);
        }
      }

      if (done) {
        break;
      }
    }

    throw new Error('Research stream ended before completion');
  }

  private async readResearchPlanStream(
    body: ReadableStream<Uint8Array>,
    handlers: ResearchPlanStreamHandlers
  ): Promise<ResearchPlanResponse> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });

      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';

      for (const block of blocks) {
        const result = this.handleResearchPlanStreamEvent(block, handlers);
        if (result.type === 'complete') {
          reader.releaseLock();
          return result.payload;
        }
        if (result.type === 'error') {
          reader.releaseLock();
          throw new Error(result.message);
        }
      }

      if (done) {
        break;
      }
    }

    throw new Error('Research plan stream ended before completion');
  }

  private handleResearchPlanStreamEvent(
    block: string,
    handlers: ResearchPlanStreamHandlers
  ): { type: 'pending' } | { type: 'complete'; payload: ResearchPlanResponse } | { type: 'error'; message: string } {
    const event = block
      .split('\n')
      .find((line) => line.startsWith('event: '))
      ?.slice('event: '.length)
      .trim();
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice('data: '.length))
      .join('\n');

    if (!event || !data) {
      return { type: 'pending' };
    }

    const payload = JSON.parse(data);

    if (event === 'status') {
      handlers.onStatus?.(payload);
    } else if (event === 'plan') {
      handlers.onPlan?.(payload);
    } else if (event === 'complete') {
      return { type: 'complete', payload };
    } else if (event === 'stream_error') {
      return { type: 'error', message: payload.detail ?? 'Research plan stream failed' };
    }

    return { type: 'pending' };
  }

  private handleResearchStreamEvent(
    block: string,
    handlers: ResearchStreamHandlers
  ): ResearchStreamEventResult {
    const event = block
      .split('\n')
      .find((line) => line.startsWith('event: '))
      ?.slice('event: '.length)
      .trim();
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice('data: '.length))
      .join('\n');

    if (!event || !data) {
      return { type: 'pending' };
    }

    const payload = JSON.parse(data);

    if (event === 'metadata') {
      handlers.onMetadata?.(payload);
    } else if (event === 'messages' || event === 'messages-tuple') {
      const messagePayload = Array.isArray(payload) ? payload[0] : payload;
      handlers.onAgentMessage?.(messagePayload as HandlerPayload<'onAgentMessage'>);
    } else if (event === 'custom') {
      this.handleResearchCustomStreamEvent(payload, handlers);
    } else if (event === 'values') {
      return { type: 'values', payload };
    } else if (event === 'end') {
      return { type: 'end' };
    } else if (event === 'error') {
      return { type: 'error', message: payload.message ?? payload.detail ?? 'Research stream failed' };
    }

    return { type: 'pending' };
  }

  private handleResearchCustomStreamEvent(
    payload: { type?: string; data?: unknown },
    handlers: ResearchStreamHandlers,
  ): void {
    const type = payload?.type;
    const data = payload?.data;
    const dataRecord = isRecord(data) ? data : {};

    if (type === 'status') {
      handlers.onStatus?.(data as HandlerPayload<'onStatus'>);
    } else if (type === 'trace') {
      handlers.onTrace?.(data as HandlerPayload<'onTrace'>);
    } else if (type === 'agent_message') {
      handlers.onAgentMessage?.(data as HandlerPayload<'onAgentMessage'>);
    } else if (type === 'documents') {
      handlers.onDocuments?.(
        (Array.isArray(dataRecord.documents) ? dataRecord.documents : []) as HandlerPayload<'onDocuments'>,
      );
    } else if (type === 'thinking') {
      handlers.onThinking?.(data as HandlerPayload<'onThinking'>);
    } else if (type === 'analysis') {
      handlers.onAnalysis?.(
        (typeof dataRecord.analysis === 'string' ? dataRecord.analysis : null) as HandlerPayload<'onAnalysis'>,
      );
    } else if (type === 'report') {
      handlers.onReport?.(
        (typeof dataRecord.report === 'string' ? dataRecord.report : null) as HandlerPayload<'onReport'>,
      );
    } else if (type === 'answer_delta') {
      handlers.onAnswerDelta?.(
        (typeof dataRecord.delta === 'string' ? dataRecord.delta : '') as HandlerPayload<'onAnswerDelta'>,
      );
    } else if (type === 'answer') {
      handlers.onAnswer?.(
        (typeof dataRecord.answer === 'string' ? dataRecord.answer : null) as HandlerPayload<'onAnswer'>,
      );
    } else if (type === 'token_usage') {
      handlers.onTokenUsage?.(data as HandlerPayload<'onTokenUsage'>);
    }
  }

  /**
   * List all documents in the vector database
   */
  async listDocuments(limit: number = 50, offset: number = 0): Promise<Document[]> {
    return this.request<Document[]>(
      `/api/research/documents?limit=${limit}&offset=${offset}`
    );
  }

  /**
   * Add a new document to the vector database
   */
  async addDocument(content: string, metadata: Record<string, unknown> = {}): Promise<{ id: number; message: string }> {
    return this.request<{ id: number; message: string }>('/api/research/documents', {
      method: 'POST',
      body: JSON.stringify({ content, metadata }),
    });
  }

  /**
   * Delete a document from the vector database
   */
  async deleteDocument(documentId: number): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/api/research/documents/${documentId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Health check endpoint
   */
  async healthCheck(): Promise<{ status: string }> {
    return this.request<{ status: string }>('/health');
  }
}

// Export singleton instance
export const apiClient = new ApiClient();
