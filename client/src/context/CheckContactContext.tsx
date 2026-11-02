import { createContext, useContext } from 'react';

/** Opens the "Check it's really <name>" flow for the open conversation. Presentation only. */
const CheckContactContext = createContext<() => void>(() => undefined);
export const CheckContactProvider = CheckContactContext.Provider;
export const useOpenCheck = (): (() => void) => useContext(CheckContactContext);
