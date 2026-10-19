'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const readSrc = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('5.28.0 — headless fix rounds', () => {
  const go = readSrc('skills/go/SKILL.md');
  const contract = readSrc('ship/docs/headless.md');

  it('go strips --fix-rounds and documents section 6b', () => {
    assert.match(go, /argument-hint:.*--fix-rounds <n>/);
    assert.match(go, /Strip `--fix-rounds \{n\}`/);
    assert.match(go, /^## 6b\. Headless Fix Rounds$/m);
  });

  it('the default budget is 2 and 0 turns it off', () => {
    assert.match(go, /otherwise \*\*2\*\*/);
    assert.match(go, /0 turns this off/);
  });

  it('rounds after the first require a strictly shrinking failing set', () => {
    assert.match(go, /strictly smaller than at the previous verify/);
    assert.match(go, /severity is not `low`/);
  });

  it('interactive runs are untouched', () => {
    assert.match(go, /Interactive runs skip this section/);
  });

  it('verify-fail detail carries the rounds used', () => {
    assert.match(go, /fix rounds \{used\}\/\{budget\}, failing set \{trend\}/);
    assert.match(contract, /fix rounds \{used\}\/\{budget\}, failing set \{trend\}/);
  });

  it('the contract no longer says go never auto-retries', () => {
    assert.doesNotMatch(contract, /never auto-retries/);
    assert.doesNotMatch(go, /never auto-retries/);
  });
});
