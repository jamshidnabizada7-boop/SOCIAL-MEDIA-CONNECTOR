import { describe, expect, it } from "vitest";
import {
  roleHasPermission,
  ROLE_PERMISSIONS,
  type Permission,
  type Role,
} from "@aria/shared-types";

describe("RBAC permission matrix", () => {
  it("gives the owner every permission", () => {
    const all: Permission[] = [
      "connect_accounts",
      "disconnect_accounts",
      "create_posts",
      "edit_posts",
      "publish_posts",
      "approve_posts",
      "view_analytics",
      "manage_team",
      "manage_billing",
      "manage_workspace",
      "view_inbox",
      "reply_inbox",
      "manage_inbox",
    ];
    for (const p of all) expect(roleHasPermission("owner", p)).toBe(true);
  });

  it("restricts billing to owner only", () => {
    const roles: Role[] = ["admin", "manager", "editor", "approver", "viewer"];
    for (const r of roles)
      expect(roleHasPermission(r, "manage_billing")).toBe(false);
  });

  it("lets editors create but not publish", () => {
    expect(roleHasPermission("editor", "create_posts")).toBe(true);
    expect(roleHasPermission("editor", "publish_posts")).toBe(false);
  });

  it("lets approvers approve and view, nothing else", () => {
    expect(roleHasPermission("approver", "approve_posts")).toBe(true);
    expect(roleHasPermission("approver", "view_analytics")).toBe(true);
    expect(roleHasPermission("approver", "create_posts")).toBe(false);
  });

  it("gives viewers analytics and inbox reading without reply or handling rights", () => {
    expect(ROLE_PERMISSIONS.viewer).toEqual(["view_inbox", "view_analytics"]);
    expect(roleHasPermission("viewer", "reply_inbox")).toBe(false);
    expect(roleHasPermission("viewer", "manage_inbox")).toBe(false);
  });

  it("never grants publish to viewers or approvers", () => {
    expect(roleHasPermission("viewer", "publish_posts")).toBe(false);
    expect(roleHasPermission("approver", "publish_posts")).toBe(false);
  });
});
