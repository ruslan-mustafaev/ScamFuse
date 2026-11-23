import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isRtl,
  placeholdersOf,
  resolveLanguage,
  SUPPORTED_LANGUAGES,
  toLocaleFolder,
  Translator,
  type MessageTable,
} from '../../extension/src/core/i18n.ts';

const localesDir = join(import.meta.dirname, '../../extension/public/_locales');
const tables: Record<string, MessageTable> = {};
for (const folder of readdirSync(localesDir)) {
  tables[folder] = JSON.parse(readFileSync(join(localesDir, folder, 'messages.json'), 'utf8')) as MessageTable;
}

test('language follows the manual choice, then the browser, then the preferred list, then English', () => {
  assert.equal(resolveLanguage('ru', 'en-US', ['en-US']), 'ru');
  assert.equal(resolveLanguage(null, 'ru-RU', ['en']), 'ru');
  assert.equal(resolveLanguage(null, 'sk-SK', ['sk', 'ru', 'en']), 'ru');
  assert.equal(resolveLanguage(null, 'ja', ['ja']), 'en');
  assert.equal(resolveLanguage('xx', 'ru', []), 'ru');
});

test('regional variants map to their folder or to the base language', () => {
  assert.equal(toLocaleFolder('pt-br'), 'pt_BR');
  assert.equal(resolveLanguage(null, 'pt-BR', [], ['en', 'pt_BR', 'pt_PT']), 'pt_BR');
  assert.equal(resolveLanguage(null, 'en-GB', [], ['en']), 'en');
});

test('right-to-left languages are detected', () => {
  assert.equal(isRtl('ar'), true);
  assert.equal(isRtl('he-IL'), true);
  assert.equal(isRtl('ru'), false);
});

test('every supported language has a folder and every folder is supported', () => {
  assert.deepEqual(Object.keys(tables).sort(), [...SUPPORTED_LANGUAGES].sort());
});

test('every translation has all English keys with the same placeholders', () => {
  const en = tables.en ?? {};
  for (const [language, table] of Object.entries(tables)) {
    for (const [key, entry] of Object.entries(en)) {
      const translated = table[key];
      assert.ok(translated, `${language} is missing "${key}"`);
      assert.deepEqual(
        placeholdersOf(translated.message),
        placeholdersOf(entry.message),
        `${language} "${key}" has different placeholders`,
      );
    }
    for (const key of Object.keys(table)) {
      assert.ok(key in en, `${language} has "${key}" that English does not have`);
      assert.match(key, /^[A-Za-z0-9_]+$/, `${language} key "${key}" has characters Chrome rejects`);
    }
  }
});

test('the safe clipboard text is harmless if someone pastes and runs it', () => {
  for (const [language, table] of Object.entries(tables)) {
    const text = table.clip_safe?.message ?? '';
    assert.ok(text.startsWith('#'), `${language} clip_safe must start with #`);
    assert.doesNotMatch(text, /["'`|&<>$;\\]/, `${language} clip_safe has a shell character`);
  }
});

test('texts made for one profile fall back to the common text', () => {
  const tr = new Translator('en', { a: { message: 'Common {x}' }, a__child: { message: 'Child {x}' } });
  assert.equal(tr.tp('a', 'child', { x: 1 }), 'Child 1');
  assert.equal(tr.tp('a', 'elder', { x: 1 }), 'Common 1');
  assert.equal(tr.t('missing'), 'missing');
});
