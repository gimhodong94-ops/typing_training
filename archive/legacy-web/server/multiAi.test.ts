import { afterEach, describe, expect, it, vi } from "vitest";
import { handleApi } from "./ai";
import { AI_MODELS } from "../shared/aiModels";

afterEach(() => vi.unstubAllGlobals());

describe("Multi AI OpenAI-compatible gateway", () => {
  it("sends the selected model and bearer key to the gateway and parses chat completions", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.baze.co/v1/gateway/chat/completions");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer multi-ai-test-key");
      const request = JSON.parse(String(init?.body));
      expect(request.model).toBe("claude-haiku-5-5");
      expect(request.messages.map((message: { role: string }) => message.role)).toEqual(["system", "user"]);
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ headline: "잘했어요", strengths: [], weaknesses: [], nextStep: "이어가요" }) } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await handleApi("/api/feedback", { summary: {} }, {
      AI_PROVIDER: "multi-ai", AI_MODEL: "claude-haiku-5-5", MULTI_AI_API_KEY: "multi-ai-test-key",
    });
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("exposes the requested model list and retains both existing Gemini choices", () => {
    expect(AI_MODELS["multi-ai"]).toEqual([
      "gpt-6.2-sol", "gpt-6.1-terra", "gpt-6-luna",
      "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5",
      "gemini-4-carbon", "gemini-4-neon", "gemini-4-hydrogen", "gemini-4-argon",
    ]);
    expect(AI_MODELS.gemini).toEqual(["gemini-3.5-flash-lite", "gemini-3.8-flash"]);
  });
});
