import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailOtpCodes } from "@/lib/db/schema";
import type {
  EmailOtpRepository,
  EmailOtpRow,
  EmailOtpInsert,
  EmailOtpPurpose,
} from "./EmailOtpRepository";

// timestamp columns come back from postgres-js as native Date objects, not
// the ISO strings Supabase/PostgREST serializes over JSON — every EmailOtpRow
// field the interface types as `string` needs an explicit .toISOString()
// here to keep the contract identical for lib/email-otp.ts regardless of
// backend.
function toRow(row: typeof emailOtpCodes.$inferSelect): EmailOtpRow {
  return {
    id: row.id,
    email: row.email,
    purpose: row.purpose as EmailOtpPurpose,
    player_id: row.playerId,
    code_hash: row.codeHash,
    expires_at: row.expiresAt.toISOString(),
    resend_after_at: row.resendAfterAt.toISOString(),
    failed_attempts: row.failedAttempts,
    consumed_at: row.consumedAt ? row.consumedAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Drizzle/Postgres counterpart of SupabaseEmailOtpRepository. Four of the
// five methods there checked `.error` and threw a prefixed message —
// replicated verbatim below via try/catch + rethrow, so callers see the
// same error text regardless of DATABASE_PROVIDER. invalidateActive is the
// one exception: the Supabase version never checked its error either
// (matches that silence here too).
export class PostgresEmailOtpRepository implements EmailOtpRepository {
  async findLatestActive(email: string, purpose: EmailOtpPurpose): Promise<EmailOtpRow | null> {
    try {
      const [row] = await db
        .select()
        .from(emailOtpCodes)
        .where(
          and(
            eq(emailOtpCodes.email, email),
            eq(emailOtpCodes.purpose, purpose),
            isNull(emailOtpCodes.consumedAt)
          )
        )
        .orderBy(desc(emailOtpCodes.createdAt))
        .limit(1);

      return row ? toRow(row) : null;
    } catch (err) {
      throw new Error(`Failed to load OTP record: ${errorMessage(err)}`);
    }
  }

  async invalidateActive(email: string, purpose: EmailOtpPurpose): Promise<void> {
    const now = new Date();
    await db
      .update(emailOtpCodes)
      .set({ consumedAt: now, updatedAt: now })
      .where(
        and(
          eq(emailOtpCodes.email, email),
          eq(emailOtpCodes.purpose, purpose),
          isNull(emailOtpCodes.consumedAt)
        )
      );
  }

  async create(data: EmailOtpInsert): Promise<void> {
    try {
      await db.insert(emailOtpCodes).values({
        email: data.email,
        purpose: data.purpose,
        playerId: data.player_id,
        codeHash: data.code_hash,
        expiresAt: new Date(data.expires_at),
        resendAfterAt: new Date(data.resend_after_at),
        failedAttempts: data.failed_attempts,
      });
    } catch (err) {
      throw new Error(`Failed to store OTP code: ${errorMessage(err)}`);
    }
  }

  async incrementFailedAttempts(id: string, failedAttempts: number): Promise<void> {
    try {
      await db
        .update(emailOtpCodes)
        .set({ failedAttempts, updatedAt: new Date() })
        .where(eq(emailOtpCodes.id, id));
    } catch (err) {
      throw new Error(`Failed to update OTP attempts: ${errorMessage(err)}`);
    }
  }

  async markConsumed(id: string): Promise<void> {
    try {
      const now = new Date();
      await db
        .update(emailOtpCodes)
        .set({ consumedAt: now, updatedAt: now })
        .where(eq(emailOtpCodes.id, id));
    } catch (err) {
      throw new Error(`Failed to consume OTP code: ${errorMessage(err)}`);
    }
  }

  async listAll(): Promise<EmailOtpRow[]> {
    try {
      const rows = await db.select().from(emailOtpCodes);
      return rows.map(toRow);
    } catch (err) {
      throw new Error(`Failed to list OTP records: ${errorMessage(err)}`);
    }
  }
}
