// Define types for the grouped permissions feature
export interface SpendingAuthorization {
  amount: number;
  description: string;
}

export interface ProtocolPermission {
  protocolID: [number, string]; // [securityLevel, protocolID]
  counterparty?: string;
  description: string;
}

export interface BasketAccess {
  basket: string;
  description: string;
}

export interface CertificateAccess {
  verifierPublicKey: string;
  type: string;
  fields: Record<string, any>;
  description: string;
}

export interface GroupedPermissions {
  spendingAuthorization?: SpendingAuthorization;
  protocolPermissions?: ProtocolPermission[];
  basketAccess?: BasketAccess[];
  certificateAccess?: CertificateAccess[];
}

export interface CounterpartyPermissions {
  description?: string;
  protocols: Array<{
    protocolID: [number, string];
    description: string;
  }>;
}

export interface CounterpartyPermissionRequest {
  requestID: string;
  originator: string;
  counterparty: string;
  counterpartyLabel?: string;
  permissions: CounterpartyPermissions;
}

export interface GroupPermissionRequest {
  requestID: string;
  originator: string;
  permissions: GroupedPermissions;
}
