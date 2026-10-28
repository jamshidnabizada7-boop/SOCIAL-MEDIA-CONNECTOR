// Export a validated Oracle snapshot into an authenticated encrypted bundle.
// Upload only the .ariabak file to offsite storage; its .key stays local.
import { spawn, spawnSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = path.resolve(import.meta.dirname, '..');
const recovery = path.join(root, '.local', 'recovery');
const host = 'ariahub-oracle';
const namePattern = /^backup-\d{8}T\d{6}Z$/;
function sshPython(source) {
  const encoded = Buffer.from(source).toString('base64');
  return `sudo python3 -c "import base64;exec(base64.b64decode('${encoded}'))"`;
}
function runPython(source) {
  const result = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', host, sshPython(source)], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('Oracle backup query failed; private output withheld');
  return result.stdout.trim();
}
const selection = JSON.parse(runPython(`
import json,re,datetime
from pathlib import Path
root=Path('/opt/ariahub-v2/backups')
names=sorted(p.name for p in root.iterdir() if p.is_dir() and re.fullmatch(r'backup-\\d{8}T\\d{6}Z',p.name) and (p/'SHA256SUMS').is_file())
if not names: raise RuntimeError('No complete snapshot')
stamp=datetime.datetime.strptime(names[-1],'backup-%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc)
age=(datetime.datetime.now(datetime.timezone.utc)-stamp).total_seconds()
if age<0 or age>36*3600: raise RuntimeError('Backup is stale or dated in the future')
print(json.dumps({'snapshot':names[-1],'ageSeconds':int(age)}))
`));
if (!namePattern.test(selection.snapshot)) throw new Error('Invalid snapshot name');
mkdirSync(recovery, { recursive: true, mode: 0o700 });
const archive = path.join(recovery, `oracle-${selection.snapshot}.ariabak`);
const keyFile = `${archive}.key`;
const completed = `${archive}.json`;

if (!existsSync(archive)) {
  const temporary = path.join(recovery, `.export-${randomUUID()}.partial`);
  const key = randomBytes(32), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const source = `
import fcntl,subprocess
from pathlib import Path
root=Path('/opt/ariahub-v2').resolve()
lock=(root/'.aria-operations.lock').open('a')
fcntl.flock(lock,fcntl.LOCK_EX)
snapshot='${selection.snapshot}'
subprocess.run(['sh',str(root/'deploy/check-snapshot.sh'),str(root/'backups'/snapshot)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
subprocess.run(['tar','-C',str(root),'-cf','-','backups/'+snapshot,'.env'],check=True)
`;
  const child = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', host, sshPython(source)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  // stderr can contain private paths; retain only an exit status.
  child.stderr.resume();
  const exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  const output = createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
  output.write(Buffer.concat([Buffer.from('ARIAREC1'), iv]));
  try {
    await pipeline(child.stdout, cipher, output);
    if (await exit !== 0) throw new Error('Oracle snapshot export failed');
    appendFileSync(temporary, cipher.getAuthTag());
    writeFileSync(keyFile, `${key.toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, archive);
  } catch (error) {
    child.kill();
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}

if (!existsSync(keyFile)) throw new Error('Recovery key is missing; refusing to replace the existing archive');
const key = Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'hex');
if (key.length !== 32) throw new Error('Invalid recovery key');
const { statSync, openSync, readSync, closeSync } = await import('node:fs');
const size = statSync(archive).size;
if (size < 36) throw new Error('Recovery bundle is incomplete');
const file = openSync(archive, 'r'), header = Buffer.alloc(20), tag = Buffer.alloc(16);
try { readSync(file, header, 0, 20, 0); readSync(file, tag, 0, 16, size - 16); } finally { closeSync(file); }
if (header.subarray(0, 8).toString() !== 'ARIAREC1') throw new Error('Unknown recovery format');
const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(8));
decipher.setAuthTag(tag);
await pipeline(createReadStream(archive, { start: 20, end: size - 17 }), decipher, new Writable({ write(_chunk, _encoding, callback) { callback(); } }));
const hash = createHash('sha256');
await pipeline(createReadStream(archive), new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); callback(); } }));
const result = { snapshot: selection.snapshot, ageSeconds: selection.ageSeconds, archive, keyFile, bytes: size, sha256: hash.digest('hex'), encryptionAuthenticated: true };
writeFileSync(completed, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(result));
