// The pause screen. One main button ("Ask ..."), one safe exit ("Close this page"),
// and a quiet "Continue anyway" that follows the mode rules.

import { buildAskLink, buildAskMessage, canAsk, formatPhone, telLink } from '../core/contact.ts';
import type { Translator } from '../core/i18n.ts';
import { continueAvailableAt } from '../core/policy.ts';
import type { DecideResult, PageMessage, PauseView } from '../core/types.ts';
import { h, kindSuffix, languageSelect, logo, mount, reasonLabel, send, translator } from './common.ts';

const id = new URLSearchParams(location.search).get('id') ?? '';

async function start(): Promise<void> {
  const view = id ? await send<PauseView | null>({ type: 'getEvent', id }) : null;
  const tr = await translator(view?.language ?? null);
  document.title = `${tr.t('pause_title')} — ScamFuse`;
  if (!view || view.event.outcome === 'allowed') {
    renderExpired(tr);
    return;
  }
  render(tr, view);
}

function renderExpired(tr: Translator): void {
  mount(
    h('div', { class: 'page' },
      h('div', { class: 'topbar' }, logo()),
      h('div', { class: 'card' },
        h('h1', {}, tr.t('expired_title')),
        h('p', { class: 'lead' }, tr.t('expired_text')),
      ),
    ),
  );
}

function decide(message: Extract<PageMessage, { type: 'decide' }>): Promise<DecideResult> {
  return send<DecideResult>(message);
}

function render(tr: Translator, view: PauseView): void {
  const { event, profile } = view;
  const kind = kindSuffix(event.kind);
  const isDownload = event.downloadId !== undefined;
  const status = h('div', { role: 'status', 'aria-live': 'polite' });

  function showStatus(text: string, error = false): void {
    status.replaceChildren(h('p', { class: error ? 'notice error' : 'notice' }, text));
  }

  // Main action: ask the trusted person.
  const askBlock = h('div', { class: 'stack' });
  const target = { channel: view.channel, phone: view.guardianPhone, email: view.guardianEmail };
  if (canAsk(target)) {
    const message = buildAskMessage(tr, { kind: event.kind, host: event.host, at: event.createdAt, profile });
    const href = buildAskLink(target, tr.t('msg_subject'), message);
    const label = view.guardianName ? tr.t('btn_ask', { name: view.guardianName }) : tr.t('btn_ask_generic');
    if (href) {
      askBlock.append(
        h('a', {
          class: 'btn btn-primary',
          href,
          target: '_blank',
          rel: 'noopener noreferrer',
          id: 'ask',
          onclick: () => {
            void send({ type: 'markAsked', id: event.id });
          },
        }, label),
        h('p', { class: 'muted small' }, tr.t('ask_via', { channel: tr.t(`channel_${view.channel}`) })),
      );
    }
  } else {
    askBlock.append(h('p', { class: 'muted' }, tr.t('ask_missing')));
  }
  const tel = telLink(view.guardianPhone);
  if (tel) {
    askBlock.append(
      h('p', { class: 'lead' },
        h('a', { href: tel }, tr.t('call_line', { phone: formatPhone(view.guardianPhone) })),
      ),
    );
  }

  // Safe exit.
  const closeButton = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    id: 'close',
    onclick: async () => {
      closeButton.disabled = true;
      const result = await decide({ type: 'decide', id: event.id, decision: 'block' });
      if (result?.ok) showStatus(tr.t('done_blocked'));
      else closeButton.disabled = false;
    },
  }, tr.t(isDownload ? 'btn_close_download' : 'btn_close'));

  mount(
    h('div', { class: 'page' },
      h('div', { class: 'topbar' },
        logo(),
        languageSelect(tr, view.language, (language) => {
          void send({ type: 'saveSettings', patch: { language } }).then(() => location.reload());
        }),
      ),
      h('main', { class: 'card' },
        h('h1', {}, tr.t('pause_title')),
        h('p', { class: 'lead' }, tr.tp(`what_${kind}`, profile)),
        h('p', { class: 'muted' }, tr.tp(`rule_${kind}`, profile)),
        h('div', { class: 'stack', style: 'margin-top: 24px' }, askBlock, closeButton),
        status,
        continueBlock(tr, view, showStatus),
        details(tr, view),
      ),
    ),
  );
}

function continueBlock(tr: Translator, view: PauseView, showStatus: (text: string, error?: boolean) => void): HTMLElement {
  const { event } = view;
  const availableAt = continueAvailableAt(event, view.mode, view.lockMinutes);
  const block = h('div', { style: 'margin-top: 20px' });

  const continueButton = h('button', { class: 'btn-link', type: 'button', id: 'continue', disabled: true }, '');
  continueButton.addEventListener('click', async () => {
    continueButton.disabled = true;
    const result = await decide({ type: 'decide', id: event.id, decision: 'allow' });
    if (result?.ok) showStatus(tr.t('done_allowed'));
    else continueButton.disabled = false;
  });

  function tick(): void {
    const left = Math.ceil((availableAt - Date.now()) / 1000);
    if (left <= 0) {
      continueButton.disabled = false;
      continueButton.textContent = tr.t('continue_now');
      return;
    }
    continueButton.disabled = true;
    continueButton.textContent =
      view.mode === 'strict' ? tr.t('continue_now') : tr.t('continue_wait', { seconds: left });
    setTimeout(tick, 1000);
  }
  tick();
  block.append(continueButton);

  if (view.mode === 'strict' && view.hasPin) {
    const pinInput = h('input', {
      type: 'password',
      inputmode: 'numeric',
      autocomplete: 'off',
      maxlength: 6,
      id: 'pin',
      'aria-label': tr.t('field_pin_short'),
      placeholder: tr.t('field_pin_short'),
    });
    const pinMessage = h('p', { class: 'small', role: 'alert' });
    const unlock = h('button', { class: 'btn btn-secondary', type: 'button', id: 'unlock' }, tr.t('btn_unlock'));
    const submit = async (): Promise<void> => {
      unlock.disabled = true;
      const result = await decide({ type: 'decide', id: event.id, decision: 'allow', pin: pinInput.value });
      unlock.disabled = false;
      if (result?.ok) {
        showStatus(tr.t('done_allowed'));
        return;
      }
      pinInput.value = '';
      if (result?.error === 'pin-locked' && result.lockedUntil) {
        pinMessage.textContent = tr.t('pin_locked', { time: tr.time(result.lockedUntil) });
      } else if (result?.error === 'wrong-pin') {
        pinMessage.textContent = tr.t('pin_wrong', { count: result.attemptsLeft ?? 0 });
      }
    };
    unlock.addEventListener('click', () => void submit());
    pinInput.addEventListener('keydown', (keyEvent) => {
      if (keyEvent.key === 'Enter') void submit();
    });
    if (view.pinLockedUntil) pinMessage.textContent = tr.t('pin_locked', { time: tr.time(view.pinLockedUntil) });
    block.prepend(
      h('p', { class: 'muted small' }, tr.t('continue_strict', { time: tr.time(availableAt) })),
      h('div', { class: 'segmented', style: 'margin-bottom: 8px' },
        h('label', { class: 'field', style: 'margin: 0; flex: 2' }, pinInput),
        unlock,
      ),
      pinMessage,
    );
  }
  return block;
}

function details(tr: Translator, view: PauseView): HTMLElement {
  const list = h('ul', { class: 'points small' });
  for (const reason of view.event.reasons) list.append(h('li', {}, reasonLabel(tr, reason)));
  return h('details', {},
    h('summary', {}, tr.t('details')),
    view.event.host ? h('p', { class: 'small' }, tr.t('details_site', { host: view.event.host })) : null,
    list,
  );
}

void start();
