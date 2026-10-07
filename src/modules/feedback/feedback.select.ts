import type { Prisma } from '../../generated/prisma/client.js';

// Shared by submission and scoped work-order reads; no customer contact/account fields.
export const feedbackSelect = {
  id: true,
  workOrderId: true,
  rating: true,
  comment: true,
  createdAt: true,
} satisfies Prisma.FeedbackSelect;

export function feedbackView(
  feedback: Prisma.FeedbackGetPayload<{ select: typeof feedbackSelect }>,
) {
  return { ...feedback, createdAt: feedback.createdAt.toISOString() };
}
