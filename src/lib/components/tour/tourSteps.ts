/** Tour content. Targets are `data-tour` attribute values. */
export const TOUR_TARGETS = ['balance', 'pay-get-paid', 'nav-payments', 'nav-activity', 'nav-apps', 'nav-settings', 'need-help'] as const
export type TourTarget = typeof TOUR_TARGETS[number]
export interface TourStep { id: string; route: string; target?: TourTarget; title: string; body: string }

export const TOUR_STEPS: TourStep[] = [
  { id: 'welcome', route: '/dashboard', title: 'Welcome to BSV Desktop',
    body: "This app is your wallet. You don't browse apps in here — keep using your normal web browser (Chrome, Safari, Firefox…). When a website wants to use your wallet, BSV Desktop pops up so you can approve or decline." },
  { id: 'balance', route: '/dashboard', target: 'balance', title: 'Your balance',
    body: 'This is the BSV you can spend. It updates as payments arrive and leave.' },
  { id: 'pay', route: '/dashboard', target: 'pay-get-paid', title: 'Pay and get paid',
    body: "Send BSV to someone's identity or address, or show your details to receive a payment." },
  { id: 'apps', route: '/dashboard', target: 'nav-apps', title: 'Apps',
    body: "Apps you've used appear here. Open one and it launches in your browser — your wallet stays here, ready to approve." },
  { id: 'approvals', route: '/dashboard', title: 'Approving requests',
    body: 'When an app asks to spend, sign, or read something, a window appears in BSV Desktop showing which app and what it wants. Approve only what you expect — you can always say no.' },
  { id: 'activity', route: '/dashboard/activity', target: 'nav-activity', title: 'Activity',
    body: 'Every payment and app transaction, newest first.' },
  { id: 'settings', route: '/dashboard', target: 'nav-settings', title: 'Settings',
    body: 'Back up your wallet, change your password, set spending limits for apps, and more.' },
  { id: 'help', route: '/dashboard', target: 'need-help', title: 'Need help?',
    body: 'Run Troubleshoot any time something seems wrong. It checks and fixes common problems automatically.' },
]
