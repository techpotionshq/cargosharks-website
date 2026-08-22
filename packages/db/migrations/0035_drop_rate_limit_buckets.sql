-- `rate_limit_buckets` was declared for the public tracking page's throttle
-- (FR-CP-05) and never written to or read from: the service throttles with
-- `@fastify/rate-limit` in memory, and nothing in either app references the
-- table. A table with a policy and no reader is exactly the kind of thing the
-- next person stops to understand, so it goes.
DROP TABLE "rate_limit_buckets" CASCADE;
