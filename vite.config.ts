import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function aiApi(): Plugin {
  const env = loadEnv("development", process.cwd(), "");
  return {
    name: "ai-api",
    configureServer(server) {
      server.middlewares.use("/api", async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify(body));
        };
        if (req.method !== "POST") return send(405, { error: "POST만 받아요." });
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        let body: unknown = {};
        try {
          const raw = Buffer.concat(chunks).toString("utf-8");
          body = raw ? JSON.parse(raw) : {};
        } catch {
          return send(400, { error: "요청 형식이 올바르지 않아요." });
        }
        const mod = await server.ssrLoadModule("/server/ai.ts");
        const out = await mod.handleApi("/api" + (req.url ?? ""), body, {
          GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? env.GEMINI_API_KEY,
          GEMINI_MODEL: process.env.GEMINI_MODEL ?? env.GEMINI_MODEL,
        });
        send(out.status, out.body);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), aiApi()],
  server: { host: "0.0.0.0", port: 5173, allowedHosts: true },
});
