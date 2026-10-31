'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'ship', 'resolve-profile.cjs');
const { resolveBuildMode } = require(SCRIPT);

function runCli(args, env) {
  const childEnv = Object.assign({}, process.env, env);
  delete childEnv.NODE_TEST_CONTEXT;
  for (const [k, v] of Object.entries(env || {})) if (v === undefined) delete childEnv[k];
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'build-mode-'));
  const dir = path.join(cwd, '.planning', 'features', 'demo');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CONTEXT.md'), '---\nfeature: "demo"\nprofile: quick\n---\n\nbody\n');
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, env: childEnv, encoding: 'utf8' });
  fs.rmSync(cwd, { recursive: true, force: true });
  return r;
}

describe('resolveBuildMode', () => {
  it('defaults to per-task', () => {
    assert.deepEqual(resolveBuildMode(null, null), { buildMode: 'per-task', source: 'default', warning: null });
    assert.deepEqual(resolveBuildMode(undefined, ''), { buildMode: 'per-task', source: 'default', warning: null });
  });

  it('takes per-phase from the env', () => {
    assert.deepEqual(resolveBuildMode(null, 'per-phase'), { buildMode: 'per-phase', source: 'env', warning: null });
  });

  it('lets the flag beat the env', () => {
    assert.deepEqual(resolveBuildMode('per-task', 'per-phase'), { buildMode: 'per-task', source: 'flag', warning: null });
    assert.deepEqual(resolveBuildMode(' "PER-PHASE" ', 'per-task'), { buildMode: 'per-phase', source: 'flag', warning: null });
  });

  it('resolves an invalid value to per-task with a warning', () => {
    const r = resolveBuildMode('turbo', null);
    assert.equal(r.buildMode, 'per-task');
    assert.equal(r.source, 'default');
    assert.equal(r.warning, "unrecognized build mode 'turbo' (from flag) — using per-task");
    const e = resolveBuildMode(null, 'phase');
    assert.equal(e.warning, "unrecognized build mode 'phase' (from env) — using per-task");
  });
});

describe('resolve-profile CLI — buildMode', () => {
  it('defaults to per-task with knobs unchanged', () => {
    const r = runCli(['demo'], { SHIP_BUILD_MODE: undefined });
    assert.equal(r.status, 0);
    const lines = r.stdout.trim().split('\n');
    assert.equal(lines.length, 1);
    const out = JSON.parse(lines[0]);
    assert.equal(out.buildMode, 'per-task');
    assert.equal(out.buildModeSource, 'default');
    assert.equal(out.profile, 'quick');
    assert.equal(out.warning, null);
    assert.deepEqual(Object.keys(out.knobs).sort(), ['maxBuildRounds', 'maxPlanRounds', 'reviewGate', 'verifyDepth']);
  });

  it('reads SHIP_BUILD_MODE from the env', () => {
    const r = runCli(['demo'], { SHIP_BUILD_MODE: 'per-phase' });
    assert.equal(r.status, 0);
    const lines = r.stdout.trim().split('\n');
    assert.equal(lines.length, 1);
    const out = JSON.parse(lines[0]);
    assert.equal(out.buildMode, 'per-phase');
    assert.equal(out.buildModeSource, 'env');
  });

  it('--build-mode=per-phase takes effect and beats the env', () => {
    const out = JSON.parse(runCli(['demo', '--build-mode=per-phase'], { SHIP_BUILD_MODE: 'per-task' }).stdout);
    assert.equal(out.buildMode, 'per-phase');
    assert.equal(out.buildModeSource, 'flag');
  });

  it('a spaced --build-mode value is not taken as the slug', () => {
    const out = JSON.parse(runCli(['--build-mode', 'per-phase', 'demo'], { SHIP_BUILD_MODE: undefined }).stdout);
    assert.equal(out.buildMode, 'per-phase');
    assert.equal(out.profile, 'quick', 'the slug must still be demo');
    assert.equal(out.warning, null);
  });

  it('merges a build-mode warning with a profile warning', () => {
    const out = JSON.parse(runCli(['demo', '--profile', 'bogus', '--build-mode', 'nope'], { SHIP_BUILD_MODE: undefined }).stdout);
    assert.equal(out.buildMode, 'per-task');
    assert.equal(out.warning,
      "unrecognized profile 'bogus' (from flag) — using standard; unrecognized build mode 'nope' (from flag) — using per-task");
  });

  it('a build-mode warning alone becomes the warning', () => {
    const out = JSON.parse(runCli(['demo'], { SHIP_BUILD_MODE: 'weird' }).stdout);
    assert.equal(out.buildMode, 'per-task');
    assert.equal(out.warning, "unrecognized build mode 'weird' (from env) — using per-task");
  });
});
