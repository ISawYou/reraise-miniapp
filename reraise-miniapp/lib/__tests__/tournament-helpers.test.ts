import { describe, it, expect } from 'vitest';
import {
  getTournamentKindLabel,
  getTournamentKindGradient,
  getRegistrationStatus,
} from '@/lib/tournament-helpers';

describe('getTournamentKindLabel', () => {
  it('returns "Платный" for paid', () => {
    expect(getTournamentKindLabel('paid')).toBe('Платный');
  });

  it('returns "Кэш" for cash', () => {
    expect(getTournamentKindLabel('cash')).toBe('Кэш');
  });

  it('returns "Бесплатный" for free', () => {
    expect(getTournamentKindLabel('free')).toBe('Бесплатный');
  });
});

describe('getTournamentKindGradient', () => {
  it('contains "amber" for paid', () => {
    expect(getTournamentKindGradient('paid')).toContain('amber');
  });

  it('contains "cyan" for cash', () => {
    expect(getTournamentKindGradient('cash')).toContain('cyan');
  });

  it('contains "emerald" for free', () => {
    expect(getTournamentKindGradient('free')).toContain('emerald');
  });
});

describe('getRegistrationStatus', () => {
  it('returns "registered" when slots available', () => {
    expect(getRegistrationStatus(5, 10)).toBe('registered');
  });

  it('returns "waitlist" when slots exactly full', () => {
    expect(getRegistrationStatus(10, 10)).toBe('waitlist');
  });

  it('returns "waitlist" when over capacity', () => {
    expect(getRegistrationStatus(15, 10)).toBe('waitlist');
  });

  it('returns "registered" when count is 0', () => {
    expect(getRegistrationStatus(0, 10)).toBe('registered');
  });
});
