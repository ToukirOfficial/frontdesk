import { useSyncExternalStore } from 'react';

const noSubscribe = () => () => {};

/** False on the server and during hydration, true once React has hydrated (no extra render, no effect). */
export const useHydrated = (): boolean => useSyncExternalStore(noSubscribe, () => true, () => false);
