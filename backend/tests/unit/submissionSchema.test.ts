import { createSubmissionSchema } from '../../src/validators/submission';

describe('createSubmissionSchema', () => {
  it('passes with valid input', () => {
    const result = createSubmissionSchema.parse({
      campaignId: '507f191e810c19729de860ea',
      postUrl: 'https://instagram.com/p/ABC123',
    });
    expect(result.campaignId).toBe('507f191e810c19729de860ea');
    expect(result.postUrl).toBe('https://instagram.com/p/ABC123');
  });

  it('rejects missing campaignId', () => {
    expect(() => createSubmissionSchema.parse({ postUrl: 'https://instagram.com/p/ABC123' })).toThrow();
  });

  it('rejects bad campaignId', () => {
    expect(() =>
      createSubmissionSchema.parse({
        campaignId: 'bad',
        postUrl: 'https://instagram.com/p/ABC123',
      }),
    ).toThrow();
  });

  it('rejects missing postUrl', () => {
    expect(() => createSubmissionSchema.parse({ campaignId: '507f191e810c19729de860ea' })).toThrow();
  });

  it('rejects empty postUrl', () => {
    expect(() =>
      createSubmissionSchema.parse({
        campaignId: '507f191e810c19729de860ea',
        postUrl: '   ',
      }),
    ).toThrow();
  });

  it('rejects postUrl over 2048 chars', () => {
    const longUrl = 'https://instagram.com/p/' + 'a'.repeat(2048);
    expect(() =>
      createSubmissionSchema.parse({
        campaignId: '507f191e810c19729de860ea',
        postUrl: longUrl,
      }),
    ).toThrow();
  });
});
