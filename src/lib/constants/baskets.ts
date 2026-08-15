/**
 * Output basket names.
 *
 * Baskets are bare strings in wallet-toolbox's `output_baskets` table and were
 * scattered as string literals across the codebase. New code should reference
 * these constants.
 */

/** wallet-toolbox's default basket for ordinary BSV outputs. */
export const DEFAULT_BASKET = 'default';

/**
 * Basket holding wallet-owned classic-STAS token UTXOs. Created lazily the
 * first time a STAS output is internalized.
 */
export const STAS_BASKET = 'stas-tokens';

/**
 * Basket holding wallet-owned DSTAS token UTXOs. Separated from STAS so the
 * wallet-toolbox spend lifecycle (and any per-basket UTXO targeting) stays
 * isolated per protocol. Created lazily by `internalizeAction`.
 */
export const DSTAS_BASKET = 'dstas-tokens';

/**
 * Basket holding wallet-owned BSV-21 token UTXOs. Defined now so the
 * token-protocol adapter for BSV-21 can route its registrations into a
 * dedicated basket once that protocol lands.
 */
export const BSV21_BASKET = 'bsv-21-tokens';

/** All token-protocol baskets, in protocol-id order. */
export const TOKEN_BASKETS = [STAS_BASKET, DSTAS_BASKET, BSV21_BASKET] as const;
