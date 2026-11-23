// Classifies downloads: remote access programs and executable programs. Pure functions.

import remoteToolsRules from '../rules/remote-tools.json' with { type: 'json' };
import siteRules from '../rules/sites.json' with { type: 'json' };
import { hostMatches } from './domains.ts';
import type { EventKind } from './types.ts';

interface RemoteTool {
  name: string;
  domains: string[];
  files: string[];
}

export const REMOTE_TOOLS: readonly RemoteTool[] = remoteToolsRules.tools;
export const REMOTE_TOOL_DOMAINS: readonly string[] = REMOTE_TOOLS.flatMap((tool) => tool.domains);
export const OFFICIAL_DOWNLOAD_SITES: readonly string[] = siteRules.officialDownloadSites;

export const EXECUTABLE_EXTENSIONS: readonly string[] = [
  'exe', 'msi', 'msix', 'msixbundle', 'appx', 'appxbundle', 'appinstaller',
  'bat', 'cmd', 'ps1', 'scr', 'vbs', 'vbe', 'wsf', 'hta', 'cpl', 'lnk', 'reg',
  'jar', 'apk', 'dmg', 'pkg', 'command',
];

/** "C:\\Users\\me\\Downloads\\AnyDesk (1).exe" → "anydesk (1).exe" */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return (parts[parts.length - 1] ?? '').toLowerCase();
}

export function extensionOf(fileName: string): string {
  const name = baseName(fileName);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1) : '';
}

export function isExecutable(fileName: string): boolean {
  return EXECUTABLE_EXTENSIONS.includes(extensionOf(fileName));
}

export function isRemoteToolSite(host: string): boolean {
  return hostMatches(host, REMOTE_TOOL_DOMAINS);
}

/** Name of the remote access tool a download belongs to, or null. */
export function remoteToolOf(host: string, fileName: string): string | null {
  const name = baseName(fileName);
  const executable = isExecutable(name);
  for (const tool of REMOTE_TOOLS) {
    if (hostMatches(host, tool.domains)) return tool.name;
    if (executable && tool.files.some((prefix) => name.startsWith(prefix))) return tool.name;
  }
  return null;
}

export interface DownloadInput {
  /** Host the file comes from (for blob: and data: links, the host of the page). */
  host: string;
  fileName: string;
  remoteAccess: boolean;
  programDownload: boolean;
}

export interface DownloadVerdict {
  kind: EventKind;
  level: 'high' | 'medium';
  reasons: string[];
}

export function classifyDownload(input: DownloadInput): DownloadVerdict | null {
  if (input.remoteAccess) {
    const tool = remoteToolOf(input.host, input.fileName);
    if (tool) return { kind: 'remote-download', level: 'high', reasons: ['remote-tool'] };
  }
  if (
    input.programDownload &&
    isExecutable(input.fileName) &&
    !hostMatches(input.host, OFFICIAL_DOWNLOAD_SITES)
  ) {
    return { kind: 'program-download', level: 'medium', reasons: ['unofficial-program'] };
  }
  return null;
}
