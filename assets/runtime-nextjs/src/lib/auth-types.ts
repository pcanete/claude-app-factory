export type PermissionAction = "list" | "read" | "create" | "update" | "delete";

export type ExternalIdentity = {
  subject: string;
  email: string;
  displayName: string;
};

export type RuntimeUser = {
  id: string;
  authSubject: string;
  email: string;
  displayName: string;
  roleKey: string;
};

export type ProductionAuthAdapter = {
  currentIdentity(): Promise<ExternalIdentity | null>;
  signInPath: string;
};
