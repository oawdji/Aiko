import { describe, expect, it } from 'vitest';
import { looksLikeStyleAdjustment } from '../intent';

describe('looksLikeStyleAdjustment', () => {
  it('detects style adjustment requests', () => {
    for (const text of [
      '以后回答更简洁一点',
      '你说话太啰嗦了',
      '语气热情一点',
      '别总是反问我',
      '多问问我',
      '调整一下你的风格',
      '以后回答尽量详细',
    ]) {
      expect(looksLikeStyleAdjustment(text), text).toBe(true);
    }
  });

  it('does not misfire on ordinary chat', () => {
    for (const text of [
      '今天好累',
      '我家宠物叫咪咪',
      '帮我讲个笑话',
      '简洁的设计是什么风格？',
      '我在学做饭',
    ]) {
      expect(looksLikeStyleAdjustment(text), text).toBe(false);
    }
  });
});
