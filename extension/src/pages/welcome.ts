// First run: two clicks. Click 1 chooses who is protected, click 2 turns protection on
// (typing a name and a number is not a click). Language is detected automatically.

import { DEMO_URL } from '../core/config.ts';
import type { Translator } from '../core/i18n.ts';
import { defaultChannel, isValidEmail, isValidPin, normalizePhone } from '../core/settings.ts';
import type { Channel, DecideResult, Profile, PublicState } from '../core/types.ts';
import { h, icon, iconTile, type IconName, languageSelect, logo, madeBy, mount, send, translator, withIcon } from './common.ts';
import { telegramBlock } from './telegram-link.ts';

interface Draft {
  profile: Profile;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string;
  channel: Channel;
  pin: string;
}

let tr: Translator;
let state: PublicState;
let language: string | null = null;
const draft: Draft = {
  profile: 'elder',
  guardianName: '',
  guardianPhone: '',
  guardianEmail: '',
  channel: 'whatsapp',
  pin: '',
};

async function start(): Promise<void> {
  state = await send<PublicState>({ type: 'getState' });
  language = state.settings.language;
  tr = await translator(language);
  draft.guardianName = state.settings.guardianName;
  draft.guardianPhone = state.settings.guardianPhone;
  draft.guardianEmail = state.settings.guardianEmail;
  draft.channel = state.settings.channel;
  document.title = `${tr.t('extName')} — ${tr.t('welcome_title')}`;
  if (state.settings.setupDone && state.settings.hasPin) renderProtected();
  else renderProfiles();
}

/** "Step 1 of 2" with two small bars. */
function steps(step: number): HTMLElement {
  return h('div', { class: 'steps' },
    h('span', { class: 'bars', 'aria-hidden': 'true' },
      h('i', { class: 'on' }),
      h('i', { class: step >= 2 ? 'on' : '' }),
    ),
    h('span', { class: 'muted small' }, tr.t('welcome_step', { step })),
  );
}

function topbar(step: number | null): HTMLElement {
  return h('div', { class: 'topbar' },
    logo(),
    h('div', { class: 'topbar-right' },
      step ? steps(step) : null,
      languageSelect(tr, language, async (next) => {
        language = next;
        tr = await translator(language);
        if (!state.settings.setupDone) draft.channel = defaultChannel(tr.language);
        void send({ type: 'saveSettings', patch: { language: next } });
        rerender();
      }),
    ),
  );
}

let rerender: () => void = () => undefined;

/** Shows a setup screen with the small credit line under it. */
function show(page: HTMLElement): void {
  mount(page, madeBy());
}

function renderProtected(): void {
  rerender = renderProtected;
  show(
    h('div', { class: 'page' },
      topbar(null),
      h('main', { class: 'card stack' },
        iconTile('lock', 'brand', 26),
        h('h1', {}, tr.t('opt_locked_text')),
        h('a', { class: 'btn btn-primary', href: 'options.html' }, ...withIcon('sliders', tr.t('btn_open_settings'))),
      ),
    ),
  );
}

// ---------------------------------------------------------------- step 1

function renderProfiles(): void {
  rerender = renderProfiles;
  const choices: Profile[] = ['elder', 'child', 'self'];
  const icons: Record<Profile, IconName> = { elder: 'heart', child: 'smile', self: 'user' };
  show(
    h('div', { class: 'page' },
      topbar(1),
      h('main', {},
        h('h1', { class: 'hero-title' }, tr.t('welcome_title')),
        h('p', { class: 'lead muted' }, tr.t('welcome_subtitle')),
        h('div', { class: 'stack', style: 'margin-top: 24px' },
          ...choices.map((profile) =>
            h('button', {
              class: 'choice',
              type: 'button',
              'data-profile': profile,
              onclick: () => {
                draft.profile = profile;
                renderContact();
              },
            },
              iconTile(icons[profile], 'brand', 26),
              h('span', { class: 'choice-text' },
                h('strong', {}, tr.t(`profile_${profile}`)),
                h('span', {}, tr.t(`profile_${profile}_hint`)),
              ),
              icon('chevron', 22),
            ),
          ),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------- step 2

function fieldError(container: HTMLElement, text: string): void {
  container.querySelector('.error')?.remove();
  if (text) container.append(h('span', { class: 'error' }, text));
}

function renderContact(): void {
  rerender = renderContact;
  const optional = draft.profile === 'self';
  const usesPin = draft.profile !== 'self';

  const whoInput = h('input', {
    id: 'who',
    autocomplete: 'off',
    maxlength: 60,
    placeholder: tr.t('field_who_placeholder'),
    value: draft.guardianName,
  });
  const who = h('label', { class: 'field' },
    h('span', {}, tr.t('field_who')),
    whoInput,
    h('small', { class: 'hint' }, tr.t('field_who_hint')),
  );

  const phoneInput = h('input', {
    id: 'phone',
    type: 'tel',
    autocomplete: 'off',
    maxlength: 32,
    placeholder: tr.t('field_phone_placeholder'),
    value: draft.guardianPhone,
  });
  const phone = h('label', { class: 'field' }, h('span', {}, tr.t('field_phone')), phoneInput);

  const emailInput = h('input', {
    id: 'email',
    type: 'email',
    autocomplete: 'off',
    maxlength: 120,
    placeholder: tr.t('field_email_placeholder'),
    value: draft.guardianEmail,
  });
  const email = h('label', { class: 'field' }, h('span', {}, tr.t('field_email')), emailInput);

  const channels: Channel[] = ['whatsapp', 'telegram', 'email'];
  const channelGroup = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': tr.t('field_channel') });
  for (const channel of channels) {
    const input = h('input', { type: 'radio', name: 'channel', value: channel, checked: draft.channel === channel });
    input.addEventListener('change', () => {
      draft.channel = channel;
      showContactField();
    });
    channelGroup.append(h('label', {}, input, h('span', {}, tr.t(`channel_${channel}`))));
  }
  const channelField = h('div', { class: 'field' }, h('span', {}, tr.t('field_channel')), channelGroup);
  const contactSlot = h('div', {});
  function showContactField(): void {
    contactSlot.replaceChildren(draft.channel === 'email' ? email : phone);
  }
  showContactField();

  const pinInput = h('input', {
    id: 'pin',
    type: 'password',
    inputmode: 'numeric',
    autocomplete: 'new-password',
    maxlength: 6,
    placeholder: tr.t('field_pin_placeholder'),
  });
  const pinHint = h('small', { class: 'hint' }, tr.t('pin_hint_none'));
  pinInput.addEventListener('input', () => {
    pinHint.textContent = tr.t(pinInput.value ? 'pin_hint_set' : 'pin_hint_none');
  });
  const pin = h('label', { class: 'field' }, h('span', {}, tr.t('field_pin')), pinInput, pinHint);

  const formError = h('div', { role: 'alert' });
  const enable = h('button', { class: 'btn btn-primary', type: 'submit', id: 'enable' }, ...withIcon('shield-check', tr.t('btn_enable')));

  const form = h('form', { class: 'card', novalidate: true },
    h('h1', {}, tr.tp('contact_title', draft.profile)),
    h('p', { class: 'muted' }, tr.tp('contact_subtitle', draft.profile)),
    who,
    channelField,
    contactSlot,
    usesPin ? pin : null,
    formError,
    enable,
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    draft.guardianName = whoInput.value.trim();
    draft.guardianPhone = phoneInput.value.trim();
    draft.guardianEmail = emailInput.value.trim();
    draft.pin = usesPin ? pinInput.value.trim() : '';

    const anything = draft.guardianName || draft.guardianPhone || draft.guardianEmail;
    let valid = true;
    fieldError(who, '');
    fieldError(phone, '');
    fieldError(email, '');
    fieldError(pin, '');
    if (!optional || anything) {
      if (!draft.guardianName) {
        fieldError(who, tr.t('err_who'));
        valid = false;
      }
      if (draft.channel === 'email' ? !isValidEmail(draft.guardianEmail) : !normalizePhone(draft.guardianPhone)) {
        if (draft.channel === 'email') fieldError(email, tr.t('err_email'));
        else fieldError(phone, tr.t('err_phone'));
        valid = false;
      }
    }
    if (draft.pin && !isValidPin(draft.pin)) {
      fieldError(pin, tr.t('err_pin'));
      valid = false;
    }
    if (!valid) {
      (form.querySelector('.error')?.previousElementSibling as HTMLElement | null)?.focus();
      return;
    }

    enable.disabled = true;
    const result = await send<DecideResult>({
      type: 'completeSetup',
      setup: {
        profile: draft.profile,
        guardianName: draft.guardianName,
        guardianPhone: draft.guardianPhone,
        guardianEmail: draft.guardianEmail,
        channel: draft.channel,
        language,
        newPin: draft.pin || undefined,
      },
    });
    enable.disabled = false;
    if (!result?.ok) {
      formError.replaceChildren(h('p', { class: 'notice error' }, tr.t('err_pin')));
      return;
    }
    renderDone();
  });

  show(
    h('div', { class: 'page' },
      topbar(2),
      form,
      h('div', { style: 'display:flex; justify-content:space-between; margin-top:12px' },
        h('button', { class: 'btn-link', type: 'button', onclick: () => renderProfiles() }, tr.t('btn_back')),
        optional
          ? h('button', {
              class: 'btn-link',
              type: 'button',
              id: 'skip',
              onclick: () => {
                whoInput.value = '';
                phoneInput.value = '';
                emailInput.value = '';
                form.requestSubmit();
              },
            }, tr.t('btn_skip'))
          : null,
      ),
    ),
  );
  whoInput.focus();
}

// ---------------------------------------------------------------- done

function renderDone(): void {
  rerender = renderDone;
  const hasContact = Boolean(draft.guardianName);
  show(
    h('div', { class: 'page' },
      topbar(null),
      h('main', { class: 'card' },
        h('div', { class: 'done-mark', 'aria-hidden': 'true' }, icon('shield-check', 40)),
        h('h1', { id: 'done' }, tr.t('done_title')),
        h('ul', { class: 'checks lead' },
          h('li', {}, icon('check', 24), h('span', {}, tr.t('done_point_stop'))),
          h('li', {}, icon('check', 24), h('span', {},
            hasContact ? tr.t('done_point_ask', { name: draft.guardianName }) : tr.t('done_point_ask_none'),
          )),
          h('li', {}, icon('check', 24), h('span', {}, tr.t('done_point_private'))),
        ),
        draft.profile !== 'self' ? h('p', { class: 'notice info' }, icon('info', 22), h('span', {}, tr.t('done_show'))) : null,
        h('div', { class: 'stack', style: 'margin-top: 24px' },
          h('a', { class: 'btn btn-primary', href: DEMO_URL, target: '_blank', rel: 'noopener' }, ...withIcon('play', tr.t('btn_try_demo'))),
          h('a', { class: 'btn btn-secondary', href: 'options.html' }, ...withIcon('sliders', tr.t('btn_open_settings'))),
        ),
        h('p', { class: 'muted small', style: 'margin-top: 20px' }, tr.t('done_pin_icon')),
      ),
      state.relay.configured && draft.profile !== 'self' ? telegramCard() : null,
    ),
  );
}

/** Optional third step: alerts that reach the trusted person by themselves. */
function telegramCard(): HTMLElement {
  const name = h('input', {
    id: 'install-name',
    maxlength: 60,
    autocomplete: 'off',
    placeholder: tr.t('field_install_name_placeholder'),
    value: state.settings.installName,
  });
  name.addEventListener('change', () => {
    void send({ type: 'saveSettings', patch: { installName: name.value.trim() } });
  });
  return h('section', { class: 'card', style: 'margin-top: 20px' },
    h('div', { class: 'section-head' }, iconTile('bell'), h('h2', {}, tr.t('tg_title'))),
    h('label', { class: 'field' }, h('span', {}, tr.t('field_install_name')), name),
    telegramBlock(tr, state.relay),
  );
}

void start();
