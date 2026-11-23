import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export function atomicWriteFile(file: string, contents: string) {
  const temp = `${file}.tmp`;
  writeFileSync(temp, contents, "utf8");
  renameSync(temp, file);
}

export type SessionLine = { sessionId: number; type: "analysis" | "raw" | "ai_analysis" | "answers" | "feedback" | "note_answer"; data: unknown };

export function readSessionLines(file: string): SessionLine[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as SessionLine);
}

export function appendSessionJsonl(file: string, sessionId: number, initial: boolean, records: SessionLine[]) {
  let lines = initial ? readSessionLines(file).filter((line) => line.sessionId !== sessionId) : readSessionLines(file);
  lines = [...lines, ...records];
  atomicWriteFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
}

export function sessionsFromJsonl(lines: SessionLine[]) {
  const sessions = new Map<number, any>();
  for (const line of lines) if (line.type === "raw" && (line.data as any)?.id) sessions.set(line.sessionId, line.data);
  for (const line of lines) {
    const session = sessions.get(line.sessionId);
    if (!session) continue;
    if (line.type === "ai_analysis") session.aiAnalysis = line.data;
    if (line.type === "answers") session.answers = line.data;
    if (line.type === "feedback") session.feedback = line.data;
    if (line.type === "note_answer") session.noteAnswers = [...(session.noteAnswers ?? []), line.data];
  }
  return [...sessions.values()];
}
