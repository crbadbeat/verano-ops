import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import OrderIntake from "@/components/orders/OrderIntake";
import { createOrderFromPdf, createOrderFromUrl, createOrderManually } from "../actions";

export const dynamic = "force-dynamic";

// Reading a 16-page agreement and writing a large order takes longer than the
// default serverless budget. Set at the page level, this covers every Server
// Action reached from it.
export const maxDuration = 60;

export default async function NewOrderPage() {
  const user = await getViewer();
  if (!user) redirect("/login");
  if (!can(user, "orders:edit")) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-muted">You do not have permission to enter orders.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-6">
      <div>
        <Link href="/orders" className="text-sm text-muted hover:underline">
          ← Orders
        </Link>
        <h1 className="text-3xl font-bold tracking-tight mt-2">New order</h1>
        <p className="text-muted mt-1">
          Whatever you start from, the island configuration is decoded once and
          the base and glass SKUs are composed from it — so what the warehouse
          picks is what the customer signed for.
        </p>
      </div>

      <OrderIntake
        fromPdf={createOrderFromPdf}
        fromUrl={createOrderFromUrl}
        manual={createOrderManually}
      />

      <div className="card p-5 text-sm text-muted space-y-2">
        <h3 className="font-semibold text-foreground">What happens next</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Each island becomes a base SKU and a glass-top SKU, composed from the
            configuration rather than looked up.
          </li>
          <li>
            A SKU nobody has stocked before is created and queued for someone to
            tie to its NetSuite item.
          </li>
          <li>
            A top that has to be cut shows the uncut blank it would come from and
            whether one is on hand. <strong>Nothing is sent to the waterjet</strong> —
            glass is only cut once the customer is scheduled.
          </li>
          <li>Anything that could not be matched to a product is listed for you to map.</li>
        </ul>
      </div>
    </div>
  );
}
