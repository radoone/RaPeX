import { describe, expect, it } from "vitest";
import { ownerTestAccessGranted } from "../app/services/owner-test-access";
import { monitoringState } from "../app/services/monitoring-state";
describe("owner test access",()=>{
 it("requires explicit tenant and installation identity and denies revoked access",()=>{
  const data={shop:"example.myshopify.com",createdAt:{toMillis:()=>123},ownerTestAccess:{shop:"example.myshopify.com",enabled:true,installation:"123",expiresAt:null}};
  expect(ownerTestAccessGranted(data,data.shop)).toBe(true);
  expect(ownerTestAccessGranted(data,"other.myshopify.com")).toBe(false);
  expect(ownerTestAccessGranted({...data,installationRetiredAt:true},data.shop)).toBe(false);
  expect(ownerTestAccessGranted({...data,ownerTestAccess:{...data.ownerTestAccess,enabled:false}},data.shop)).toBe(false);
 });
 it("shows real run failures during owner testing instead of claiming a paid plan",()=>{
  const billing={ownerTestAccess:true,developmentBypass:false,billingVerified:false,hasActivePayment:false};
  expect(monitoringState(billing,"FAILURE")).toBe("failed");
  expect(monitoringState(billing,"processing")).toBe("processing");
  expect(monitoringState({...billing,ownerTestAccess:false},"SUCCESS")).toBe("unverified");
 });
});
