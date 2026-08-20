import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { players } from "./players";

export const academyLessonProgress = pgTable("academy_lesson_progress", {
  id: uuid().primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  lessonCode: text("lesson_code").notNull(),
  attemptsCount: integer("attempts_count").notNull().default(0),
  lastScorePercent: integer("last_score_percent").notNull(),
  bestScorePercent: integer("best_score_percent").notNull(),
  passed: boolean().notNull().default(false),
  firstCompletedAt: timestamp("first_completed_at", { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("academy_lesson_progress_attempts_count_check", sql`${table.attemptsCount} >= 0`),
  check("academy_lesson_progress_last_score_check", sql`${table.lastScorePercent} BETWEEN 0 AND 100`),
  check("academy_lesson_progress_best_score_check", sql`${table.bestScorePercent} BETWEEN 0 AND 100`),
  uniqueIndex("academy_lesson_progress_player_lesson_key").on(table.playerId, table.lessonCode),
  index("academy_lesson_progress_lesson_code_idx").on(table.lessonCode),
]);

export const academyTrainingAttempts = pgTable("academy_training_attempts", {
  id: uuid().primaryKey(),
  playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  lessonCode: text("lesson_code").notNull(),
  scorePercent: integer("score_percent").notNull(),
  passed: boolean().notNull(),
  firstPass: boolean("first_pass").notNull().default(false),
  newBest: boolean("new_best").notNull().default(false),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("academy_training_attempts_score_check", sql`${table.scorePercent} BETWEEN 0 AND 100`),
  index("academy_training_attempts_player_lesson_idx").on(table.playerId, table.lessonCode),
]);
