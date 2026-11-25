export function isPollDate(value: unknown): value is string
export function isSettablePollDate(value: unknown, now?: number): value is string
export function closesText(due: string | undefined): string | null
export function isPastDue(due: string | undefined, today: string): boolean
export function waitingOn(pollId: string, memberIds: Iterable<string>, voteKeys: Iterable<string>): string[]
export function pollWaiting(pollId: string, rosterIds: Iterable<string>, memberIds: Iterable<string>, voteKeys: Iterable<string>): string[] | null
export function reminderText(input: { question: string; due?: string; names: string[]; link?: string }): string
