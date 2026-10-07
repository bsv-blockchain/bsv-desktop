import { useContext, useEffect } from "react"
import { useHistory } from "react-router-dom"
import { WalletContext } from "../WalletContext"
import { UserContext } from "../UserContext"

// -----
// AuthRedirector: Handles auto-login redirect when snapshot has loaded
// -----
export default function AuthRedirector() {
    const history = useHistory()
    const { managers, snapshotLoaded } = useContext(WalletContext)
    const { setPageLoaded } = useContext(UserContext)

    useEffect(() => {
        if (
            managers?.walletManager?.authenticated && managers?.permissionsManager && snapshotLoaded
        ) {
            if (!history.location.pathname.startsWith('/dashboard')) history.replace('/dashboard')
        }
        setPageLoaded(true)
    }, [managers?.walletManager?.authenticated, managers?.permissionsManager, snapshotLoaded, history])

    return null
}
