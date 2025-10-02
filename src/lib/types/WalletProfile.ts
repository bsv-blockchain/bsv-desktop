import {PubKeyHex } from '@bsv/sdk'

export type WalletProfile = {
  id: number[]
  name: string
  createdAt: number | null
  active: boolean,
  identityKey: PubKeyHex
}