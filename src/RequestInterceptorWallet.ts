import {
  WalletInterface,
  OriginatorDomainNameStringUnder250Bytes,
  GetPublicKeyArgs,
  GetPublicKeyResult,
  RevealCounterpartyKeyLinkageArgs,
  RevealCounterpartyKeyLinkageResult,
  RevealSpecificKeyLinkageArgs,
  RevealSpecificKeyLinkageResult,
  WalletEncryptArgs,
  WalletEncryptResult,
  WalletDecryptArgs,
  WalletDecryptResult,
  CreateHmacArgs,
  CreateHmacResult,
  VerifyHmacArgs,
  VerifyHmacResult,
  CreateSignatureArgs,
  CreateSignatureResult,
  VerifySignatureArgs,
  VerifySignatureResult,
  CreateActionArgs,
  CreateActionResult,
  SignActionArgs,
  SignActionResult,
  AbortActionArgs,
  AbortActionResult,
  ListActionsArgs,
  ListActionsResult,
  InternalizeActionArgs,
  InternalizeActionResult,
  ListOutputsArgs,
  ListOutputsResult,
  RelinquishOutputArgs,
  RelinquishOutputResult,
  AcquireCertificateArgs,
  WalletCertificate,
  ListCertificatesArgs,
  ListCertificatesResult,
  ProveCertificateArgs,
  ProveCertificateResult,
  RelinquishCertificateArgs,
  RelinquishCertificateResult,
  DiscoverByIdentityKeyArgs,
  DiscoverByAttributesArgs,
  DiscoverCertificatesResult,
  AuthenticatedResult,
  GetHeightResult,
  GetHeaderArgs,
  GetHeaderResult,
  GetNetworkResult,
  GetVersionResult
} from '@bsv/sdk';

/**
 * RequestInterceptorWallet wraps another WalletInterface and records each call's
 * `originator` via the supplied `updateRecentApp` callback.  The callback is
 * awaited but **errors are swallowed** so telemetry never blocks wallet
 * functionality.
 */
export class RequestInterceptorWallet implements WalletInterface {
  constructor(
    private readonly underlying: WalletInterface,
    private readonly profileId: string,
    private readonly updateRecentApp: (
      profileId: string,
      origin: OriginatorDomainNameStringUnder250Bytes
    ) => Promise<void> | void
  ) { }

  /**
   * Call the tracking hook, swallowing any error so the wallet op proceeds.
   */
  private record(
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<void> {
    if (!originator) return;
    try {
      this.updateRecentApp(this.profileId, originator);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[RequestInterceptorWallet] updateRecentApp failed:', err);
    }
  }

  /**
   * Small helper to avoid boilerplate in every method.
   */
  private passthrough<TArgs, TResult>(
    fn: (args: TArgs, origin?: OriginatorDomainNameStringUnder250Bytes) => Promise<TResult>,
    args: TArgs,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<TResult> {
    this.record(originator);
    // Preserve `this` binding for underlying wallet methods.
    return fn.call(this.underlying, args, originator);
  }

  // ------------------------------------------------------------------
  // WalletInterface implementation (auto‑generated style) -------------
  // ------------------------------------------------------------------

  async getPublicKey(
    args: GetPublicKeyArgs,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<GetPublicKeyResult> {
    return this.passthrough(this.underlying.getPublicKey, args, originator);
  }

  async revealCounterpartyKeyLinkage(
    args: RevealCounterpartyKeyLinkageArgs,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<RevealCounterpartyKeyLinkageResult> {
    return this.passthrough(
      this.underlying.revealCounterpartyKeyLinkage,
      args,
      originator
    );
  }

  async revealSpecificKeyLinkage(
    args: RevealSpecificKeyLinkageArgs,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<RevealSpecificKeyLinkageResult> {
    return this.passthrough(
      this.underlying.revealSpecificKeyLinkage,
      args,
      originator
    );
  }

  async encrypt(
    args: WalletEncryptArgs,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<WalletEncryptResult> {
    return this.passthrough(this.underlying.encrypt, args, originator);
  }

  async decrypt(
    args: WalletDecryptArgs,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<WalletDecryptResult> {
    return this.passthrough(this.underlying.decrypt, args, originator);
  }

  async createHmac(
    args: CreateHmacArgs,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<CreateHmacResult> {
    return this.passthrough(this.underlying.createHmac, args, originator);
  }

  async verifyHmac(
    args: VerifyHmacArgs,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<VerifyHmacResult> {
    return this.passthrough(this.underlying.verifyHmac, args, originator);
  }

  async createSignature(
    args: CreateSignatureArgs,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<CreateSignatureResult> {
    return this.passthrough(this.underlying.createSignature, args, originator);
  }

  async verifySignature(
    args: VerifySignatureArgs,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<VerifySignatureResult> {
    return this.passthrough(this.underlying.verifySignature, args, originator);
  }

  async createAction(
    args: CreateActionArgs,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<CreateActionResult> {
    return this.passthrough(this.underlying.createAction, args, originator);
  }

  async signAction(
    args: SignActionArgs,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<SignActionResult> {
    return this.passthrough(this.underlying.signAction, args, originator);
  }

  async abortAction(
    args: AbortActionArgs,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<AbortActionResult> {
    return this.passthrough(this.underlying.abortAction, args, originator);
  }

  async listActions(
    args: ListActionsArgs,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<ListActionsResult> {
    return this.passthrough(this.underlying.listActions, args, originator);
  }

  async internalizeAction(
    args: InternalizeActionArgs,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<InternalizeActionResult> {
    return this.passthrough(this.underlying.internalizeAction, args, originator);
  }

  async listOutputs(
    args: ListOutputsArgs,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<ListOutputsResult> {
    return this.passthrough(this.underlying.listOutputs, args, originator);
  }

  async relinquishOutput(
    args: RelinquishOutputArgs,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<RelinquishOutputResult> {
    return this.passthrough(this.underlying.relinquishOutput, args, originator);
  }

  async acquireCertificate(
    args: AcquireCertificateArgs,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<WalletCertificate> {
    return this.passthrough(this.underlying.acquireCertificate, args, originator);
  }

  async listCertificates(
    args: ListCertificatesArgs,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<ListCertificatesResult> {
    return this.passthrough(this.underlying.listCertificates, args, originator);
  }

  async proveCertificate(
    args: ProveCertificateArgs,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<ProveCertificateResult> {
    return this.passthrough(this.underlying.proveCertificate, args, originator);
  }

  async relinquishCertificate(
    args: RelinquishCertificateArgs,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<RelinquishCertificateResult> {
    return this.passthrough(this.underlying.relinquishCertificate, args, originator);
  }

  async discoverByIdentityKey(
    args: DiscoverByIdentityKeyArgs,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<DiscoverCertificatesResult> {
    return this.passthrough(this.underlying.discoverByIdentityKey, args, originator);
  }

  async discoverByAttributes(
    args: DiscoverByAttributesArgs,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<DiscoverCertificatesResult> {
    return this.passthrough(this.underlying.discoverByAttributes, args, originator);
  }

  async isAuthenticated(
    args: object,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<AuthenticatedResult> {
    return this.passthrough(this.underlying.isAuthenticated, args, originator);
  }

  async waitForAuthentication(
    args: object,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<AuthenticatedResult> {
    return this.passthrough(this.underlying.waitForAuthentication, args, originator);
  }

  async getHeight(
    args: object,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<GetHeightResult> {
    return this.passthrough(this.underlying.getHeight, args, originator);
  }

  async getHeaderForHeight(
    args: GetHeaderArgs,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<GetHeaderResult> {
    return this.passthrough(this.underlying.getHeaderForHeight, args, originator);
  }

  async getNetwork(
    args: object,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<GetNetworkResult> {
    return this.passthrough(this.underlying.getNetwork, args, originator);
  }

  async getVersion(
    args: object,
    originator?: OriginatorDomainNameStringUnder250Bytes
  ): Promise<GetVersionResult> {
    return this.passthrough(this.underlying.getVersion, args, originator);
  }
}
