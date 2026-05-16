/**
 * API client for Deep Research backend
 */

import type {
  Document,
  ResearchPlanResponse,
  ResearchRequest,
  ResearchResponse,
  ResearchResult,
  ResearchStreamHandlers,
} from './types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
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
   * Execute research and get full results including report
   */
  async executeResearch(request: ResearchRequest): Promise<ResearchResult> {
    return this.request<ResearchResult>('/api/research/execute', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Execute research and stream progress with Server-Sent Events
   */
  async streamResearch(
    request: ResearchRequest,
    handlers: ResearchStreamHandlers = {}
  ): Promise<ResearchResult> {
    const url = `${this.baseUrl}/api/research/stream?query=${encodeURIComponent(request.query)}`;

    return new Promise((resolve, reject) => {
      const eventSource = new EventSource(url);
      const abortHandler = () => {
        eventSource.close();
        reject(new Error('Research cancelled'));
      };

      if (handlers.signal?.aborted) {
        abortHandler();
        return;
      }

      handlers.signal?.addEventListener('abort', abortHandler, { once: true });

      const cleanup = () => {
        eventSource.close();
        handlers.signal?.removeEventListener('abort', abortHandler);
      };

      eventSource.addEventListener('status', (event) => {
        handlers.onStatus?.(JSON.parse(event.data));
      });

      eventSource.addEventListener('documents', (event) => {
        handlers.onDocuments?.(JSON.parse(event.data).documents ?? []);
      });

      eventSource.addEventListener('thinking', (event) => {
        handlers.onThinking?.(JSON.parse(event.data));
      });

      eventSource.addEventListener('analysis', (event) => {
        handlers.onAnalysis?.(JSON.parse(event.data).analysis ?? null);
      });

      eventSource.addEventListener('report', (event) => {
        handlers.onReport?.(JSON.parse(event.data).report ?? null);
      });

      eventSource.addEventListener('complete', (event) => {
        cleanup();
        resolve(JSON.parse(event.data));
      });

      eventSource.addEventListener('stream_error', (event) => {
        cleanup();
        const message = JSON.parse(event.data).detail ?? 'Research stream failed';
        reject(new Error(message));
      });

      eventSource.onerror = () => {
        cleanup();
        reject(new Error('Research stream connection failed'));
      };
    });
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
