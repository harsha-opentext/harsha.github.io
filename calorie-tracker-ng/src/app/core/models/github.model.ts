export interface GitHubFileResponse {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  content: string;
  encoding: string;
  type?: string;
}

export interface GitHubContentsItem {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  download_url: string | null;
  type: 'file' | 'dir';
}

export interface GitHubPutResponse {
  content: GitHubFileResponse;
  commit: {
    sha: string;
    message: string;
  };
}

export interface ValidationResult {
  ok: boolean;
  message?: string;
}

export interface FetchDateResult {
  status: number;
  entries: import('./entry.model').AnyEntry[] | null;
}
