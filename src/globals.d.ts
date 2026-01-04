// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SBObject = Record<string, any>;

declare global {
    interface Window { SB: SBObject }
}
