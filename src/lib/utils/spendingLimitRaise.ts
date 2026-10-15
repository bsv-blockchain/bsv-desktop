import type { SpendingRequest } from '../services/PermissionQueueManager'

/** The smallest monthly limit that lets this payment through: spent so far plus this payment. */
export function minimumRaisedLimit(request: Pick<SpendingRequest, 'totalPastSpending' | 'authorizationAmount'>): number {
  return Math.max(0, request.totalPastSpending) + request.authorizationAmount
}

/**
 * Suggested new monthly limit when a payment goes over an app's limit: double
 * the old limit, or enough for this payment if that is more.
 */
export function suggestRaisedLimit(request: Pick<SpendingRequest, 'totalPastSpending' | 'authorizationAmount' | 'amountPreviouslyAuthorized'>): number {
  return Math.max(minimumRaisedLimit(request), request.amountPreviouslyAuthorized * 2)
}
