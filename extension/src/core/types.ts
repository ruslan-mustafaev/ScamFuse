// Shared types for the extension. Pure TypeScript: no runtime code here.

export type Profile = 'elder' | 'child' | 'self';
export type Mode = 'advice' | 'strict';
export type Channel = 'whatsapp' | 'telegram' | 'email';
export type DetectorId = 'remoteAccess' | 'clipboard' | 'fakeAlert' | 'programDownload';

export type EventKind =
  | 'remote-site'
  | 'remote-download'
  | 'clipboard'
  | 'fake-alert'
  | 'program-download';

export type Level = 'high' | 'medium';
export type Outcome = 'pending' | 'allowed' | 'blocked';
export type DecidedBy = 'user' | 'pin' | 'timer';

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
  safeText: string;
}

export type ContentMessage =
  | { type: 'pageStatus' }
  | { type: 'signal'; kind: 'clipboard' | 'fake-alert'; reasons: string[] };

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
}

export type PageMessage =
  | { type: 'getEvent'; id: string }
  | { type: 'decide'; id: string; decision: 'allow' | 'block'; pin?: string }
  | { type: 'markAsked'; id: string }
  | { type: 'verifyPin'; pin: string }
  | { type: 'getState' }
  | { type: 'completeSetup'; setup: SetupInput }
  | { type: 'saveSettings'; patch: Partial<Omit<Settings, 'pin' | 'version'>>; pin?: string }
  | { type: 'setPin'; newPin: string | null; pin?: string }
  | { type: 'clearLog'; pin?: string };

export interface DecideResult {
  ok: boolean;
  error?: 'missing' | 'decided' | 'locked' | 'wrong-pin' | 'pin-locked' | 'invalid';
  attemptsLeft?: number;
  lockedUntil?: number;
}
