import { isStaff } from "@/lib/roles";

export type HomeStaffCardKind = "admin" | "dealer" | null;

// Precedence for the ONE conditional card slot on the home screen that
// otherwise only ever showed "Админ-панель" for staff: dealer is NOT an
// auth role (isDealer is purely "does this player have a dealer_profiles
// row"), so a staff member who also happens to be a dealer still sees
// "Админ-панель" here -- their personal dealer access lives on their own
// Profile page and the admin landing shortcut instead, not this slot.
export function resolveHomeStaffCardKind(
  role: string | null | undefined,
  isDealer: boolean
): HomeStaffCardKind {
  if (isStaff(role)) {
    return "admin";
  }
  if (isDealer) {
    return "dealer";
  }
  return null;
}
