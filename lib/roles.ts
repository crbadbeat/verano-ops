import type { UserRole } from "@prisma/client";

// Every role an admin may assign, in a sensible display order. `satisfies`
// makes TypeScript flag this list if a new UserRole lands in the enum but is not
// offered here. Kept out of the "use server" actions file (which may only export
// async server actions) so both the actions and the admin UI can import it.
export const ASSIGNABLE_ROLES = [
  "ADMIN",
  "MANAGER",
  "STAFF",
  "CSR",
  "SALES",
  "ACCOUNTING",
  "MFG_MANAGER",
  "WATERJET",
  "RETURNS",
  "DRIVER",
  "EXECUTIVE",
  "PGI_SALES",
] as const satisfies readonly UserRole[];
