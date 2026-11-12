import { it, expect } from 'vitest';
import { admissionConfirmation, admissionCompletionRejection } from '../admin-admission';
it('phase-specific confirmation identifies exact player and tournament', () => { for (const phase of ['after_time', 'after_snapshot'] as const) {
    const text = admissionConfirmation(phase, 'ufo_lover', 'CLASSIC');
    expect(text).toContain('ufo_lover');
    expect(text).toContain('CLASSIC');
    expect(text).toContain(phase === 'after_time' ? 'Если игрок будет отмечен' : 'без пересчёта');
} });
it('expected frozen completion conflict is recognizable, SQL payload is never returned', () => { const message = 'Состав изменился — обновите результаты перед завершением'; expect(admissionCompletionRejection({ message: 'Failed query', cause: { code: '23514', message } })).toBe(message); expect(admissionCompletionRejection({ code: '23514', message: 'Unrelated constraint' })).toBeNull(); });
