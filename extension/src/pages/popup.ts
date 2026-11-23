// The toolbar window: status, today's count, the open page's check, and one button to ask about it.

import { DEMO_URL } from '../core/config.ts';
import { buildAskLink, buildAskMessage, canAsk, kindKey } from '../core/contact.ts';
import { hostOf } from '../core/domains.ts';
import type { PublicState, SiteCheck } from '../core/types.ts';
import { h, icon, iconTile, languageSelect, madeBy, mount, reasonLabel, send, translator, withIcon } from './common.ts';

async function start(): Promise<void> {
  const state = await send<PublicState>({ type: 'getState' });
  const tr = await translator(state.settings.language);
  const s = state.settings;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const pageHost = hostOf(tab?.url);

  // ------------------------------------------------ protection on/off and today's count
  const status = h('div', { class: `tile status-tile ${s.enabled ? 'on' : 'off'}`, id: 'status' },
    iconTile(s.enabled ? 'shield-check' : 'shield-off', s.enabled ? 'ok' : 'danger'),
    h('div', { class: 'tile-text' },
      h('strong', {}, tr.t(s.enabled ? 'popup_on' : 'popup_off')),
      state.relay.guardians.length
        ? h('span', {}, tr.t('popup_tg', { names: state.relay.guardians.join(', ') }))
        : h('span', {}, tr.t('popup_today', { count: state.todayCount })),
    ),
    h('div', { class: 'count-badge', title: tr.t('popup_today', { count: state.todayCount }) },
      String(state.todayCount),
    ),
  );

  const actions = h('div', { class: 'stack' });
  if (!s.setupDone) {
    actions.append(
      h('p', { class: 'notice warn small' }, tr.t('popup_setup_needed')),
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
          ...withIcon(s.channel === 'email' ? 'mail' : 'send', tr.t('popup_ask_page', { name: s.guardianName }), 20),
        ),
      );
    }
  }

  // ------------------------------------------------ how the open page looks to the fake-site check
  let check: SiteCheck | null = null;
  if (tab?.id !== undefined && pageHost) {
    check = await (chrome.tabs.sendMessage(tab.id, { type: 'siteCheck' }, { frameId: 0 }) as Promise<SiteCheck>).catch(() => null);
  }
  const reasons = check ? check.reasons.slice(0, 3).map((code) => reasonLabel(tr, code)).join('; ') : '';
  const level = check ? check.level : 'na';
  const siteIcon = level === 'low' ? iconTile('check-circle', 'ok') : level === 'high' ? iconTile('alert', 'danger') : level === 'medium' ? iconTile('alert', 'warn') : iconTile('globe', 'muted');
  const siteBlock = h('div', { class: `tile site-tile level-${level}`, id: 'site-check' },
    siteIcon,
    h('div', { class: 'tile-text' },
      h('strong', {}, pageHost || tr.t('popup_site_title')),
      h('div', { class: 'verdict' },
        !check
          ? tr.t('popup_site_na')
          : check.level === 'low'
            ? tr.t('popup_site_ok')
            : tr.t(check.level === 'high' ? 'popup_site_high' : 'popup_site_medium', { reasons }),
      ),
    ),
  );

  // ------------------------------------------------ the last three events
  const recent = state.log.slice(0, 3);
  const recentBlock = recent.length
    ? h('ul', { class: 'events' },
        ...recent.map((entry) =>
          h('li', {},
            h('i', { class: `dot ${entry.outcome}`, 'aria-hidden': 'true' }),
            h('div', {},
              h('strong', {}, tr.t(kindKey(entry.kind))),
              h('span', {}, `${tr.time(entry.at)} · ${entry.host || '—'} · ${tr.t(`outcome_${entry.outcome}`)}`),
            ),
          ),
        ),
      )
    : h('div', { class: 'events-empty' }, icon('check-circle', 20), h('span', {}, tr.t('popup_none')));

  mount(
    h('div', { class: 'popup' },
      h('div', { class: 'topbar' },
        h('div', { class: 'brand' }, h('img', { src: '../icons/on-32.png', alt: '', width: 26, height: 26 }), h('span', {}, 'ScamFuse')),
        languageSelect(tr, s.language, (language) => {
          void send({ type: 'saveSettings', patch: { language } }).then(() => location.reload());
        }),
      ),
      status,
      siteBlock,
      actions.childElementCount ? h('div', { style: 'margin-top: 10px' }, actions) : null,
      h('div', { class: 'popup-section-title' }, tr.t('popup_recent')),
      recentBlock,
      h('div', { class: 'popup-links' },
        h('a', { href: 'options.html', target: '_blank' }, ...withIcon('sliders', tr.t('popup_settings'), 18)),
        h('a', { href: DEMO_URL, target: '_blank', rel: 'noopener' }, ...withIcon('play', tr.t('popup_demo'), 18)),
      ),
      madeBy(),
    ),
  );
}

void start();
