import { describe, expect, it } from 'vitest';
import { outlineBounds } from './portrait-outline';
describe('portrait outline bounds', () => {
  it('crops around the outline with padding', () => {
    expect(outlineBounds([{x:.25,y:.25},{x:.75,y:.25},{x:.5,y:.75}], 1000, 800, 0.1)).toEqual({x:200,y:150,width:600,height:500});
  });
  it('clamps padding to the image edges and rejects incomplete outlines', () => {
    expect(outlineBounds([{x:0,y:0},{x:1,y:0},{x:1,y:1}], 100, 100)).toEqual({x:0,y:0,width:100,height:100});
    expect(() => outlineBounds([{x:0,y:0}], 100, 100)).toThrow();
  });
});
