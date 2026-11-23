// Shared types for the extension. Pure TypeScript: no runtime code here.

export type Profile = 'elder' | 'child' | 'self';
export type Mode = 'advice' | 'strict';
export type Channel = 'whatsapp' | 'telegram' | 'email';
export type DetectorId =
  | 'remoteAccess'
  | 'clipboard'
  | 'fakeAlert'
  | 'programDownload'
  | 'screenShare'
  | 'cardEntry';

export type EventKind =
  | 'remote-site'
  | 'remote-download'
  | 'clipboard'
  | 'fake-alert'
  | 'program-download'
  | 'screen-share'
  | 'card-entry';

export type Level = 'high' | 'medium';
export type Outcome = 'pending' | 'allowed' | 'blocked';
export type DecidedBy = 'user' | 'pin' | 'timer' | 'guardian' | 'code';

export interface PinRecord {
  salt: string;
  hash: string;
  iterations: number;
}

export interface Settings {
  version: 1;
  setupDone: boolean;
  enabled: boolean;
  profile: Profile;
  mode: Mode;
  /** Strict mode: minutes an action stays locked without the PIN. */
  lockMinutes: number;
  /** How the protected person refers to the trusted person, as typed: "Dad", "папу". */
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string;
  channel: Channel;
  /** Manual language choice; null means automatic. */
  language: string | null;
  detectors: Record<DetectorId, boolean>;
  /** Hostnames the trusted person allowed permanently. */
  trustedSites: string[];
  pin: PinRecord | null;
  /** Alert relay address; empty means no automatic alerts. */
  relayUrl: string;
  /** How alerts name this computer for the trusted person: "Mom, laptop". */
  installName: string;
  /** Read the pause screen aloud. */
  voice: boolean;
}

/** A stopped action waiting for a decision. Lives in session storage only. */
export interface PauseEvent {
  id: string;
  kind: EventKind;
  level: Level;
  host: string;
  /** Full address, kept on the device only, to return the tab after "Continue". */
  url: string;
  createdAt: number;
  tabId?: number;
  downloadId?: number;
  /** True when the pause screen was opened in its own tab (downloads). */
  ownTab?: boolean;
  outcome: Outcome;
  decidedBy?: DecidedBy;
  decidedAt?: number;
  asked?: boolean;
  reasons: string[];
  /** Alert sent through the relay to the trusted person's Telegram. */
  alertId?: string;
  alertState?: 'sending' | 'sent' | 'queued' | 'failed';
  /** SHA-256 of the one-time unlock code the trusted person can read out by phone. */
  codeHash?: string;
  codeTries?: number;
  reply?: string;
  replyBy?: string;
  decidedByName?: string;
}

/** What the local log keeps: no full addresses, no page content. */
export interface LogEntry {
  id: string;
  at: number;
  kind: EventKind;
  host: string;
  outcome: Outcome;
  decidedBy?: DecidedBy;
}

export interface Verdict {
  score: number;
  high: boolean;
  reasons: string[];
}

// Messages between the parts of the extension.

/** What the page scripts should watch on this tab: off when disabled or allowed. */
export interface PageStatus {
  clipboard: boolean;
  fakeAlert: boolean;
  screenShare: boolean;
  cardEntry: boolean;
  safeText: string;
}

export type ContentMessage =
  | { type: 'pageStatus' }
  | { type: 'signal'; kind: SignalKind; reasons: string[] };

export type SignalKind = 'clipboard' | 'fake-alert' | 'screen-share' | 'card-entry';

export interface PauseView {
  event: PauseEvent;
  profile: Profile;
  mode: Mode;
  lockMinutes: number;
  hasPin: boolean;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string;
  channel: Channel;
  language: string | null;
  pinLockedUntil: number;
  pinAttemptsLeft: number;
  /** Names of the people linked through Telegram; empty when there is no relay. */
  guardians: string[];
  voice: boolean;
}

export interface SetupInput {
  profile: Profile;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string;
  channel: Channel;
  language: string | null;
  /** New PIN chosen during setup, if any. */
  newPin?: string;
  /** Current PIN, needed when setup runs again on a PIN-protected install. */
  pin?: string;
}

export interface PublicState {
  settings: Omit<Settings, 'pin'> & { hasPin: boolean };
  todayCount: number;
  log: LogEntry[];
  version: string;
  relay: RelayInfo;
}

export interface RelayInfo {
  /** A relay address is set. */
  configured: boolean;
  /** People linked through Telegram. */
  guardians: string[];
  bot: string;
}

export interface PairingInfo {
  ok: boolean;
  code?: string;
  link?: string;
  bot?: string;
  expiresAt?: number;
  error?: string;
}

export interface PairingStatus {
  ok: boolean;
  status?: 'waiting' | 'paired' | 'expired';
  guardianName?: string;
}

export type PageMessage =
  | { type: 'getEvent'; id: string }
  | { type: 'decide'; id: string; decision: 'allow' | 'block'; pin?: string; code?: string }
  | { type: 'eventStatus'; id: string }
  | { type: 'askGuardian'; id: string }
  | { type: 'relayPair' }
  | { type: 'relayPairStatus'; code: string }
  | { type: 'relayTest' }
  | { type: 'relayUnlink'; pin?: string }
  | { type: 'relayRefresh' }
  | { type: 'markAsked'; id: string }
  | { type: 'verifyPin'; pin: string }
  | { type: 'getState' }
  | { type: 'completeSetup'; setup: SetupInput }
  | { type: 'saveSettings'; patch: Partial<Omit<Settings, 'pin' | 'version'>>; pin?: string }
  | { type: 'setPin'; newPin: string | null; pin?: string }
  | { type: 'clearLog'; pin?: string };

export interface DecideResult {
  ok: boolean;
  error?: 'missing' | 'decided' | 'locked' | 'wrong-pin' | 'pin-locked' | 'invalid' | 'wrong-code' | 'relay';
  attemptsLeft?: number;
  lockedUntil?: number;
}
