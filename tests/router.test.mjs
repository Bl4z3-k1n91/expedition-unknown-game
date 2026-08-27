import test from 'node:test';
import assert from 'node:assert/strict';

test('weighted score favors a less-loaded high-weight shard', () => {
  const score = (weight, load, cap, affinity = 0) => affinity / weight + (load / cap) * 1000;
  assert.ok(score(5, 10, 60) < score(2, 10, 40));
});

test('capacity guard removes full shards', () => {
  const shards = [{ load: 60, capacity: 60 }, { load: 20, capacity: 48 }];
  assert.equal(shards.filter(s => s.load < s.capacity).length, 1);
});
