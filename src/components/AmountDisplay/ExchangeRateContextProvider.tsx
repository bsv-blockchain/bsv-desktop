import { ReactNode, createContext, useEffect, useState } from 'react'
import { Services } from '@bsv/wallet-toolbox-client'

const services = new Services('main')

const EXCHANGE_RATE_UPDATE_INTERVAL = 5 * 60 * 1000

const defaultState = {
  satoshisPerUSD: NaN,
  eurPerUSD: 0.93, // TODO: must tie to external service
  gbpPerUSD: 0.79, // TODO: must tie to external service
  whenUpdated: null,
  isFiatPreferred: false,
  fiatFormatIndex: 0,
  satsFormatIndex: 0
}

// Create the exchange rate context and provider to use in the amount component
export const ExchangeRateContext = createContext(defaultState)

export const ExchangeRateContextProvider: React.FC<{
  children: ReactNode
}> = ({ children }) => {
  const [state, setState] = useState(defaultState)

  // The function instances are created here and included in the state to ensure they have stable references
  const contextValue = {
    ...state,
    toggleIsFiatPreferred: () => {
      setState(oldState => ({ ...oldState, isFiatPreferred: !oldState.isFiatPreferred }))
    },
    cycleFiatFormat: () => {
      setState(oldState => ({ ...oldState, fiatFormatIndex: oldState.fiatFormatIndex + 1 }))
    },
    cycleSatsFormat: () => {
      setState(oldState => ({ ...oldState, satsFormatIndex: oldState.satsFormatIndex + 1 }))
    }
  }

  useEffect(() => {
    const tick = async () => {
      try {
        const usdPerBsv = await services.getBsvExchangeRate()
        const gbpPerUSD = await services.getFiatExchangeRate('GBP')
        const eurPerUSD = await services.getFiatExchangeRate('EUR')
        const satoshisPerUSD = 100000000 / usdPerBsv // satsPerBsv * bsvPerUSD => satsPerUSD
        setState((oldState: any) => ({ ...oldState, satoshisPerUSD, gbpPerUSD, eurPerUSD, whenUpdated: new Date() }))
      } catch (error) {
        console.error('Error fetching data: ', error)
        // You can check for error.response.status here if using a library like axios
        // and implement specific behavior for rate limiting errors (typically 429)
      }
    }

    tick() // Invoke the function immediately to perform the initial data fetch

    const timerID = setInterval(() => tick(), EXCHANGE_RATE_UPDATE_INTERVAL)

    // This is the cleanup function to clear the interval when the component unmounts
    return () => clearInterval(timerID)
  }, []) // Empty dependency array means this useEffect runs once when the component mounts

  return (
    <ExchangeRateContext.Provider value={contextValue}>
      {children}
    </ExchangeRateContext.Provider>
  )
}
