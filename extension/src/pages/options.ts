// Settings. Every change is saved at once: no "Save" button to forget.
// With a PIN set, the page asks for it once and then keeps it in memory for this tab.

import { PROJECT_URL } from '../core/config.ts';
import { kindKey } from '../core/contact.ts';
import type { Translator } from '../core/i18n.ts';
import {
  defaultDetectors,
  DETECTORS,
  isValidEmail,
  isValidPin,
  MAX_LOCK_MINUTES,
  MIN_LOCK_MINUTES,
  normalizeHostInput,
  normalizePhone,
  normalizeRelayUrl,
} from '../core/settings.ts';
import type { Channel, DecideResult, Mode, Profile, PublicState, Settings } from '../core/types.ts';
import { h, iconTile, type IconName, languageSelect, logo, madeBy, mount, send, translator, withIcon } from './common.ts';
import { telegramBlock } from './telegram-link.ts';

type Patch = Partial<Omit<Settings, 'pin' | 'version'>>;

let tr: Translator;
let state: PublicState;
let pin: string | undefined;

async function load(): Promise<void> {
  state = await send<PublicState>({ type: 'getState' });
  tr = await translator(state.settings.language);
  document.title = tr.t('opt_title');
}

async function start(): Promise<void> {
  await load();
  if (state.settings.hasPin && pin === undefined) renderLock();
  else render();
}

function toast(text: string): void {
  document.querySelector('.toast')?.remove();
  const node = h('div', { class: 'toast', role: 'status' }, text);
  document.body.append(node);
  setTimeout(() => node.remove(), 1800);
}

async function save(patch: Patch): Promise<boolean> {
  const result = await send<DecideResult>({ type: 'saveSettings', patch, pin });
  if (!result?.ok) return false;
  await load();
  toast(tr.t('saved'));
  return true;
}

function renderLock(): void {
  const input = h('input', { type: 'password', inputmode: 'numeric', maxlength: 6, id: 'unlock-pin', autocomplete: 'off' });
  const message = h('p', { role: 'alert', class: 'small' });
  const form = h('form', { class: 'card' },
    h('div', { class: 'section-head' }, iconTile('lock'), h('h1', { style: 'margin: 0' }, tr.t('opt_locked_title'))),
    h('p', { class: 'muted' }, tr.t('opt_locked_text')),
    h('label', { class: 'field' }, h('span', {}, tr.t('field_pin_short')), input),
    message,
    h('button', { class: 'btn btn-primary', type: 'submit' }, ...withIcon('lock', tr.t('btn_unlock'))),
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = await send<{ ok: boolean; attemptsLeft: number; lockedUntil: number }>({
      type: 'verifyPin',
      pin: input.value,
    });
    if (result?.ok) {
      pin = input.value;
      render();
      return;
    }
    input.value = '';
    message.textContent = result?.lockedUntil
      ? tr.t('pin_locked', { time: tr.time(result.lockedUntil) })
      : tr.t('pin_wrong', { count: result?.attemptsLeft ?? 0 });
  });
  mount(h('div', { class: 'page' }, h('div', { class: 'topbar' }, logo()), form));
  input.focus();
}

function section(title: string, iconName: IconName, ...children: (Node | null)[]): HTMLElement {
  return h('section', { class: 'card section' },
    h('div', { class: 'section-head' }, iconTile(iconName), h('h2', {}, title)),
    ...children,
  );
}

function radios<T extends string>(name: string, values: readonly T[], current: T, label: (value: T) => string, onPick: (value: T) => void, disabled: (value: T) => boolean = () => false): HTMLElement {
  const group = h('div', { role: 'radiogroup' });
  for (const value of values) {
    const input = h('input', { type: 'radio', name, value, checked: value === current, disabled: disabled(value) });
    input.addEventListener('change', () => onPick(value));
    group.append(h('label', { class: 'radio-row' }, input, h('span', {}, label(value))));
  }
  return group;
}

function textField(label: string, value: string, attrs: Record<string, string | number>, validate: (value: string) => string, onSave: (value: string) => void): HTMLElement {
  const input = h('input', { value, ...attrs });
  const field = h('label', { class: 'field' }, h('span', {}, label), input);
  input.addEventListener('change', () => {
    field.querySelector('.error')?.remove();
    const error = validate(input.value.trim());
    if (error) {
      field.append(h('span', { class: 'error' }, error));
      return;
    }
    onSave(input.value.trim());
  });
  return field;
}

function render(): void {
  const s = state.settings;

  // ------------------------------------------------ header + on/off
  const enabled = h('input', { type: 'checkbox', class: 'switch', id: 'enabled', checked: s.enabled });
  enabled.addEventListener('change', () => void save({ enabled: enabled.checked }).then(render));

  // ------------------------------------------------ people
  const channels: Channel[] = ['whatsapp', 'telegram', 'email'];
  const people = section(
    tr.t('opt_section_people'),
    'users',
    textField(tr.t('field_who'), s.guardianName, { maxlength: 60, id: 'opt-who', placeholder: tr.t('field_who_placeholder') }, () => '', (value) => void save({ guardianName: value })),
    h('div', { class: 'field' },
      h('span', {}, tr.t('field_channel')),
      radios('channel', channels, s.channel, (c) => tr.t(`channel_${c}`), (c) => void save({ channel: c }).then(render)),
    ),
    s.channel === 'email'
      ? textField(tr.t('field_email'), s.guardianEmail, { type: 'email', maxlength: 120, id: 'opt-email' }, (v) => (v && !isValidEmail(v) ? tr.t('err_email') : ''), (value) => void save({ guardianEmail: value }))
      : textField(tr.t('field_phone'), s.guardianPhone, { type: 'tel', maxlength: 32, id: 'opt-phone', placeholder: tr.t('field_phone_placeholder') }, (v) => (v && !normalizePhone(v) ? tr.t('err_phone') : ''), (value) => void save({ guardianPhone: value })),
  );

  // ------------------------------------------------ protection
  const profiles: Profile[] = ['elder', 'child', 'self'];
  const modes: Mode[] = ['advice', 'strict'];
  const lockField = s.mode === 'strict'
    ? textField(tr.t('opt_lock_minutes'), String(s.lockMinutes), { type: 'number', min: MIN_LOCK_MINUTES, max: MAX_LOCK_MINUTES, id: 'opt-lock' },
        (v) => (Number.isFinite(Number(v)) && Number(v) >= MIN_LOCK_MINUTES && Number(v) <= MAX_LOCK_MINUTES ? '' : `${MIN_LOCK_MINUTES}–${MAX_LOCK_MINUTES}`),
        (v) => void save({ lockMinutes: Number(v) }))
    : null;

  const newPin = h('input', { type: 'password', inputmode: 'numeric', maxlength: 6, autocomplete: 'new-password', id: 'opt-new-pin' });
  const pinMessage = h('p', { class: 'small', role: 'status' });
  const setPin = h('button', { class: 'btn btn-secondary', type: 'button' }, tr.t('btn_set_pin'));
  setPin.addEventListener('click', async () => {
    if (!isValidPin(newPin.value)) {
      pinMessage.textContent = tr.t('err_pin');
      return;
    }
    const result = await send<DecideResult>({ type: 'setPin', newPin: newPin.value, pin });
    if (result?.ok) {
      pin = newPin.value;
      await load();
      toast(tr.t('saved'));
      render();
    }
  });
  const removePin = s.hasPin
    ? h('button', {
        class: 'btn-link',
        type: 'button',
        onclick: async () => {
          const result = await send<DecideResult>({ type: 'setPin', newPin: null, pin });
          if (result?.ok) {
            pin = undefined;
            await load();
            toast(tr.t('saved'));
            render();
          }
        },
      }, tr.t('btn_remove_pin'))
    : null;

  const protection = section(
    tr.t('opt_section_protection'),
    'shield',
    h('div', { class: 'field' },
      h('span', {}, tr.t('opt_profile')),
      radios('profile', profiles, s.profile, (p) => tr.t(`profile_${p}`), (p) => void save({ profile: p, detectors: defaultDetectors(p) }).then(render)),
    ),
    h('div', { class: 'field' },
      h('span', {}, tr.t('opt_mode')),
      radios('mode', modes, s.mode, (m) => tr.t(`mode_${m}`), (m) => void save({ mode: m }).then(render), (m) => m === 'strict' && !s.hasPin),
      !s.hasPin ? h('small', { class: 'hint' }, tr.t('mode_strict_needs_pin')) : null,
    ),
    lockField,
    h('div', { class: 'field' },
      h('span', {}, tr.t('opt_pin')),
      h('p', { class: 'muted small' }, tr.t(s.hasPin ? 'opt_pin_on' : 'opt_pin_none')),
      h('div', { class: 'inline' }, h('label', { class: 'field' }, newPin), setPin),
      h('small', { class: 'hint' }, tr.t('opt_pin_new')),
      pinMessage,
      removePin,
    ),
  );

  // ------------------------------------------------ detectors
  const detectorRows = DETECTORS.map((id) => {
    const box = h('input', { type: 'checkbox', checked: s.detectors[id], id: `det-${id}` });
    box.addEventListener('change', () => void save({ detectors: { ...s.detectors, [id]: box.checked } }));
    return h('label', { class: 'switch-row' },
      h('div', { class: 'text' }, h('strong', {}, tr.t(`det_${id}`)), h('span', {}, tr.t(`det_${id}_hint`))),
      box,
    );
  });
  const voice = h('input', { type: 'checkbox', checked: s.voice, id: 'opt-voice' });
  voice.addEventListener('change', () => void save({ voice: voice.checked }));
  detectorRows.push(
    h('label', { class: 'switch-row' },
      h('div', { class: 'text' }, h('strong', {}, tr.t('opt_voice')), h('span', {}, tr.t('opt_voice_hint'))),
      voice,
    ),
  );
  const detectors = section(tr.t('opt_section_detectors'), 'scan', ...detectorRows);

  // ------------------------------------------------ alerts in Telegram
  const relayField = textField(
    tr.t('opt_relay_url'),
    s.relayUrl,
    { type: 'url', id: 'opt-relay', placeholder: 'https://', maxlength: 200 },
    (v) => (v && !normalizeRelayUrl(v) ? tr.t('err_relay_url') : ''),
    (value) => void save({ relayUrl: normalizeRelayUrl(value) }).then(render),
  );
  relayField.append(h('small', { class: 'hint' }, tr.t('opt_relay_hint')));
  const telegram = section(
    tr.t('tg_title'),
    'bell',
    state.relay.configured
      ? textField(tr.t('field_install_name'), s.installName, { maxlength: 60, id: 'opt-install-name', placeholder: tr.t('field_install_name_placeholder') }, () => '', (value) => void save({ installName: value }))
      : h('p', { class: 'muted' }, tr.t('opt_relay_none')),
    state.relay.configured
      ? telegramBlock(tr, state.relay, {
          onUnlink: async () => {
            const result = await send<DecideResult>({ type: 'relayUnlink', pin });
            if (result?.ok) {
              await load();
              render();
            }
          },
          onLinked: () => void load(),
        })
      : null,
    h('details', {}, h('summary', {}, tr.t('opt_relay_url')), relayField),
  );

  // ------------------------------------------------ trusted sites
  const siteInput = h('input', { placeholder: tr.t('opt_site_placeholder'), id: 'opt-site', autocomplete: 'off' });
  const siteError = h('p', { class: 'small', role: 'alert' });
  const addSite = h('button', { class: 'btn btn-secondary', type: 'button' }, tr.t('btn_add'));
  addSite.addEventListener('click', () => {
    const host = normalizeHostInput(siteInput.value);
    if (!host) {
      siteError.textContent = tr.t('err_site');
      return;
    }
    void save({ trustedSites: [...s.trustedSites, host] }).then(render);
  });
  const siteList = s.trustedSites.length
    ? h('ul', { class: 'plain sites' },
        ...s.trustedSites.map((site) =>
          h('li', {},
            h('span', {}, site),
            h('button', { class: 'btn-link', type: 'button', onclick: () => void save({ trustedSites: s.trustedSites.filter((x) => x !== site) }).then(render) }, tr.t('btn_remove')),
          ),
        ),
      )
    : h('p', { class: 'muted' }, tr.t('opt_sites_empty'));
  const sites = section(
    tr.t('opt_section_sites'),
    'star',
    h('p', { class: 'muted small' }, tr.t('opt_sites_hint')),
    siteList,
    h('div', { class: 'inline', style: 'margin-top: 14px' }, h('label', { class: 'field' }, siteInput), addSite),
    siteError,
  );

  // ------------------------------------------------ log
  const log = state.log.length
    ? h('table', { class: 'log' },
        h('thead', {}, h('tr', {}, h('th', {}, tr.t('log_time')), h('th', {}, tr.t('log_what')), h('th', {}, tr.t('log_site')), h('th', {}, tr.t('log_result')))),
        h('tbody', {},
          ...state.log.map((entry) =>
            h('tr', {},
              h('td', {}, tr.dateTime(entry.at)),
              h('td', {}, tr.t(kindKey(entry.kind))),
              h('td', {}, entry.host),
              h('td', {}, tr.t(`outcome_${entry.outcome}`)),
            ),
          ),
        ),
      )
    : h('p', { class: 'muted' }, tr.t('log_empty'));
  const logSection = section(
    tr.t('opt_section_log'),
    'list',
    log,
    state.log.length
      ? h('button', { class: 'btn-link', type: 'button', onclick: async () => {
          const result = await send<DecideResult>({ type: 'clearLog', pin });
          if (result?.ok) {
            await load();
            render();
          }
        } }, tr.t('btn_clear_log'))
      : null,
  );

  // ------------------------------------------------ about
  const about = section(
    tr.t('opt_section_about'),
    'info',
    h('p', {}, tr.t('about_text')),
    h('p', { class: 'muted small' }, tr.t('about_version', { version: state.version })),
    h('div', { class: 'popup-links', style: 'max-width: 460px' },
      h('a', { href: PROJECT_URL, target: '_blank', rel: 'noopener' }, ...withIcon('code', tr.t('about_source'), 18)),
      h('a', { href: 'welcome.html' }, ...withIcon('play', tr.t('btn_rerun_setup'), 18)),
    ),
  );

  mount(
    h('div', { class: 'page' },
      h('div', { class: 'topbar' },
        logo(),
        languageSelect(tr, s.language, (language) => {
          void save({ language }).then(async () => {
            tr = await translator(state.settings.language);
            render();
          });
        }),
      ),
      h('h1', { class: 'page-title' }, tr.t('opt_title')),
      h('label', { class: 'card master' },
        iconTile(s.enabled ? 'shield-check' : 'shield-off', s.enabled ? 'ok' : 'danger', 26),
        h('div', { class: 'text' }, h('strong', {}, tr.t(s.enabled ? 'popup_on' : 'popup_off'))),
        enabled,
      ),
      people,
      telegram,
      protection,
      detectors,
      sites,
      logSection,
      about,
    ),
    madeBy(),
  );
}

void start();
