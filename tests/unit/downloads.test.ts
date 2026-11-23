import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseName, classifyDownload, isExecutable, remoteToolOf } from '../../extension/src/core/downloads.ts';

const all = { remoteAccess: true, programDownload: true };

test('remote access programs are recognised by site and by file name', () => {
  assert.equal(remoteToolOf('download.anydesk.com', 'C:\\Users\\a\\Downloads\\AnyDesk.exe'), 'AnyDesk');
  assert.equal(remoteToolOf('cdn.example.net', '/home/a/Downloads/TeamViewer_Setup_x64.exe'), 'TeamViewer');
  assert.equal(remoteToolOf('files.example.org', 'rustdesk-1.3.2-x86_64.exe'), 'RustDesk');
  assert.equal(remoteToolOf('example.org', 'scamfuse-demo-remote-support.exe'), 'ScamFuse demo');
});

test('a document whose name looks like a tool is not a remote access program', () => {
  assert.equal(remoteToolOf('example.org', 'anydesk-manual.pdf'), null);
  assert.equal(remoteToolOf('example.org', 'sos_report.txt'), null);
});

test('remote access downloads are high level', () => {
  const verdict = classifyDownload({ host: 'anydesk.com', fileName: 'AnyDesk.exe', ...all });
  assert.deepEqual(verdict, { kind: 'remote-download', level: 'high', reasons: ['remote-tool'] });
});

test('programs from unofficial sites are stopped only when that detector is on', () => {
  const cheat = { host: 'free-robux.example', fileName: 'robux-generator.exe' };
  assert.equal(classifyDownload({ ...cheat, ...all })?.kind, 'program-download');
  assert.equal(classifyDownload({ ...cheat, remoteAccess: true, programDownload: false }), null);
});

test('official stores and non-programs pass', () => {
  assert.equal(classifyDownload({ host: 'setup.rbxcdn.com', fileName: 'RobloxPlayerInstaller.exe', ...all }), null);
  assert.equal(classifyDownload({ host: 'dl.google.com', fileName: 'ChromeSetup.exe', ...all }), null);
  assert.equal(classifyDownload({ host: 'example.org', fileName: 'homework.pdf', ...all }), null);
  assert.equal(classifyDownload({ host: 'example.org', fileName: 'photos.zip', ...all }), null);
});

test('file name helpers', () => {
  assert.equal(baseName('C:\\a\\b\\Setup.EXE'), 'setup.exe');
  assert.equal(isExecutable('Setup.EXE'), true);
  assert.equal(isExecutable('notes.txt'), false);
  assert.equal(isExecutable('.exe'), false);
});
