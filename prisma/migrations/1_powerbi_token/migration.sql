-- CreateTable
CREATE TABLE "PowerBiToken" (
    "id" TEXT NOT NULL DEFAULT 'current',
    "accessToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sourceIp" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PowerBiToken_pkey" PRIMARY KEY ("id")
);

