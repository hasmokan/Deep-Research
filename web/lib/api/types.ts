/**
 * Type definitions for API requests and responses
 */

export interface ResearchRequest {
  query: string;
}

export interface ResearchResponse {
  id: string;
  query: string;
  status: string;
  documents_count: number;
  created_at: string;
}

export interface ResearchResult {
  query: string;
  documents: Document[];
  analysis: string | null;
  report: string | null;
  status: string;
}

export interface Document {
  id: number;
  content: string;
  metadata: Record<string, any>;
  similarity?: number;
}

export interface ApiError {
  detail: string;
}
