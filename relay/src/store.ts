// All SQL in one place. Works on Cloudflare D1 and, in tests, on node:sqlite.

import type { AlertRow, D1Database, GuardianRow, InstallRow, PairingRow } from './types.ts';

export const MAX_GUARDIANS = 3;
const DAY_MS = 24 * 60 * 60_000;

export class Store {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  // ------------------------------------------------------------ installs

  async createInstall(row: Omit<InstallRow, 'silent_notified' | 'removed_at'>): Promise<boolean> {
    const existing = await this.db.prepare('SELECT id FROM installs WHERE id = ?').bind(row.id).first();
    if (existing) return false;
    await this.db
      .prepare(
        `INSERT INTO installs (id, secret_hash, uninstall_hash, name, profile, language, time_zone, created_at, last_seen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(row.id, row.secret_hash, row.uninstall_hash, row.name, row.profile, row.language, row.time_zone, row.created_at, row.last_seen)
      .run();
    return true;
  }

  getInstall(id: string): Promise<InstallRow | null> {
    return this.db.prepare('SELECT * FROM installs WHERE id = ?').bind(id).first<InstallRow>();
  }

  async updateInstall(id: string, patch: Partial<Pick<InstallRow, 'name' | 'profile' | 'language' | 'time_zone'>>): Promise<void> {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (!keys.length) return;
    const sets = keys.map((key) => `${key} = ?`).join(', ');
    await this.db.prepare(`UPDATE installs SET ${sets} WHERE id = ?`).bind(...keys.map((key) => patch[key]), id).run();
  }

  async touch(id: string, now: number): Promise<void> {
    await this.db.prepare('UPDATE installs SET last_seen = ?, silent_notified = 0 WHERE id = ?').bind(now, id).run();
  }

  async markRemoved(id: string, now: number): Promise<void> {
    await this.db.prepare('UPDATE installs SET removed_at = ? WHERE id = ?').bind(now, id).run();
  }

  async markSilentNotified(id: string): Promise<void> {
    await this.db.prepare('UPDATE installs SET silent_notified = 1 WHERE id = ?').bind(id).run();
  }

  async deleteInstall(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM alert_messages WHERE alert_id IN (SELECT id FROM alerts WHERE install_id = ?)').bind(id).run();
    await this.db.prepare('DELETE FROM alerts WHERE install_id = ?').bind(id).run();
    await this.db.prepare('DELETE FROM pairings WHERE install_id = ?').bind(id).run();
    await this.db.prepare('DELETE FROM guardians WHERE install_id = ?').bind(id).run();
    await this.db.prepare('DELETE FROM installs WHERE id = ?').bind(id).run();
  }

  /** Linked installs that have not been heard from since `cutoff` and were not reported yet. */
  async silentInstalls(cutoff: number): Promise<InstallRow[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM installs
         WHERE last_seen < ? AND silent_notified = 0 AND removed_at IS NULL
           AND id IN (SELECT install_id FROM guardians)`,
      )
      .bind(cutoff)
      .all<InstallRow>();
    return results;
  }

  // ------------------------------------------------------------ guardians

  async listGuardians(installId: string): Promise<GuardianRow[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM guardians WHERE install_id = ? ORDER BY created_at')
      .bind(installId)
      .all<GuardianRow>();
    return results;
  }

  async isGuardian(installId: string, chatId: number): Promise<GuardianRow | null> {
    return this.db.prepare('SELECT * FROM guardians WHERE install_id = ? AND chat_id = ?').bind(installId, chatId).first<GuardianRow>();
  }

  async addGuardian(row: GuardianRow): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO guardians (install_id, chat_id, name, language, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (install_id, chat_id) DO UPDATE SET name = excluded.name`,
      )
      .bind(row.install_id, row.chat_id, row.name, row.language, row.created_at)
      .run();
  }

  async installsForChat(chatId: number): Promise<InstallRow[]> {
    const { results } = await this.db
      .prepare('SELECT installs.* FROM installs JOIN guardians ON guardians.install_id = installs.id WHERE guardians.chat_id = ?')
      .bind(chatId)
      .all<InstallRow>();
    return results;
  }

  async removeChat(chatId: number): Promise<number> {
    const result = await this.db.prepare('DELETE FROM guardians WHERE chat_id = ?').bind(chatId).run();
    return result.meta?.changes ?? 0;
  }

  async chatLanguage(chatId: number): Promise<string | null> {
    const row = await this.db.prepare('SELECT language FROM guardians WHERE chat_id = ? LIMIT 1').bind(chatId).first<{ language: string }>();
    return row?.language ?? null;
  }

  async setChatLanguage(chatId: number, language: string): Promise<void> {
    await this.db.prepare('UPDATE guardians SET language = ? WHERE chat_id = ?').bind(language, chatId).run();
  }

  // ------------------------------------------------------------ pairings

  async createPairing(code: string, installId: string, expiresAt: number): Promise<void> {
    await this.db.prepare('DELETE FROM pairings WHERE install_id = ? AND chat_id IS NULL').bind(installId).run();
    await this.db.prepare('INSERT INTO pairings (code, install_id, expires_at) VALUES (?, ?, ?)').bind(code, installId, expiresAt).run();
  }

  getPairing(code: string): Promise<PairingRow | null> {
    return this.db.prepare('SELECT * FROM pairings WHERE code = ?').bind(code).first<PairingRow>();
  }

  async usePairing(code: string, chatId: number, name: string): Promise<void> {
    await this.db.prepare('UPDATE pairings SET chat_id = ?, guardian_name = ? WHERE code = ?').bind(chatId, name, code).run();
  }

  // ------------------------------------------------------------ alerts

  async createAlert(row: Pick<AlertRow, 'id' | 'install_id' | 'kind' | 'host' | 'created_at'>): Promise<void> {
    await this.db
      .prepare('INSERT INTO alerts (id, install_id, kind, host, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(row.id, row.install_id, row.kind, row.host, row.created_at)
      .run();
  }

  getAlert(id: string): Promise<AlertRow | null> {
    return this.db.prepare('SELECT * FROM alerts WHERE id = ?').bind(id).first<AlertRow>();
  }

  /** Records the first decision only. Returns false when someone already decided. */
  async decideAlert(id: string, status: 'allowed' | 'blocked', always: boolean, by: string, now: number): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE alerts SET status = ?, always_allow = ?, decided_by = ?, decided_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .bind(status, always ? 1 : 0, by, now, id)
      .run();
    return (result.meta?.changes ?? 0) > 0;
  }

  async setReply(id: string, reply: string, by: string): Promise<void> {
    await this.db.prepare('UPDATE alerts SET reply = ?, reply_by = ? WHERE id = ?').bind(reply, by, id).run();
  }

  async addAlertMessage(alertId: string, chatId: number, messageId: number): Promise<void> {
    await this.db
      .prepare('INSERT OR REPLACE INTO alert_messages (alert_id, chat_id, message_id) VALUES (?, ?, ?)')
      .bind(alertId, chatId, messageId)
      .run();
  }

  async alertMessages(alertId: string): Promise<{ chat_id: number; message_id: number }[]> {
    const { results } = await this.db
      .prepare('SELECT chat_id, message_id FROM alert_messages WHERE alert_id = ?')
      .bind(alertId)
      .all<{ chat_id: number; message_id: number }>();
    return results;
  }

  async alertForMessage(chatId: number, messageId: number): Promise<AlertRow | null> {
    return this.db
      .prepare('SELECT alerts.* FROM alerts JOIN alert_messages ON alert_messages.alert_id = alerts.id WHERE alert_messages.chat_id = ? AND alert_messages.message_id = ?')
      .bind(chatId, messageId)
      .first<AlertRow>();
  }

  // ------------------------------------------------------------ limits and cleanup

  /** Counts one use of `key`. Returns false when the limit for the window is used up. */
  async allow(key: string, limit: number, windowMs: number, now: number): Promise<boolean> {
    const row = await this.db.prepare('SELECT count, expires_at FROM counters WHERE key = ?').bind(key).first<{ count: number; expires_at: number }>();
    if (!row || row.expires_at <= now) {
      await this.db.prepare('INSERT OR REPLACE INTO counters (key, count, expires_at) VALUES (?, 1, ?)').bind(key, now + windowMs).run();
      return true;
    }
    if (row.count >= limit) return false;
    await this.db.prepare('UPDATE counters SET count = count + 1 WHERE key = ?').bind(key).run();
    return true;
  }

  async cleanup(now: number): Promise<void> {
    const old = now - 30 * DAY_MS;
    await this.db.prepare('DELETE FROM alert_messages WHERE alert_id IN (SELECT id FROM alerts WHERE created_at < ?)').bind(old).run();
    await this.db.prepare('DELETE FROM alerts WHERE created_at < ?').bind(old).run();
    await this.db.prepare('DELETE FROM pairings WHERE expires_at < ?').bind(now - DAY_MS).run();
    await this.db.prepare('DELETE FROM counters WHERE expires_at < ?').bind(now).run();
    // Removed installs are forgotten after 30 days.
    const { results } = await this.db.prepare('SELECT id FROM installs WHERE removed_at IS NOT NULL AND removed_at < ?').bind(old).all<{ id: string }>();
    for (const row of results) await this.deleteInstall(row.id);
  }
}
