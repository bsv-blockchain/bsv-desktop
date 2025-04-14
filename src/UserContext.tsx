import React, { createContext, Dispatch, SetStateAction, useEffect, useMemo, useState } from 'react'
import packageJson from '../package.json'
import { invoke } from '@tauri-apps/api/core'

// 1. Our Tauri commands exposed as async calls:
async function isFocused(): Promise<boolean> {
  return invoke<boolean>('is_focused')
}

async function onFocusRequested(): Promise<void> {
  return invoke<void>('request_focus')
}

async function onFocusRelinquished(): Promise<void> {
  return invoke<void>('relinquish_focus')
}

// -----
// UserContextProps Component Props
// -----
interface UserContextProps {
    appVersion?: string;
    appName?: string;
    children?: React.ReactNode;
}

export interface UserContextValue {
    isFocused: () => Promise<boolean>;
    onFocusRequested: () => Promise<void>;
    onFocusRelinquished: () => Promise<void>;
    appVersion: string;
    appName: string;
    basketAccessModalOpen: boolean;
    setBasketAccessModalOpen: Dispatch<SetStateAction<boolean>>;
    certificateAccessModalOpen: boolean;
    setCertificateAccessModalOpen: Dispatch<SetStateAction<boolean>>;
    protocolAccessModalOpen: boolean;
    setProtocolAccessModalOpen: Dispatch<SetStateAction<boolean>>;
    spendingAuthorizationModalOpen: boolean;
    setSpendingAuthorizationModalOpen: Dispatch<SetStateAction<boolean>>;
    pageLoaded: boolean;
    setPageLoaded: Dispatch<SetStateAction<boolean>>;
}

export const UserContext = createContext<UserContextValue>({} as UserContextValue);

/**
 * The UserInterface component supports both new and returning users.
 * For returning users, if a snapshot exists it is loaded and once authenticated
 * the AuthRedirector (inside Router) sends them to the dashboard.
 * New users see the WalletConfig UI.
 */
export const UserContextProvider: React.FC<UserContextProps> = ({
    appVersion = packageJson.version,
    appName = 'Metanet Desktop',
    children
}) => {
    const [basketAccessModalOpen, setBasketAccessModalOpen] = useState(false)
    const [certificateAccessModalOpen, setCertificateAccessModalOpen] = useState(false)
    const [protocolAccessModalOpen, setProtocolAccessModalOpen] = useState(false)
    const [spendingAuthorizationModalOpen, setSpendingAuthorizationModalOpen] = useState(false)
    const [pageLoaded, setPageLoaded] = useState(false)

    const userContext = useMemo(() => ({
        isFocused,
        onFocusRequested,
        onFocusRelinquished,
        appVersion,
        appName,
        basketAccessModalOpen,
        setBasketAccessModalOpen,
        certificateAccessModalOpen,
        setCertificateAccessModalOpen,
        protocolAccessModalOpen,
        setProtocolAccessModalOpen,
        spendingAuthorizationModalOpen,
        setSpendingAuthorizationModalOpen,
        pageLoaded,
        setPageLoaded
    }), [appVersion, appName, basketAccessModalOpen, certificateAccessModalOpen, protocolAccessModalOpen, spendingAuthorizationModalOpen, pageLoaded]);

    return (
        <UserContext.Provider value={userContext}>
            {children}
        </UserContext.Provider>
    )
}
