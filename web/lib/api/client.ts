/**
 * API client for Deep Research backend
 */

import type {
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

export class ApiClient {
  private baseUrl: string;
  private accessTokenProvider: (() => string | null | undefined) | null = null;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  setAccessTokenProvider(provider: (() => string | null | undefined) | null) {
    this.accessTokenProvider = provider;
  }

  private headers(headers?: HeadersInit): Headers {
    const nextHeaders = new Headers(headers);

    if (!nextHeaders.has('Content-Type')) {
      nextHeaders.set('Content-Type', 'application/json');
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

    const response = await fetch(url, {
      ...options,
      headers: this.headers(options?.headers),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        detail: 'An unknown error occurred',
      }));
      throw new Error(error.detail || `HTTP ${response.status}`);
    }

    return response.json();
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
    const response = await fetch(`${this.baseUrl}/api/research/plan/stream`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(request),
      signal: handlers.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        detail: 'Research plan stream failed',
      }));
      throw new Error(error.detail || `HTTP ${response.status}`);
    }

    if (!response.body) {
      throw new Error('Research plan stream response was empty');
    }

    return this.readResearchPlanStream(response.body, handlers);
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
    const params = new URLSearchParams();
    if (handlers.afterSeq && handlers.afterSeq > 0) {
      params.set('after_seq', String(handlers.afterSeq));
    }
    const queryString = params.toString();
    const response = await fetch(
      `${this.baseUrl}/api/research/runs/${encodeURIComponent(runId)}/stream${queryString ? `?${queryString}` : ''}`,
      {
        method: 'GET',
        headers: this.headers(),
        signal: handlers.signal,
      },
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        detail: 'Research run stream failed',
      }));
      throw new Error(error.detail || `HTTP ${response.status}`);
    }

    if (!response.body) {
      throw new Error('Research run stream response was empty');
    }

    return this.readResearchStream(response.body, handlers);
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

  /**
   * Execute research and stream progress with Server-Sent Events
   */
  async streamResearch(
    request: ResearchRequest,
    handlers: ResearchStreamHandlers = {}
  ): Promise<ResearchResult> {
    const response = await fetch(`${this.baseUrl}/api/research/stream`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(request),
      signal: handlers.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        detail: 'Research stream failed',
      }));
      throw new Error(error.detail || `HTTP ${response.status}`);
    }

    if (!response.body) {
      throw new Error('Research stream response was empty');
    }

    return this.readResearchStream(response.body, handlers);
  }

  private async readResearchStream(
    body: ReadableStream<Uint8Array>,
    handlers: ResearchStreamHandlers
  ): Promise<ResearchResult> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });

      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';

      for (const block of blocks) {
        const result = this.handleResearchStreamEvent(block, handlers);
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
  ): { type: 'pending' } | { type: 'complete'; payload: ResearchResult } | { type: 'error'; message: string } {
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
    } else if (event === 'status') {
      handlers.onStatus?.(payload);
    } else if (event === 'trace') {
      handlers.onTrace?.(payload);
    } else if (event === 'agent_message') {
      handlers.onAgentMessage?.(payload);
    } else if (event === 'documents') {
      handlers.onDocuments?.(payload.documents ?? []);
    } else if (event === 'thinking') {
      handlers.onThinking?.(payload);
    } else if (event === 'analysis') {
      handlers.onAnalysis?.(payload.analysis ?? null);
    } else if (event === 'report') {
      handlers.onReport?.(payload.report ?? null);
    } else if (event === 'answer_delta') {
      handlers.onAnswerDelta?.(payload.delta ?? '');
    } else if (event === 'answer') {
      handlers.onAnswer?.(payload.answer ?? null);
    } else if (event === 'complete') {
      return { type: 'complete', payload };
    } else if (event === 'stream_error') {
      return { type: 'error', message: payload.detail ?? 'Research stream failed' };
    }

    return { type: 'pending' };
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
