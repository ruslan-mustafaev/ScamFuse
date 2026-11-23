// "Alerts in Telegram": one button, then a QR code for the trusted person's phone.
// The QR code and the 8-digit code both open the ScamFuse bot with this computer's pairing code.

import qrcode from 'qrcode-generator';
import type { Translator } from '../core/i18n.ts';
import type { PairingInfo, PairingStatus, RelayInfo } from '../core/types.ts';
import { h, send, withIcon } from './common.ts';

const SVG = 'http://www.w3.org/2000/svg';
const POLL_MS = 2000;

/** Draws a QR code with DOM calls only (no HTML strings). */
export function qrSvg(text: string, size = 220): SVGSVGElement {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const margin = 4;
  const total = count + margin * 2;
  let path = '';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) path += `M${col + margin} ${row + margin}h1v1h-1z`;
    }
  }
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('role', 'img');
  svg.setAttribute('shape-rendering', 'crispEdges');
  const background = document.createElementNS(SVG, 'rect');
  background.setAttribute('width', String(total));
  background.setAttribute('height', String(total));
  background.setAttribute('fill', '#ffffff');
  const modules = document.createElementNS(SVG, 'path');
  modules.setAttribute('d', path);
  modules.setAttribute('fill', '#000000');
  svg.append(background, modules);
  return svg;
}

/** replaceChildren without the empty slots. */
function fill(root: HTMLElement, ...children: (Node | null)[]): void {
  root.replaceChildren(...children.filter((child): child is Node => child !== null));
}

function spacedCode(code: string): string {
  return `${code.slice(0, 4)} ${code.slice(4)}`;
}

export interface TelegramBlockOptions {
  /** Shows "Disconnect Telegram"; the page handles the PIN. */
  onUnlink?: () => Promise<void>;
  /** Called after a new person is linked. */
  onLinked?: (guardians: string[]) => void;
}

export function telegramBlock(tr: Translator, relay: RelayInfo, options: TelegramBlockOptions = {}): HTMLElement {
  const root = h('div', { class: 'stack', id: 'telegram' });
  let guardians = [...relay.guardians];
  let timer: ReturnType<typeof setTimeout> | undefined;

  function stop(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function renderLinked(note?: string): void {
    stop();
    const test = h('button', { class: 'btn btn-secondary', type: 'button', id: 'tg-test' }, ...withIcon('bell', tr.t('btn_tg_test')));
    const status = h('p', { class: 'small', role: 'status' }, note ?? '');
    test.addEventListener('click', async () => {
      test.disabled = true;
      const result = await send<{ ok: boolean }>({ type: 'relayTest' });
      status.textContent = tr.t(result?.ok ? 'tg_test_sent' : 'tg_error');
      test.disabled = false;
    });
    fill(
      root,
      h('p', { class: 'notice', id: 'tg-linked' }, tr.t('tg_linked', { names: guardians.join(', ') })),
      test,
      guardians.length < 3
        ? h('button', { class: 'btn-link', type: 'button', onclick: () => void connect() }, tr.t('btn_tg_add'))
        : null,
      options.onUnlink
        ? h('button', {
            class: 'btn-link',
            type: 'button',
            onclick: async () => {
              await options.onUnlink?.();
            },
          }, tr.t('btn_tg_unlink'))
        : null,
      status,
    );
  }

  function renderStart(message?: string): void {
    stop();
    fill(
      root,
      h('p', { class: 'muted' }, tr.t('tg_text')),
      message ? h('p', { class: 'notice error' }, message) : null,
      h('button', { class: 'btn btn-primary', type: 'button', id: 'tg-connect', onclick: () => void connect() }, ...withIcon('send', tr.t('btn_tg_connect'))),
    );
  }

  async function connect(): Promise<void> {
    stop();
    const pairing = await send<PairingInfo>({ type: 'relayPair' });
    if (!pairing?.ok || !pairing.code || !pairing.link) {
      const text = tr.t(pairing?.error === 'limit' ? 'tg_limit' : 'tg_error');
      if (guardians.length) renderLinked(text);
      else renderStart(text);
      return;
    }
    const code = pairing.code;
    const waiting = h('p', { class: 'muted small', role: 'status' }, tr.t('tg_waiting'));
    root.replaceChildren(
      h('p', {}, tr.t('tg_scan')),
      h('div', { class: 'qr', 'data-code': code }, qrSvg(pairing.link)),
      h('p', { class: 'small' }, tr.t('tg_or_code', { bot: pairing.bot ?? '', code: spacedCode(code) })),
      waiting,
    );
    const poll = async (): Promise<void> => {
      const status = await send<PairingStatus>({ type: 'relayPairStatus', code });
      if (status?.status === 'paired') {
        const refreshed = await send<{ guardians: string[] }>({ type: 'relayRefresh' });
        guardians = refreshed?.guardians?.length ? refreshed.guardians : [...guardians, status.guardianName ?? ''];
        options.onLinked?.(guardians);
        renderLinked();
        return;
      }
      if (status?.status === 'expired') {
        root.replaceChildren(
          h('p', { class: 'notice error' }, tr.t('tg_expired')),
          h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => void connect() }, tr.t('btn_tg_new_code')),
        );
        return;
      }
      timer = setTimeout(() => void poll(), POLL_MS);
    };
    timer = setTimeout(() => void poll(), POLL_MS);
  }

  if (guardians.length) renderLinked();
  else renderStart();
  return root;
}
