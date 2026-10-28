import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
const shellPath = (p) => process.platform === "win32" ? p.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`) : p;
function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aria-ops-"));
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  const stub = (name, source) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${source}\n`, { mode: 0o755 });
  stub("pg_dump", 'for arg; do case "$arg" in --file=*) printf "fixture database" > "${arg#--file=}";; esac; done');
  stub("rclone", 'printf "%s\\n" "$*" >> "$OPS_LOG"');
  stub("docker", 'printf "%s\\n" "$*" >> "$OPS_LOG"');
  stub("flock", 'exit "${OPS_LOCK_STATUS:-0}"');
  const env = { ...process.env, PATH: `${shellPath(bin)}:${process.env.PATH}`, ARIA_BACKUP_DIR: shellPath(path.join(dir, "backups")), ARIA_MEDIA_DIR: shellPath(path.join(dir, "data")), OPS_LOG: shellPath(path.join(dir, "commands")) };
  const run = (file, args = [], extra = {}) => spawnSync(bash, ["-c", 'PATH="$OPS_BIN:$PATH"; export PATH; exec sh "$@"', "ops", shellPath(path.resolve(file)), ...args], { cwd: dir, env: { ...env, OPS_BIN: shellPath(bin), ...extra }, encoding: "utf8" });
  try { return fn({ dir, stub, env, run }); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("all deployment scripts have valid POSIX shell syntax", () => {
  for (const file of fs.readdirSync("deploy").filter((file) => file.endsWith(".sh"))) {
    const result = spawnSync(bash, ["-n", shellPath(path.resolve("deploy", file))], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
});

test("backup publishes a checksummed database and media set; offsite manifest is uploaded last", () => fixture(({ dir, run }) => {
  fs.mkdirSync(path.join(dir, "data", "storage"), { recursive: true });
  fs.writeFileSync(path.join(dir, "data", "storage", "image.txt"), "media fixture");
  const backup = run("deploy/backup.sh");
  assert.equal(backup.status, 0, backup.stderr);
  const [name] = fs.readdirSync(path.join(dir, "backups"));
  assert.match(name, /^backup-\d{8}T\d{6}Z$/);
  assert.deepEqual(fs.readdirSync(path.join(dir, "backups", name)).sort(), ["SHA256SUMS", "db.dump", "media.tar.gz"]);
  const copy = run("deploy/backup-offsite.sh");
  assert.equal(copy.status, 0, copy.stderr);
  const commands = fs.readFileSync(path.join(dir, "commands"), "utf8").trim().split("\n");
  assert.match(commands[0], /^copy /);
  assert.match(commands[1], /^copyto .*SHA256SUMS/);
  assert.match(commands[2], /^lsf .*--min-age 14d/);
  assert.equal(commands.length, 3);
}));

function snapshotFixture({ dir, run }) {
  fs.mkdirSync(path.join(dir, "data", "storage"), { recursive: true });
  fs.writeFileSync(path.join(dir, "data", "storage", "image.txt"), "media fixture");
  const result = run("deploy/backup.sh");
  assert.equal(result.status, 0, result.stderr);
  return path.join(dir, "backups", fs.readdirSync(path.join(dir, "backups"))[0]);
}

function writeManifest(folder) {
  fs.writeFileSync(path.join(folder, "SHA256SUMS"), ["db.dump", "media.tar.gz"].map((name) =>
    `${createHash("sha256").update(fs.readFileSync(path.join(folder, name))).digest("hex")}  ${name}\n`).join(""));
}

test("a partial manifest cannot bypass completeness checks on restore or offsite copy", () => fixture((ctx) => {
  const folder = snapshotFixture(ctx);
  const manifest = fs.readFileSync(path.join(folder, "SHA256SUMS"), "utf8");
  fs.writeFileSync(path.join(folder, "SHA256SUMS"), manifest.split("\n")[0] + "\n");
  assert.equal(ctx.run("deploy/restore.sh", [shellPath(folder)]).status, 1);
  assert.equal(ctx.run("deploy/backup-offsite.sh").status, 1);
  assert.equal(fs.existsSync(path.join(ctx.dir, "commands")), false);
}));

test("checksummed but invalid compressed media is rejected before any Docker operation", () => fixture((ctx) => {
  const folder = snapshotFixture(ctx);
  fs.writeFileSync(path.join(folder, "media.tar.gz"), "not a gzip archive");
  writeManifest(folder);
  assert.notEqual(ctx.run("deploy/restore.sh", [shellPath(folder)]).status, 0);
  assert.equal(fs.existsSync(path.join(ctx.dir, "commands")), false);
}));

test("media archive outside storage is rejected before stopping services", () => fixture((ctx) => {
  const folder = snapshotFixture(ctx);
  const result = spawnSync(bash, ["-c", 'tar -czf "$1/media.tar.gz" -C "$1" db.dump', "ops", shellPath(folder)], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  writeManifest(folder);
  assert.equal(ctx.run("deploy/restore.sh", [shellPath(folder)]).status, 1);
  assert.equal(fs.existsSync(path.join(ctx.dir, "commands")), false);
}));

test("offsite retention purges whole expired sets and ignores unexpected paths", () => fixture((ctx) => {
  snapshotFixture(ctx);
  ctx.stub("rclone", `printf "%s\\n" "$*" >> "$OPS_LOG"
if [ "$1" = lsf ]; then
  printf '%s\\n' 'backup-20200101T000000Z/SHA256SUMS' '../SHA256SUMS' 'backup-other/SHA256SUMS' 'backup-20200101T000000Z/nested/SHA256SUMS'
fi`);
  const result = ctx.run("deploy/backup-offsite.sh");
  assert.equal(result.status, 0, result.stderr);
  const commands = fs.readFileSync(path.join(ctx.dir, "commands"), "utf8").trim().split("\n");
  assert.equal(commands.filter((line) => line.startsWith("purge ")).length, 1);
  assert.equal(commands.at(-1), "purge offsite:ariahub-backups/backup-20200101T000000Z");
}));

test("an old local backup cannot authorize expiry of the last remote copies", () => fixture((ctx) => {
  const folder = snapshotFixture(ctx);
  fs.utimesSync(path.join(folder, "SHA256SUMS"), new Date("2020-01-01"), new Date("2020-01-01"));
  assert.equal(ctx.run("deploy/backup-offsite.sh").status, 1);
  const commands = fs.readFileSync(path.join(ctx.dir, "commands"), "utf8");
  assert.doesNotMatch(commands, /(?:lsf|purge|delete) /);
}));

for (const scenario of [
  { name: "preserves a paused worker", running: "api", stop: 0, backup: 0, expected: 0 },
  { name: "recovers writers after backup failure", running: "api worker", stop: 0, backup: 7, expected: 7 },
  { name: "recovers writers after partial stop failure", running: "api worker", stop: 8, backup: 0, expected: 8 },
  { name: "keeps an entirely stopped application stopped", running: "", stop: 0, backup: 0, expected: 0 },
]) {
  test(`backup wrapper ${scenario.name}`, () => fixture((ctx) => {
    ctx.stub("docker", `printf "%s\\n" "$*" >> "$OPS_LOG"
case " $* " in
  *' ps '*) printf '%s\\n' $OPS_RUNNING;;
  *' stop '*) exit "$OPS_STOP";;
  *' run '*) exit "$OPS_BACKUP";;
esac`);
    const result = ctx.run("deploy/backup-stack.sh", [], { OPS_RUNNING: scenario.running, OPS_STOP: String(scenario.stop), OPS_BACKUP: String(scenario.backup) });
    assert.equal(result.status, scenario.expected, result.stderr);
    const commands = fs.readFileSync(path.join(ctx.dir, "commands"), "utf8").trim().split("\n");
    if (scenario.running) {
      assert.ok(commands.some((line) => line.endsWith(`stop ${scenario.running}`)));
      assert.ok(commands.at(-1).endsWith(`up -d --no-deps ${scenario.running}`));
    } else {
      assert.ok(commands.every((line) => !line.includes(" stop ") && !line.includes(" up ")));
    }
    if (scenario.stop) assert.ok(commands.every((line) => !line.includes(" run ")));
  }));
}

test("backup and restore refuse a conflicting operation before touching containers", () => fixture((ctx) => {
  for (const script of ["deploy/backup-stack.sh", "deploy/restore.sh"]) {
    assert.equal(ctx.run(script, ["unused"], { OPS_LOCK_STATUS: "1" }).status, 1);
  }
  assert.equal(fs.existsSync(path.join(ctx.dir, "commands")), false);
}));

function releaseFixture(ctx) {
  const revision = "a".repeat(40);
  fs.mkdirSync(path.join(ctx.dir, "releases"));
  fs.writeFileSync(path.join(ctx.dir, "releases", `${revision}.tar`), "archive fixture");
  fs.writeFileSync(path.join(ctx.dir, ".env"), "fixture only");
  fs.writeFileSync(path.join(ctx.dir, "REVISION"), "b".repeat(40) + "\n");
  fs.writeFileSync(path.join(ctx.dir, "PREVIOUS_REVISION"), "c".repeat(40) + "\n");
  ctx.stub("tar", 'printf "extract\\n" >> "$OPS_LOG"');
  ctx.stub("curl", 'printf "health %s\\n" "$*" >> "$OPS_LOG"; exit "${OPS_HEALTH:-0}"');
  ctx.stub("docker", `printf "%s\\n" "$*" >> "$OPS_LOG"
case " $* " in
  *' build '*) exit "\${OPS_BUILD:-0}";;
  *' run --rm --no-deps migrate '*) exit "\${OPS_MIGRATE:-0}";;
  *' --user root '*) exit "\${OPS_STORAGE:-0}";;
  *' exec -T caddy caddy reload '*) exit "\${OPS_CADDY:-0}";;
esac`);
  return revision;
}

for (const scenario of [
  { name: "build", env: { OPS_BUILD: "6" }, forbidden: / stop | run |--profile tunnel/, code: 6 },
  { name: "migration", env: { OPS_MIGRATE: "7" }, forbidden: /--profile tunnel/, code: 7 },
  { name: "storage permissions", env: { OPS_STORAGE: "9" }, forbidden: /--profile tunnel/, code: 9 },
  { name: "health", env: { OPS_HEALTH: "8" }, forbidden: /exec -T worker/, code: 8 },
  { name: "gateway reload", env: { OPS_CADDY: "10" }, forbidden: /health http|exec -T worker/, code: 10 },
  { name: "operation lock", env: { OPS_LOCK_STATUS: "1" }, forbidden: /./, code: 1 },
]) {
  test(`failed deployment ${scenario.name} keeps verified rollback revisions`, () => fixture((ctx) => {
    const revision = releaseFixture(ctx);
    const result = ctx.run("deploy/apply-release.sh", [revision], scenario.env);
    assert.equal(result.status, scenario.code, result.stderr);
    assert.equal(fs.readFileSync(path.join(ctx.dir, "REVISION"), "utf8"), "b".repeat(40) + "\n");
    assert.equal(fs.readFileSync(path.join(ctx.dir, "PREVIOUS_REVISION"), "utf8"), "c".repeat(40) + "\n");
    const log = path.join(ctx.dir, "commands");
    assert.doesNotMatch(fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "", scenario.forbidden);
  }));
}

test("successful deployment waits for service health and advances rollback revisions once", () => fixture((ctx) => {
  const revision = releaseFixture(ctx);
  const result = ctx.run("deploy/apply-release.sh", [revision]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(ctx.dir, "REVISION"), "utf8"), revision + "\n");
  assert.equal(fs.readFileSync(path.join(ctx.dir, "PREVIOUS_REVISION"), "utf8"), "b".repeat(40) + "\n");
  const commands = fs.readFileSync(path.join(ctx.dir, "commands"), "utf8");
  assert.match(commands, /--wait --wait-timeout 150/);
  assert.match(commands, /exec -T caddy caddy reload --config \/etc\/caddy\/Caddyfile --adapter caddyfile/);
  assert.match(commands, /http:\/\/127\.0\.0\.1:18080\/signin/);
  assert.equal(ctx.run("deploy/apply-release.sh", [revision]).status, 0);
  assert.equal(fs.readFileSync(path.join(ctx.dir, "PREVIOUS_REVISION"), "utf8"), "b".repeat(40) + "\n");
}));

test("deployment preserves an existing external tunnel without starting another", () => fixture((ctx) => {
  const revision = releaseFixture(ctx);
  const result = ctx.run("deploy/apply-release.sh", [revision], { ARIA_TUNNEL_MODE: "external" });
  assert.equal(result.status, 0, result.stderr);
  const commands = fs.readFileSync(path.join(ctx.dir, "commands"), "utf8");
  assert.match(commands, /up -d --wait --wait-timeout 150/);
  assert.doesNotMatch(commands, /--profile tunnel/);
}));

test("Docker cannot consume the remaining deployment script when invoked over SSH stdin", () => fixture((ctx) => {
  const revision = releaseFixture(ctx);
  ctx.stub("docker", 'printf "%s\\n" "$*" >> "$OPS_LOG"; cat > /dev/null');
  const source = fs.readFileSync("deploy/apply-release.sh", "utf8");
  const result = spawnSync(bash, ["-c", 'PATH="$OPS_BIN:$PATH"; export PATH; exec sh -s -- "$@"', "ops", revision], {
    cwd: ctx.dir,
    env: { ...ctx.env, OPS_BIN: shellPath(path.join(ctx.dir, "bin")) },
    input: source,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(ctx.dir, "REVISION"), "utf8"), revision + "\n");
  assert.equal(fs.readFileSync(path.join(ctx.dir, "PREVIOUS_REVISION"), "utf8"), "b".repeat(40) + "\n");
  assert.match(result.stdout, /API, worker and web healthy/);
}));

test("failed pg_dump cannot produce a completed backup", () => fixture(({ dir, stub, run }) => {
  stub("pg_dump", "exit 7");
  assert.equal(run("deploy/backup.sh").status, 7);
  assert.deepEqual(fs.readdirSync(path.join(dir, "backups")), []);
}));

test("fresh installation without uploads produces a valid storage archive", () => fixture((ctx) => {
  const result = ctx.run("deploy/backup.sh");
  assert.equal(result.status, 0, result.stderr);
  const folder = path.join(ctx.dir, "backups", fs.readdirSync(path.join(ctx.dir, "backups"))[0]);
  const check = ctx.run("deploy/check-snapshot.sh", [shellPath(folder)]);
  assert.equal(check.status, 0, check.stderr);
}));

test("empty backup source cannot trigger remote deletion", () => fixture(({ dir, run }) => {
  assert.equal(run("deploy/backup-offsite.sh").status, 1);
  assert.equal(fs.existsSync(path.join(dir, "commands")), false);
}));

test("restore rejects incomplete or corrupt backups before stopping services", () => fixture(({ dir, run }) => {
  const folder = path.join(dir, "bad-backup");
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, "db.dump"), "corrupt");
  assert.equal(run("deploy/restore.sh", [shellPath(folder)]).status, 1);
  fs.writeFileSync(path.join(folder, "media.tar.gz"), "corrupt");
  fs.writeFileSync(path.join(folder, "SHA256SUMS"), `${"0".repeat(64)}  db.dump\n${"0".repeat(64)}  media.tar.gz\n`);
  assert.equal(run("deploy/restore.sh", [shellPath(folder)]).status, 1);
  assert.equal(fs.existsSync(path.join(dir, "commands")), false);
}));
