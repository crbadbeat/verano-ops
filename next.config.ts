import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Agreements are uploaded through a Server Action, and those cap the
      // request body at 1MB by default — a signed FSA runs to 1.3MB and up, so
      // a large one was rejected before any of our code ran (an instant 500
      // with no message, because there is nothing to catch).
      //
      // Vercel caps a serverless request body at 4.5MB, so this stays under it
      // with room for the boundaries and part headers multipart adds.
      // components/orders/OrderIntake.tsx checks the same number client-side so
      // an oversized file gets an explanation instead of a failure.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
