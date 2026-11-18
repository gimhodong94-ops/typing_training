import type { ApiResult } from "../server/ai";

declare global {
  interface Window {
    typingCoach?: {
      request(path: string, body: unknown): Promise<ApiResult>;
      hasApiKey(): Promise<boolean>;
      saveApiKey(key: string): Promise<void>;
      clearApiKey(): Promise<void>;
    };
  }
}

export {};
