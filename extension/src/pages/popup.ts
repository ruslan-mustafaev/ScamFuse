// The toolbar window: status, today's count, and one button to ask about the open page.

import { DEMO_URL } from '../core/config.ts';
import { buildAskLink, buildAskMessage, canAsk, kindKey } from '../core/contact.ts';
import { hostOf } from '../core/domains.ts';
import type { PublicState, SiteCheck } from '../core/types.ts';
import { h, languageSelect, mount, reasonLabel, send, translator } from './common.ts';

async function start(): Promise<void> {
  const state = await send<PublicState>({ type: 'getState' });
  const tr = await translator(state.settings.language);
  const s = state.settings;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const pageHost = hostOf(tab?.url);

  const status = h('div', { class: s.enabled ? 'notice' : 'notice error', id: 'status' },
    tr.t(s.enabled ? 'popup_on' : 'popup_off'),
  );

  const actions = h('div', { class: 'stack' });
  if (!s.setupDone) {
    actions.append(
      h('p', { class: 'muted small' }, tr.t('popup_setup_needed')),
      h('a', { class: 'btn btn-primary', href: 'welcome.html', target: '_blank' }, tr.t('btn_finish_setup')),
    );
  }
  const target = { channel: s.channel, phone: s.guardianPhone, email: s.guardianEmail };
  if (pageHost && canAsk(target) && s.guardianName) {
    const message = buildAskMessage(tr, { kind: 'page', host: pageHost, title: tab?.title, at: Date.now(), profile: s.profile });
    const href = buildAskLink(target, tr.t('msg_subject'), message);
    if (href) {
      actions.append(
        h('a', { class: 'btn btn-primary', href, target: '_blank', rel: 'noopener noreferrer', id: 'ask-page' },
          tr.t('popup_ask_page', { name: s.guardianName }),
        ),
      );
    }
  }

  // How the open page looks to the fake-site check.
  let check: SiteCheck | null = null;
  if (tab?.id !== undefined && pageHost) {
    check = await (chrome.tabs.sendMessage(tab.id, { type: 'siteCheck' }, { frameId: 0 }) as Promise<SiteCheck>).catch(() => null);
  }
  const reasons = check ? check.reasons.slice(0, 3).map((code) => reasonLabel(tr, code)).join('; ') : '';
  const siteBlock = h('div', { id: 'site-check', style: 'margin: 10px 0' },
    h('strong', { class: 'small' }, `${tr.t('popup_site_title')}: ${pageHost || '—'}`),
    h('p', {
      class: check && check.level !== 'low' ? 'notice error small' : 'muted small',
      style: 'margin: 4px 0 0',
    },
      !check
        ? tr.t('popup_site_na')
        : check.level === 'low'
          ? tr.t('popup_site_ok')
          : tr.t(check.level === 'high' ? 'popup_site_high' : 'popup_site_medium', { reasons }),
    ),
  );

  const recent = state.log.slice(0, 3);
  const recentBlock = recent.length
    ? h('ul', { class: 'plain small' },
        ...recent.map((entry) =>
          h('li', { style: 'padding: 6px 0; border-bottom: 1px solid var(--line)' },
            h('strong', {}, tr.t(kindKey(entry.kind))),
            h('br', {}),
            h('span', { class: 'muted' }, `${tr.time(entry.at)} · ${entry.host || '—'} · ${tr.t(`outcome_${entry.outcome}`)}`),
          ),
        ),
      )
    : h('p', { class: 'muted small' }, tr.t('popup_none'));

  mount(
    h('div', { class: 'popup' },
      h('div', { class: 'topbar', style: 'margin-bottom: 12px' },
        h('div', { class: 'brand' }, h('img', { src: '../icons/on-32.png', alt: '', width: 24, height: 24 }), h('span', {}, 'ScamFuse')),
        languageSelect(tr, s.language, (language) => {
          void send({ type: 'saveSettings', patch: { language } }).then(() => location.reload());
        }),
      ),
      status,
      state.relay.guardians.length
        ? h('p', { class: 'small', style: 'margin: 10px 0 0' }, tr.t('popup_tg', { names: state.relay.guardians.join(', ') }))
        : null,
      siteBlock,
      h('p', { class: 'small', style: 'margin: 10px 0' }, tr.t('popup_today', { count: state.todayCount })),
      actions,
      h('h2', { style: 'font-size: 16px; margin: 16px 0 6px' }, tr.t('popup_recent')),
      recentBlock,
      h('div', { style: 'display:flex; justify-content:space-between; margin-top: 14px' },
        h('a', { href: 'options.html', target: '_blank' }, tr.t('popup_settings')),
        h('a', { href: DEMO_URL, target: '_blank', rel: 'noopener' }, tr.t('popup_demo')),
      ),
    ),
  );
}

void start();
