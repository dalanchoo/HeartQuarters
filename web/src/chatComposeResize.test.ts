import { describe, expect, it } from 'vitest';
import { clampComposeHeight, COMPOSE_DEFAULT_HEIGHT, COMPOSE_MAX_HEIGHT, COMPOSE_MIN_HEIGHT } from './chatComposeResize';

describe('chat compose box height', () => {
  it('stays between the shortest and tallest allowed', () => {
    expect(clampComposeHeight(10)).toBe(COMPOSE_MIN_HEIGHT);
    expect(clampComposeHeight(5000)).toBe(COMPOSE_MAX_HEIGHT);
    expect(clampComposeHeight(180.6)).toBe(181);
  });

  it('leaves room for the conversation in a short window', () => {
    expect(clampComposeHeight(500, 600)).toBe(360);
    expect(clampComposeHeight(500, 50)).toBe(COMPOSE_MIN_HEIGHT);
  });

  it('uses the standard height for a value that is not a number', () => {
    expect(clampComposeHeight(NaN)).toBe(COMPOSE_DEFAULT_HEIGHT);
  });
});
