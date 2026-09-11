export class AuthError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

export class NotAMemberError extends AuthError {
  constructor() {
    super("organization not found or you are not a member", "AUTH_NOT_A_MEMBER");
    this.name = "NotAMemberError";
  }
}

export class ForbiddenError extends AuthError {
  constructor(action: string, role: string) {
    super(`user with role ${role} is not authorized to perform action ${action}`, "AUTH_FORBIDDEN");
    this.name = "ForbiddenError";
  }
}

export class OrganizationNotFoundError extends AuthError {
  constructor() {
    super("organization not found or you are not a member", "AUTH_ORG_NOT_FOUND");
    this.name = "OrganizationNotFoundError";
  }
}
