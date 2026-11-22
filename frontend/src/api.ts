// Thin typed wrapper over the generated Go bindings and Wails events.
import { Events } from '@wailsio/runtime';
import * as Svc from '../bindings/github.com/shu-go/mdview/app';
import type { InitState, OpenResult, RecentList, RenderResult, Settings, TabState } from '../bindings/github.com/shu-go/mdview/models';
import type { Snapshot, FileItem } from '../bindings/github.com/shu-go/mdview/internal/workspace/models';
import type { Heading } from '../bindings/github.com/shu-go/mdview/internal/markdown/models';

export type { InitState, OpenResult, RecentList, RenderResult, Settings, TabState, Snapshot, FileItem, Heading };

export const api = Svc;

export const Ev = {
  docChanged: 'doc:changed',
  filesChanged: 'files:changed',
  settingsChanged: 'settings:changed',
  customCSS: 'customcss:changed',
  recentChanged: 'recent:changed',
  openPaths: 'open:paths',
  tabReceive: 'tab:receive',
} as const;

export function on<T>(name: string, cb: (data: T) => void): () => void {
  return Events.On(name, (ev: { data: unknown }) => cb(ev.data as T));
}

export interface OpenPathsEvent {
  target: number;
  paths: string[];
}

export interface TabReceiveEvent {
  target: number;
  tab: TabState;
  x: number;
  y: number;
}
