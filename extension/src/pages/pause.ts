// The pause screen. One main button ("Ask ..."), one safe exit ("Close this page"),
// and a quiet "Continue anyway" that follows the mode rules.
// With Telegram linked, the alert goes by itself and the trusted person's answer appears here.

import { buildAskLink, buildAskMessage, canAsk, formatPhone, telLink } from '../core/contact.ts';
import { toBcp47, type Translator } from '../core/i18n.ts';
import { continueAvailableAt } from '../core/policy.ts';
import type { DecideResult, PageMessage, PauseView } from '../core/types.ts';
import { h, kindSuffix, languageSelect, logo, mount, reasonLabel, send, translator } from './common.ts';

const id = new URLSearchParams(location.search).get('id') ?? '';
const POLL_MS = 3000;

async function start(): Promise<void> {
  const view = id ? await send<PauseView | null>({ type: 'getEvent', id }) : null;
  const tr = await translator(view?.language ?? null);
  document.title = `${tr.t('pause_title')} — ScamFuse`;
  if (!view || view.event.outcome === 'allowed') {
    renderExpired(tr);
    return;
  }
  render(tr, view);
  if (view.voice) speak(tr, view);
}

function speak(tr: Translator, view: PauseView): void {
  try {
    const kind = kindSuffix(view.event.kind);
    const utterance = new SpeechSynthesisUtterance(
      `${tr.t('pause_title')} ${whatText(tr, view)} ${tr.tp(`rule_${kind}`, view.profile)}`,
    );
    utterance.lang = toBcp47(tr.language);
    utterance.rate = 0.9;
    speechSynthesis.speak(utterance);
  } catch {
    // No voice on this computer: the screen still says everything.
  }
}

/** What happened, in one sentence. A fake site names the brand it imitates. */
function whatText(tr: Translator, view: PauseView): string {
  if (view.event.kind === 'phishing') {
    if (view.event.level === 'medium') return tr.t('what_phishing_medium');
    return view.event.detail ? tr.t('what_phishing', { brand: view.event.detail }) : tr.t('what_phishing_nobrand');
  }
  return tr.tp(`what_${kindSuffix(view.event.kind)}`, view.profile);
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

function render(tr: Translator, initial: PauseView): void {
  let view = initial;
  const kind = kindSuffix(view.event.kind);
  const isDownload = view.event.downloadId !== undefined;
  const linked = view.guardians.length > 0;
  const status = h('div', { role: 'status', 'aria-live': 'polite', id: 'status' });
  const relayStatus = h('div', { 'aria-live': 'polite', id: 'relay-status' });

  function showStatus(text: string, error = false): void {
    status.replaceChildren(h('p', { class: error ? 'notice error' : 'notice' }, text));
  }

  // ------------------------------------------------ main action: ask the trusted person
  const askBlock = h('div', { class: 'stack' });
  const label = view.guardianName ? tr.t('btn_ask', { name: view.guardianName }) : tr.t('btn_ask_generic');
  let askButton: HTMLButtonElement | null = null;
  if (linked) {
    askButton = h('button', { class: 'btn btn-primary', type: 'button', id: 'ask' }, label);
    askButton.addEventListener('click', async () => {
      if (askButton) askButton.disabled = true;
      await send({ type: 'askGuardian', id: view.event.id });
      await refresh();
    });
    askBlock.append(askButton, h('p', { class: 'muted small', id: 'ask-hint' }, tr.t('ask_via_telegram')));
  } else {
    const target = { channel: view.channel, phone: view.guardianPhone, email: view.guardianEmail };
    const href = canAsk(target)
      ? buildAskLink(
          target,
          tr.t('msg_subject'),
          buildAskMessage(tr, { kind: view.event.kind, host: view.event.host, at: view.event.createdAt, profile: view.profile }),
        )
      : null;
    if (href) {
      askBlock.append(
        h('a', {
          class: 'btn btn-primary',
          href,
          target: '_blank',
          rel: 'noopener noreferrer',
          id: 'ask',
          onclick: () => {
            void send({ type: 'markAsked', id: view.event.id });
          },
        }, label),
        h('p', { class: 'muted small' }, tr.t('ask_via', { channel: tr.t(`channel_${view.channel}`) })),
      );
    } else {
      askBlock.append(h('p', { class: 'muted' }, tr.t('ask_missing')));
    }
  }
  const tel = telLink(view.guardianPhone);
  if (tel) {
    askBlock.append(
      h('p', { class: 'lead' }, h('a', { href: tel }, tr.t('call_line', { phone: formatPhone(view.guardianPhone) }))),
    );
  }

  // ------------------------------------------------ safe exit
  const closeButton = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    id: 'close',
    onclick: async () => {
      closeButton.disabled = true;
      const result = await decide({ type: 'decide', id: view.event.id, decision: 'block' });
      if (result?.ok) showStatus(tr.t('done_blocked'));
      else closeButton.disabled = false;
    },
  }, tr.t(isDownload ? 'btn_close_download' : 'btn_close'));

  const continueArea = continueBlock(tr, view, showStatus);
  const codeArea = h('div', {});

  // ------------------------------------------------ the trusted person's answer
  function renderRelay(): void {
    const event = view.event;
    const names = view.guardians.join(', ');
    const parts: Node[] = [];
    if (event.outcome === 'blocked' && event.decidedBy === 'guardian') {
      parts.push(h('p', { class: 'notice error', id: 'relay-decision' }, tr.t('relay_blocked', { name: event.decidedByName ?? names })));
      continueArea.hidden = true;
      codeArea.hidden = true;
      if (askButton) askButton.disabled = true;
    } else if (event.outcome === 'allowed') {
      parts.push(h('p', { class: 'notice', id: 'relay-decision' }, tr.t('relay_allowed', { name: event.decidedByName ?? names })));
    } else if (event.alertState === 'sending') {
      parts.push(h('p', { class: 'muted' }, tr.t('relay_sending', { names })));
    } else if (event.alertState === 'sent') {
      parts.push(h('p', { class: 'notice', id: 'relay-sent' }, tr.t('relay_sent', { names })));
    } else if (event.alertState === 'queued') {
      parts.push(h('p', { class: 'notice error' }, tr.t('relay_queued')));
    }
    if (event.reply) {
      parts.push(h('p', { class: 'lead', id: 'relay-reply' }, tr.t('relay_reply', { name: event.replyBy ?? '', text: event.reply })));
    }
    relayStatus.replaceChildren(...parts);
    if (askButton && (event.alertState === 'sent' || event.alertState === 'sending')) {
      askButton.disabled = true;
      askButton.textContent = tr.t('btn_asked');
      askBlock.querySelector('#ask-hint')?.remove();
    }
    if (event.codeHash && codeArea.childElementCount === 0 && event.outcome === 'pending') {
      codeArea.append(codeBlock(tr, view, showStatus));
    }
  }

  async function refresh(): Promise<void> {
    const next = await send<PauseView | null>({ type: 'eventStatus', id: view.event.id });
    if (next) {
      view = next;
      renderRelay();
    }
  }

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
        h('p', { class: 'lead' }, whatText(tr, view)),
        h('p', { class: 'muted' }, tr.tp(`rule_${kind}`, view.profile)),
        relayStatus,
        h('div', { class: 'stack', style: 'margin-top: 24px' }, askBlock, closeButton),
        status,
        codeArea,
        continueArea,
        details(tr, view),
      ),
    ),
  );

  if (linked) {
    renderRelay();
    const poll = async (): Promise<void> => {
      await refresh();
      if (view.event.outcome === 'pending') setTimeout(() => void poll(), POLL_MS);
    };
    setTimeout(() => void poll(), view.event.alertState ? POLL_MS : 800);
  }
}

/** The one-time code the trusted person reads out by phone. */
function codeBlock(tr: Translator, view: PauseView, showStatus: (text: string, error?: boolean) => void): HTMLElement {
  const input = h('input', {
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    maxlength: 7,
    id: 'code',
    'aria-label': tr.t('field_code'),
    placeholder: '000 000',
  });
  const message = h('p', { class: 'small', role: 'alert' });
  const open = h('button', { class: 'btn btn-secondary', type: 'button', id: 'code-open' }, tr.t('btn_unlock'));
  const submit = async (): Promise<void> => {
    open.disabled = true;
    const result = await decide({ type: 'decide', id: view.event.id, decision: 'allow', code: input.value });
    open.disabled = false;
    if (result?.ok) {
      showStatus(tr.t('done_allowed'));
      return;
    }
    input.value = '';
    message.textContent = tr.t('code_wrong', { count: result?.attemptsLeft ?? 0 });
  };
  open.addEventListener('click', () => void submit());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void submit();
  });
  return h('div', { class: 'field', style: 'margin-top: 20px' },
    h('span', {}, tr.t('field_code')),
    h('div', { class: 'inline' }, h('label', { class: 'field' }, input), open),
    h('small', { class: 'hint' }, tr.t('code_hint')),
    message,
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
      h('div', { class: 'inline', style: 'margin-bottom: 8px' }, h('label', { class: 'field' }, pinInput), unlock),
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
