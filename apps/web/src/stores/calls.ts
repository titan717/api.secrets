import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { VoiceRoom } from "@secrets/shared";
import { VOICE_URL } from "../config";
import { uuid } from "../lib/id";
import { getToken } from "./session";
import { toast } from "./toast";

export interface CallRecord {
  id: string;
  conversation_id: string;
  title: string;
  kind: "voice" | "video";
  started_at: string;
  ended_at?: string;
  outcome: "completed" | "failed" | "missed";
  avatar_seed?: string;
}

export interface ActiveCall extends VoiceRoom {
  id: string;
  conversation_id: string;
  title: string;
  started_at: string;
}

interface CallState {
  active: ActiveCall | null;
  starting: boolean;
  history: CallRecord[];
  start: (opts: { conversation_id: string; kind: "voice" | "video"; title: string }) => Promise<void>;
  end: () => void;
  clearHistory: () => void;
}

export const useCalls = create<CallState>()(
  persist(
    (set, get) => ({
      active: null,
      starting: false,
      history: [],
      start: async ({ conversation_id, kind, title }) => {
        if (get().active) {
          toast.info("You’re already in a call");
          return;
        }
        set({ starting: true });
        const id = uuid();
        const started_at = new Date().toISOString();
        try {
          const res = await fetch(`${VOICE_URL}/v1/rooms`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
            body: JSON.stringify({ conversation_id, kind }),
          });
          if (!res.ok) {
            let msg = `Call service returned ${res.status}`;
            try {
              msg = (await res.json()).message ?? msg;
            } catch {
              /* ignore */
            }
            throw new Error(msg);
          }
          const room = (await res.json()) as VoiceRoom;
          set({ active: { ...room, kind: room.kind ?? kind, id, conversation_id, title, started_at } });
        } catch (e) {
          const offline = e instanceof TypeError;
          toast.error(offline ? "Calls aren’t reachable right now. The voice service may be offline — try again in a bit." : (e as Error).message);
          set({ history: [{ id, conversation_id, title, kind, started_at, outcome: "failed" as const }, ...get().history].slice(0, 100) });
        } finally {
          set({ starting: false });
        }
      },
      end: () => {
        const a = get().active;
        if (!a) return;
        set({
          active: null,
          history: [{ id: a.id, conversation_id: a.conversation_id, title: a.title, kind: a.kind, started_at: a.started_at, ended_at: new Date().toISOString(), outcome: "completed" as const }, ...get().history].slice(0, 100),
        });
      },
      clearHistory: () => set({ history: [] }),
    }),
    { name: "secrets.calls", partialize: (s) => ({ history: s.history }) as Partial<CallState> },
  ),
);
