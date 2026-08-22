// Parity between the two workflows that run the suite.
//
// .github/workflows/test.yml exists so a red suite is caught on the PR, and
// .github/workflows/release.yml gates the published release. They are only
// worth having together if they run the *same* suite the *same* way: a test
// workflow that invokes Node differently can go green while the release run
// goes red, which is exactly the blind spot test.yml was added to close.
//
// Parsed by regex rather than a YAML library on purpose — Ship ships zero npm
// dependencies. The extractors are narrow, so each one is guarded: a parse miss
// fails the test naming the file, instead of passing vacuously on null.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WORKFLOWS = path.join(__dirname, '..', '.github', 'workflows');
const TEST_WORKFLOW = path.join(WORKFLOWS, 'test.yml');
const RELEASE_WORKFLOW = path.join(WORKFLOWS, 'release.yml');

const EXPECTED_RUN = 'node --test "tests/*.test.js"';

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

/**
 * The `run:` value of the step named `Run tests`, or null when the step or its
 * command cannot be found. Only the single-line `run: {command}` form is
 * accepted — both workflows use it, and a block scalar would need different
 * handling that the parity comparison could not do honestly.
 */
function runTestsCommand(content) {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*-\s+name:\s*Run tests\s*$/.test(lines[i])) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (/^\s*-\s/.test(line)) break;      // the next step started
      if (line.trim() === '') continue;
      const match = line.match(/^\s*run:\s*(\S.*?)\s*$/);
      if (match) return match[1];
    }
    return null;
  }
  return null;
}

/** The pinned `node-version:` value, unquoted, or null. */
function nodeVersion(content) {
  const match = content.match(/^\s*node-version:\s*['"]?([^'"\s]+)['"]?\s*$/m);
  return match ? match[1] : null;
}

describe('CI workflow parity — test.yml and release.yml run the suite identically', () => {
  it('the test workflow exists', () => {
    assert.ok(fs.existsSync(TEST_WORKFLOW), '.github/workflows/test.yml must exist');
  });

  it('both workflows invoke the suite with the same command string', () => {
    const testRun = runTestsCommand(read(TEST_WORKFLOW));
    const releaseRun = runTestsCommand(read(RELEASE_WORKFLOW));

    assert.ok(testRun !== null, 'failed to parse the `Run tests` command out of test.yml');
    assert.ok(releaseRun !== null, 'failed to parse the `Run tests` command out of release.yml');
    assert.equal(testRun, releaseRun, 'the two workflows must run the suite identically');
    assert.equal(testRun, EXPECTED_RUN, 'the suite is run with the quoted single-level glob');
  });

  it('both workflows pin the same Node version', () => {
    const testNode = nodeVersion(read(TEST_WORKFLOW));
    const releaseNode = nodeVersion(read(RELEASE_WORKFLOW));

    assert.ok(testNode !== null, 'failed to parse node-version out of test.yml');
    assert.ok(releaseNode !== null, 'failed to parse node-version out of release.yml');
    assert.equal(testNode, releaseNode, 'a version drift means a green PR can still fail on release');
    assert.equal(testNode, '22', 'Node 22 is the pinned CI version');
  });

  it('the test workflow triggers on both push and pull_request', () => {
    const lines = read(TEST_WORKFLOW).split('\n');
    const onIndex = lines.findIndex(l => /^on:\s*$/.test(l));
    assert.ok(onIndex !== -1, 'failed to parse the `on:` block out of test.yml');
    const block = [];
    for (let i = onIndex + 1; i < lines.length && !/^\S/.test(lines[i]); i++) block.push(lines[i]);
    assert.ok(block.length > 0, 'the `on:` block in test.yml is empty');
    const triggers = block.join('\n');
    assert.match(triggers, /^\s+push:/m, 'test.yml must run on push');
    assert.match(triggers, /^\s+pull_request:/m, 'test.yml must run on pull_request');
  });
});
