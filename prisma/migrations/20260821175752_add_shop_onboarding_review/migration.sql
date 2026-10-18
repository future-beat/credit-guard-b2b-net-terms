-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "onboardingDismissedAt" TIMESTAMP(3),
ADD COLUMN     "onboardingReviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewPromptedAt" TIMESTAMP(3);
