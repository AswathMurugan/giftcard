import { describe, it, expect } from 'vitest';
import { resolveCurrentUser, userInitials } from './user-menu-utils';

describe('UserMenu', { tags: ['layout', 'logic'] }, () => {
  describe('userInitials', { tags: ['important'] }, () => {
    it('takes the first two name parts', () => {
      expect(userInitials({ name: 'Ops Person' })).toBe('OP');
    });

    it('derives initials from an email local part', () => {
      expect(userInitials({ name: '', email: 'ops@jiffy.ai' })).toBe('OP');
      expect(userInitials({ name: '', email: 'jane.doe@x.com' })).toBe('JD');
    });

    it('uses the first two letters for a single token', () => {
      expect(userInitials({ name: 'Triad' })).toBe('TR');
    });

    it('splits on dots/underscores/dashes', { tags: ['edge-case'] }, () => {
      expect(userInitials({ name: 'jane_doe' })).toBe('JD');
      expect(userInitials({ name: 'jane-doe' })).toBe('JD');
    });

    it('returns ? for empty input', { tags: ['edge-case'] }, () => {
      expect(userInitials({ name: '' })).toBe('?');
      expect(userInitials({ name: '   ' })).toBe('?');
    });

    it('is always uppercase', () => {
      expect(userInitials({ name: 'ops person' })).toBe('OP');
    });
  });

  describe('resolveCurrentUser', { tags: ['important'] }, () => {
    const sessionUser = {
      username: 'nagarajan.umapathy',
      email: 'nagarajan.umapathy@jiffy.ai',
      attributes: { name: 'Session Name' },
    };

    it('uses the platform profile name, email, and organization', () => {
      expect(
        resolveCurrentUser(sessionUser, {
          first_name: 'Assistant',
          last_name: 'Two',
          email: 'assistant.two@jiffy.ai',
          org_name: 'J Financials',
        })
      ).toEqual({
        name: 'Assistant Two',
        email: 'assistant.two@jiffy.ai',
        subtitle: 'J Financials',
      });
    });

    it('supports a partial platform name', { tags: ['edge-case'] }, () => {
      expect(
        resolveCurrentUser(sessionUser, { first_name: 'Assistant' }).name
      ).toBe('Assistant');
    });

    it(
      'falls back to the auth session when the profile is unavailable',
      {
        tags: ['edge-case'],
      },
      () => {
        expect(resolveCurrentUser(sessionUser)).toEqual({
          name: 'Session Name',
          email: 'nagarajan.umapathy@jiffy.ai',
        });
      }
    );

    it(
      'falls back to username when no names or email exist',
      {
        tags: ['edge-case'],
      },
      () => {
        expect(resolveCurrentUser({ username: 'assistant-two' })).toEqual({
          name: 'assistant-two',
        });
      }
    );
  });
});
