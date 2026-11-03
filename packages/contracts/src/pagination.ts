import { z } from 'zod';

/**
 * Standard pagination query parameters across all list endpoints.
 */
export const PaginationQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    starting_after: z.string().optional(),
    ending_before: z.string().optional(),
  })
  .strict();
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/**
 * Generic factory for standard paginated list response envelopes.
 */
export function createPaginatedListResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    object: z.literal('list'),
    data: z.array(itemSchema),
    hasMore: z.boolean(),
    totalCount: z.number().int().min(0).optional(),
  });
}

/**
 * Base paginated list structure with unknown data items.
 */
export const PaginatedListResponseSchema = z.object({
  object: z.literal('list'),
  data: z.array(z.unknown()),
  hasMore: z.boolean(),
  totalCount: z.number().int().min(0).optional(),
});
export type PaginatedListResponse<T = unknown> = {
  object: 'list';
  data: T[];
  hasMore: boolean;
  totalCount?: number;
};
