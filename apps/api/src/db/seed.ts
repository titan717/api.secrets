import { randomBytes } from "node:crypto";
import { sealBody } from "@secrets/shared";
import { db } from "./index.js";
import { uuid, token } from "../lib/http.js";
import { hashPassword } from "../modules/auth/service.js";
import { createChannel, DEFAULT_DOCK_HANDLE } from "../modules/docks/service.js";

export const BOT_USERNAME = "secrets";
export let botId = "";

const WELCOME_GENERAL = `Welcome to Secrets HQ 👋

Your world. Your people. Your space.

This is a public dock everyone joins on signup. Say hi, ask questions, and explore:
• Start a DM or a group from the chats tab
• Create your own dock (public or private) for your crew
• React, reply and share images in any conversation`;

const WELCOME_ANNOUNCEMENTS = `📣 Product news and updates from the Secrets team land here. Only dock admins can post in #announcements.`;

/** First-boot seed: the "secrets" bot and the public "Secrets HQ" dock. Idempotent. */
export async function seed(log: (m: string) => void) {
  let bot = await db.one<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [BOT_USERNAME]);
  if (!bot) {
    const id = uuid();
    const hash = await hashPassword(randomBytes(24).toString("hex"));
    await db.query(
      `INSERT INTO users (id, username, password_hash, display_name, about, is_bot, accent) VALUES ($1, $2, $3, 'Secrets', $4, true, '#7c5cff')
       ON CONFLICT (username) DO NOTHING`,
      [id, BOT_USERNAME, hash, "The official Secrets account."],
    );
    bot = await db.one(`SELECT id FROM users WHERE username = $1`, [BOT_USERNAME]);
    log("seeded bot user @secrets");
  }
  botId = bot!.id;

  const dock = await db.one(`SELECT id FROM docks WHERE handle = $1`, [DEFAULT_DOCK_HANDLE]);
  if (dock) return;
  const dockId = uuid();
  const channels = await db.tx(async (q) => {
    await q.query(
      `INSERT INTO docks (id, name, handle, description, visibility, owner_id, invite_code) VALUES ($1, 'Secrets HQ', $2, $3, 'public', $4, $5)`,
      [dockId, DEFAULT_DOCK_HANDLE, "The official home of Secrets. Meet people, share feedback, hear what's new.", botId, token(6)],
    );
    await q.query(`INSERT INTO dock_members (dock_id, user_id, role) VALUES ($1, $2, 'owner')`, [dockId, botId]);
    const general = await createChannel(q, dockId, "general", "Say hi 👋", botId, 0);
    const ann = await createChannel(q, dockId, "announcements", "News from the Secrets team", botId, 1);
    return { general, ann };
  });
  for (const [ch, text] of [
    [channels.general, WELCOME_GENERAL],
    [channels.ann, WELCOME_ANNOUNCEMENTS],
  ] as const) {
    const id = uuid();
    const { ciphertext, nonce } = sealBody({ text });
    await db.query(
      `INSERT INTO messages (id, conversation_id, sender_id, device_id, ciphertext, nonce, client_msg_id) VALUES ($1,$2,$3,'server',$4,$5,$6)`,
      [id, ch.id, botId, ciphertext, nonce, `seed-${ch.name}`],
    );
    await db.query(`UPDATE conversations SET last_message_at = now() WHERE id = $1`, [ch.id]);
  }
  // Existing users (e.g. seeded on an older DB) join too.
  await db.query(`INSERT INTO dock_members (dock_id, user_id) SELECT $1, id FROM users WHERE is_bot = false ON CONFLICT DO NOTHING`, [dockId]);
  log("seeded dock Secrets HQ (#general, #announcements)");
}
