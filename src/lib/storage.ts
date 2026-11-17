import type { Session } from "./types";

const KEY = "typing-coach-sessions-v1";
const MAX_SESSIONS = 8;

export function loadSessions(): Session[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveSession(session: Session) {
  let list = [session, ...loadSessions().filter((s) => s.id !== session.id)].slice(0, MAX_SESSIONS);
  while (list.length) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      return;
    } catch {
      list = list.slice(0, -1);
    }
  }
}
