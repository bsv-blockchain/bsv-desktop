/**
 * IdentitySearchField — a "search for a recipient" input backed by
 * `@bsv/identity-react`'s useIdentitySearch, extracted from the Payments (PeerPay)
 * tab so the token send modal (and anywhere else) can offer the same
 * name/handle → identity-key lookup instead of forcing users to paste a raw key.
 *
 * Calls `onSelect(identityKey)` when an identity is chosen (or '' when cleared).
 */
import React from 'react'
import {
  Autocomplete, TextField, Box, Avatar, Chip, Typography, CircularProgress,
} from '@mui/material'
import type { WalletInterface } from '@bsv/sdk'
import { useIdentitySearch } from '@bsv/identity-react'

function getInitials(name?: string, identityKey = ''): string {
  if (!name || name.trim() === '') return identityKey.slice(0, 2).toUpperCase()
  const words = name.trim().split(/\s+/)
  return (words.length >= 2
    ? words[0][0] + words[words.length - 1][0]
    : name.slice(0, 2)
  ).toUpperCase()
}

export interface IdentitySearchFieldProps {
  wallet: WalletInterface
  originator?: string
  /** Fired with the selected identity key (or '' when the selection is cleared). */
  onSelect: (identityKey: string) => void
  label?: string
  placeholder?: string
}

export default function IdentitySearchField({
  wallet, originator, onSelect, label, placeholder,
}: IdentitySearchFieldProps) {
  const identitySearch = useIdentitySearch({
    originator,
    wallet,
    onIdentitySelected: (identity: any) => {
      if (identity) onSelect(identity.identityKey)
    },
  } as any)

  return (
    <Autocomplete
      options={identitySearch.identities}
      loading={identitySearch.isLoading}
      inputValue={identitySearch.inputValue}
      value={identitySearch.selectedIdentity}
      onInputChange={identitySearch.handleInputChange}
      onChange={(event, value: any) => {
        identitySearch.handleSelect(event, value)
        onSelect(value && typeof value !== 'string' ? value.identityKey : '')
      }}
      filterOptions={(options: any[]) =>
        options.filter((id: any, index, array) =>
          array.findIndex((i: any) => i.identityKey === id.identityKey) === index)
      }
      getOptionLabel={(option: any) =>
        typeof option === 'string' ? option : (option.name || option.identityKey.slice(0, 16))
      }
      isOptionEqualToValue={(option: any, value: any) =>
        typeof option === 'string' || typeof value === 'string'
          ? false
          : option.identityKey === value.identityKey
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label ?? 'Search for a recipient'}
          placeholder={placeholder ?? 'Name, handle, or identity'}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {identitySearch.isLoading ? <CircularProgress size={20} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
      renderOption={(props, option: any) => {
        if (typeof option === 'string') return null
        const { key, ...otherProps } = props as any
        return (
          <li key={key + option.identityKey} {...otherProps}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' }}>
              {option.avatarURL ? (
                <Avatar src={option.avatarURL} alt={option.name} sx={{ width: 40, height: 40 }} />
              ) : (
                <Avatar sx={{ width: 40, height: 40, bgcolor: 'primary.main', fontSize: '0.875rem', fontWeight: 600 }}>
                  {getInitials(option.name, option.identityKey)}
                </Avatar>
              )}
              <Box sx={{ flexGrow: 1 }}>
                <Typography variant="body1" sx={{ fontWeight: 500 }}>{option.name || 'Unknown'}</Typography>
                <Typography variant="caption" color="textSecondary" sx={{ fontFamily: 'monospace' }}>
                  {option.identityKey.slice(0, 20)}...
                </Typography>
              </Box>
              {option.badgeLabel && <Chip size="small" label={option.badgeLabel} sx={{ ml: 1 }} />}
            </Box>
          </li>
        )
      }}
      noOptionsText={identitySearch.inputValue ? 'No identities found' : 'Start typing to search'}
      fullWidth
    />
  )
}
