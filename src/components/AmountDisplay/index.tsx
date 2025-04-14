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
  const settingsCurrency = settings?.currency || ''

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
  }, [children, showPlus, abbreviate, satsFormat, settingsCurrency, settings]) 

  // When satoshis or the exchange rate context changes, update the formatted fiat amount
  useEffect(() => {
    if (!isNaN(satoshis) && satoshisPerUSD) {
      const newFormattedFiat = formatSatoshisAsFiat(satoshis, satoshisPerUSD, fiatFormat, settingsCurrency, eurPerUSD, gbpPerUSD, showFiatAsInteger)
      setFormattedFiatAmount(newFormattedFiat || '...') 
    } else {
      setFormattedFiatAmount('...')
    }
  }, [satoshis, satoshisPerUSD, fiatFormat, settingsCurrency, settings]) 

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
