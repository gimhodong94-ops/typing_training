import type { Session } from "./types";
import { readSession } from "./sessionData";

const KEY = "typing-coach-sessions-v1";
const MAX_SESSIONS = 8;

export function loadSessions(): Session[] {
  try {
    const rows = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Session[];
    return rows.map(readSession);
  } catch {
    return [];
  }
}

export function saveSession(session: Session) {
  const { isLocalStorageOnly: _isLocalStorageOnly, ...persistedSession } = session;
  let raw: Session[];
  try {
    raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Session[];
  } catch {
    raw = [];
  }
  const existing = raw.find((s) => s.id === session.id);
  const valueToSave = existing
    ? existing.schemaVersion === undefined
      ? { ...existing, ...(persistedSession.feedback === undefined ? {} : { feedback: persistedSession.feedback }), ...(persistedSession.aiAnalysis === undefined ? {} : { aiAnalysis: persistedSession.aiAnalysis }), ...(persistedSession.analysis === undefined ? {} : { analysis: persistedSession.analysis }), ...(persistedSession.answers === undefined ? {} : { answers: persistedSession.answers }), ...(persistedSession.noteAnswers === undefined ? {} : { noteAnswers: persistedSession.noteAnswers }) }
      : { ...existing, ...persistedSession }
    : persistedSession;
  let list = [valueToSave, ...raw.filter((s) => s.id !== session.id)].slice(0, MAX_SESSIONS);
  while (list.length) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      return;
    } catch {
      list = list.slice(0, -1);
    }
  }
}
