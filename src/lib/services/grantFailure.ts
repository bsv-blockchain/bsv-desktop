import { toast } from 'react-toastify'
import { getWalletService } from '../hooks/useWalletService'
import { PermissionQueueManager } from './PermissionQueueManager'

/**
 * Tells the user when a permission they granted could not be saved on chain,
 * instead of failing silently. See PermissionQueueManager.noteGrantFailure.
 */
export function reportGrantFailure(requestID: string, error: unknown): void {
  console.error('[permissions] grant could not be saved:', error)
  const message = getWalletService().permissionQueue.noteGrantFailure(requestID, error)
  if (PermissionQueueManager.isInsufficientFunds(error)) toast.warning(message)
  else toast.error(message)
}

export function reportGroupGrantFailure(request: { originator: string; counterparty?: string }, granted: unknown, error: unknown): void {
  console.error('[permissions] grouped grant could not be saved:', error)
  const message = getWalletService().permissionQueue.noteGroupGrantFailure(request, granted, error)
  if (PermissionQueueManager.isInsufficientFunds(error)) toast.warning(message)
  else toast.error(message)
}
