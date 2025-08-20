/* eslint-disable react/prop-types */
import { ReactNode, useState, useEffect, useContext } from 'react'
import { Tooltip, Typography, Button } from '@mui/material'
import { formatSatoshis, formatSatoshisAsFiat, satoshisOptions } from './amountFormatHelpers'
import { ExchangeRateContext } from './ExchangeRateContextProvider'
import { useTheme } from '@emotion/react'
import { WalletContext } from '../../WalletContext'

type Props = {
  abbreviate?: boolean,
  showPlus?: boolean,
  description?: string,
  children: ReactNode,
  showFiatAsInteger?: boolean
}

/**
 * AmountDisplay component shows an amount in either satoshis or fiat currency.
 * The component allows the user to toggle between viewing amounts in satoshis or fiat,
 * and cycle through different formatting options.
 * 
 * @param {object} props - The props that are passed to this component
 * @param {boolean} props.abbreviate - Flag indicating if the displayed amount should be abbreviated
 * @param {boolean} props.showPlus - Flag indicating whether to show a plus sign before the amount
 * @param {number|string} props.children - The amount (in satoshis) to display, passed as the child of this component
 *
 * Note: The component depends on the ExchangeRateContext for several pieces of data related to
 * currency preference, exchange rates, and formatting options.
 */
const AmountDisplay: React.FC<Props> = ({ abbreviate, showPlus, description, children, showFiatAsInteger }) => {
  // State variables for the amount in satoshis and the corresponding formatted strings
  const [satoshis, setSatoshis] = useState(NaN)
  const [formattedSatoshis, setFormattedSatoshis] = useState('...')
  const [formattedFiatAmount, setFormattedFiatAmount] = useState('...')
  const theme: any = useTheme()

  // Get current settings directly from context
  const { settings } = useContext(WalletContext)
  const settingsCurrency: string = (settings?.currency || '').toString().toUpperCase()

  // Retrieve necessary values and functions from the ExchangeRateContext
  const ctx = useContext<any>(ExchangeRateContext)
  const {
    // Exchange rate context...
    satoshisPerUSD, eurPerUSD, gbpPerUSD,
    // Shared display format context...
    isFiatPreferred, fiatFormatIndex, satsFormatIndex,
    // display format update methods...
    toggleIsFiatPreferred, cycleFiatFormat, cycleSatsFormat
  } = ctx

  const opts = satoshisOptions
  const fiatFormat = opts.fiatFormats[fiatFormatIndex % opts.fiatFormats.length]
  const satsFormat = opts.satsFormats[satsFormatIndex % opts.satsFormats.length]

  const [color, setColor] = useState('textPrimary')

  // --- helper: compute numeric fiat value for USD/EUR/GBP
  const computeFiatNumeric = (sats: number, code: 'USD' | 'EUR' | 'GBP'): number | null => {
    if (!satoshisPerUSD) return null
    const usd = sats / satoshisPerUSD // USD = sats / (sats per USD)
    if (code === 'USD') return usd
    if (code === 'EUR') return eurPerUSD ? usd * eurPerUSD : null
    if (code === 'GBP') return gbpPerUSD ? usd * gbpPerUSD : null
    return null
  }

  // --- helper: smart-format small fiat numbers with 3 significant digits
  const formatSmallFiat = (value: number, code: 'USD' | 'EUR' | 'GBP'): string => {
    // Use currency style but cap to 3 significant digits; no grouping to keep it compact
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      minimumSignificantDigits: 3,
      maximumSignificantDigits: 3,
      useGrouping: false
    }).format(value)
  }

  // Update the satoshis and formattedSatoshis whenever the relevant props change
  useEffect(() => {
    if (Number.isInteger(Number(children))) {
      const newSatoshis = Number(children)
      setSatoshis(newSatoshis)
      // Figure out the correctly formatted amount, prefix, and color
      const satoshisToDisplay = formatSatoshis(newSatoshis, showPlus, abbreviate, satsFormat, settingsCurrency)
      if (description === 'Return to your Metanet Balance') {
        setFormattedSatoshis(`+${satoshisToDisplay}`)
        setColor('green')
      } else if (description === 'Spend from your Metanet Balance') {
        setFormattedSatoshis(`-${satoshisToDisplay}`)
        setColor(theme.palette.secondary.main)
      } else if (satoshisToDisplay.startsWith('+')) { 
        setFormattedSatoshis(satoshisToDisplay)
        setColor('green')
      } else if (satoshisToDisplay.startsWith('-')) { 
        setFormattedSatoshis(satoshisToDisplay)
        setColor(theme.palette.secondary.main)
      } else {
        setFormattedSatoshis(satoshisToDisplay)
        setColor('textPrimary')
      }
    } else {
      setSatoshis(NaN)
      setFormattedSatoshis('...')
    }
  }, [children, showPlus, abbreviate, satsFormat, settingsCurrency, settings, theme]) 

  // When satoshis or the exchange rate context changes, update the formatted fiat amount
  useEffect(() => {
    if (!isNaN(satoshis) && satoshisPerUSD) {
      // Keep your existing formatted output first
      const newFormattedFiat = formatSatoshisAsFiat(
        satoshis, satoshisPerUSD, fiatFormat, settingsCurrency, eurPerUSD, gbpPerUSD, showFiatAsInteger
      ) || '...'

      // Determine which currency code is in play for numeric calculation
      const code: 'USD' | 'EUR' | 'GBP' =
        (settingsCurrency === 'EUR' ? 'EUR'
        : settingsCurrency === 'GBP' ? 'GBP'
        : 'USD') // default USD when settingsCurrency is empty or USD/other

      const fiatNumeric = computeFiatNumeric(satoshis, code)

      if (fiatNumeric !== null && Math.abs(fiatNumeric) > 0 && Math.abs(fiatNumeric) < 1) {
        // For tiny values, show 3 significant digits after the leading zeros
        setFormattedFiatAmount(formatSmallFiat(fiatNumeric, code))
      } else {
        setFormattedFiatAmount(newFormattedFiat)
      }
    } else {
      setFormattedFiatAmount('...')
    }
  }, [satoshis, satoshisPerUSD, fiatFormat, settingsCurrency, eurPerUSD, gbpPerUSD, showFiatAsInteger]) 

  // Create handlers for clicks with proper accessibility
  const handleFiatClick = () => {
    cycleFiatFormat();
  };

  const handleSatsClick = () => {
    cycleSatsFormat();
  };

  const handleTogglePreference = () => {
    toggleIsFiatPreferred();
  };

  // Accessibility improvements - make interactive elements proper buttons with aria attributes
  const renderAccessibleAmount = (content, onClick) => (
    <Button 
      onClick={onClick}
      variant="text" 
      size="small"
      sx={{ 
        p: 0, 
        minWidth: 'auto', 
        color: 'inherit',
        textTransform: 'none',
        fontSize: 'inherit',
        fontWeight: 'inherit',
        lineHeight: 'inherit',
        letterSpacing: 'inherit'
      }}
    >
      {content}
    </Button>
  );

  // Updated component return with direct event handling
  if (settingsCurrency) {
    return ['USD', 'EUR', 'GBP'].indexOf(settingsCurrency) > -1
      ? (
        <Tooltip disableInteractive title={<Typography color='inherit'>{formattedSatoshis}</Typography>} arrow>
          <span style={{ color }}>{formattedFiatAmount}</span>
        </Tooltip>
      )
      : (
        <Tooltip disableInteractive title={<Typography color='inherit'>{formattedFiatAmount}</Typography>} arrow>
          <span style={{ color }}>{formattedSatoshis}</span>
        </Tooltip>
      )
  } else {
    return isFiatPreferred
      ? (
        <Tooltip title={<Typography onClick={handleTogglePreference} color='inherit'>{formattedSatoshis}</Typography>} arrow>
          {renderAccessibleAmount(formattedFiatAmount, handleFiatClick)}
        </Tooltip>
      )
      : (
        <Tooltip title={<Typography onClick={handleTogglePreference} color='inherit'>{formattedFiatAmount}</Typography>} arrow>
          {renderAccessibleAmount(formattedSatoshis, handleSatsClick)}
        </Tooltip>
      )
  }
}

export default AmountDisplay
