export type PermissionAction = "list" | "read" | "create" | "update" | "delete";

export type ExternalIdentity = {
  subject: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
};

export type RuntimeUser = {
  id: string;
  authSubject: string;
  email: string;
  displayName: string;
  roleKey: string;
};

export type ProductionAuthAdapter = {
  currentSubject(): Promise<string | null>;
  provisioningIdentity(subject: string): Promise<ExternalIdentity | null>;
  signInPath: string;
};
