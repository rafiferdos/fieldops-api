-- CreateEnum
CREATE TYPE "ImagePurpose" AS ENUM ('AVATAR', 'SERVICE');

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "imageUrl" VARCHAR(2048);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarUrl" VARCHAR(2048);

-- CreateTable
CREATE TABLE "MediaUpload" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "purpose" "ImagePurpose" NOT NULL,
    "publicId" VARCHAR(255) NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaUpload_publicId_key" ON "MediaUpload"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaUpload_url_key" ON "MediaUpload"("url");

-- CreateIndex
CREATE INDEX "MediaUpload_ownerId_purpose_createdAt_idx" ON "MediaUpload"("ownerId", "purpose", "createdAt");

-- AddForeignKey
ALTER TABLE "MediaUpload" ADD CONSTRAINT "MediaUpload_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

