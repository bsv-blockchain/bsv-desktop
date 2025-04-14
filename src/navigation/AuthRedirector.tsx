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
            managers?.walletManager?.authenticated && snapshotLoaded
        ) {
            history.push('/dashboard/apps')
        }
        setPageLoaded(true)
    }, [managers?.walletManager?.authenticated, snapshotLoaded, history])

    return null
}