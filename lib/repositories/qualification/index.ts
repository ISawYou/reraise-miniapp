import { PostgresQualificationRepository } from "./PostgresQualificationRepository";
export const qualificationRepository = new PostgresQualificationRepository();
export type { QualificationCommand } from "./QualificationRepository";
