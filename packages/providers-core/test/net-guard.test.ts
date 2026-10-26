import { describe, expect, it } from "vitest";
import { assertSafeUrlShape, isPrivateAddress } from "../src/net-guard.js";

describe("private instance address filtering", () => {
  it("rejects mapped/expanded loopback and private IPv6 destinations", () => {
    for (const address of ["::1", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1", "::ffff:7f00:1", "0:0:0:0:0:ffff:a00:1", "::ffff:192.168.1.1", "fc00::1", "fe80::1", "64:ff9b::a00:1", "2002:7f00:1::"]) {
      expect(isPrivateAddress(address), address).toBe(true);
      expect(() => assertSafeUrlShape(new URL(`https://[${address}]/`)), address).toThrow();
    }
  });
  it("permits public IPv4, IPv6 and public mapped addresses", () => {
    for (const address of ["8.8.8.8", "2606:4700:4700::1111", "::ffff:808:808"]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });
});
