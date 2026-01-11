/**
 * API client for Deep Research backend
 */

import type { ResearchRequest, ResearchResponse, ResearchResult, Document } from './types';

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
   * Execute research and get full results including report
   */
  async executeResearch(request: ResearchRequest): Promise<ResearchResult> {
    return this.request<ResearchResult>('/api/research/execute', {
      method: 'POST',
      body: JSON.stringify(request),
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
  async addDocument(content: string, metadata: Record<string, any> = {}): Promise<{ id: number; message: string }> {
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
