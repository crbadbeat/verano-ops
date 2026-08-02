-- AlterTable
ALTER TABLE "ShowEvent" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "weatherGeocodedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ShowWeatherDay" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "tempMaxF" DOUBLE PRECISION,
    "tempMinF" DOUBLE PRECISION,
    "precipitationIn" DOUBLE PRECISION,
    "windMph" DOUBLE PRECISION,
    "weatherCode" INTEGER,
    "source" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShowWeatherDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShowWeatherDay_eventId_idx" ON "ShowWeatherDay"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "ShowWeatherDay_eventId_date_key" ON "ShowWeatherDay"("eventId", "date");

-- AddForeignKey
ALTER TABLE "ShowWeatherDay" ADD CONSTRAINT "ShowWeatherDay_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ShowEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

